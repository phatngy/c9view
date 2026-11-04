import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runHooksCommand } from './hooks.js';
it('requires --yes without a TTY and installs/uninstalls against a temporary Claude dir', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-cli-hooks-'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await writeFile(join(dir, 'settings.json'), '{"env":{"EXAMPLE":"kept"}}');
    await expect(runHooksCommand('install', dir, false)).rejects.toThrow('TTY');
    expect(await readFile(join(dir, 'settings.json'), 'utf8')).toBe(
      '{"env":{"EXAMPLE":"kept"}}',
    );
    await runHooksCommand('install', dir, true);
    await runHooksCommand('status', dir, true);
    expect(JSON.parse(log.mock.calls.at(-1)![0] as string)).toMatchObject({
      installed: true,
      size: 0,
      lastEventAt: null,
      eventsLastHour: 0,
    });
    await runHooksCommand('uninstall', dir, true);
    expect(
      JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')),
    ).toEqual({ env: { EXAMPLE: 'kept' } });
  } finally {
    log.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});
