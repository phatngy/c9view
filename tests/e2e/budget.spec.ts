import { expect, test } from '@playwright/test';
import type { SessionDetailResponse } from '../../packages/api/src/index.js';
import {
  budgetBaseURL,
  defaultServerBaseURL,
  pageBudgetBytes,
} from './budget.js';
import { projectPath, sessionPath } from './paths.js';

const sessionAPI = `/api${sessionPath}`;

test('budgeted session pages preserve message order and show partial content', async ({
  page,
  request,
}) => {
  // session-one is the largest existing fixture (981 JSONL bytes, three messages).
  const baselineResponse = await request.get(
    `${defaultServerBaseURL}/api${sessionPath}?cursor=0&limit=1000`,
  );
  expect(baselineResponse.ok()).toBe(true);
  const baseline = (await baselineResponse.json()) as SessionDetailResponse;
  expect(baseline.nextCursor).toBeNull();
  expect(baseline.messages.some((message) => message.truncated)).toBe(false);
  const expectedIds = baseline.messages.map((message) => message.uuid);

  const messages: SessionDetailResponse['messages'] = [];
  let cursor: number | null = 0;
  let pageCount = 0;
  while (cursor !== null) {
    const response = await request.get(
      `${budgetBaseURL}${sessionAPI}?cursor=${cursor}&limit=1000`,
    );
    expect(response.ok()).toBe(true);
    expect((await response.body()).byteLength).toBeLessThanOrEqual(
      pageBudgetBytes,
    );
    const detail = (await response.json()) as SessionDetailResponse;
    expect(detail.cursor).toBe(cursor);
    if (detail.nextCursor !== null)
      expect(detail.nextCursor).toBeGreaterThan(cursor);
    // The first request must be byte-limited, despite asking for 1,000 messages.
    if (pageCount === 0) expect(detail.nextCursor).not.toBeNull();
    messages.push(...detail.messages);
    cursor = detail.nextCursor;
    pageCount++;
  }
  expect(pageCount).toBeGreaterThanOrEqual(2);
  expect(messages.map((message) => message.uuid)).toEqual(expectedIds);

  const sessionRequests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === sessionAPI) sessionRequests.push(url);
  });
  await page.goto(projectPath);
  await page.getByRole('link', { name: /Sample widget/ }).click();
  await expect(page).toHaveURL(sessionPath);
  const conversation = page.getByLabel('Conversation messages', {
    exact: true,
  });
  await expect(conversation).toBeVisible();
  // Scroll until the beginning, including when a short page auto-loads its
  // predecessor before the next poll. No assumptions about response timing.
  await expect
    .poll(
      async () => {
        await conversation.evaluate((element) => {
          element.scrollTop = 0;
          element.dispatchEvent(new Event('scroll'));
        });
        return conversation
          .getByText('Beginning of session', { exact: true })
          .count();
      },
      { timeout: 15_000 },
    )
    .toBe(1);

  await expect
    .poll(
      () =>
        conversation
          .getByRole('article')
          .evaluateAll((articles) => articles.map((article) => article.id)),
      { timeout: 15_000 },
    )
    .toEqual(expectedIds.map((id) => `m-${id}`));
  const articles = conversation.getByRole('article');
  for (const [index, message] of messages.entries()) {
    const notices = articles
      .nth(index)
      .getByRole('note')
      .filter({ hasText: 'This message was cut to fit the page size.' });
    if (message.truncated) await expect(notices).toHaveCount(1);
    else await expect(notices).toHaveCount(0);
  }
  expect(
    sessionRequests.some((url) => url.searchParams.get('from') === 'end'),
  ).toBe(true);
  const earlier = sessionRequests.filter(
    (url) =>
      // A background refetch may also request the pinned tail without fill=end.
      url.searchParams.has('cursor') &&
      Number(url.searchParams.get('cursor')) < baseline.totalMessages - 1,
  );
  // Every page before the newest one is an earlier-page request.
  expect(earlier.length).toBeGreaterThanOrEqual(pageCount - 1);
  expect(earlier.every((url) => url.searchParams.get('fill') === 'end')).toBe(
    true,
  );
});
