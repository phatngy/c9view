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
        totalMessages: cursor + 50,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        ...sessionDetail,
        cursor,
        totalMessages: cursor + 100,
        nextCursor: cursor + 50,
      })
      .mockResolvedValueOnce({
        ...sessionDetail,
        cursor: cursor + 50,
        totalMessages: cursor + 100,
        nextCursor: null,
      });
    const { result, unmount } = renderHook(() => useSession('p', 's'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pageParams).toEqual([{ cursor, limit: 50 }]);
    await act(async () => {
      await refreshSession(client, 'local', 'p', 's');
    });
    expect(request).toHaveBeenNthCalledWith(2, 'local', 'p', 's', {
      cursor,
      limit: 50,
    });
    expect(result.current.data?.pageParams).toEqual([{ cursor, limit: 50 }]);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      'local',
      'p',
      's',
      { cursor: cursor + 50, limit: 50 },
      expect.any(AbortSignal),
    );
    expect(result.current.data?.pages.map((page) => page.cursor)).toEqual([
      cursor,
      cursor + 50,
    ]);
    expect(result.current.data?.pageParams).toEqual([
      { cursor, limit: 50 },
      { cursor: cursor + 50, limit: 50 },
    ]);
    unmount();
    client.clear();
  },
);
