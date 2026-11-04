import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { projectPath, sessionPath, secretSessionPath } from './paths.js';

function fixtureSecrets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return fixtureSecrets(path);
    if (!/\.jsonl?$/.test(entry.name)) return [];
    return (
      readFileSync(path, 'utf8').match(
        /sk-ant-fake[\w-]+|fake-fixture-secret/g,
      ) ?? []
    );
  });
}
export const secrets = [
  ...new Set(
    fixtureSecrets(
      fileURLToPath(new URL('../fixtures/claude', import.meta.url)),
    ),
  ),
];

// Keep the session last so phone panel navigation starts on that page.
export const fixturePages = [
  ['/', 'Your Claude Code activity, in one place.'],
  [projectPath, 'Sample widget'],
  [secretSessionPath, 'Synthetic response'],
  ['/config', 'Filter configuration'],
  ['/search?q=sample', 'Search conversations'],
  [sessionPath, 'Build a sample widget'],
] as const;

export async function expectPageReady(page: Page, path: string, text: string) {
  await expect(
    page.getByText(text, { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  if (path.startsWith('/search')) {
    await expect(
      page.getByRole('link', { name: /Find sample text/ }),
    ).toBeVisible();
  }
}

export async function expectNoRenderedSecrets(page: Page) {
  expect(secrets.length).toBeGreaterThan(0);
  const body = await page.evaluate(() => document.body.innerText);
  for (const secret of secrets) {
    expect(body.includes(secret), 'Rendered page hides fixture secret').toBe(
      false,
    );
  }
}

export async function expectPageLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `${page.url()} fits the viewport`,
  ).toBe(true);
  const offenders = await page.evaluate(() => {
    return Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap(
      (element) => {
        if (element.closest('[aria-hidden="true"]')) return [];
        // Check the element that owns each text node, not all its ancestors.
        const text = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join(' ')
          .trim();
        if (
          !text ||
          !element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          })
        )
          return [];
        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        if (size >= 12) return [];
        return [
          {
            element: element.tagName.toLowerCase(),
            className: element.className,
            text: text.slice(0, 120),
            fontSize: size,
          },
        ];
      },
    );
  });
  expect(
    offenders,
    `${page.url()} visible text below 12 px: ${JSON.stringify(offenders)}`,
  ).toEqual([]);
}
