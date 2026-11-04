import { lstatSync, type Stats } from 'node:fs';
import { lstat, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME ?? homedir(), '.claude', 'c9view');
}

/** Installed hook arguments survive Claude Code's different environment. */
export function hookStateDir(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): string {
  const index = argv.indexOf('--c9view-state-dir');
  if (index !== -1) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error('Missing --c9view-state-dir path');
    return resolve(value);
  }
  return resolve(env.C9VIEW_STATE_DIR ?? defaultStateDir(env));
}

export function legacyHookStateDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.C9VIEW_LEGACY_STATE_DIR !== undefined)
    return resolve(env.C9VIEW_LEGACY_STATE_DIR);
  if (env.C9VIEW_STATE_DIR !== undefined) return undefined;
  return join(
    env.XDG_STATE_HOME ?? join(env.HOME ?? homedir(), '.local', 'state'),
    'c9view',
  );
}

function quote(path: string): string {
  return "'" + path.replaceAll("'", "'\\''") + "'";
}

/** Ancestors may be symlinks; only the final state folder must be a real directory. */
async function prepareDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/** Only the best-effort hook writer may create or tighten the state folder. */
export async function ensureStateDir(
  path: string = hookStateDir(),
): Promise<void> {
  path = resolve(path);
  await prepareDirectory(path);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`Refusing symlink or invalid state folder: ${path}`);
  if (process.getuid && info.uid !== process.getuid())
    throw new Error(`Refusing foreign owner of state folder: ${path}`);
  if ((info.mode & 0o777) !== 0o700) await chmod(path, 0o700);
}

function checkStateInfo(path: string, info: Stats, directory: boolean): void {
  const kind = directory ? 'folder' : 'file';
  if (
    info.isSymbolicLink() ||
    !(directory ? info.isDirectory() : info.isFile())
  )
    throw new Error(`Refusing symlink or invalid state ${kind}: ${path}`);
  if (process.getuid && info.uid !== process.getuid())
    throw new Error(`Refusing foreign owner of state ${kind}: ${path}`);
  const mode = directory ? '700' : '600';
  if ((info.mode & 0o777) !== Number.parseInt(mode, 8))
    throw new Error(
      `State ${kind} permissions must be 0${mode}; run: chmod ${mode} ${quote(path)}`,
    );
}

/** Startup validation is read-only, including when the state folder is absent. */
export function checkStateDirSync(path: string): void {
  path = resolve(path);
  const inspect = (target: string, directory: boolean): boolean => {
    let info;
    try {
      info = lstatSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    checkStateInfo(target, info, directory);
    return true;
  };
  if (!inspect(path, true)) return;
  for (const file of ['events.jsonl', 'events.1.jsonl'])
    inspect(join(path, file), false);
}

/** Missing files can be created by the caller with mode 0600; existing files are never changed. */
export async function assertStateFile(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error(`Refusing symlink or invalid state file: ${path}`);
  if (process.getuid && info.uid !== process.getuid())
    throw new Error(`Refusing foreign owner of state file: ${path}`);
  if ((info.mode & 0o777) !== 0o600)
    throw new Error(
      `State file permissions must be 0600; run: chmod 600 ${quote(path)}`,
    );
}
