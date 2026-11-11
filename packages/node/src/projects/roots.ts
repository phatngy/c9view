import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { encodeProjectPath } from '@c9view/core';
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
  let value = location;
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
  forbidden: readonly string[] = [],
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
  // c9view never creates or opens folders in or around Claude data or its state folder.
  for (const folder of forbidden)
    if (overlaps(await canonical(folder), path)) throw outside();
  if (projectIdFor(path).length > MAX_PROJECT_ID)
    throw new ControlError(400, 'Location path is too long');
  const firstMissing = missing[0] ? join(base, missing[0]) : undefined;
  return {
    path,
    exists: missing.length === 0,
    root,
    ...(firstMissing ? { firstMissing } : {}),
  };
}

/**
 * Claude Code names a project folder after its path with non-alphanumerics as
 * "-" (core's rule). Claude Code hashes names longer than about 200 characters,
 * which core does not model, so `resolveLocation` refuses such locations
 * rather than computing a wrong project ID.
 */
export const projectIdFor = encodeProjectPath;
export const MAX_PROJECT_ID = 200;

/** Real path of the nearest existing ancestor plus the missing tail. */
async function canonical(value: string): Promise<string> {
  let path = value;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(await realpath(path), ...tail);
    } catch (error) {
      const parent = dirname(path);
      if (parent === path || (error as NodeJS.ErrnoException).code !== 'ENOENT')
        return value;
      tail.unshift(basename(path));
      path = parent;
    }
  }
}
const overlaps = (a: string, b: string) =>
  a === b || inside(a, b) || inside(b, a);
