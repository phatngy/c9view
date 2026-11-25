import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertAllLicensed,
  bundledPackages,
  dedupePackages,
  noticesText,
  packageDirOf,
  type BundledPackage,
} from './bundle-checks.ts';

describe('packageDirOf', () => {
  it('maps pnpm paths to the innermost package', () => {
    expect(
      packageDirOf(
        'node_modules/.pnpm/a@1/node_modules/micromark/lib/index.js?x=1',
      ),
    ).toBe('node_modules/.pnpm/a@1/node_modules/micromark');
    expect(
      packageDirOf('/r/node_modules/.pnpm/b@1/node_modules/@scope/pkg/x.js'),
    ).toBe('/r/node_modules/.pnpm/b@1/node_modules/@scope/pkg');
  });
  it('ignores non-package and virtual ids', () => {
    expect(packageDirOf('apps/web/src/main.tsx')).toBeUndefined();
    expect(packageDirOf('\0vite/preload-helper')).toBeUndefined();
  });
});

function fake(name: string, dir = '/x', license = 'MIT'): BundledPackage {
  return { name, version: '1.0.0', license, dir };
}

describe('dedupePackages', () => {
  it('dedupes, drops workspace packages and sorts by name', () => {
    const out = dedupePackages([
      fake('b'),
      fake('@c9view/core'),
      fake('a'),
      fake('b'),
    ]);
    expect(out.map((p) => p.name)).toEqual(['a', 'b']);
  });
});

describe('bundledPackages', () => {
  const repo = mkdtempSync(join(tmpdir(), 'repo-'));
  mkdirSync(join(repo, 'node_modules/ok'), { recursive: true });
  writeFileSync(
    join(repo, 'node_modules/ok/package.json'),
    '{"name":"ok","version":"1.0.0","license":"MIT"}',
  );
  mkdirSync(join(repo, 'node_modules/bare'), { recursive: true });
  it('maps web modules to packages', () => {
    const out = bundledPackages(
      repo,
      [],
      [
        join(repo, 'node_modules/ok/index.js'),
        '\0virtual',
        join(repo, 'src/app.ts'),
      ],
    );
    expect(out.map((p) => p.name)).toEqual(['ok']);
  });
  it('throws for modules outside the repo and for missing package.json', () => {
    expect(() =>
      bundledPackages(repo, [], ['/elsewhere/node_modules/x/i.js']),
    ).toThrow(/outside/);
    expect(() =>
      bundledPackages(repo, [], [join(repo, 'node_modules/bare/i.js')]),
    ).toThrow(/no package\.json/);
  });
});

describe('licenses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notices-'));
  const withFile = join(dir, 'a');
  const without = join(dir, 'b');
  mkdirSync(withFile);
  mkdirSync(without);
  writeFileSync(join(withFile, 'LICENSE'), 'License text\n');
  it('fails when a package has neither file nor field', () => {
    expect(() =>
      assertAllLicensed([fake('b', without, 'see license file')]),
    ).toThrow(/b@1\.0\.0/);
    expect(() => assertAllLicensed([fake('a', withFile)])).not.toThrow();
  });
  it('carries vendored text for a package without a file, and fails otherwise', () => {
    const licenses = join(dir, 'licenses');
    mkdirSync(licenses);
    writeFileSync(join(licenses, 'Apache-2.0.txt'), 'Apache text\n');
    expect(noticesText([fake('b', without, 'Apache-2.0')], licenses)).toContain(
      'Apache text',
    );
    expect(() =>
      assertAllLicensed([fake('b', without, 'Zlib')], licenses),
    ).toThrow(/b@1\.0\.0 \(Zlib\)/);
    expect(() =>
      assertAllLicensed([fake('b', without, 'MIT')], licenses),
    ).toThrow(/b@1\.0\.0 \(MIT\)/);
  });
  it('writes an accurate header and entries', () => {
    const text = noticesText([fake('a', withFile)]);
    expect(text).toContain('better-sqlite3');
    expect(text).toContain('a@1.0.0 (MIT)');
    expect(text).toContain('License text');
  });
});
