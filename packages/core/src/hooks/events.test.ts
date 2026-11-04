import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { HookEventTailer, normalizeHookEvent } from './events.js';
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
it.each(['default', 'xdg', 'explicit', 'disabled'])(
  'reads legacy state read-only and merges by timestamp: %s',
  async (mode) => {
    const home = await mkdtemp(join(tmpdir(), 'c9view-legacy-'));
    dirs.push(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv(
      'XDG_STATE_HOME',
      mode === 'xdg' ? join(home, 'xdg') : undefined,
    );
    vi.stubEnv(
      'C9VIEW_STATE_DIR',
      ['explicit', 'disabled'].includes(mode)
        ? join(home, 'custom')
        : undefined,
    );
    vi.stubEnv(
      'C9VIEW_LEGACY_STATE_DIR',
      mode === 'explicit' ? join(home, 'legacy') : undefined,
    );
    const legacy =
      mode === 'explicit'
        ? join(home, 'legacy')
        : join(
            mode === 'xdg' ? join(home, 'xdg') : join(home, '.local/state'),
            'c9view',
          );
    const state = process.env.C9VIEW_STATE_DIR ?? join(home, '.claude/c9view');
    const event = (ts: string) =>
      JSON.stringify(
        normalizeHookEvent(
          { hook_event_name: 'Stop', session_id: 's', cwd: home },
          new Date(ts),
        ),
      ) + '\n';
    await mkdir(legacy, { recursive: true });
    await mkdir(state, { recursive: true });
    const old = join(legacy, 'events.jsonl'),
      bytes = event('2026-01-01T00:00:00Z');
    await writeFile(old, bytes);
    await writeFile(join(state, 'events.jsonl'), event('2026-01-02T00:00:00Z'));
    const before = await stat(old);
    const tail = new HookEventTailer();
    await tail.refresh();
    await tail.refresh();
    expect(tail.sessions.get('s')?.map((e) => e.ts)).toEqual(
      mode === 'disabled'
        ? ['2026-01-02T00:00:00.000Z']
        : ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'],
    );
    expect(await readFile(old, 'utf8')).toBe(bytes);
    const after = await stat(old);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
    expect(after.mode).toBe(before.mode);
  },
);
