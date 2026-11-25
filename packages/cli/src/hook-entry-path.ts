import { existsSync } from 'node:fs';

/**
 * The dependency-free hook entry that Claude settings point at: `hooks/` beside
 * the bundle in the published package, else the built core package.
 */
export function hookEntryUrl(): URL {
  const bundled = new URL('./hooks/hook-entry.js', import.meta.url);
  if (existsSync(bundled)) return bundled;
  return new URL(
    '../dist/hooks/hook-entry.js',
    import.meta.resolve('@c9view/core'),
  );
}
