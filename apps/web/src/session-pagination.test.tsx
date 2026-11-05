import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, useSession } from './api.js';
import { sessionDetail } from './test-fixtures.js';
import { refreshSession } from './live/index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([1538, 17])(
  'pins an end page at absolute offset %i across growth and pagination',
  async (cursor) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const request = vi
      .spyOn(api, 'session')
      .mockResolvedValueOnce({
        ...sessionDetail,
        cursor,
        totalMessages: cursor + 3,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        ...sessionDetail,
        cursor,
        totalMessages: cursor + 6,
        nextCursor: cursor + 3,
      })
      .mockResolvedValueOnce({
        ...sessionDetail,
        cursor: cursor + 3,
        totalMessages: cursor + 6,
        nextCursor: null,
      });
    const { result, unmount } = renderHook(() => useSession('p', 's'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pageParams).toEqual([{ cursor, limit: 3 }]);
    await act(async () => {
      await refreshSession(client, 'local', 'p', 's');
    });
    expect(request).toHaveBeenNthCalledWith(2, 'local', 'p', 's', {
      cursor,
      limit: 3,
    });
    expect(result.current.data?.pageParams).toEqual([{ cursor, limit: 3 }]);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      'local',
      'p',
      's',
      { cursor: cursor + 3, limit: 50 },
      expect.any(AbortSignal),
    );
    // fetchNextPage resolves before the hook re-renders on slow CI runners.
    await waitFor(() =>
      expect(result.current.data?.pages.map((page) => page.cursor)).toEqual([
        cursor,
        cursor + 3,
      ]),
    );
    expect(result.current.data?.pageParams).toEqual([
      { cursor, limit: 3 },
      { cursor: cursor + 3, limit: 50 },
    ]);
    unmount();
    client.clear();
  },
);

it('keeps byte-limited pages contiguous through backward loading, growth and refetch', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let total = 19;
  const request = vi
    .spyOn(api, 'session')
    .mockImplementation(async (_machine, _project, _session, param = 0) => {
      const limit = typeof param === 'object' ? param.limit : 50;
      const start =
        param === 'end'
          ? Math.max(0, total - limit)
          : typeof param === 'number'
            ? param
            : param.cursor;
      const end = Math.min(total, start + limit);
      const fromEnd =
        param === 'end' || (typeof param === 'object' && param.fill === 'end');
      const cursor = fromEnd ? Math.max(start, end - 3) : start;
      const count = Math.min(3, end - cursor);
      return {
        ...sessionDetail,
        cursor,
        totalMessages: total,
        truncated: true,
        prevCursor: cursor > 0 ? Math.max(0, cursor - limit) : null,
        nextCursor: cursor + count < total ? cursor + count : null,
        messages: Array.from({ length: count }, (_, index) => ({
          ...sessionDetail.messages[0]!,
          uuid: String(cursor + index),
        })),
      };
    });
  const { result, unmount } = renderHook(() => useSession('p', 's'), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.pageParams).toEqual([{ cursor: 16, limit: 3 }]);
  while (result.current.hasPreviousPage) {
    await act(async () => {
      await result.current.fetchPreviousPage();
    });
  }
  const ids = () =>
    result.current.data!.pages.flatMap((page) =>
      page.messages.map((m) => m.uuid),
    );
  expect(ids()).toEqual(
    Array.from({ length: total }, (_, index) => String(index)),
  );
  const cached = result.current.data!;
  for (const [index, param] of cached.pageParams.entries()) {
    expect(param).toMatchObject({
      cursor: cached.pages[index]!.cursor,
      limit: cached.pages[index]!.messages.length,
    });
  }
  total += 4;
  await act(async () => {
    await refreshSession(client, 'local', 'p', 's');
  });
  expect(request.mock.calls.at(-1)?.[3]).toEqual(cached.pageParams.at(-1));
  expect(ids()).toHaveLength(19);
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ['local', 'session', 'p', 's'],
    });
  });
  while (result.current.hasNextPage) {
    await act(async () => {
      await result.current.fetchNextPage();
    });
  }
  expect(ids()).toEqual(
    Array.from({ length: total }, (_, index) => String(index)),
  );
  unmount();
  client.clear();
});
