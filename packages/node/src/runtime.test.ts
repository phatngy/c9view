import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadConfig } from '@c9view/core';
import { createNode } from './runtime.js';
import { HookEvents } from './data/hook-events.js';
import { createNodeApp } from './app.js';
import { InProcessTransport, type NodeEvent } from './transport.js';

it('shares one index and event hub between runtime, transport and routes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-runtime-'));
  const claudeDir = join(dir, 'claude');
  await cp(
    fileURLToPath(new URL('../test/fixtures/claude', import.meta.url)),
    claudeDir,
    { recursive: true },
  );
  const runtime = createNode(
    loadConfig({
      C9VIEW_CLAUDE_DIR: claudeDir,
      C9VIEW_DB: join(dir, 'index.db'),
    }),
    { hooks: new HookEvents(join(dir, 'hooks')) },
  );
  const app = createNodeApp(runtime);
  const transport = new InProcessTransport(runtime, app);
  try {
    const events: NodeEvent[] = [];
    transport.subscribe((event) => events.push(event));
    const index = runtime.start();
    expect(runtime.start()).toBe(index);
    await index.ready;
    expect(events).toContainEqual({ type: 'index', state: 'ready' });
    expect(runtime.events).toBe(runtime.store.events);
    expect(runtime.store.readyIndex).toBe(runtime.store.index);
    const health = await (await app.request('/health')).json();
    expect(health.index).toEqual(runtime.store.indexHealth);
    expect(health.version).toBe(runtime.hello.version);
    expect((await transport.snapshot()).sessions[0]).toHaveProperty(
      'status.column',
    );
    for (const path of ['/events', '/api/overview', '/control', '/missing']) {
      expect((await app.request(path)).status).toBe(404);
    }
    expect(
      (
        await app.request('/overview', {
          headers: {
            host: 'browser.invalid',
            origin: 'https://browser.invalid',
          },
        })
      ).status,
    ).toBe(200);
    await Promise.all([runtime.close(), runtime.close()]);
    expect(runtime.store.index).toBeUndefined();
    expect(() => runtime.start()).toThrow('closed');
  } finally {
    transport.close();
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});
