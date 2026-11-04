import { expect, test } from '@playwright/test';
import {
  fixturePages,
  expectPageReady,
  expectNoRenderedSecrets,
  secrets,
} from './page-checks.js';

test('Foreign Host requests are rejected', async ({ request }) => {
  for (const path of ['/m/local', '/api/health', '/api/m/local/projects']) {
    const response = await request.get(path, {
      headers: { Host: 'foreign.example' },
    });
    expect(response.status()).toBe(403);
  }
});

test('Pages and their HTTP responses hide synthetic fixture secrets', async ({
  page,
}) => {
  expect(secrets.length).toBeGreaterThan(0);
  const responses: Promise<boolean | null>[] = [];
  let checked = 0;
  page.on('response', (response) => {
    const contentType = response.headers()['content-type'] ?? '';
    if (!/application\/json|text\/html/.test(contentType)) return;
    responses.push(
      response
        .body()
        .catch(() => null)
        .then((body) => {
          if (body === null) return null;
          checked += 1;
          return secrets.every(
            (secret) => !body.toString('utf8').includes(secret),
          );
        }),
    );
  });
  for (const [path, text] of fixturePages) {
    await page.goto(path);
    await expectPageReady(page, path, text);
    await expectNoRenderedSecrets(page);
  }
  for (const safe of await Promise.all(responses)) {
    if (safe === null) continue;
    expect(safe, 'HTTP response hides fixture secrets').toBe(true);
  }
  expect(
    checked,
    'At least one HTTP response body was checked',
  ).toBeGreaterThan(0);
});
