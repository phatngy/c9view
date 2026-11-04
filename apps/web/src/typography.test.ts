import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = resolve(process.cwd(), 'src');
const css = readFileSync(join(source, 'style.css'), 'utf8');
const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const scale = {
  caption: [12, 16],
  small: [13, 18],
  body: [14, 20],
  lead: [16, 24],
  title: [20, 28],
  display: [28, 34],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('typography scale', () => {
  it('defines every size and line height once and maps Tailwind aliases', () => {
    for (const [token, [size, lineHeight]] of Object.entries(scale)) {
      expect(css.match(new RegExp(`--text-${token}:`, 'g'))).toHaveLength(1);
      expect(css).toContain(`--text-${token}: ${size}px;`);
      expect(css).toContain(`--text-${token}--line-height: ${lineHeight}px;`);
    }
    for (const [alias, token] of Object.entries({
      xs: 'caption',
      sm: 'small',
      base: 'body',
      lg: 'lead',
      xl: 'title',
      '2xl': 'title',
      '3xl': 'display',
    })) {
      expect(css).toContain(`--text-${alias}: var(--text-${token});`);
      expect(css).toContain(
        `--text-${alias}--line-height: var(--text-${token}--line-height);`,
      );
    }
  });

  it('uses scale tokens for every CSS font size and never goes below 12px', () => {
    const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)];
    expect(sizes.length).toBeGreaterThan(0);
    for (const [, size] of sizes) {
      expect(size).toMatch(
        /^(?:var\(--text-(caption|small|body|lead|title|display)\)|0\.93em)$/,
      );
    }
    expect(css).toMatch(/--font-sans:\s*'IBM Plex Sans',/);
    expect(css).toMatch(/--font-mono:\s*'IBM Plex Mono',/);
  });

  it('has no undersized arbitrary text utilities anywhere in source', () => {
    for (const path of sourceFiles(source).filter((path) =>
      /\.(?:tsx?|css)$/.test(path),
    )) {
      const matches = readFileSync(path, 'utf8').matchAll(
        /text-\[(\d+(?:\.\d+)?)px\]/g,
      );
      for (const [, value] of matches) {
        expect(Number(value), path).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('keeps tabular figures scoped to aligned numeric content', () => {
    expect(css).not.toMatch(/body\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/table\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(readFileSync(join(source, 'kit/Stat.tsx'), 'utf8')).toMatch(
      /<dd className="[^"]*tabular-nums/,
    );
  });

  it('keeps markdown prose at 24px leading and inline code relative', () => {
    expect(css).toMatch(/\.markdown p\s*\{[^}]*line-height:\s*24px/);
    expect(css).toMatch(/\.markdown ul,\s*\.markdown ol\s*\{[^}]*line-height:\s*24px/);
    expect(css).toMatch(/\.markdown code\s*\{[^}]*font-size:\s*0\.93em/);
    expect(css).toMatch(/\.text-xs code\s*\{[^}]*font-size:\s*0\.93em/);
    expect(css).toMatch(/\.markdown pre code\s*\{[^}]*font-size:\s*var\(--text-small\)/);
  });

  it('does not depend on Inter or JetBrains Mono packages', () => {
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    expect(Object.keys(dependencies)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/inter|jetbrains.?mono/i),
      ]),
    );
  });

  it('uses scale tokens in component styles too', () => {
    for (const path of sourceFiles(source).filter((path) =>
      path.endsWith('.css'),
    )) {
      for (const [, size] of readFileSync(path, 'utf8').matchAll(
        /font-size:\s*([^;]+);/g,
      )) {
        expect(size, path).toMatch(
          /^(?:var\(--text-(caption|small|body|lead|title|display)\)|0\.93em)$/,
        );
      }
    }
  });

  it('keeps diff rows at 24px with small monospace text', () => {
    expect(css).toMatch(
      /\.diff-table\s*\{[^}]*font-family: var\(--font-mono\);[^}]*font-size: var\(--text-small\)/,
    );
    expect(css).toMatch(
      /\.diff-table td\s*\{[^}]*height: 24px;[^}]*line-height: 24px;/,
    );
    expect(css).toMatch(
      /\.diff-table \.fold-button\s*\{[^}]*height: 24px;[^}]*line-height: 24px;/,
    );
  });
});
