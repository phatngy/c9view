import { cp, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import type { SessionDetailResponse } from '@c9view/api';
import { DataStore, startIndex } from '@c9view/node';
import { createApp } from './app.js';

let dir: string;
let store: DataStore;
let runtime: ReturnType<typeof startIndex> | undefined;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'c9view-index-server-'));
  const claudeDir = join(dir, 'claude');
  await cp(
    fileURLToPath(
      new URL('../../../packages/node/test/fixtures/claude', import.meta.url),
    ),
    claudeDir,
    { recursive: true },
  );
  store = new DataStore(
    loadConfig({
      C9VIEW_CLAUDE_DIR: claudeDir,
      C9VIEW_DB: join(dir, 'index.sqlite'),
    }),
  );
  app = createApp(store.config, { store });
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  store.hooks.close();
  await rm(dir, { recursive: true, force: true });
});
async function json(path: string) {
  const r = await app.request(path);
  expect(r.status).toBe(200);
  return r.json();
}
it('reports building immediately and serves the fallback; search validates and requires readiness', async () => {
  expect((await json('/api/health')).index.state).toBe('building');
  expect((await json('/api/projects')).projects).toHaveLength(2);
  for (const q of ['', ' ', 'x'.repeat(501)])
    expect(
      (await app.request('/api/search?q=' + encodeURIComponent(q))).status,
    ).toBe(400);
  const unavailable = await app.request('/api/search?q=fixture');
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({
    error: 'Search is available once indexing finishes',
  });
  runtime = startIndex(store.config, store);
  await runtime.ready;
  expect((await json('/api/health')).index).toMatchObject({
    state: 'ready',
    lastFullScanAt: expect.any(String),
  });
});
it('streams transcript append events and cleans listeners on cancel and abort', async () => {
  runtime = startIndex(store.config, store);
  await runtime.ready;
  const response = await app.request('/api/events');
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(
    'retry: 3000\n\n',
  );
  expect(store.events.listeners.size).toBe(1);
  await appendFile(
    join(store.config.claudeDir, 'projects/-fixture-alpha/s1.jsonl'),
    JSON.stringify({
      type: 'user',
      uuid: 'append',
      message: { content: 'private transcript content' },
    }) + '\n',
  );
  const chunk = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SSE timeout')), 5000),
    ),
  ]);
  expect(new TextDecoder().decode(chunk.value)).toBe(
    'event: session\ndata: {"projectId":"-fixture-alpha","sessionId":"s1"}\n\n',
  );
  const refreshed = (await json(
    '/api/projects/-fixture-alpha/sessions/s1',
  )) as SessionDetailResponse;
  expect(refreshed.messages.at(-1)?.uuid).toBe('append');
  expect(refreshed.totalMessages).toBe(6);
  await reader.cancel();
  expect(store.events.listeners.size).toBe(0);
  const controller = new AbortController();
  const aborted = await app.request('/api/events', {
    signal: controller.signal,
  });
  controller.abort();
  expect(store.events.listeners.size).toBe(0);
  await aborted.body?.cancel();
});
it('caps clients and enforces Host/Origin on streams', async () => {
  const clients = await Promise.all(
    Array.from({ length: 32 }, () => app.request('/api/events')),
  );
  expect(store.events.listeners.size).toBe(32);
  expect((await app.request('/api/events')).status).toBe(503);
  for (const headers of [
    { host: 'evil.example' },
    { origin: 'https://evil.example' },
  ])
    expect((await app.request('/api/events', { headers })).status).toBe(403);
  await Promise.all(clients.map((r) => r.body!.cancel()));
  expect(store.events.listeners.size).toBe(0);
});
it('sends heartbeat comments every fifteen seconds', async () => {
  vi.useFakeTimers();
  try {
    const response = await app.request('/api/events');
    const reader = response.body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      ': heartbeat\n\n',
    );
    await reader.cancel();
    expect(store.events.listeners.size).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('drops stalled SSE clients at the byte limit and keeps healthy clients subscribed', async () => {
  const stalled = await app.request('/api/events');
  const healthy = await app.request('/api/events');
  const reader = healthy.body!.getReader();
  await reader.read();
  for (let i = 0; i < 300; i++) {
    store.events.emit({
      event: 'session',
      data: { projectId: 'x'.repeat(1024), sessionId: 's' },
    });
    await reader.read();
  }
  expect(store.events.listeners.size).toBe(1);
  const queued = stalled.body!.getReader();
  let bytes = 0;
  for (;;) {
    const chunk = await queued.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
  }
  expect(bytes).toBeLessThanOrEqual(256 * 1024);
  await reader.cancel();
  expect(store.events.listeners.size).toBe(0);
});
