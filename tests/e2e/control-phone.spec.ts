import { expect, test } from '@playwright/test';
import { controlSessionPath, controlToken } from './control-fixture.js';

test('Phone session shows the reply composer within the viewport', async ({
  page,
}) => {
  await page.goto(`/login?token=${controlToken}`);
  await page.goto(controlSessionPath('reply'));
  const composer = page.getByRole('textbox', { name: 'Reply to session' });
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
