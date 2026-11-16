import { ControlError } from '../control/errors.js';
import { inside } from './roots.js';

const active = new Set<string>();

/**
 * Claims a real location for one create or clone at a time; returns the release function.
 * A path that is an ancestor or a descendant of an active claim is refused too.
 */
export function claimLocation(path: string): () => void {
  for (const other of active)
    if (other === path || inside(other, path) || inside(path, other))
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
