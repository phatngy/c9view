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
import {
  hookStateDir,
  ensureStateDir,
  assertStateFile,
  checkStateDirSync,
} from './state-dir.js';
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
  expect(() => checkStateDirSync(dir)).toThrow(`chmod 700 '${dir}'`);
  expect((await stat(dir)).mode & 0o777).toBe(0o755);
  await ensureStateDir(dir);
  const file = join(dir, 'identity.json');
  await writeFile(file, '{}', { mode: 0o644 });
  await expect(assertStateFile(file)).rejects.toThrow(`chmod 600 '${file}'`);
  expect((await stat(file)).mode & 0o777).toBe(0o644);
});
it('allows symlinked ancestors but refuses symlinked final folders, files and foreign ownership', async () => {
  const root = await temp(),
    dir = join(root, 'state');
  await mkdir(dir, { mode: 0o700 });
  await symlink(dir, join(root, 'link'));
  await expect(ensureStateDir(join(root, 'link'))).rejects.toThrow('symlink');
  await ensureStateDir(join(root, 'link', 'nested'));
  expect((await stat(join(dir, 'nested'))).mode & 0o777).toBe(0o700);
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

it('checks missing state without creating it and accepts private files', async () => {
  const dir = join(await temp(), 'missing');
  checkStateDirSync(dir);
  await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  await mkdir(dir, { mode: 0o700 });
  for (const name of ['events.jsonl', 'events.1.jsonl']) {
    const file = join(dir, name);
    await writeFile(file, '', { mode: 0o600 });
    checkStateDirSync(dir);
    await chmod(file, 0o644);
    expect(() => checkStateDirSync(dir)).toThrow(`chmod 600 '${file}'`);
    expect((await stat(file)).mode & 0o777).toBe(0o644);
    await chmod(file, 0o600);
  }
});
it('rejects symlinked server folders and event files and foreign owners', async () => {
  const root = await temp();
  const dir = join(root, 'state');
  await mkdir(dir, { mode: 0o700 });
  await symlink(dir, join(root, 'link'));
  expect(() => checkStateDirSync(join(root, 'link'))).toThrow('symlink');
  await symlink(join(root, 'missing'), join(dir, 'events.jsonl'));
  expect(() => checkStateDirSync(dir)).toThrow('symlink');
  await rm(join(dir, 'events.jsonl'));
  if (process.getuid) {
    vi.spyOn(process, 'getuid').mockReturnValue((await stat(dir)).uid + 1);
    expect(() => checkStateDirSync(dir)).toThrow('foreign owner');
  }
});

it('silently discards events when the state argument is missing', async () => {
  const argv = process.argv;
  process.argv = ['node', 'hook', '--c9view-state-dir'];
  try {
    await expect(
      appendHookEvent({
        hook_event_name: 'Stop',
        session_id: 's',
        cwd: '/synthetic',
      }),
    ).resolves.toBeUndefined();
  } finally {
    process.argv = argv;
  }
});
it('writes through a symlinked Claude ancestor and silently skips a symlinked state folder', async () => {
  const root = await temp();
  const claude = join(root, 'dotfiles');
  await mkdir(claude, { mode: 0o755 });
  const alias = join(root, '.claude');
  await symlink(claude, alias);
  const input = { hook_event_name: 'Stop', session_id: 's', cwd: '/synthetic' };
  await appendHookEvent(input, join(alias, 'c9view'));
  expect((await stat(join(claude, 'c9view/events.jsonl'))).mode & 0o777).toBe(
    0o600,
  );
  expect((await stat(claude)).mode & 0o777).toBe(0o755);
  checkStateDirSync(join(alias, 'c9view'));
  const target = join(root, 'target');
  await mkdir(target, { mode: 0o700 });
  await symlink(target, join(alias, 'linked-state'));
  await appendHookEvent(input, join(alias, 'linked-state'));
  await expect(stat(join(target, 'events.jsonl'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
