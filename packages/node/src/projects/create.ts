import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import { ControlError } from '../control/errors.js';
import type { GitWriter } from './git-write.js';
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

/** Creates the missing folders and re-checks that the result still lies in the root. */
export async function ensureFolder(location: Location): Promise<void> {
  if (!location.exists) {
    await mkdir(location.path, { recursive: true });
    try {
      if (!inside(location.root, await realpath(location.path)))
        throw new Error();
    } catch {
      if (location.firstMissing)
        await rm(location.firstMissing, { recursive: true, force: true });
      throw new ControlError(
        400,
        'Location is outside the workspace roots',
        'outside-roots',
      );
    }
  }
}

/** An existing folder opens as is; a missing one is created, with `git init` when asked. */
export async function openProject(
  roots: readonly string[],
  locationText: string,
  gitInit: boolean,
  git: GitWriter,
): Promise<OpenedProject> {
  const location = await resolveLocation(roots, locationText);
  if (location.exists && !(await stat(location.path)).isDirectory())
    throw new ControlError(400, 'Location is not a folder');
  await ensureFolder(location);
  if (!location.exists && gitInit) {
    try {
      await git.init(location.path);
    } catch (error) {
      if (location.firstMissing)
        await rm(location.firstMissing, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    path: location.path,
    projectId: projectIdFor(location.path),
    created: !location.exists,
  };
}
