import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import { ControlError } from '../control/errors.js';
import type { GitWriter } from './git-write.js';
import { claimLocation } from './inflight.js';
import {
  inside,
  projectIdFor,
  resolveLocation,
  type Location,
} from './roots.js';

export interface OpenedProject {
  path: string;
  projectId: string;
  created: boolean;
}

/**
 * Creates the missing folders and re-checks that the result still lies in the
 * root. Returns the first directory this call actually created (mkdir's
 * result), or undefined when everything already existed. Cleanup removes only
 * that directory, never a folder another call or process made.
 */
export async function ensureFolder(
  location: Location,
): Promise<string | undefined> {
  if (location.exists) return undefined;
  const created = await mkdir(location.path, { recursive: true });
  try {
    if (!inside(location.root, await realpath(location.path)))
      throw new Error();
  } catch {
    if (created) await rm(created, { recursive: true, force: true });
    throw new ControlError(
      400,
      'Location is outside the workspace roots',
      'outside-roots',
    );
  }
  return created;
}

/** An existing folder opens as is; a missing one is created, with `git init` when asked. */
export async function openProject(
  roots: readonly string[],
  locationText: string,
  gitInit: boolean,
  git: GitWriter,
  forbidden: readonly string[] = [],
): Promise<OpenedProject> {
  const location = await resolveLocation(roots, locationText, forbidden);
  const release = claimLocation(location.path);
  try {
    if (location.exists && !(await stat(location.path)).isDirectory())
      throw new ControlError(400, 'Location is not a folder');
    const created = await ensureFolder(location);
    if (created && gitInit) {
      try {
        await git.init(location.path);
      } catch (error) {
        await rm(created, { recursive: true, force: true });
        throw error;
      }
    }
    return {
      path: location.path,
      projectId: projectIdFor(location.path),
      created: created !== undefined,
    };
  } finally {
    release();
  }
}
