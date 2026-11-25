// Checks and notices derived from the esbuild metafiles of the release bundle.
import type { Metafile } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  dir: string;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
/** The package folder (under a node_modules) that an input file belongs to. */
function packageDir(repoRoot: string, input: string): string | undefined {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = input.slice(at + marker.length).split('/');
  const depth = rest[0]?.startsWith('@') ? 2 : 1;
  return join(
    repoRoot,
    input.slice(0, at + marker.length),
    ...rest.slice(0, depth),
  );
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
  extraDirs: string[] = [],
): BundledPackage[] {
  const dirs = new Set(extraDirs);
  for (const meta of metafiles)
    for (const input of Object.keys(meta.inputs)) {
      const dir = packageDir(repoRoot, input);
      if (dir) dirs.add(dir);
    }
  return [...dirs]
    .filter((dir) => existsSync(join(dir, 'package.json')))
    .map(packageAt)
    .filter((p) => !p.name.startsWith('@c9view/'))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
}
function licenseText(dir: string): string {
  const file = readdirSync(dir).find((f) =>
    /^(licen[sc]e|copying|notice)(\.|$)/i.test(f),
  );
  return file
    ? readFileSync(join(dir, file), 'utf8').trim()
    : '(no license file in the package)';
}
export function noticesText(packages: BundledPackage[]): string {
  const header =
    'Third-party software included in @phatngy/c9view (the bundled code and web build).\n';
  return (
    header +
    packages
      .map(
        (p) =>
          `\n${'='.repeat(72)}\n${p.name}@${p.version} (${p.license})\n${'='.repeat(72)}\n${licenseText(p.dir)}\n`,
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
