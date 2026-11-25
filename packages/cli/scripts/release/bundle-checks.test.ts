import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertAllLicensed,
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
    expect(() =>
      assertAllLicensed([fake('a', withFile), fake('b', without)]),
    ).not.toThrow();
  });
  it('writes an accurate header and entries', () => {
    const text = noticesText([fake('a', withFile), fake('b', without)]);
    expect(text).toContain('better-sqlite3');
    expect(text).toContain('a@1.0.0 (MIT)');
    expect(text).toContain('License text');
    expect(text).toContain('license field of its package.json: MIT');
  });
});
