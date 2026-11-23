import { expect, test } from '@playwright/test';
import {
  controlProjectPath,
  controlSessionPath,
  controlToken,
} from './control-fixture.js';

// Runs against the control server started without an API-key method
// (C9VIEW_E2E_NO_API_KEY=1): control is ready, but starting or resuming a
// session from c9view is refused. Remote send to a live terminal session is
// covered by the node and web unit tests.
const MESSAGE = /needs an Anthropic API key \(ANTHROPIC_API_KEY\)/;

test.beforeEach(async ({ page }) => {
  await page.goto(`/login?token=${controlToken}`);
  await expect(page).toHaveURL(/\/m\/local$/);
});

test('the reply composer of a non-live session shows the API-key message and cannot send', async ({
  page,
}) => {
  await page.goto(controlSessionPath('reply'));
  const composer = page.getByRole('textbox', { name: 'Reply to session' });
  await expect(composer).toBeVisible();
  await expect(page.getByText(MESSAGE)).toBeVisible();
  await expect(composer).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
});

test('New session shows the API-key message and its start is disabled', async ({
  page,
}) => {
  await page.goto(controlProjectPath);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await expect(dialog.getByText(MESSAGE)).toBeVisible();
  await dialog.getByLabel('Prompt').fill('Start a fresh synthetic session');
  await expect(
    dialog.getByRole('button', { name: 'Start session' }),
  ).toBeDisabled();
});
