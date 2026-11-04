import { expect, test } from '@playwright/test';
import { projectPath, sessionPath, secretSessionPath } from './paths.js';
import {
  fixturePages,
  expectPageReady,
  expectPageLayout,
} from './page-checks.js';

test('Overview lists fixture projects and filters status and usage range', async ({
  page,
}) => {
  await page.goto('/m/local');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  const projects = page.getByRole('region', { name: 'Projects table' });
  await expect(
    projects.getByRole('link', { name: 'alpha', exact: true }),
  ).toBeVisible();
  await expect(
    projects.getByRole('link', { name: 'beta', exact: true }),
  ).toBeVisible();
  const statuses = page.getByRole('group', {
    name: 'Filter projects by status',
  });
  for (const status of ['Need input', 'In progress', 'In review', 'Inactive']) {
    const button = statuses.getByRole('button', { name: new RegExp(status) });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    if (status === 'Inactive') {
      for (const name of ['alpha', 'beta']) {
        await expect(
          projects.getByRole('link', { name, exact: true }),
        ).toBeVisible();
      }
    } else
      await expect(
        page.getByText('No projects match your filters.'),
      ).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
  const ranges = page.getByRole('group', { name: 'Usage range' });
  for (const [label, value] of [
    ['7d', '7'],
    ['All', '366'],
    ['30d', '30'],
  ] as const) {
    const button = ranges.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(new RegExp(`range=${value}(?:&|$)`));
    await expect(
      page.getByRole('region', { name: 'Selected range cost' }),
    ).toContainText(`last ${value} days`);
  }
});

test('Project board lists sessions, toggles List, and switches every section', async ({
  page,
}) => {
  await page.goto(projectPath);
  for (const name of ['Need input', 'In progress', 'In review', 'Inactive']) {
    await expect(
      page.getByRole('heading', { name: new RegExp(`^${name} `) }),
    ).toBeVisible();
  }
  const inactive = page.getByRole('region', { name: 'inactive', exact: true });
  await expect(
    inactive.getByRole('link', { name: /Sample widget/ }),
  ).toBeVisible();
  await expect(
    inactive.getByRole('link', { name: /Find sample text/ }),
  ).toBeVisible();
  const view = page.getByRole('group', { name: 'Session view' });
  await view.getByRole('button', { name: 'List', exact: true }).click();
  const list = page.getByRole('region', { name: 'Sessions table' });
  await expect(
    list.getByRole('link', { name: 'Sample widget', exact: true }),
  ).toBeVisible();
  await view.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(inactive).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Project sections' });
  for (const name of ['Usage', 'Files', 'Changes', 'Config', 'Sessions']) {
    await tabs.getByRole('tab', { name, exact: true }).click();
    await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('tabpanel', { name, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`tab=${name.toLowerCase()}(?:&|$)`),
    );
  }
});

test('Session renders turns and tools, jumps from outline, and offers export', async ({
  page,
}) => {
  await page.goto(secretSessionPath);
  await expect(
    page.getByText('Synthetic response', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Claude', { exact: true })).toBeVisible();
  await page.goto(sessionPath);
  await expect(
    page
      .getByRole('article')
      .getByText('Build a sample widget', { exact: true }),
  ).toBeVisible();
  const outline = page.getByRole('button', {
    name: /Prompt: Build a sample widget/,
  });
  await outline.click();
  await expect(page).toHaveURL(/#m-user-one$/);
  await expect(outline).toHaveAttribute('aria-current', 'true');
  await expect(
    page.getByRole('button', { name: /^(Task|Agent) Inspect sample$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Markdown', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: 'JSON', exact: true }),
  ).toBeVisible();
});

test('Session Task links to its synthetic subagent and back to the parent call', async ({
  page,
}) => {
  await page.goto(sessionPath);
  await page.getByRole('button', { name: /^Subagent: Inspect sample/ }).click();
  const rail = page.getByRole('complementary', { name: 'Session rail' });
  await expect(
    rail.getByRole('heading', { name: 'Subagents', exact: true }),
  ).toBeVisible();
  await rail.getByRole('button', { name: /^Inspect sample child-on$/ }).click();
  await expect(page).toHaveURL(/#tool-tool-one$/);
  await expect(
    page.getByRole('button', { name: /^(Task|Agent) Inspect sample$/ }),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('Config section navigation and filtering work', async ({ page }) => {
  await page.goto('/m/local/config');
  await expect(
    page.getByRole('heading', { name: 'Global config', exact: true }),
  ).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Configuration sections' });
  for (const name of [
    'Skills',
    'Agents',
    'Commands',
    'Hooks',
    'MCP',
    'Instructions',
    'Memory',
    'Plugins',
    'Settings',
  ]) {
    const link = nav.getByRole('link', { name: new RegExp(`^${name} `) });
    await link.click();
    await expect(link).toHaveAttribute('aria-current', 'location');
    await expect(
      page.getByRole('heading', { name, exact: true }),
    ).toBeFocused();
  }
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await expect(settings.getByText('env', { exact: true })).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Filter configuration' })
    .fill('permissions');
  await expect(
    settings.getByText('permissions', { exact: true }),
  ).toBeVisible();
  await expect(settings.getByText('env', { exact: true })).toHaveCount(0);
  await page
    .getByRole('searchbox', { name: 'Filter configuration' })
    .fill('no-synthetic-match');
  await expect(settings.getByText('No matches', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter configuration' }).clear();
  await expect(settings.getByText('env', { exact: true })).toBeVisible();
});

test('Search highlights fixture text and links to the matching message', async ({
  page,
}) => {
  await page.goto('/m/local/search');
  await page.getByRole('searchbox', { name: 'Search query' }).fill('widget');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const hit = page.getByRole('link', { name: /Build a sample widget/ });
  await expect(hit.getByText('widget', { exact: true })).toHaveJSProperty(
    'tagName',
    'MARK',
  );
  await hit.click();
  await expect(page).toHaveURL(`${sessionPath}#m-user-one`);
  await expect(
    page
      .getByRole('article')
      .getByText('Build a sample widget', { exact: true }),
  ).toBeVisible();
});

test('Theme menu applies dark and light themes', async ({ page }) => {
  await page.goto('/m/local');
  for (const theme of ['Dark', 'Light']) {
    await page
      .getByRole('button', { name: /^Theme: .* Change theme$/ })
      .click();
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe(theme.toLowerCase());
  }
});

test('Desktop pages fit the viewport and keep visible text at least 12 px', async ({
  page,
}) => {
  for (const [path, text] of fixturePages) {
    await page.goto(path);
    await expectPageReady(page, path, text);
    await expectPageLayout(page);
  }
});

test('legacy project URLs redirect while retaining their query', async ({
  page,
}) => {
  await page.goto('/projects/-synthetic-alpha?tab=files&path=README.md&line=2');
  await expect(page).toHaveURL(/\/m\/local\/projects\/-synthetic-alpha\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('tab')).toBe('files');
  expect(url.searchParams.get('path')).toBe('README.md');
  expect(url.searchParams.get('line')).toBe('2');
});
