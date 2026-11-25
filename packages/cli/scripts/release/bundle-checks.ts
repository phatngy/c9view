// Checks and notices derived from the esbuild metafiles of the release bundle.
import type { Metafile } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/**
 * Third-party packages whose code is inlined into the bundle: the esbuild
 * inputs, the Vite module ids (absolute paths) and extra package folders.
 * Nothing is dropped silently: a module outside the repo, or a package folder
 * without a package.json, is an error.
 */
export function bundledPackages(
  repoRoot: string,
  metafiles: Metafile[],
  webModules: string[] = [],
  extraDirs: string[] = [],
): BundledPackage[] {
  const dirs = new Set(extraDirs);
  const add = (input: string, where: string) => {
    const dir = packageDir(repoRoot, input);
    if (!dir) return;
    if (!existsSync(join(dir, 'package.json')))
      throw new Error(`${where} module ${input} has no package.json at ${dir}`);
    dirs.add(dir);
  };
  for (const id of webModules) {
    if (id.startsWith('\0')) continue; // Bundler virtual modules.
    const rel = relative(repoRoot, id);
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new Error(
        `Web module ${id} is outside ${repoRoot}; the module list is stale or from another checkout`,
      );
    add(rel, 'Web');
  }
  for (const meta of metafiles)
    for (const input of Object.keys(meta.inputs)) add(input, 'esbuild');
  return dedupePackages([...dirs].map(packageAt));
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
const LICENSES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'licenses');
/** MIT, BSD and ISC texts carry a copyright line, so they cannot be filled in generically. */
const NEEDS_OWN_TEXT = /^(MIT|BSD|ISC)/i;

/**
 * The license text of a package: its own file, else the vendored canonical
 * text for its SPDX id. Returns an error message when neither exists.
 */
function resolveLicense(
  p: BundledPackage,
  licensesDir: string,
): { text: string } | { error: string } {
  const file = licenseFile(p.dir);
  if (file) return { text: readFileSync(join(p.dir, file), 'utf8').trim() };
  const id = p.license;
  const label = `${p.name}@${p.version} (${id})`;
  if (id === 'see license file' || NEEDS_OWN_TEXT.test(id))
    return { error: `${label}: no license file to carry its copyright line` };
  const vendored = join(licensesDir, `${id}.txt`);
  if (/^[A-Za-z0-9.+-]+$/.test(id) && existsSync(vendored))
    return { text: readFileSync(vendored, 'utf8').trim() };
  return { error: `${label}: no license file and no vendored text for ${id}` };
}
/** Release check: every bundled package must carry a license text. */
export function assertAllLicensed(
  packages: BundledPackage[],
  licensesDir = LICENSES_DIR,
): void {
  const errors = packages.flatMap((p) => {
    const r = resolveLicense(p, licensesDir);
    return 'error' in r ? [r.error] : [];
  });
  if (errors.length > 0)
    throw new Error(
      `Bundled packages without a license text:\n${errors.join('\n')}`,
    );
}
function licenseText(p: BundledPackage, licensesDir: string): string {
  const r = resolveLicense(p, licensesDir);
  if ('error' in r) throw new Error(r.error);
  return licenseFile(p.dir)
    ? r.text
    : `(the package ships no license file; this is the standard ${p.license} text)\n\n${r.text}`;
}
export function noticesText(
  packages: BundledPackage[],
  licensesDir = LICENSES_DIR,
): string {
  const header =
    'Third-party packages bundled into the JavaScript and web app of @phatngy/c9view.\n' +
    'External runtime dependencies (better-sqlite3 and @anthropic-ai/claude-agent-sdk)\n' +
    'are not included here; npm installs them with their own licenses.\n';
  return (
    header +
    packages
      .map(
        (p) =>
          `\n${'='.repeat(72)}\n${p.name}@${p.version} (${p.license})\n${'='.repeat(72)}\n${licenseText(p, licensesDir)}\n`,
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
