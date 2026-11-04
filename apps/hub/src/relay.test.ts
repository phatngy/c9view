import { expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import {
  createNodeHello,
  type NodeTransport,
  type NodeResponse,
} from '@c9view/node';
import { createApp } from './app.js';

function setup(response: NodeResponse) {
  const transport: NodeTransport = {
    machineId: 'local',
    hello: createNodeHello,
    request: vi.fn(async () => response),
    subscribe: () => () => {},
    snapshot: async () => ({ projects: [], sessions: [], controlRuns: [] }),
    close: () => {},
  };
  return {
    transport,
    app: createApp(loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/claude' }), {
      transport,
    }),
  };
}

it('relays only the method, node path, query and POST body, preserving response bytes', async () => {
  const encoder = new TextEncoder();
  const { app, transport } = setup({
    status: 202,
    contentType: 'application/octet-stream',
    body: (async function* () {
      yield encoder.encode('first');
      yield encoder.encode('second');
    })(),
  });
  const response = await app.request('/api/control?value=a%26b', {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      cookie: 'secret=fixture',
      authorization: 'Bearer fixture',
      'x-browser-header': 'fixture',
    },
    body: '{"fixture":true}',
  });
  expect(response.status).toBe(202);
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(await response.text()).toBe('firstsecond');
  expect(transport.request).toHaveBeenCalledWith(
    {
      method: 'POST',
      path: '/control',
      query: { value: 'a&b' },
      body: encoder.encode('{"fixture":true}'),
    },
    expect.any(AbortSignal),
  );
});

it('passes browser aborts to the transport and omits bodies from GET envelopes', async () => {
  const { app, transport } = setup({
    status: 200,
    contentType: 'application/json',
    body: (async function* () {
      yield new TextEncoder().encode('{}');
    })(),
  });
  const controller = new AbortController();
  const response = await app.request('/api/projects', {
    signal: controller.signal,
  });
  expect(transport.request).toHaveBeenCalledWith(
    { method: 'GET', path: '/projects', query: {} },
    expect.any(AbortSignal),
  );
  const signal = vi.mocked(transport.request).mock.calls[0]![1];
  expect(signal.aborted).toBe(false);
  controller.abort();
  expect(signal.aborted).toBe(true);
  await response.body?.cancel();
});

it('preserves node health failures without adding success fields', async () => {
  const { app } = setup({
    status: 504,
    contentType: 'application/json',
    body: (async function* () {
      yield new TextEncoder().encode('{"error":"Gateway timeout"}');
    })(),
  });
  const response = await app.request('/api/health');
  expect(response.status).toBe(504);
  expect(await response.json()).toEqual({ error: 'Gateway timeout' });
});
