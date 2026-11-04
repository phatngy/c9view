import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runHooksCommand } from './hooks.js';
it('requires --yes without a TTY and installs/uninstalls against a temporary Claude dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-cli-hooks-'));
  vi.stubEnv('HOME', dir);
  vi.stubEnv('XDG_STATE_HOME', join(dir, 'xdg'));
  vi.stubEnv('C9VIEW_STATE_DIR', join(dir, "custom state's"));
  vi.stubEnv('C9VIEW_LEGACY_STATE_DIR', join(dir, 'legacy'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await writeFile(join(dir, 'settings.json'), '{"env":{"EXAMPLE":"kept"}}');
    await expect(runHooksCommand('install', dir, false)).rejects.toThrow('TTY');
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(
      '{"env":{"EXAMPLE":"kept"}}',
    );
    await runHooksCommand('install', dir, true);
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toContain(
      '--c9view-state-dir',
    );
    await runHooksCommand('status', dir, true);
    expect(JSON.parse(log.mock.calls.at(-1)![0] as string)).toMatchObject({
      installed: true,
      eventsFile: join(dir, "custom state's", 'events.jsonl'),
      legacyEventsFile: join(dir, 'legacy/events.jsonl'),
      legacySize: 0,
      size: 0,
      lastEventAt: null,
      eventsLastHour: 0,
    });
    vi.stubEnv('C9VIEW_STATE_DIR', join(dir, 'replacement'));
    await runHooksCommand('install', dir, true);
    const replaced = await readFile(join(dir, 'settings.json'), 'utf8');
    expect(replaced).toContain(join(dir, 'replacement'));
    expect(replaced).not.toContain('custom state');
    vi.stubEnv('C9VIEW_STATE_DIR', undefined);
    await runHooksCommand('install', dir, true);
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).not.toContain(
      '--c9view-state-dir',
    );
    await runHooksCommand('uninstall', dir, true);
    expect(
      JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')),
    ).toEqual({ env: { EXAMPLE: 'kept' } });
  } finally {
    vi.unstubAllEnvs();
    log.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
