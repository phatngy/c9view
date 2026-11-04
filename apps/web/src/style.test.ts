import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');
import { describe, expect, it } from 'vitest';

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

describe('theme text contrast', () => {
  const blocks = [...css.matchAll(/(?:^|\n)\s*:root[^{]*\{([^}]+)\}/g)].filter(
    (block) => block[1]?.includes('--page:'),
  );
  it('keeps explicit light, automatic dark, and explicit dark themes', () => {
    expect(blocks).toHaveLength(3);
  });
  for (const [index, block] of blocks.entries()) {
    it(`keeps text readable in theme block ${index + 1}`, () => {
      const tokens = Object.fromEntries(
        [...block[1]!.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map((match) => [
          match[1],
          match[2],
        ]),
      );
      for (const foreground of [
        'ink',
        'muted',
        'accent',
        'inactive',
        'need-input',
        'in-progress',
        'in-review',
        'success',
        'danger',
      ]) {
        for (const background of ['page', 'panel', 'surface']) {
          const values = [tokens[foreground]!, tokens[background]!].map(
            luminance,
          );
          const ratio =
            (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
          expect(
            ratio,
            `${foreground} on ${background}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      const selectedRowContrast =
        (luminance(tokens.ink!) > luminance(tokens['accent-soft']!)
          ? luminance(tokens.ink!) + 0.05
          : luminance(tokens['accent-soft']!) + 0.05) /
        (Math.min(luminance(tokens.ink!), luminance(tokens['accent-soft']!)) +
          0.05);
      expect(selectedRowContrast, 'ink on accent-soft').toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});

it('styles global scrollbars with theme tokens while preserving forced colors', () => {
  for (const [token, opacity] of [
    ['thumb', 35],
    ['thumb-hover', 55],
    ['thumb-active', 75],
  ]) {
    expect(css).toContain(
      `--scrollbar-${token}: color-mix(in srgb, var(--muted) ${opacity}%, transparent)`,
    );
  }
  const scrollbarRules = css.slice(css.indexOf('@media (forced-colors: none)'));
  expect(scrollbarRules).toContain('scrollbar-width: thin');
  expect(scrollbarRules).toContain(
    'scrollbar-color: var(--scrollbar-thumb) transparent',
  );
  expect(scrollbarRules).toContain('*::-webkit-scrollbar {');
  expect(scrollbarRules).toContain('width: 8px');
  expect(scrollbarRules).toContain('height: 8px');
  expect(scrollbarRules).toContain('*::-webkit-scrollbar-button {');
  expect(scrollbarRules).toContain('display: none');
  expect(scrollbarRules).toContain('*::-webkit-scrollbar-corner');
  expect(scrollbarRules).toContain('background: transparent');
  expect(scrollbarRules).toContain('border: 1px solid transparent');
  expect(scrollbarRules).toContain('border-radius: 999px');
  expect(scrollbarRules).toContain('background-clip: padding-box');
  expect(scrollbarRules).toContain('*:hover::-webkit-scrollbar-thumb');
  expect(scrollbarRules).toContain('*::-webkit-scrollbar-thumb:active');
});

it('disables animations, transitions and CSS smooth scrolling for reduced motion', () => {
  const reduced = css.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  expect(reduced).toContain('*::before');
  expect(reduced).toContain('*::after');
  expect(reduced).toContain('animation: none !important');
  expect(reduced).toContain('transition: none !important');
  expect(reduced).toContain('scroll-behavior: auto !important');
});

it('uses readable theme highlight tokens and system mark colors in forced colors', () => {
  const blocks = [...css.matchAll(/(?:^|\n)\s*:root[^{]*\{([^}]+)\}/g)].filter(
    (block) => block[1]?.includes('--page:'),
  );
  expect(blocks).toHaveLength(3);
  for (const block of blocks) {
    const ink = block[1]!.match(/--ink: (#[\da-f]{6});/)?.[1];
    const highlight = block[1]!.match(/--highlight: (#[\da-f]{6});/)?.[1];
    expect(highlight).toBeDefined();
    const values = [ink!, highlight!].map(luminance);
    expect(
      (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
  expect(css).toMatch(
    /mark\s*\{\s*background: var\(--highlight\);\s*color: var\(--ink\);/,
  );
  expect(css).toMatch(
    /@media \(forced-colors: active\)\s*\{\s*mark\s*\{\s*forced-color-adjust: none;\s*background: Mark;\s*color: MarkText;/,
  );
});
