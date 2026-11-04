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

/** Check every component before creating anything through a symlink. */
async function prepareDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await prepareDirectory(parent);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error(`Refusing symlink state folder: ${path}`);
    if (!info.isDirectory()) throw new Error(`Not a state folder: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (creationError) {
      if ((creationError as NodeJS.ErrnoException).code !== 'EEXIST')
        throw creationError;
      await prepareDirectory(path);
    }
  }
}

/** Hooks may tighten their own folder. Native node/hub callers must never tighten. */
export async function ensureStateDir(
  path: string = hookStateDir(),
  caller: 'server' | 'hook' = 'server',
): Promise<void> {
  await prepareDirectory(resolve(path));
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`Refusing symlink or invalid state folder: ${path}`);
  if (process.getuid && info.uid !== process.getuid())
    throw new Error(`Refusing foreign owner of state folder: ${path}`);
  if ((info.mode & 0o777) !== 0o700) {
    if (caller === 'hook') await chmod(path, 0o700);
    else
      throw new Error(
        `State folder permissions must be 0700; run: chmod 700 ${quote(path)}`,
      );
  }
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
