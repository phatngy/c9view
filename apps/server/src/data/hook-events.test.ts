import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { appendHookEvent, loadConfig } from '@c9view/core';
import { HookEvents } from './hook-events.js';
import { DataStore } from './store.js';
import { createApp } from '../app.js';
it('serves hook-derived status, bounded history and health from a temporary state dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-status-server-'));
  const claudeDir = join(dir, 'claude');
  const stateDir = join(dir, 'state');
  const hooks = new HookEvents(stateDir);
  const store = new DataStore(loadConfig({ C9VIEW_CLAUDE_DIR: claudeDir }));
  store.hooks.close();
  Object.defineProperty(store, 'hooks', { value: hooks });
  try {
    await mkdir(join(claudeDir, 'projects', 'p'), { recursive: true });
    await mkdir(join(claudeDir, 'sessions'), { recursive: true });
    await writeFile(
      join(claudeDir, 'projects', 'p', 's.jsonl'),
      JSON.stringify({
        type: 'user',
        uuid: 'u',
        timestamp: new Date().toISOString(),
        message: { content: 'synthetic' },
      }) + '\n',
    );
    await writeFile(
      join(claudeDir, 'sessions', 'live.json'),
      JSON.stringify({
        pid: process.pid,
        sessionId: 's',
        status: 'busy',
        statusUpdatedAt: Date.now(),
      }),
    );
    await appendHookEvent(
      {
        hook_event_name: 'PermissionRequest',
        session_id: 's',
        cwd: '/tmp/project',
        tool_name: 'Bash',
      },
      stateDir,
    );
    const app = createApp(store.config, { store });
    const status = await app.request('/api/projects/p/sessions/s/status');
    expect(await status.json()).toMatchObject({
      status: {
        column: 'need_input',
        source: 'hook',
        confidence: 'medium',
        stale: false,
      },
    });
    const history = await app.request(
      '/api/projects/p/sessions/s/status/history',
    );
    expect(await history.json()).toMatchObject({
      changes: [{ column: 'need_input', source: 'hook' }],
    });
    const health = await app.request('/api/health');
    expect(await health.json()).toMatchObject({
      hooks: {
        installed: false,
        eventsFile: join(stateDir, 'events.jsonl'),
        lastEventAt: expect.any(String),
      },
    });
    expect(
      (await app.request('/api/projects/p/sessions/missing/status/history'))
        .status,
    ).toBe(404);
  } finally {
    hooks.close();
    await rm(dir, { recursive: true, force: true });
  }
});
