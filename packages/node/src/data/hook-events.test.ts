import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  chmod,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { appendHookEvent, normalizeHookEvent, loadConfig } from '@c9view/core';
import { HookEvents } from './hook-events.js';
import { DataStore } from './store.js';
import { createApp } from '../test-app.js';
it('serves hook-derived status, bounded history and health from a temporary state dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-status-server-'));
  vi.stubEnv('HOME', dir);
  vi.stubEnv('XDG_STATE_HOME', join(dir, 'xdg'));
  vi.stubEnv('C9VIEW_STATE_DIR', join(dir, 'state'));
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', join(dir, 'legacy'));
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
    await mkdir(join(dir, 'legacy'));
    await writeFile(
      join(dir, 'legacy/events.jsonl'),
      JSON.stringify(
        normalizeHookEvent(
          { hook_event_name: 'Stop', session_id: 's', cwd: '/tmp/project' },
          new Date(Date.now() - 1000),
        ),
      ) + '\n',
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
    expect(hooks.events('s')).toHaveLength(2);
    const history = await app.request(
      '/api/projects/p/sessions/s/status/history',
    );
    expect(await history.json()).toMatchObject({
      changes: expect.arrayContaining([
        {
          at: expect.any(String),
          column: 'need_input',
          reason: expect.any(String),
          source: 'hook',
        },
      ]),
    });
    const health = await app.request('/api/health');
    expect(await health.json()).toMatchObject({
      hooks: {
        installed: false,
        eventsFile: join(stateDir, 'events.jsonl'),
        legacyEventsFile: join(dir, 'legacy/events.jsonl'),
        lastEventAt: expect.any(String),
      },
    });
    expect(
      (await app.request('/api/projects/p/sessions/missing/status/history'))
        .status,
    ).toBe(404);
  } finally {
    vi.unstubAllEnvs();
    hooks.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it('validates server state read-only before building a tailer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c9view-startup-'));
  const dir = join(root, 'state');
  try {
    const hooks = new HookEvents(dir);
    hooks.close();
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    await mkdir(dir, { mode: 0o755 });
    expect(() => new HookEvents(dir)).toThrow(`chmod 700 '${dir}'`);
    expect((await stat(dir)).mode & 0o777).toBe(0o755);
    await chmod(dir, 0o700);
    for (const name of ['events.jsonl', 'events.1.jsonl']) {
      const file = join(dir, name);
      await writeFile(file, '', { mode: 0o644 });
      expect(() => new HookEvents(dir)).toThrow(`chmod 600 '${file}'`);
      await chmod(file, 0o600);
      new HookEvents(dir).close();
      await rm(file);
      await symlink(join(root, 'missing'), file);
      expect(() => new HookEvents(dir)).toThrow('symlink');
      await rm(file);
    }
    await symlink(dir, join(root, 'link'));
    expect(() => new HookEvents(join(root, 'link'))).toThrow('symlink');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('returns timestamp-merged history and latest event across legacy and current files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'c9view-merged-'));
  const current = join(root, 'current');
  const legacy = join(root, 'legacy');
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', legacy);
  let hooks: HookEvents | undefined;
  try {
    await mkdir(current, { mode: 0o700 });
    await mkdir(legacy, { mode: 0o755 });
    const timestamps = [0, 1, 2, 3].map(
      (second) => new Date(Date.now() - 4000 + second * 1000),
    );
    const event = (index: number, name: string) =>
      JSON.stringify(
        normalizeHookEvent(
          { hook_event_name: name, session_id: 's', cwd: '/synthetic' },
          timestamps[index],
        ),
      ) + '\n';
    await writeFile(
      join(current, 'events.jsonl'),
      event(1, 'PermissionRequest') + event(3, 'PermissionRequest'),
      { mode: 0o600 },
    );
    await writeFile(
      join(legacy, 'events.jsonl'),
      event(0, 'UserPromptSubmit') + event(2, 'UserPromptSubmit'),
      { mode: 0o644 },
    );
    hooks = new HookEvents(current);
    await hooks.refresh();
    expect(hooks.events('s').map((e) => e.ts)).toEqual(
      timestamps.map((t) => t.toISOString()),
    );
    expect(hooks.history('s').changes.map((c) => [c.at, c.column])).toEqual(
      timestamps.map((t, i) => [
        t.toISOString(),
        i % 2 ? 'need_input' : 'in_progress',
      ]),
    );
    expect((await hooks.health(join(root, 'claude'))).lastEventAt).toBe(
      timestamps[3]!.toISOString(),
    );
  } finally {
    hooks?.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
