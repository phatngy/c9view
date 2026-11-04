import { expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  createNodeHello,
  type NodeEvent,
  type NodeTransport,
} from '@c9view/node';
import { eventRoutes } from './events.js';

function setup() {
  let emit: (event: NodeEvent) => void = () => {};
  const unsubscribe = vi.fn();
  const transport: NodeTransport = {
    machineId: 'forged-channel',
    hello: createNodeHello,
    subscribe: (listener) => {
      emit = listener;
      return unsubscribe;
    },
    request: vi.fn(),
    snapshot: vi.fn(),
    close: vi.fn(),
  };
  const app = new Hono().route('/api', eventRoutes(transport));
  return {
    app,
    transport,
    unsubscribe,
    emit: (event: NodeEvent) => emit(event),
  };
}

it('keeps retry first, announces local, and stamps node events with hub identity', async () => {
  const { app, transport, emit, unsubscribe } = setup();
  const response = await app.request('/api/events');
  const reader = response.body!.getReader();
  const read = async () =>
    new TextDecoder().decode((await reader.read()).value);
  expect(await read()).toBe('retry: 3000\n\n');
  expect(await read()).toBe(
    `event: machine\ndata: ${JSON.stringify({ type: 'machine', machineId: 'local', state: 'online', bootId: transport.hello().bootId })}\n\n`,
  );
  emit({
    type: 'session',
    machineId: 'forged',
    projectId: 'p',
    sessionId: 's',
  });
  expect(await read()).toBe(
    'event: session\ndata: {"machineId":"local","event":{"type":"session","machineId":"local","projectId":"p","sessionId":"s"}}\n\n',
  );
  emit({ type: 'config' });
  expect(await read()).toBe(
    'event: config\ndata: {"machineId":"local","event":{"type":"config"}}\n\n',
  );
  await reader.cancel();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('retains heartbeats, client cap, and releases slots on cancellation', async () => {
  vi.useFakeTimers();
  try {
    const { app } = setup();
    const readers = [];
    for (let i = 0; i < 32; i++) {
      const response = await app.request('/api/events');
      const reader = response.body!.getReader();
      await reader.read();
      await vi.advanceTimersByTimeAsync(100);
      await reader.read();
      readers.push(reader);
    }
    expect((await app.request('/api/events')).status).toBe(503);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await readers[0]!.read()).value)).toBe(
      ': heartbeat\n\n',
    );
    await Promise.all(readers.map((reader) => reader.cancel()));
    const response = await app.request('/api/events');
    expect(response.status).toBe(200);
    await response.body?.cancel();
  } finally {
    vi.useRealTimers();
  }
});
