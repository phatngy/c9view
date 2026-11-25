// Checks and notices derived from the esbuild metafiles of the release bundle.
import type { Metafile } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  dir: string;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
/**
 * The package folder (under a node_modules) that a module path belongs to,
 * relative to the same root as `input`. Handles pnpm's nested layout, bundler
 * query strings and virtual ids.
 */
export function packageDirOf(input: string): string | undefined {
  const marker = 'node_modules/';
  const path = input.replace(/[?#].*$/, '').replaceAll('\\', '/');
  const at = path.lastIndexOf(marker);
  if (at < 0 || path.startsWith('\0')) return undefined;
  const rest = path.slice(at + marker.length).split('/');
  const depth = rest[0]?.startsWith('@') ? 2 : 1;
  if (rest.length <= depth) return undefined;
  return path.slice(0, at + marker.length) + rest.slice(0, depth).join('/');
}
function packageDir(repoRoot: string, input: string): string | undefined {
  const dir = packageDirOf(input);
  return dir && resolve(repoRoot, dir);
}
export function packageAt(dir: string): BundledPackage {
  const pkg = readJson(join(dir, 'package.json'));
  return {
    name: String(pkg['name']),
    version: String(pkg['version']),
    license: String(
      typeof pkg['license'] === 'string' ? pkg['license'] : 'see license file',
    ),
    dir,
  };
}
/** Third-party packages whose code is inlined into the bundle. */
export function bundledPackages(
  repoRoot: string,
  metafiles: Metafile[],
  extraModules: string[] = [],
): BundledPackage[] {
  const dirs = new Set<string>();
  for (const id of extraModules) {
    const dir = packageDir(repoRoot, id);
    if (dir) dirs.add(dir);
  }
  for (const meta of metafiles)
    for (const input of Object.keys(meta.inputs)) {
      const dir = packageDir(repoRoot, input);
      if (dir) dirs.add(dir);
    }
  return dedupePackages(
    [...dirs]
      .filter((dir) => existsSync(join(dir, 'package.json')))
      .map(packageAt),
  );
}
/** Drops workspace packages and repeats of one name@version; sorts by name. */
export function dedupePackages(packages: BundledPackage[]): BundledPackage[] {
  const seen = new Map<string, BundledPackage>();
  for (const p of packages)
    if (!p.name.startsWith('@c9view/')) seen.set(`${p.name}@${p.version}`, p);
  return [...seen.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}
function licenseFile(dir: string): string | undefined {
  return readdirSync(dir).find((f) =>
    /^(licen[sc]e|copying|notice)(\.|$)/i.test(f),
  );
}
/** Release check: every bundled package needs a license file or a license field. */
export function assertAllLicensed(packages: BundledPackage[]): void {
  const missing = packages
    .filter((p) => !licenseFile(p.dir) && p.license === 'see license file')
    .map((p) => `${p.name}@${p.version}`);
  if (missing.length > 0)
    throw new Error(
      `No license file and no license field for bundled packages: ${missing.join(', ')}`,
    );
}
function licenseText(p: BundledPackage): string {
  const file = licenseFile(p.dir);
  return file
    ? readFileSync(join(p.dir, file), 'utf8').trim()
    : `(no license file in the package; license field of its package.json: ${p.license})`;
}
export function noticesText(packages: BundledPackage[]): string {
  const header =
    'Third-party packages bundled into the JavaScript and web app of @phatngy/c9view.\n' +
    'External runtime dependencies (better-sqlite3 and @anthropic-ai/claude-agent-sdk)\n' +
    'are not included here; npm installs them with their own licenses.\n';
  return (
    header +
    packages
      .map(
        (p) =>
          `\n${'='.repeat(72)}\n${p.name}@${p.version} (${p.license})\n${'='.repeat(72)}\n${licenseText(p)}\n`,
      )
      .join('')
  );
}
function hasDevelopment(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, child]) => key === 'development' || hasDevelopment(child),
  );
}
/**
 * The bundle resolves the `development` export condition so workspace packages
 * load their TypeScript source. That must not change which files a third-party
 * package contributes.
 */
export function assertNoThirdPartyDevelopmentExports(
  packages: BundledPackage[],
): void {
  for (const p of packages) {
    const pkg = readJson(join(p.dir, 'package.json'));
    if (hasDevelopment(pkg['exports']) || hasDevelopment(pkg['imports']))
      throw new Error(
        `${p.name}@${p.version} has a "development" export condition; alias the workspace packages instead of using the condition`,
      );
  }
}
/** AGENTS.md: the hook entry imports only node: built-ins. */
export function assertHookEntryDependencyFree(meta: Metafile): void {
  for (const output of Object.values(meta.outputs))
    for (const imported of output.imports)
      if (!imported.path.startsWith('node:'))
        throw new Error(
          `Hook entry imports ${imported.path}; it may import only node: built-ins`,
        );
}
