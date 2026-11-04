import { expect, test } from '@playwright/test';
import {
  fixturePages,
  expectPageReady,
  expectPageLayout,
  expectNoRenderedSecrets,
} from './page-checks.js';

test('Phone pages fit the viewport and session navigation switches panels', async ({
  page,
}) => {
  for (const [path, text] of fixturePages) {
    await page.goto(path);
    await expectPageReady(page, path, text);
    await expectNoRenderedSecrets(page);
    await expectPageLayout(page);
  }
  const tabs = page.getByRole('navigation', { name: 'Session sections' });
  for (const name of ['Outline', 'Files', 'Usage', 'Chat']) {
    const button = tabs.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    if (name === 'Outline')
      await expect(
        page.getByRole('heading', { name: 'Outline', exact: true }),
      ).toBeVisible();
    if (name === 'Usage')
      await expect(
        page.getByRole('heading', { name: 'Subagents', exact: true }),
      ).toBeVisible();
    if (name === 'Chat')
      await expect(
        page
          .getByRole('article')
          .getByText('Build a sample widget', { exact: true }),
      ).toBeVisible();
    await expectPageLayout(page);
  }
});
