import { ControlError } from '../control/errors.js';

const active = new Set<string>();

/** Claims a real location for one create or clone at a time; returns the release function. */
export function claimLocation(path: string): () => void {
  if (active.has(path))
    throw new ControlError(
      409,
      'Another request is already using this location',
      'run-exists',
    );
  active.add(path);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(path);
  };
}
