import { realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
  isAbsolute,
} from 'node:path';

function canonical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute
      ? absolute
      : join(canonical(parent), basename(absolute));
  }
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

/** Resolve aliases and not-yet-created children, with directory boundaries. */
export function isC9viewStatePath(
  claudeDir: string,
  stateDir: string,
  path: string,
): boolean {
  const root = canonical(claudeDir),
    candidate = canonical(path),
    state = canonical(stateDir);
  return (
    inside(canonical(join(claudeDir, 'c9view')), candidate) ||
    (inside(root, state) && inside(state, candidate))
  );
}
