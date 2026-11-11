import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { ControlError } from '../control/errors.js';

const outside = () =>
  new ControlError(
    400,
    'Location is outside the workspace roots',
    'outside-roots',
  );

export interface Location {
  /** Real path of the nearest existing ancestor plus the missing segments. */
  path: string;
  exists: boolean;
  /** Real path of the root that contains it. */
  root: string;
  /** First segment that does not exist yet, when `exists` is false. */
  firstMissing?: string;
}

export const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
};

export async function realRoots(roots: readonly string[]): Promise<string[]> {
  const result: string[] = [];
  for (const root of roots) {
    try {
      if (isAbsolute(root)) result.push(await realpath(root));
    } catch {
      /* A missing root offers nothing. */
    }
  }
  return result;
}

/** Splits a raw path, expands `~` and rejects `..`, `.`, empty segments and NUL. */
export function segmentsOf(location: string): string[] {
  if (location.includes('\0') || location.length > 4096) throw outside();
  let value = location.trim();
  if (value === '~' || value.startsWith('~/'))
    value = join(homedir(), value.slice(1));
  if (!isAbsolute(value)) throw outside();
  const parts = value.split('/').slice(1);
  if (parts.at(-1) === '') parts.pop();
  if (parts.some((part) => part === '' || part === '.' || part === '..'))
    throw outside();
  return parts;
}

/**
 * Resolves the real path of the nearest existing parent, appends the missing
 * segments and requires the result inside a root (never the root itself).
 */
export async function resolveLocation(
  roots: readonly string[],
  location: string,
): Promise<Location> {
  const real = await realRoots(roots);
  if (real.length === 0) throw new ControlError(404, 'Not found');
  const parts = segmentsOf(location);
  const missing: string[] = [];
  let probe = parts;
  let current = '';
  // Walk down while segments exist; lstat so a dangling symlink counts as existing.
  for (let i = 0; i < parts.length; i++) {
    const next = `${current}/${parts[i]}`;
    try {
      await lstat(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw outside();
      probe = parts.slice(0, i);
      missing.push(...parts.slice(i));
      break;
    }
    current = next;
    probe = parts.slice(0, i + 1);
  }
  const existing = `/${probe.join('/')}`;
  let base: string;
  try {
    base = await realpath(existing);
  } catch {
    throw outside();
  }
  const path = join(base, ...missing);
  const root = real.find((candidate) => inside(candidate, path));
  if (!root) throw outside();
  const firstMissing = missing[0] ? join(base, missing[0]) : undefined;
  return {
    path,
    exists: missing.length === 0,
    root,
    ...(firstMissing ? { firstMissing } : {}),
  };
}

/** Claude Code names a project folder after its path with non-alphanumerics as "-". */
export const projectIdFor = (path: string) =>
  path.replace(/[^A-Za-z0-9]/g, '-');
