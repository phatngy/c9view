import { lstat as fsLstat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';

export interface SocketCheckDeps {
  env?: NodeJS.ProcessEnv;
  uid?: number;
  tmp?: string;
  lstat?: (
    path: string,
  ) => Promise<Pick<Stats, 'isDirectory' | 'isSocket' | 'uid' | 'mode'>>;
}

/** Folders Claude Code puts its messaging sockets in, for this user only. */
export function allowedFolders(
  uid: number,
  env: NodeJS.ProcessEnv,
  tmp: string,
): string[] {
  const folders = [
    `/run/user/${uid}/cc-socks`,
    join(tmp, `cc-socks-${uid}`),
    `/tmp/cc-socks-${uid}`,
  ];
  const runtime = env.XDG_RUNTIME_DIR;
  if (runtime && isAbsolute(runtime) && normalize(runtime) === runtime)
    folders.push(join(runtime, 'cc-socks'));
  return folders;
}

/**
 * True only when `path` is a bare absolute normalised `<pid>.sock` directly in
 * an allowed folder, the folder is a real directory of this user that no one
 * else can write, and the path is a socket of this user with no group or
 * other access. Nothing is created, changed or opened; the path is not kept.
 */
export async function socketPathOwned(
  path: unknown,
  pid: number,
  deps: SocketCheckDeps = {},
): Promise<boolean> {
  if (typeof path !== 'string' || path.includes('\0')) return false;
  if (!isAbsolute(path) || normalize(path) !== path) return false;
  if (basename(path) !== `${pid}.sock`) return false;
  const uid = deps.uid ?? process.getuid?.();
  if (uid === undefined) return false;
  const folder = dirname(path);
  const allowed = allowedFolders(
    uid,
    deps.env ?? process.env,
    deps.tmp ?? tmpdir(),
  );
  if (!allowed.includes(folder)) return false;
  const lstat = deps.lstat ?? fsLstat;
  try {
    const directory = await lstat(folder);
    if (
      !directory.isDirectory() ||
      directory.uid !== uid ||
      (directory.mode & 0o022) !== 0
    )
      return false;
    const socket = await lstat(path);
    return (
      socket.isSocket() && socket.uid === uid && (socket.mode & 0o077) === 0
    );
  } catch {
    return false;
  }
}
