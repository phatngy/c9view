import { readdir, rm, stat } from 'node:fs/promises';
import { ControlError } from '../control/errors.js';
import type { GitWriter } from './git-write.js';
import { ensureFolder } from './create.js';
import { projectIdFor, resolveLocation, type Location } from './roots.js';
import type { ParsedGitUrl } from './url.js';

export interface ClonePlan {
  location: Location;
  projectId: string;
}

/** Validates the target synchronously so a bad location or a full folder never starts a clone. */
export async function planClone(
  roots: readonly string[],
  locationText: string,
): Promise<ClonePlan> {
  const location = await resolveLocation(roots, locationText);
  if (location.exists) {
    if (!(await stat(location.path)).isDirectory())
      throw new ControlError(400, 'Location is not a folder');
    if ((await readdir(location.path)).length > 0)
      throw new ControlError(400, 'Folder is not empty', 'not-empty');
  }
  return { location, projectId: projectIdFor(location.path) };
}

/** Clones into a missing or empty folder; removes what this call created on failure. */
export async function runClone(
  plan: ClonePlan,
  url: ParsedGitUrl,
  git: GitWriter,
  signal?: AbortSignal,
): Promise<string> {
  const { location } = plan;
  await ensureFolder(location);
  try {
    await git.clone(url, location.path, signal);
  } catch (error) {
    if (location.firstMissing)
      await rm(location.firstMissing, { recursive: true, force: true });
    throw error;
  }
  return location.path;
}
