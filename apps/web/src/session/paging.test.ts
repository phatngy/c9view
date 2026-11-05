import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionDetailResponse } from '@c9view/api';
import { SESSION_PAGE_SIZE, type SessionPageParam } from '../api.js';
import { messages, sessionDetail } from '../test-fixtures.js';
import {
  nextSessionPage,
  previousSessionPage,
  smoothScrollBehavior,
} from './paging.js';

const page = (
  overrides: Partial<SessionDetailResponse> = {},
): SessionDetailResponse => ({
  ...sessionDetail,
  ...overrides,
});
afterEach(() => vi.unstubAllGlobals());

describe('previousSessionPage', () => {
  it('uses absolute offsets without overlapping the next page', () => {
    expect(
      previousSessionPage(page({ cursor: 1538, prevCursor: 1488 })),
    ).toEqual({ cursor: 1488, limit: 50, fill: 'end' });
    expect(previousSessionPage(page({ cursor: 38, prevCursor: 0 }))).toEqual({
      cursor: 0,
      limit: 38,
      fill: 'end',
    });
  });
  it('stops at the beginning or without a preceding page', () => {
    expect(
      previousSessionPage(page({ cursor: 0, prevCursor: 0 })),
    ).toBeUndefined();
    expect(
      previousSessionPage(page({ cursor: 50, prevCursor: null })),
    ).toBeUndefined();
  });
});

describe('nextSessionPage', () => {
  it('uses the server next offset before consulting the poll', () => {
    expect(nextSessionPage(page({ nextCursor: 38 }), undefined)).toEqual({
      cursor: 38,
      limit: 50,
    });
  });
  it('loads growth from the previous absolute total', () => {
    expect(nextSessionPage(page(), 4)).toEqual({ cursor: 3, limit: 50 });
    for (const total of [undefined, 2, 3])
      expect(nextSessionPage(page(), total)).toBeUndefined();
  });
  it('never chains another request from an empty end page', () => {
    expect(nextSessionPage(page({ messages: [] }), 100)).toBeUndefined();
  });
});

it('reconstructs chronological pages exactly on an infinite-query refetch', () => {
  for (let total = 0; total <= 260; total++) {
    const serve = (param: SessionPageParam): SessionDetailResponse => {
      const limit = param === 'end' ? SESSION_PAGE_SIZE : param.limit;
      const cursor =
        param === 'end'
          ? Math.max(0, total - limit)
          : Math.min(param.cursor, total);
      return page({
        cursor,
        prevCursor: cursor > 0 ? Math.max(0, cursor - limit) : null,
        nextCursor: cursor + limit < total ? cursor + limit : null,
        totalMessages: total,
        messages: Array.from(
          { length: Math.min(limit, total - cursor) },
          (_, index) => ({ ...messages[0]!, uuid: String(cursor + index) }),
        ),
      });
    };
    const original = [serve('end')];
    const params: SessionPageParam[] = ['end'];
    for (;;) {
      const previous = previousSessionPage(original[0]!);
      if (!previous) break;
      params.unshift(previous);
      original.unshift(serve(previous));
    }
    const rebuilt = [serve(params[0]!)];
    for (;;) {
      const next = nextSessionPage(rebuilt.at(-1)!, undefined);
      if (!next) break;
      rebuilt.push(serve(next));
    }
    const intervals = (pages: SessionDetailResponse[]) =>
      pages.map((item) => ({
        cursor: item.cursor,
        limit: item.messages.length,
      }));
    expect(intervals(rebuilt), `total ${total}`).toEqual(intervals(original));
    expect(
      rebuilt.flatMap((item) =>
        item.messages.map((message) => Number(message.uuid)),
      ),
    ).toEqual(Array.from({ length: total }, (_, index) => index));
  }
});

it('animates user navigation unless reduced motion is requested', () => {
  const media = vi.fn(() => ({ matches: false }));
  vi.stubGlobal('matchMedia', media);
  expect(smoothScrollBehavior()).toBe('smooth');
  expect(media).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  media.mockReturnValue({ matches: true });
  expect(smoothScrollBehavior()).toBe('instant');
});

it('follows short forward pages and end-filled backward pages without gaps', () => {
  const total = 123;
  const serve = (param: SessionPageParam): SessionDetailResponse => {
    const limit = param === 'end' ? SESSION_PAGE_SIZE : param.limit;
    const start = param === 'end' ? Math.max(0, total - limit) : param.cursor;
    const end = Math.min(total, start + limit);
    const backwards = param === 'end' || param.fill === 'end';
    const cursor = backwards ? Math.max(start, end - 7) : start;
    const count = Math.min(7, end - cursor);
    return page({
      cursor,
      prevCursor: cursor > 0 ? Math.max(0, cursor - limit) : null,
      nextCursor: cursor + count < total ? cursor + count : null,
      totalMessages: total,
      truncated: true,
      messages: Array.from({ length: count }, (_, index) => ({
        ...messages[0]!,
        uuid: String(cursor + index),
      })),
    });
  };
  const expected = Array.from({ length: total }, (_, index) => String(index));
  const forward = [serve({ cursor: 0, limit: 50 })];
  while (forward.at(-1)!.nextCursor !== null)
    forward.push(serve(nextSessionPage(forward.at(-1)!, undefined)!));
  expect(forward.flatMap((item) => item.messages.map((m) => m.uuid))).toEqual(
    expected,
  );
  const backward = [serve('end')];
  while (backward[0]!.prevCursor !== null) {
    const param = previousSessionPage(backward[0]!)!;
    expect(param).toMatchObject({ fill: 'end' });
    const previous = serve(param);
    expect(previous.cursor + previous.messages.length).toBe(
      backward[0]!.cursor,
    );
    backward.unshift(previous);
  }
  expect(backward.flatMap((item) => item.messages.map((m) => m.uuid))).toEqual(
    expected,
  );
});
