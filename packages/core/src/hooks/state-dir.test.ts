import {
  mkdtemp,
  mkdir,
  chmod,
  stat,
  symlink,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { hookStateDir, ensureStateDir, assertStateFile } from './state-dir.js';
import { appendHookEvent } from './hook-entry.js';
const dirs: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'c9view-state-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
it('resolves argument before environment before the fixed home default', async () => {
  const home = await temp();
  expect(
    hookStateDir(
      {
        HOME: home,
        XDG_STATE_HOME: join(home, 'xdg'),
        C9VIEW_CLAUDE_DIR: join(home, 'other'),
      },
      [],
    ),
  ).toBe(join(home, '.claude/c9view'));
  expect(
    hookStateDir({ HOME: home, C9VIEW_STATE_DIR: join(home, 'env') }, []),
  ).toBe(join(home, 'env'));
  expect(
    hookStateDir({ HOME: home, C9VIEW_STATE_DIR: join(home, 'env') }, [
      '--c9view-state-dir',
      join(home, 'arg'),
    ]),
  ).toBe(join(home, 'arg'));
  expect(() => hookStateDir({ HOME: home }, ['--c9view-state-dir'])).toThrow();
});
it('creates private state and refuses wider server permissions without changing them', async () => {
  const dir = join(await temp(), 'state');
  await ensureStateDir(dir);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  await chmod(dir, 0o755);
  await expect(ensureStateDir(dir)).rejects.toThrow(`chmod 700 '${dir}'`);
  expect((await stat(dir)).mode & 0o777).toBe(0o755);
  await ensureStateDir(dir, 'hook');
  const file = join(dir, 'identity.json');
  await writeFile(file, '{}', { mode: 0o644 });
  await expect(assertStateFile(file)).rejects.toThrow(`chmod 600 '${file}'`);
  expect((await stat(file)).mode & 0o777).toBe(0o644);
});
it('refuses symlinked folders, ancestor folders, files and foreign ownership without root', async () => {
  const root = await temp(),
    dir = join(root, 'state');
  await mkdir(dir, { mode: 0o700 });
  await symlink(dir, join(root, 'link'));
  await expect(ensureStateDir(join(root, 'link'))).rejects.toThrow('symlink');
  await expect(ensureStateDir(join(root, 'link', 'nested'))).rejects.toThrow(
    'symlink',
  );
  const file = join(root, 'target');
  await writeFile(file, 'untouched');
  await symlink(file, join(dir, 'identity.json'));
  await expect(assertStateFile(join(dir, 'identity.json'))).rejects.toThrow(
    'symlink',
  );
  if (process.getuid) {
    vi.spyOn(process, 'getuid').mockReturnValue((await stat(dir)).uid + 1);
    await expect(ensureStateDir(dir)).rejects.toThrow('owner');
  }
});
it('writes private event files and tightens owned hook folders', async () => {
  const dir = await temp();
  await chmod(dir, 0o755);
  await appendHookEvent(
    { hook_event_name: 'Stop', session_id: 'synthetic', cwd: dir },
    dir,
  );
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  expect((await stat(join(dir, 'events.jsonl'))).mode & 0o777).toBe(0o600);
});
