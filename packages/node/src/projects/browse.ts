import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { WorkspaceBrowse } from '@c9view/api';
import { ControlError } from '../control/errors.js';
import { inside, realRoots, segmentsOf } from './roots.js';

const MAX_ENTRIES = 500;

/** One level of directories under the roots; hidden ones only on request. */
export async function browse(
  roots: readonly string[],
  path: string | undefined,
  hidden: boolean,
): Promise<WorkspaceBrowse> {
  const real = await realRoots(roots);
  if (real.length === 0) throw new ControlError(404, 'Not found');
  if (path === undefined || path === '')
    return {
      entries: real.map((root) => ({ name: root, path: root })),
      truncated: false,
    };
  segmentsOf(path);
  let folder: string;
  try {
    folder = await realpath(path);
    if (!(await stat(folder)).isDirectory()) throw new Error('not a folder');
  } catch {
    throw new ControlError(404, 'Not found');
  }
  const root = real.find(
    (candidate) => candidate === folder || inside(candidate, folder),
  );
  if (!root)
    throw new ControlError(
      400,
      'Location is outside the workspace roots',
      'outside-roots',
    );
  const names = (await readdir(folder, { withFileTypes: true }))
    // Symlinks are never listed, so a link cannot lead out of the roots.
    .filter(
      (entry) => entry.isDirectory() && (hidden || !entry.name.startsWith('.')),
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return {
    path: folder,
    ...(folder !== root ? { parent: dirname(folder) } : {}),
    entries: names
      .slice(0, MAX_ENTRIES)
      .map((name) => ({ name, path: join(folder, name) })),
    truncated: names.length > MAX_ENTRIES,
  };
}
