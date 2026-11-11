import { expect, test, type Page } from '@playwright/test';
import {
  controlProjectPath,
  controlSessionPath,
  controlToken,
} from './control-fixture.js';

test.beforeEach(async ({ page }) => {
  // Real token login: the hub refuses control without it.
  await page.goto(`/login?token=${controlToken}`);
  await expect(page).toHaveURL(/\/m\/local$/);
});

const composer = (page: Page) =>
  page.getByRole('textbox', { name: 'Reply to session' });

test('Reply composer sends a reply and the answer reaches the transcript', async ({
  page,
}) => {
  await page.goto(controlSessionPath('reply'));
  await expect(composer(page)).toBeVisible();
  await composer(page).fill('Please say hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Synthetic reply to: Please say hello').first(),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Run controls' }),
  ).toBeVisible();
  await expect(composer(page)).toHaveValue('');
});

for (const [name, button, outcome] of [
  ['allow', 'Allow', 'Synthetic command approved'],
  ['deny', 'Deny', 'Synthetic command denied'],
] as const) {
  test(`Approval card pinned to the composer: ${button} resumes the run`, async ({
    page,
  }) => {
    await page.goto(controlSessionPath(name));
    await composer(page).fill('needs-approval please');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const card = page.getByRole('region', { name: 'Permission for Bash' });
    await expect(card).toBeVisible();
    // Pinned above the composer: the card lives inside the session control area.
    await expect(
      page.locator('[aria-label="Session control"]').getByRole('region', {
        name: 'Permission for Bash',
      }),
    ).toBeVisible();
    await expect(card).toContainText('echo synthetic-approval');
    await card.getByRole('button', { name: button, exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText(outcome).first()).toBeVisible();
  });
}

test('New session from the project header starts a run and opens its transcript', async ({
  page,
}) => {
  await page.goto(controlProjectPath);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Prompt').fill('Start a fresh synthetic session');
  await dialog.getByRole('button', { name: 'Start session' }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}/);
  await expect(
    page
      .getByText('Synthetic reply to: Start a fresh synthetic session')
      .first(),
  ).toBeVisible();
  await expect(composer(page)).toBeVisible();
});
