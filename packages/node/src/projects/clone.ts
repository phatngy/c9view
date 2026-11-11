import { readdir, rm, stat } from 'node:fs/promises';
import { ControlError } from '../control/errors.js';
import type { GitWriter } from './git-write.js';
import { ensureFolder } from './create.js';
import { claimLocation } from './inflight.js';
import { projectIdFor, resolveLocation, type Location } from './roots.js';
import type { ParsedGitUrl } from './url.js';

export interface ClonePlan {
  location: Location;
  projectId: string;
  /** Releases the in-flight claim on the location; `runClone` calls it. */
  release: () => void;
}

const notEmpty = () =>
  new ControlError(400, 'Folder is not empty', 'not-empty');

/**
 * Validates the target synchronously so a bad location or a full folder never
 * starts a clone, and claims the location until `runClone` finishes.
 */
export async function planClone(
  roots: readonly string[],
  locationText: string,
  forbidden: readonly string[] = [],
): Promise<ClonePlan> {
  const location = await resolveLocation(roots, locationText, forbidden);
  const release = claimLocation(location.path);
  try {
    if (location.exists) {
      if (!(await stat(location.path)).isDirectory())
        throw new ControlError(400, 'Location is not a folder');
      if ((await readdir(location.path)).length > 0) throw notEmpty();
    }
  } catch (error) {
    release();
    throw error;
  }
  return { location, projectId: projectIdFor(location.path), release };
}

/**
 * Clones into a missing or empty folder. On failure it removes only the first
 * directory this call created, never a folder that already existed.
 */
export async function runClone(
  plan: ClonePlan,
  url: ParsedGitUrl,
  git: GitWriter,
  signal?: AbortSignal,
): Promise<string> {
  const { location } = plan;
  try {
    const created = await ensureFolder(location);
    // The folder may have been populated between planning and now.
    if ((await readdir(location.path)).length > 0) throw notEmpty();
    try {
      await git.clone(url, location.path, signal);
    } catch (error) {
      if (created) await rm(created, { recursive: true, force: true });
      throw error;
    }
    return location.path;
  } finally {
    plan.release();
  }
}
