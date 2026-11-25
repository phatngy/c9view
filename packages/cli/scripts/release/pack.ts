// Assembles the publishable @phatngy/c9view package in packages/cli/release/.
// Usage: node --experimental-strip-types scripts/release/pack.ts --version 0.1.0 [--out dir]
import { build, type BuildOptions, type Plugin } from 'esbuild';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
/** Packages that cannot be bundled: they load native or packaged files at runtime. */
const EXTERNALS = {
  // Native addon, loaded through `bindings` from its own build folder.
  'better-sqlite3': 'packages/node/package.json',
  // Resolves its platform binary package and spawns it (control sessions).
  '@anthropic-ai/claude-agent-sdk': 'packages/node/package.json',
} as const;

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(cliRoot, '../..');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
export function externalDependencies(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, source] of Object.entries(EXTERNALS)) {
    const deps = readJson(join(repoRoot, source))['dependencies'] as Record<
      string,
      string
    >;
    const range = deps[name];
    if (!range) throw new Error(`${name} is not a dependency of ${source}`);
    result[name] = range;
  }
  return result;
}

/** Inline the hub instead of locating its package on disk at run time. */
function bundledHubLoader(): Plugin {
  const hubMain = join(repoRoot, 'apps/hub/src/main.ts');
  return {
    name: 'bundled-hub-loader',
    setup(b) {
      b.onResolve({ filter: /\/hub-loader\.js$/ }, (args) =>
        args.importer.includes('/packages/cli/src/')
          ? { path: 'bundled-hub-loader', namespace: 'c9view' }
          : undefined,
      );
      b.onLoad({ filter: /.*/, namespace: 'c9view' }, () => ({
        contents: `export async function loadHub() { return import(${JSON.stringify(hubMain)}); }`,
        resolveDir: repoRoot,
        loader: 'js',
      }));
    },
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const version = values.version;
  if (!version || !SEMVER.test(version))
    throw new Error('Pass --version <semver>, for example --version 0.1.0');
  const out = resolve(values.out ?? join(cliRoot, 'release'));
  const webDist = join(repoRoot, 'apps/web/dist');
  if (!existsSync(join(webDist, 'index.html')))
    throw new Error('apps/web/dist is missing; run corepack pnpm build first');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const external = Object.keys(EXTERNALS);
  const common: BuildOptions = {
    absWorkingDir: repoRoot,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    conditions: ['development'],
    external,
    legalComments: 'none',
    logLevel: 'warning',
  };
  // Lazy chunks (beside main.js, so import.meta.url paths hold) keep `--help` and the hook fast path from loading SQLite.
  await build({
    ...common,
    entryPoints: [join(cliRoot, 'src/main.ts')],
    outdir: join(out, 'dist'),
    splitting: true,
    chunkNames: '[name]-[hash]',
    plugins: [bundledHubLoader()],
    // Bundled CommonJS-style dependencies still need require().
    banner: {
      js: "import { createRequire as __c9Require } from 'node:module'; const require = __c9Require(import.meta.url);",
    },
  });
  // The hook entry stays one self-contained file with only node: built-ins.
  await build({
    ...common,
    entryPoints: [join(repoRoot, 'packages/core/src/hooks/hook-entry.ts')],
    outfile: join(out, 'dist/hooks/hook-entry.js'),
  });
  cpSync(webDist, join(out, 'web-dist'), { recursive: true });
  for (const file of ['README.md', 'LICENSE'])
    cpSync(join(repoRoot, file), join(out, file));
  const root = readJson(join(repoRoot, 'package.json'));
  writeFileSync(
    join(out, 'package.json'),
    JSON.stringify(
      {
        name: '@phatngy/c9view',
        version,
        description: root['description'],
        license: root['license'],
        repository: root['repository'],
        homepage: root['homepage'],
        bugs: root['bugs'],
        keywords: ['claude-code', 'dashboard', 'sessions', 'token-usage'],
        type: 'module',
        bin: { c9view: './dist/main.js' },
        files: ['dist', 'web-dist', 'README.md', 'LICENSE'],
        engines: { node: '>=22' },
        publishConfig: { access: 'public' },
        dependencies: externalDependencies(),
      },
      null,
      2,
    ) + '\n',
  );
  // Executable bit for the bin entry (npm also sets it on install).
  const bin = join(out, 'dist/main.js');
  if (!readFileSync(bin, 'utf8').startsWith('#!'))
    throw new Error('dist/main.js lost its shebang');
  console.log(`Assembled @phatngy/c9view@${version} in ${out}`);
  console.log(`External dependencies: ${external.join(', ')}`);
}
await main();
