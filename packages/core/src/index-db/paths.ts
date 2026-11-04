import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export function assertClaudeDir(claudeDir: string): void {
  try {
    if (statSync(claudeDir).isDirectory()) return;
  } catch {
    // Report a useful input error before opening or creating the database.
  }
  throw new Error(
    `Claude directory does not exist or is not a directory: ${claudeDir}`,
  );
}

// Resolve existing symlinks even when the database or some parents do not exist.
function resolvedPath(file: string): string {
  const absolute = path.resolve(file);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return path.join(
      resolvedPath(path.dirname(absolute)),
      path.basename(absolute),
    );
  }
}

export function assertIndexPath(dbPath: string, claudeDir: string): void {
  if (dbPath === ':memory:') return;
  const root = realpathSync(claudeDir);
  // SQLite sidecars live beside the supplied filename, including symlink files.
  for (const candidate of [
    resolvedPath(dbPath),
    path.join(
      resolvedPath(path.dirname(path.resolve(dbPath))),
      path.basename(dbPath),
    ),
  ]) {
    const relative = path.relative(root, candidate);
    if (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    ) {
      throw new Error('Index database must be outside the Claude directory');
    }
  }
}
