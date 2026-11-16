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

test('New project: pick a location, trust the folder, start the first run', async ({
  page,
}) => {
  await page.goto('/m/local');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByRole('button', { name: 'Browse…' }).click();
  const picker = dialog.getByRole('region', { name: 'Folder picker' });
  await picker.getByRole('button', { name: 'e2e-workspace' }).click();
  await picker.getByRole('button', { name: 'fresh-app' }).click();
  await expect(dialog.getByLabel('Location')).toHaveValue(
    /e2e-workspace\/fresh-app$/,
  );
  await dialog.getByLabel('First prompt').fill('Hello from a new project');
  await dialog.getByRole('button', { name: 'Create and start' }).click();
  // The folder is new to Claude Code, so the trust step comes first.
  const trust = dialog.getByRole('region', { name: 'Folder trust required' });
  await expect(trust).toBeVisible();
  await expect(trust).toContainText('fresh-app');
  await trust.getByRole('button', { name: 'Trust this folder' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/sessions\/[0-9a-f-]{36}/);
  await expect(
    page.getByText('Synthetic reply to: Hello from a new project').first(),
  ).toBeVisible();
});

test('A session label is edited, shown in place of the title and removed', async ({
  page,
}) => {
  await page.goto(controlSessionPath('reply'));
  await page.getByRole('button', { name: 'Add label' }).click();
  const form = page.getByRole('form', { name: 'Session label' });
  await form.getByLabel('c9view label').fill('Synthetic label');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole('heading', { level: 1, name: /Synthetic label/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: /Synthetic label/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit label' }).click();
  const again = page.getByRole('form', { name: 'Session label' });
  await again.getByLabel('c9view label').fill('');
  await again.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: /Synthetic label/ }),
  ).toHaveCount(0);
});
