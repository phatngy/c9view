import '../session.js';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type {
  Message,
  SessionDetailResponse,
  StatusHistoryResponse,
} from '@c9view/api';
import { routeTree } from '../router.js';
import { useSession } from '../api.js';
import {
  projectDetail,
  sessionDetail,
  messages as fixtures,
} from '../test-fixtures.js';
import { Conversation } from './Conversation.js';
import { ConversationEdge } from './ConversationEdge.js';
import { Outline, Timeline } from './Navigation.js';
import { ContextUsage } from './ContextUsage.js';
import { Sidebar, Subagents } from './Sidebar.js';
import { contextUsage, contextWindow } from './context.js';
import {
  collectExport,
  EXPORT_LIMIT,
  exportMarkdown,
  exportJson,
} from './export.js';
import { ExportMenu } from './ExportMenu.js';
import { WindowedMessages } from './WindowedMessages.js';
import { PastedText } from './chat/PastedText.js';
import * as model from './model.js';
import { act } from '@testing-library/react';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
function message(
  id: string,
  role: Message['role'] = 'user',
  text = id,
): Message {
  return {
    ...fixtures[1]!,
    uuid: id,
    role,
    blocks: [{ type: 'text', text }],
    usage: null,
  };
}
function tool(id: string, name = 'Read'): Message {
  return {
    ...message(id, 'assistant'),
    blocks: [
      {
        type: 'tool_use',
        id: `tool-${id}`,
        name,
        input: { path: 'example.ts' },
      },
    ],
  };
}
function detail(
  messages: Message[],
  nextCursor: number | null = null,
): SessionDetailResponse {
  return {
    ...sessionDetail,
    messages,
    nextCursor,
    cursor: 0,
    prevCursor: null,
    totalMessages: messages.length,
  };
}
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
function mockFetch(
  pages: Record<number, SessionDetailResponse> & {
    end?: SessionDetailResponse;
  },
  history: StatusHistoryResponse = { changes: [] },
  projectPending = false,
) {
  const fetcher = vi.fn(async (url: string) => {
    if (projectPending && url === '/api/m/local/projects/project-1')
      return new Promise(() => {});
    let body: unknown;
    if (url.includes('/status/history')) body = history;
    else if (url.includes('?from=end')) body = pages.end ?? pages[0];
    else if (url.includes('?cursor='))
      body =
        pages[
          Number(new URL(url, 'http://localhost').searchParams.get('cursor'))
        ];
    else if (url.endsWith('/status'))
      body = {
        status: sessionDetail.session.status,
        totalMessages: pages[0]!.totalMessages,
        lastAt: null,
      };
    else if (url.endsWith('/changes')) body = { files: [] };
    else body = projectDetail;
    return {
      ok: !!body,
      status: body ? 200 : 404,
      json: async () => body ?? { error: 'Missing fixture' },
    };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function pagedFetch(all: Message[], size = 1) {
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    let body: unknown = projectDetail;
    if (params.has('from') || params.has('cursor')) {
      const requestedLimit = Number(params.get('limit') ?? size);
      const before = Number(params.get('before') ?? all.length);
      const start = params.has('from')
        ? Math.max(0, Math.min(all.length, before) - requestedLimit)
        : Number(params.get('cursor'));
      const end = Math.min(start + requestedLimit, all.length, before);
      // Model a byte-limited server: backward windows return their tail, even
      // when the client requests more messages than fit on one page.
      const cursor =
        params.has('from') || params.get('fill') === 'end'
          ? Math.max(start, end - size)
          : start;
      const count = Math.min(size, end - cursor);
      body = {
        ...detail(all.slice(cursor, cursor + count)),
        cursor,
        prevCursor: cursor > 0 ? Math.max(0, cursor - size) : null,
        nextCursor: cursor + count < all.length ? cursor + count : null,
        totalMessages: all.length,
      };
    } else if (url.endsWith('/status'))
      body = {
        status: sessionDetail.session.status,
        totalMessages: all.length,
        lastAt: null,
      };
    else if (url.endsWith('/changes')) body = { files: [] };
    else if (url.includes('/status/history')) body = { changes: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function pageRequests(fetcher: { mock: { calls: [string, ...unknown[]][] } }) {
  return fetcher.mock.calls.filter(([url]) =>
    /[?](from=end|cursor=)/.test(url),
  );
}

it.each([10, 60])(
  'stores the absolute tail cursor and preserves the window on whole-query refetch after growth (%i messages)',
  async (count) => {
    const all = Array.from({ length: count }, (_, index) =>
      message(`tail-${index}`),
    );
    const fetcher = pagedFetch(all, 50);
    const Wrapper = wrapper();
    const cachedParams: unknown[] = [];
    const unsubscribe = clients[0]!.getQueryCache().subscribe((event) => {
      const data = event.query.state.data as
        { pageParams?: unknown[] } | undefined;
      if (data?.pageParams) cachedParams.push([...data.pageParams]);
    });
    const { result } = renderHook(() => useSession('project-1', 'session-0'), {
      wrapper: Wrapper,
    });
    const cursor = Math.max(0, count - 50);
    const limit = Math.min(count, 50);
    const pageParams = [{ cursor, limit }];
    await waitFor(() =>
      expect(result.current.data?.pageParams).toEqual(pageParams),
    );
    expect(
      clients[0]!.getQueryData(['local', 'session', 'project-1', 'session-0']),
    ).toMatchObject({ pageParams });
    unsubscribe();
    expect(cachedParams.length).toBeGreaterThan(0);
    expect(
      cachedParams.every(
        (params) => JSON.stringify(params) === JSON.stringify(pageParams),
      ),
    ).toBe(true);
    const loaded = all.slice(cursor).map(({ uuid }) => uuid);
    // Grow past the page size even when the original session was short.
    all.push(
      ...Array.from({ length: 51 }, (_, index) => message(`new-tail-${index}`)),
    );
    await act(async () => {
      await clients[0]!.refetchQueries({
        queryKey: ['local', 'session', 'project-1', 'session-0'],
        exact: true,
      });
    });
    expect(result.current.data?.pageParams).toEqual(pageParams);
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pages[0]?.cursor).toBe(cursor);
    expect(
      result.current.data?.pages[0]?.messages
        .slice(0, loaded.length)
        .map(({ uuid }) => uuid),
    ).toEqual(loaded);
    expect(result.current.data?.pages[0]?.messages[0]?.uuid).toBe(
      `tail-${cursor}`,
    );
    expect(pageRequests(fetcher).map(([url]) => url.split('?')[1])).toEqual([
      'from=end&limit=50',
      `cursor=${cursor}&limit=${limit}`,
    ]);
  },
);

function openSession(sessionId = 'session-0', newSession = false) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [
        `/m/local/projects/project-1/sessions/${sessionId}${newSession ? '?newSession=true' : ''}`,
      ],
    }),
    defaultPendingMinMs: 0,
  });
  render(<RouterProvider router={router} />, { wrapper: wrapper() });
  return router;
}

function runFixture(
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    runId: 'run',
    sessionId,
    projectId: 'project-1',
    state: 'running',
    mode: 'default',
    queued: 0,
    startedAt: '2026-11-11T00:00:00.000Z',
    ownedByC9view: true,
    ...overrides,
  };
}

function startFetcher(
  sessionId: string,
  runs: unknown[],
  transcriptReady: () => boolean,
) {
  const fetcher = vi.fn(async (url: string) => {
    let body: unknown = {};
    let status = 200;
    if (url === '/api/machines')
      body = [
        {
          machineId: 'local',
          name: 'Local',
          state: 'online',
          lastSeenAt: null,
          version: '1.0.0',
          protocol: 1,
          outdated: false,
          bootId: 'boot',
          capabilities: { control: { state: 'ready' }, bypass: false },
        },
      ];
    else if (url.endsWith('/control/runs')) body = { runs, requests: [] };
    else if (url.includes('/status/history')) body = { changes: [] };
    else if (url.endsWith('/status'))
      body = { status: 'running', totalMessages: 0, lastAt: null };
    else if (url.endsWith('/changes')) body = { files: [] };
    else if (url === '/api/m/local/projects/project-1') body = projectDetail;
    else if (url.includes(`/sessions/${sessionId}?`)) {
      if (transcriptReady())
        body = {
          ...sessionDetail,
          session: {
            ...sessionDetail.session,
            id: sessionId,
            title: 'New session',
          },
        };
      else {
        status = 404;
        body = { error: 'Not found' };
      }
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

it('T097 shows a failed start and its error, and stops retrying', async () => {
  const sessionId = 'failed-session';
  const fetcher = startFetcher(
    sessionId,
    [runFixture(sessionId, { state: 'failed', error: 'Could not launch' })],
    () => false,
  );
  openSession(sessionId, true);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The session failed to start.');
  expect(alert).toHaveTextContent('Could not launch');
  expect(screen.queryByText('Starting…')).toBeNull();
  const count = () =>
    fetcher.mock.calls.filter(([url]) =>
      url.includes(`/sessions/${sessionId}?`),
    ).length;
  const before = count();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(count()).toBe(before);
});

it('T098 T099 strips newSession from the URL once the transcript loads', async () => {
  const sessionId = 'strip-session';
  let ready = false;
  startFetcher(sessionId, [runFixture(sessionId)], () => ready);
  const router = openSession(sessionId, true);
  expect(await screen.findByText('Starting…')).toBeVisible();
  expect(router.state.location.search).toMatchObject({ newSession: true });
  ready = true;
  await screen.findByRole('heading', { name: 'New session' });
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('newSession', true),
  );
  expect(router.state.location.href).not.toContain('newSession');
});

it.each(['ended', 'failed'])(
  'T101 hides the Driven and Bypass badges once the run is %s',
  async (state) => {
    const sessionId = 'badge-session';
    startFetcher(
      sessionId,
      [runFixture(sessionId, { state, mode: 'bypassPermissions' })],
      () => true,
    );
    openSession(sessionId);
    await screen.findByRole('heading', { name: 'New session' });
    expect(screen.queryByText('Driven by c9view')).toBeNull();
    expect(screen.queryByText('Bypass')).toBeNull();
  },
);

it('keeps Stop and the badges for the live run when an older run of the session ended', async () => {
  const sessionId = 'two-runs';
  startFetcher(
    sessionId,
    [
      runFixture(sessionId, { runId: 'old', state: 'ended' }),
      runFixture(sessionId, {
        runId: 'new',
        state: 'running',
        mode: 'bypassPermissions',
      }),
    ],
    () => true,
  );
  openSession(sessionId);
  await screen.findByRole('heading', { name: 'New session' });
  expect(
    await screen.findByRole('button', { name: 'Run options' }),
  ).toBeVisible();
  expect(screen.getAllByText('Driven by c9view').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Bypass').length).toBeGreaterThan(0);
});

it('T101 shows the Driven and Bypass badges while the run is active', async () => {
  const sessionId = 'badge-active';
  startFetcher(
    sessionId,
    [runFixture(sessionId, { mode: 'bypassPermissions' })],
    () => true,
  );
  openSession(sessionId);
  await screen.findByRole('heading', { name: 'New session' });
  expect(screen.getAllByText('Driven by c9view').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Bypass').length).toBeGreaterThan(0);
});

it('T062 shows Starting until a newly created session transcript is available', async () => {
  const sessionId = 'new-session';
  let transcriptReady = false;
  const fetcher = vi.fn(async (url: string) => {
    let body: unknown = {};
    let status = 200;
    if (url === '/api/machines')
      body = [
        {
          machineId: 'local',
          name: 'Local',
          state: 'online',
          lastSeenAt: null,
          version: '1.0.0',
          protocol: 1,
          outdated: false,
          bootId: 'boot',
          capabilities: { control: { state: 'ready' }, bypass: false },
        },
      ];
    else if (url.endsWith('/control/runs'))
      body = {
        runs: [
          {
            runId: 'run',
            sessionId,
            projectId: 'project-1',
            state: 'running',
            mode: 'default',
            queued: 0,
            startedAt: '2026-11-11T00:00:00.000Z',
            ownedByC9view: true,
          },
        ],
        requests: [],
      };
    else if (url.includes('/status/history')) body = { changes: [] };
    else if (url.endsWith('/status'))
      body = {
        status: 'running',
        totalMessages: transcriptReady ? 3 : 0,
        lastAt: null,
      };
    else if (url.endsWith('/changes')) body = { files: [] };
    else if (url === '/api/m/local/projects/project-1') body = projectDetail;
    else if (url.includes(`/sessions/${sessionId}?`)) {
      if (transcriptReady)
        body = {
          ...sessionDetail,
          session: {
            ...sessionDetail.session,
            id: sessionId,
            title: 'New session',
          },
        };
      else {
        status = 404;
        body = { error: 'Not found' };
      }
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  });
  vi.stubGlobal('fetch', fetcher);
  openSession(sessionId, true);
  expect(await screen.findByText('Starting…')).toBeVisible();
  transcriptReady = true;
  await screen.findByRole('heading', { name: 'New session' });
  expect(
    fetcher.mock.calls.filter(([url]) =>
      url.includes(`/sessions/${sessionId}?`),
    ).length,
  ).toBeGreaterThan(1);
  expect(screen.queryByText('Starting…')).toBeNull();
});

it('stops showing Starting after the new transcript wait cap', async () => {
  const realSetTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, 'setTimeout').mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) =>
    realSetTimeout(
      handler,
      timeout === 120_000 ? 1500 : timeout,
      ...args,
    )) as typeof window.setTimeout);
  const sessionId = 'expired-new-session';
  const fetcher = vi.fn(async (url: string) => {
    let body: unknown = {};
    let status = 200;
    if (url === '/api/machines')
      body = [
        {
          machineId: 'local',
          name: 'Local',
          state: 'online',
          lastSeenAt: null,
          version: '1.0.0',
          protocol: 1,
          outdated: false,
          bootId: 'boot',
          capabilities: { control: { state: 'ready' }, bypass: false },
        },
      ];
    else if (url.endsWith('/control/runs')) body = { runs: [], requests: [] };
    else if (url.includes('/status/history')) body = { changes: [] };
    else if (url.endsWith('/status'))
      body = { status: 'running', totalMessages: 0, lastAt: null };
    else if (url.endsWith('/changes')) body = { files: [] };
    else if (url === '/api/m/local/projects/project-1') body = projectDetail;
    else if (url.includes(`/sessions/${sessionId}?`)) {
      status = 404;
      body = { error: 'Not found' };
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  });
  vi.stubGlobal('fetch', fetcher);
  openSession(sessionId, true);
  expect(await screen.findByText('Starting…')).toBeVisible();
  const future = Date.now() + 120_001;
  vi.spyOn(Date, 'now').mockImplementation(() => future);
  await screen.findByRole('alert');
  expect(screen.queryByText('Starting…')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load data');
});

async function openSearch() {
  const buttons = await screen.findAllByRole('button', {
    name: 'Search this session',
  });
  fireEvent.click(buttons[0]!);
  return screen.findByRole('searchbox');
}

describe('session navigation', () => {
  it('keeps earlier history before the rows inside the conversation scroller', async () => {
    pagedFetch([message('first'), message('last')]);
    openSession();
    await screen.findAllByRole('button', { name: 'Load earlier messages' });
    const button = within(
      document.querySelector<HTMLElement>('.conversation-window')!,
    ).getByRole('button', { name: 'Load earlier messages' });
    expect(button.closest('.conversation-window')).toBeInTheDocument();
    expect(button.closest('[data-message-row]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });
  it('fills a visible short viewport from earlier pages without duplicate requests', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('conversation-window') ? 500 : 0;
      },
    );
    const fetcher = pagedFetch(
      Array.from({ length: 6 }, (_, i) => message(`history-${i}`)),
    );
    openSession();
    await screen.findByText('Beginning of session');
    expect(pageRequests(fetcher)).toHaveLength(6);
    expect(new Set(pageRequests(fetcher).map(([url]) => url)).size).toBe(6);
  });
  it('does not automatically fetch hidden history, and ignores repeated manual requests while loading', async () => {
    const fetcher = pagedFetch([message('first'), message('last')]);
    const request = fetcher.getMockImplementation()!;
    let release: (() => void) | undefined;
    fetcher.mockImplementation(async (url) => {
      if (url.includes('?cursor='))
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return request(url);
    });
    openSession();
    await screen.findAllByRole('button', { name: 'Load earlier messages' });
    expect(pageRequests(fetcher)).toHaveLength(1);
    const scroller = document.querySelector<HTMLElement>(
      '.conversation-window',
    )!;
    fireEvent.click(
      within(scroller).getByRole('button', { name: 'Load earlier messages' }),
    );
    const pending = await within(scroller).findByRole('button', {
      name: 'Loading earlier messages…',
    });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(pending);
    expect(pageRequests(fetcher)).toHaveLength(2);
    await act(async () => release?.());
    await screen.findByText('Beginning of session');
    expect(pageRequests(fetcher)).toHaveLength(2);
  });
  it('stops automatic history loading on error and retries manually', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('conversation-window') ? 500 : 0;
      },
    );
    const fetcher = pagedFetch([message('first'), message('last')]);
    const request = fetcher.getMockImplementation()!;
    let failed = false;
    fetcher.mockImplementation(async (url) => {
      if (url.includes('?cursor=') && !failed) {
        failed = true;
        throw new Error('History unavailable');
      }
      return request(url);
    });
    openSession();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(pageRequests(fetcher)).toHaveLength(2);
    fireEvent.click(retry);
    await screen.findByText('Beginning of session');
    expect(pageRequests(fetcher)).toHaveLength(3);
  });
  it('shows the beginning of a short session without additional requests', async () => {
    const fetcher = pagedFetch([message('only')]);
    openSession();
    await screen.findByText('Beginning of session');
    expect(pageRequests(fetcher)).toHaveLength(1);
  });
  it('retains newest-page metadata after prepending history', async () => {
    mockFetch({
      end: {
        ...detail([message('latest')]),
        cursor: 1,
        prevCursor: 0,
        session: { ...sessionDetail.session, title: 'Newest title' },
      },
      0: {
        ...detail([message('old')]),
        session: { ...sessionDetail.session, title: 'Old title' },
      },
    });
    openSession();
    await screen.findAllByRole('button', { name: 'Load earlier messages' });
    fireEvent.click(
      within(
        document.querySelector<HTMLElement>('.conversation-window')!,
      ).getByRole('button', { name: 'Load earlier messages' }),
    );
    await screen.findByText('Beginning of session');
    expect(
      screen.getByRole('heading', { name: 'Newest title' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Old title' })).toBeNull();
  });
  it('offers earlier history in the outline and retains its control while loading', () => {
    const loadEarlier = vi.fn();
    const { rerender } = render(
      <Outline
        messages={[message('last')]}
        jump={vi.fn()}
        hasEarlier
        loadEarlier={loadEarlier}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Load earlier messages' }),
    );
    expect(loadEarlier).toHaveBeenCalledOnce();
    rerender(
      <Outline
        messages={[message('last')]}
        jump={vi.fn()}
        hasEarlier
        loadingEarlier
        loadEarlier={loadEarlier}
      />,
    );
    const pending = screen.getByRole('button', {
      name: 'Loading earlier messages…',
    });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(pending);
    expect(loadEarlier).toHaveBeenCalledOnce();
  });
  it('loads history from the phone Outline tab while Chat is hidden', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    pagedFetch([message('first'), message('last')]);
    openSession();
    await screen.findByRole('button', { name: 'Outline' });
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Load earlier messages' }),
    );
    await screen.findByRole('button', { name: /Prompt: first/ });
    expect(
      screen.queryByRole('button', { name: 'Load earlier messages' }),
    ).toBeNull();
  });
  it('searches displayed command text rather than markup tags', async () => {
    mockFetch({
      0: detail([
        message(
          'command',
          'user',
          '<command-name>/model</command-name><command-args>opus</command-args>',
        ),
      ]),
    });
    openSession();
    const input = await openSearch();
    fireEvent.change(input, { target: { value: '/model' } });
    expect(screen.getByText('1 matches')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'command-name' } });
    expect(screen.getByText('0 matches')).toBeInTheDocument();
  });
  it('loads pages to find a message hash and highlights its anchor', async () => {
    const fetcher = pagedFetch([message('target'), message('latest')]);
    window.history.replaceState(null, '', '/#m-target');
    openSession();
    await waitFor(() =>
      expect(document.getElementById('m-target')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(document.getElementById('m-target')).toHaveClass(
        'message-highlight',
      ),
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('cursor=0&limit=1'),
      expect.anything(),
    );
  });
  it('clears the tool reveal when a tool hash jump completes', async () => {
    const meta = {
      ...tool('meta-tool'),
      role: 'system' as const,
      isMeta: true,
    };
    mockFetch({ 0: detail([meta]) });
    window.history.replaceState(null, '', '/#tool-tool-meta-tool');
    openSession();
    await waitFor(() =>
      expect(document.getElementById('tool-tool-meta-tool')).toHaveFocus(),
    );
    const toggle = screen.getByRole('checkbox', {
      name: 'Show system messages',
    });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByText('meta-tool')).toBeNull();
  });
  it('bounds missing-anchor paging to 20 pages including the initial page', async () => {
    const fetcher = pagedFetch(
      Array.from({ length: 25 }, (_, i) => message(`page-${i}`)),
    );
    window.history.replaceState(null, '', '/#m-absent');
    openSession();
    await waitFor(() => expect(pageRequests(fetcher).length).toBe(20));
    expect(fetcher.mock.calls.some(([url]) => url.includes('cursor=4&'))).toBe(
      false,
    );
  });
  it('reports and clears a missing hash target after paging is exhausted', async () => {
    const fetcher = mockFetch({ 0: detail([message('present')]) });
    window.history.replaceState(null, '', '/#tool-absent');
    openSession();
    expect(
      await screen.findByText(
        'Message not found in loaded pages; jumps load at most 20 pages.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(pageRequests(fetcher)).toHaveLength(1));
  });
  it('lists first-line prompts, question and plan entries and jumps', () => {
    const jump = vi.fn();
    render(
      <Outline
        messages={[
          message('prompt', 'user', 'First line\nsecond line'),
          tool('question', 'AskUserQuestion'),
          tool('plan', 'ExitPlanMode'),
        ]}
        jump={jump}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Prompt: First line/ }));
    expect(jump).toHaveBeenCalledWith('prompt');
    // Tool entries are labelled by their question or plan, never the tool name.
    expect(
      screen.getByRole('button', { name: /Question/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plan/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /AskUserQuestion|ExitPlanMode/ }),
    ).toBeNull();
  });
  it('groups tool-only assistant runs, counts tools, never groups text, and expands a targeted message', () => {
    const batch = [
      tool('a'),
      tool('b'),
      tool('c', 'Edit'),
      message('text', 'assistant', 'Always visible'),
      tool('d'),
    ];
    const { rerender } = render(<Conversation messages={batch} />);
    const group = screen.getByRole('button', {
      name: /^3 tool calls.*Read ×2 · Edit/,
    });
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Always visible')).toBeInTheDocument();
    expect(document.getElementById('m-a')).toBeNull();
    fireEvent.click(group);
    expect(document.getElementById('m-b')).toBeInTheDocument();
    fireEvent.click(group);
    rerender(<Conversation messages={batch} target="b" />);
    expect(document.getElementById('m-b')).toBeInTheDocument();
  });
  it.each(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'plan'])(
    'keeps %s outside tool groups',
    (name) => {
      const groups = model.groupMessages([
        tool('before'),
        tool('interaction', name),
        tool('after'),
      ]);
      expect(groups).toHaveLength(3);
      expect(groups[1]![0]!.uuid).toBe('interaction');
    },
  );
  it('keeps an interaction visible when its message also contains another tool call', () => {
    const question = tool('question', 'AskUserQuestion');
    question.blocks.push(...tool('sibling').blocks);
    render(
      <Conversation messages={[tool('before'), question, tool('after')]} />,
    );
    expect(screen.queryByRole('button', { name: /tool calls/ })).toBeNull();
    expect(
      screen.getByText('Question · waiting for your answer'),
    ).toBeInTheDocument();
  });
  it('summarizes names in first appearance order and only matching result times', () => {
    const batch = [
      tool('read'),
      tool('mcp', 'mcp__server__lookup'),
      tool('read2'),
    ];
    const result = {
      ...message('result'),
      timestamp: '2026-01-01T00:00:02Z',
      blocks: [
        {
          type: 'tool_result' as const,
          toolUseId: 'tool-mcp',
          text: 'Done',
          isError: false,
        },
      ],
    };
    const unrelated = {
      ...result,
      timestamp: '2026-01-01T00:00:10Z',
      blocks: [{ ...result.blocks[0]!, toolUseId: 'not-in-group' }],
    };
    expect(
      model.summarizeGroup(
        batch,
        new Map([
          ['tool-mcp', result.timestamp],
          ['not-in-group', unrelated.timestamp],
        ]),
      ),
    ).toMatchObject({
      count: 3,
      names: [
        { name: 'Read', count: 2 },
        { name: 'lookup', count: 1 },
      ],
      additions: 0,
      deletions: 0,
      startAt: batch[0]!.timestamp,
      endAt: result.timestamp,
    });
  });
  it('expands a group and highlights the message targeted by search', async () => {
    const batch = [tool('first'), tool('second')];
    const { rerender } = render(<Conversation messages={batch} />);
    rerender(
      <Conversation
        messages={batch}
        target="second"
        search={{ term: 'example', active: 'second' }}
      />,
    );
    await waitFor(() =>
      expect(document.getElementById('m-second')).toHaveClass(
        'message-highlight',
      ),
    );
    expect(
      screen.getByRole('button', { name: /^2 tool calls/ }),
    ).toHaveAttribute('aria-expanded', 'true');
  });
  it('shows group diff totals and duration from matching result timestamps', () => {
    const edit = tool('edit', 'Edit');
    const block = edit.blocks[0]!;
    if (block.type !== 'tool_use') throw new Error('Expected tool');
    block.change = {
      filePath: 'example.ts',
      kind: 'update',
      additions: 4,
      deletions: 2,
      hunks: [],
      truncated: false,
    };
    edit.timestamp = '2026-01-01T00:00:00Z';
    const result = {
      ...message('result'),
      timestamp: '2026-01-01T00:00:02Z',
      blocks: [
        {
          type: 'tool_result' as const,
          toolUseId: 'tool-edit',
          text: 'Done',
          isError: false,
        },
      ],
    };
    render(<Conversation messages={[edit, tool('read'), result]} />);
    const header = screen.getByRole('button', {
      name: /^2 tool calls.*Edit · Read/,
    });
    expect(within(header).getByText('+4')).toBeInTheDocument();
    expect(within(header).getByText('−2')).toBeInTheDocument();
    expect(
      within(header).getByText('4 additions, 2 deletions'),
    ).toBeInTheDocument();
    expect(within(header).getByText('2s')).toBeInTheDocument();
  });
  it('opens a targeted tool row inside a collapsed group', () => {
    const batch = [tool('first'), tool('second')];
    const { rerender } = render(<Conversation messages={batch} />);
    expect(document.getElementById('m-second')).toBeNull();
    rerender(<Conversation messages={batch} target="tool-second" />);
    const article = document.getElementById('m-second')!;
    expect(article).toBeInTheDocument();
    expect(
      within(article).getByRole('button', { name: /^Read/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: /^2 tool calls/ }),
    ).toHaveAttribute('aria-expanded', 'true');
  });
  it('groups real alternating thinking, calls and results, with collapsed thinking and no empty cards', () => {
    const run = ['a', 'b'].flatMap((id) => [
      {
        ...message(`thinking-${id}`, 'assistant'),
        blocks: [{ type: 'thinking' as const, text: 'Private reasoning' }],
      },
      tool(id),
      {
        ...message(`result-${id}`),
        blocks: [
          {
            type: 'tool_result' as const,
            toolUseId: `tool-${id}`,
            text: 'Result',
            isError: false,
          },
        ],
      },
    ]);
    const batch = [...run, message('reply', 'assistant', 'Final response')];
    expect(model.groupMessages(batch)).toHaveLength(2);
    render(<Conversation messages={batch} />);
    fireEvent.click(
      screen.getByRole('button', { name: /^2 tool calls.*Read ×2/ }),
    );
    expect(screen.getAllByRole('button', { name: /Thinking/ })).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: /Thinking/ })[0]!,
    ).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('m-result-a')).toBeNull();
    expect(document.querySelectorAll('.conversation-window')).toHaveLength(1);
    expect(document.querySelector('.conversation-inline')).toBeInTheDocument();
    expect(screen.getByText('Final response')).toBeInTheDocument();
    expect(
      model.groupMessages(run.slice(0, 3)).every((g) => g.length === 1),
    ).toBe(true);
    const meta = { ...message('meta', 'system'), isMeta: true, blocks: [] };
    expect(model.groupMessages([tool('x'), meta, tool('y')])).toHaveLength(1);
    expect(
      model.groupMessages([
        tool('x'),
        message('break', 'assistant'),
        tool('y'),
      ]),
    ).toHaveLength(3);
  });
  it('keeps a jumped-to system message visible after jump handling clears the target', async () => {
    const meta = {
      ...message('system-event', 'system', 'System event'),
      isMeta: true,
    };
    function JumpHarness() {
      const [target, setTarget] = useState<string | undefined>('system-event');
      return (
        <div data-target={target ?? ''}>
          <Conversation
            messages={[meta]}
            target={target}
            onJumpHandled={() => setTarget(undefined)}
          />
        </div>
      );
    }
    render(<JumpHarness />);
    expect(screen.getByText('System event')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.getElementById('m-system-event')).toHaveFocus();
      expect(document.querySelector('[data-target=""]')).toBeInTheDocument();
    });
    expect(screen.getByText('System event')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Show system messages' }),
    );
    expect(screen.getByText('System event')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Show system messages' }),
    );
    expect(screen.queryByText('System event')).toBeNull();
  });
  it('renders remaining messages when a hidden meta tool leaves a group with one visible call', () => {
    const hiddenTool = {
      ...tool('hidden'),
      isMeta: true,
    };
    const result = {
      ...message('hidden-result', 'user'),
      blocks: [
        {
          type: 'tool_result' as const,
          toolUseId: 'tool-hidden',
          text: 'Visible result',
          isError: false,
        },
      ],
    };
    render(<Conversation messages={[tool('visible'), hiddenTool, result]} />);
    expect(document.getElementById('m-visible')).toBeInTheDocument();
    expect(document.getElementById('m-hidden-result')).toBeInTheDocument();
    expect(screen.getByText('Visible result')).toBeInTheDocument();
  });
  it('groups multiple calls in one message but leaves a single call ungrouped', () => {
    const one = tool('single');
    const { rerender } = render(<Conversation messages={[one]} />);
    expect(screen.queryByRole('button', { name: /tool calls/ })).toBeNull();
    rerender(
      <Conversation
        messages={[
          { ...one, blocks: [...one.blocks, ...tool('second').blocks] },
        ]}
      />,
    );
    expect(
      screen.getByRole('button', { name: /^2 tool calls.*Read ×2/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
  it('nests subagents only beneath matching parent tool cards', () => {
    render(
      <Conversation
        messages={[
          tool('parent', 'Task'),
          message('separate', 'assistant', 'Text'),
        ]}
        context={{
          subagents: [
            {
              agentId: 'child',
              description: 'Synthetic analysis',
              parentToolUseId: 'tool-parent',
            },
            {
              agentId: 'other',
              description: 'Other agent',
              parentToolUseId: 'missing',
            },
          ],
        }}
      />,
    );
    const article = document.getElementById('m-parent')!;
    expect(within(article).getByText('Synthetic analysis')).toBeInTheDocument();
    expect(within(article).queryByText('Other agent')).toBeNull();
  });
  it('searches text and tool input summaries with next and previous navigation', async () => {
    mockFetch({
      0: detail([
        message('one', 'user', 'Needle first'),
        message('two', 'assistant', 'needle second'),
        tool('read'),
      ]),
    });
    openSession();
    fireEvent.change(await openSearch(), {
      target: { value: 'NEEDLE' },
    });
    expect(screen.getByText('2 matches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(window.location.hash).toBe('#m-one');
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(window.location.hash).toBe('#m-two');
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(window.location.hash).toBe('#m-one');
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'example.ts' },
    });
    expect(screen.getByText('1 matches')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Search all conversations' }),
    ).toHaveAttribute(
      'href',
      '/m/local/search?q=example.ts&projectId=project-1',
    );
  });
  it('reveals pasted text when Next match jumps to its hidden content', async () => {
    const pasted = Array.from({ length: 25 }, (_, index) =>
      index === 12 ? 'only-pasted-needle' : `Pasted line ${index}`,
    ).join('\n');
    mockFetch({
      0: detail([
        message(
          'pasted-search',
          'user',
          `<pasted_content>${pasted}</pasted_content>`,
        ),
      ]),
    });
    openSession();
    const fold = await screen.findByRole('button', {
      name: /^Pasted text 25 lines$/,
    });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(await openSearch(), {
      target: { value: 'only-pasted-needle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(fold).toHaveAttribute('aria-expanded', 'true'));
    expect(
      screen.getByText(/only-pasted-needle/, { selector: 'pre' }),
    ).toBeInTheDocument();
  });
  it('searches earlier pages for the previous match after selecting the latest loaded match', async () => {
    const fetcher = pagedFetch([
      message('first', 'user', 'Needle'),
      message('last', 'user', 'Needle too'),
    ]);
    openSession();
    fireEvent.change(await openSearch(), { target: { value: 'needle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    await waitFor(() => expect(window.location.hash).toBe('#m-last'));
    expect(pageRequests(fetcher)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    await waitFor(() => expect(window.location.hash).toBe('#m-first'));
    expect(pageRequests(fetcher)).toHaveLength(2);
  });
  it('searches backwards one matching page at a time and wraps to the newest', async () => {
    pagedFetch(
      ['first', 'middle', 'last'].map((id) => message(id, 'user', 'Needle')),
    );
    openSession();
    fireEvent.change(await openSearch(), { target: { value: 'needle' } });
    for (const id of ['last', 'middle', 'first', 'last']) {
      fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
      await waitFor(() => expect(window.location.hash).toBe(`#m-${id}`));
    }
  });
  it('loads older matches before Next wraps to the oldest match', async () => {
    pagedFetch(
      ['first', 'middle', 'last'].map((id) => message(id, 'user', 'Needle')),
    );
    openSession();
    fireEvent.change(await openSearch(), { target: { value: 'needle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(window.location.hash).toBe('#m-last'));
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(window.location.hash).toBe('#m-first'));
  });
  it('bounds earlier-page search paging to twenty pages', async () => {
    const fetcher = pagedFetch(
      Array.from({ length: 25 }, (_, i) => message(`p-${i}`, 'user', 'Needle')),
    );
    openSession();
    fireEvent.change(await openSearch(), { target: { value: 'needle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(window.location.hash).toBe('#m-p-24'));
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await waitFor(() => expect(window.location.hash).toBe('#m-p-4'));
    expect(pageRequests(fetcher)).toHaveLength(21);
    expect(
      screen.getByText('Searched up to 20 pages; more messages remain.'),
    ).toBeInTheDocument();
  });
  it('reports the search cap when the only match is still in unloaded history', async () => {
    const fetcher = pagedFetch(
      Array.from({ length: 25 }, (_, i) =>
        message(
          `p-${i}`,
          'user',
          i === 0 ? 'Unique ancient needle' : 'Other text',
        ),
      ),
    );
    openSession();
    fireEvent.change(await openSearch(), {
      target: { value: 'ancient needle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(
      await screen.findByText('Searched up to 20 pages; more messages remain.'),
    ).toBeInTheDocument();
    expect(pageRequests(fetcher)).toHaveLength(21);
    expect(window.location.hash).toBe('');
  });
  it.each(['hash', 'outline', 'search'])(
    'resumes live tailing after a %s jump completes',
    async (source) => {
      const all = [message('first')];
      const fetcher = pagedFetch(all);
      if (source === 'hash') window.history.replaceState(null, '', '/#m-first');
      openSession();
      await openSearch();
      if (source === 'outline')
        fireEvent.click(screen.getByRole('button', { name: /Prompt: first/ }));
      if (source === 'search') {
        fireEvent.change(screen.getByRole('searchbox'), {
          target: { value: 'first' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
      }
      await waitFor(() =>
        expect(document.getElementById('m-first')).toHaveFocus(),
      );
      // The jump animation settles before the server announces another message.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      all.push(message('live'));
      act(() =>
        clients[0]!.setQueryData(
          ['local', 'session-poll', 'project-1', 'session-0'],
          {
            status: sessionDetail.session.status,
            totalMessages: 2,
            lastAt: null,
          },
        ),
      );
      await waitFor(() =>
        expect(document.getElementById('m-live')).toBeInTheDocument(),
      );
      expect(fetcher).toHaveBeenCalledWith(
        expect.stringContaining('cursor=1&limit=50'),
        expect.anything(),
      );
    },
  );
  it('shows Jump to latest when appends increase the gap below an unpinned reader', async () => {
    const all = [message('first')];
    pagedFetch(all);
    openSession();
    await waitFor(() =>
      expect(document.getElementById('m-first')).toBeInTheDocument(),
    );
    const scroller = screen.getByLabelText('Conversation messages');
    let height = 1000;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, get: () => height },
    });
    fireEvent.scroll(scroller, { target: { scrollTop: 380 } });
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
    all.push(message('appended live row'));
    height = 2000;
    act(() =>
      clients[0]!.setQueryData(
        ['local', 'session-poll', 'project-1', 'session-0'],
        {
          status: sessionDetail.session.status,
          totalMessages: 2,
          lastAt: null,
        },
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Jump to latest' }),
    ).toBeInTheDocument();
    expect(scroller.scrollTop).toBe(380);
  });
  it('does not rebuild the 2,000-message search index while typing', async () => {
    const build = vi.spyOn(model, 'buildSearchIndex');
    mockFetch({
      0: detail(Array.from({ length: 2000 }, (_, i) => message(`entry-${i}`))),
    });
    openSession();
    const input = await openSearch();
    const calls = build.mock.calls.length;
    for (const value of ['e', 'en', 'ent', 'entry-1999'])
      fireEvent.change(input, { target: { value } });
    expect(screen.getByText('1 matches')).toBeInTheDocument();
    expect(build).toHaveBeenCalledTimes(calls);
    // Rendering 2,000 messages in jsdom takes ~2 s locally, over the 5 s
    // default on slow CI runners; the assertion is about memoization.
  }, 20_000);
  it('caps tool input summaries without serializing or visiting the whole input', () => {
    const unread = vi.fn(() => {
      throw new Error('Unbounded traversal');
    });
    const input = {
      content: '語'.repeat(100_000),
      get tail() {
        return unread();
      },
    };
    const summary = model.summarizeInput(input);
    expect(new TextEncoder().encode(summary).length).toBeLessThanOrEqual(2000);
    expect(unread).not.toHaveBeenCalled();
  });
  it('makes details reachable from Usage, switches all panels, and focuses an Outline jump without scroll locks', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mockFetch({ 0: detail([message('prompt')]) });
    openSession();
    const nav = await screen.findByRole('navigation', {
      name: 'Session sections',
    });
    const tab = (name: string) => within(nav).getByRole('button', { name });
    expect(tab('Chat')).toHaveAttribute('aria-current', 'page');
    expect(document.documentElement).toHaveClass('session-route');
    fireEvent.click(tab('Usage'));
    expect(tab('Usage')).toHaveAttribute('aria-current', 'page');
    expect(tab('Chat')).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('heading', { name: 'Tokens per turn' }),
    ).toHaveFocus();
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Session details', expanded: false })
        .find(
          (button) =>
            button.getAttribute('aria-controls') === 'session-details-body',
        )!,
    );
    expect(
      await screen.findByRole('heading', { name: 'Status timeline' }),
    ).toBeVisible();
    fireEvent.click(tab('Files'));
    expect(
      screen.getByRole('heading', { name: 'Files changed' }),
    ).toBeVisible();
    fireEvent.click(tab('Outline'));
    fireEvent.click(screen.getByRole('button', { name: /Prompt: prompt/ }));
    await waitFor(() =>
      expect(document.getElementById('m-prompt')).toHaveFocus(),
    );
    expect(tab('Chat')).toHaveAttribute('aria-current', 'page');
    expect(document.documentElement).not.toHaveClass('session-drawer-open');
    cleanup();
    expect(document.documentElement).not.toHaveClass('session-drawer-open');
    expect(document.documentElement).not.toHaveClass('session-route');
  });
  it('keeps Jump to latest through rail scrolls and hides it on phone Usage', async () => {
    mockFetch({ 0: detail([message('prompt')]) });
    openSession();
    const conversation = await screen.findByLabelText('Conversation messages');
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(conversation);
    expect(
      await screen.findByRole('button', { name: 'Jump to latest' }),
    ).toBeInTheDocument();
    fireEvent.scroll(
      screen.getByRole('complementary', { name: 'Session rail' }),
    );
    expect(
      screen.getByRole('button', { name: 'Jump to latest' }),
    ).toBeInTheDocument();
  });
  it('does not show Jump to latest over Usage on a phone', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mockFetch({ 0: detail([message('prompt')]) });
    openSession();
    const conversation = await screen.findByLabelText('Conversation messages');
    Object.defineProperties(conversation, {
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(conversation);
    expect(
      await screen.findByRole('button', { name: 'Jump to latest' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });
  it('uses a placeholder project label while the project query is pending', async () => {
    mockFetch({ 0: detail([message('prompt')]) }, { changes: [] }, true);
    openSession();
    expect(await screen.findByText(/… ·/)).toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByText('…')).toBeInTheDocument();
    expect(within(breadcrumb).queryByText('project-1')).toBeNull();
    expect(screen.queryByText(/project-1 · Opus/)).toBeNull();
  });
  it('opens a requested full change in Files from a tool card', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    const change = {
      filePath: '/workspace/demo.ts',
      kind: 'update' as const,
      additions: 1,
      deletions: 0,
      truncated: false,
      hunks: [],
    };
    const edit = {
      ...tool('edit', 'Edit'),
      blocks: [
        {
          type: 'tool_use' as const,
          id: 'edit-call',
          name: 'Edit',
          input: { file_path: change.filePath },
          change,
        },
      ],
    };
    const fetcher = mockFetch({ 0: detail([edit]) });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('/changes'))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                ...change,
                fileId: 'f',
                relPath: 'demo.ts',
                toolUseIds: ['edit-call'],
                firstAt: null,
                lastAt: null,
              },
            ],
          }),
        };
      if (url.endsWith('/changes/f'))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...change,
            fileId: 'f',
            steps: [],
            source: 'tool-hunks',
            tooLarge: false,
            partial: false,
          }),
        };
      return original(url);
    });
    openSession();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open in Files changed' }),
    );
    const nav = screen.getByRole('navigation', { name: 'Session sections' });
    expect(within(nav).getByRole('button', { name: 'Files' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await screen.findByRole('dialog', { name: 'Session file diff' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Files changed' }),
    ).toBeVisible();
  });
  it('opens Usage and scrolls to a requested subagent beyond the first three', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const agent = tool('agent', 'Agent');
    const data = {
      ...detail([agent]),
      subagents: Array.from({ length: 4 }, (_, i) => ({
        agentId: `agent-${i}`,
        description: `Review ${i}`,
        parentToolUseId: 'tool-agent',
      })),
    };
    mockFetch({ 0: data });
    openSession();
    fireEvent.click(
      await screen.findByRole('button', { name: /Subagent: Review 3/ }),
    );
    const nav = screen.getByRole('navigation', { name: 'Session sections' });
    expect(within(nav).getByRole('button', { name: 'Usage' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() =>
      expect(scroll.mock.contexts).toContain(
        document.getElementById('subagent-agent-3'),
      ),
    );
    expect(document.getElementById('subagent-agent-3')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Review 3.*agent-3/ }));
    await waitFor(() =>
      expect(document.getElementById('tool-tool-agent')).toHaveFocus(),
    );
    expect(within(nav).getByRole('button', { name: 'Chat' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
  it('keeps jump focus and details reachable across tablet and desktop breakpoint changes', async () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return matches;
        },
        addEventListener: (_type: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          listeners.delete(listener),
      })),
    );
    mockFetch({ 0: detail([message('prompt')]) });
    openSession();
    fireEvent.click(
      await screen.findByRole('button', { name: /Prompt: prompt/ }),
    );
    await waitFor(() =>
      expect(document.getElementById('m-prompt')).toHaveFocus(),
    );
    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    const nav = screen.getByRole('navigation', { name: 'Session sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Usage' }));
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Session details', expanded: false })
        .find(
          (button) =>
            button.getAttribute('aria-controls') === 'session-details-body',
        )!,
    );
    expect(
      await screen.findByRole('heading', { name: 'Status timeline' }),
    ).toBeVisible();
    expect(document.documentElement).not.toHaveClass('session-drawer-open');
    matches = false;
    act(() => listeners.forEach((listener) => listener()));
    expect(document.getElementById('m-prompt')).toBeVisible();
    expect(document.documentElement).not.toHaveClass('session-drawer-open');
  });
});

describe('timeline and usage', () => {
  it('shows the last five timeline entries with an expand control', async () => {
    const history: StatusHistoryResponse = {
      changes: Array.from({ length: 7 }, (_, i) => ({
        at: `2026-10-25T10:0${i}:00Z`,
        column: 'in_progress',
        reason: `Reason ${i}`,
        source: 'hook',
      })),
    };
    mockFetch({ 0: sessionDetail }, history);
    render(<Timeline projectId="project-1" sessionId="session-0" />, {
      wrapper: wrapper(),
    });
    await screen.findByText('Reason 6');
    expect(screen.queryByText('Reason 0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show all (7)' }));
    expect(screen.getByText('Reason 0')).toBeInTheDocument();
  });
  it('computes context from input and both caches, excluding output', () => {
    const m = {
      ...message('usage', 'assistant'),
      usage: {
        input: 50_000,
        cacheRead: 40_000,
        cacheCreation: 10_000,
        output: 9000,
        thinking: 3000,
      },
    };
    expect(contextUsage([m])).toEqual({
      used: 100_000,
      capacity: 200_000,
      percent: 50,
    });
    expect(contextWindow('claude-sonnet-4[1m]')).toBe(1_000_000);
    expect(contextWindow('claude-opus-4-6')).toBe(200_000);
    expect(contextWindow('unknown')).toBe(200_000);
  });
});

describe('context inference', () => {
  const turn = (
    id: string,
    input: number,
    overrides: Partial<Message> = {},
  ): Message => ({
    ...message(id, 'assistant'),
    model: 'sonnet',
    usage: {
      input,
      cacheRead: 0,
      cacheCreation: 0,
      output: 500_000,
      thinking: 0,
    },
    ...overrides,
  });
  it.each([
    'claude-sonnet-5',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-opus-4-5-20251101',
    'sonnet',
    'opus',
    '<synthetic>',
  ])('defaults %s to 200k', (model) => {
    expect(contextUsage([turn('normal', 200_000, { model })]).capacity).toBe(
      200_000,
    );
  });
  it('infers 1M from any earlier observed input and both caches', () => {
    const earlier = turn('earlier', 1, {
      usage: {
        input: 1,
        cacheRead: 100_000,
        cacheCreation: 100_000,
        output: 0,
        thinking: 0,
      },
    });
    expect(contextUsage([earlier, turn('latest', 50_000)])).toEqual({
      used: 50_000,
      capacity: 1_000_000,
      percent: 5,
    });
  });
  it('honors an explicit suffix and excludes sidechains and synthetic models from the latest turn', () => {
    const turns = [
      turn('real', 100_000, { model: 'opus[1m]' }),
      turn('side', 150_000, { isSidechain: true }),
      turn('fake', 0, { model: '<synthetic>' }),
    ];
    expect(contextUsage(turns)).toEqual({
      used: 100_000,
      capacity: 1_000_000,
      percent: 10,
    });
    expect(contextUsage([])).toEqual({
      used: 0,
      capacity: 200_000,
      percent: 0,
    });
  });
});

describe('export', () => {
  it('formats role, time, model, tools and bounded tool results as Markdown', () => {
    const md = exportMarkdown('Synthetic session', [
      message('text', 'assistant', 'Exact **text**'),
      tool('call'),
      {
        ...message('result'),
        blocks: [
          {
            type: 'tool_result',
            toolUseId: 'call',
            isError: false,
            text: 'x'.repeat(2100),
          },
        ],
      },
    ]).join('');
    expect(md).toContain('# Synthetic session');
    expect(md).toContain('## assistant · Unknown time · claude-sonnet');
    expect(md).toContain('Exact **text**');
    expect(md).toContain('### Tool: Read\n\n```json');
    expect(md).toContain('[Truncated to 2,000 characters for export.]');
    expect(md).not.toContain('x'.repeat(2001));
  });
  it('collapses title whitespace and escapes a leading heading marker', () => {
    const md = exportMarkdown('  # first\n\tsecond  ', []).join('');
    expect(md.startsWith('# \\# first second\n\n')).toBe(true);
    expect(md).not.toContain('\n# second');
  });
  it('escapes text headings and fence runs while fencing thinking with a longer delimiter', () => {
    const text = 'Normal **Markdown**\n```\n````\n## user\n```unclosed';
    const parts = exportMarkdown('Safe', [
      {
        ...message('unsafe'),
        blocks: [
          { type: 'text', text },
          { type: 'thinking', text },
        ],
      },
      message('next', 'assistant', 'Still structured'),
    ]);
    const md = parts.join('');
    expect(parts).toHaveLength(3);
    expect(md).toContain('Normal **Markdown**');
    expect(md).toContain('\\## user');
    expect(md).toContain('\\`\\`\\`unclosed');
    expect(md).toContain('### Thinking\n\n`````\n');
    expect(md).toContain('```unclosed\n`````\n\n## assistant');
  });
  it('serializes JSON per message and returns separate Blob parts for both formats', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      message(`part-${i}`),
    );
    const stringify = vi.spyOn(JSON, 'stringify');
    const parts = exportJson({
      session: sessionDetail.session,
      messages,
      truncated: false,
    });
    expect(parts).toHaveLength(102);
    expect(stringify.mock.calls.some(([value]) => value === messages)).toBe(
      false,
    );
    expect(JSON.parse(parts.join('')).messages).toHaveLength(100);
    expect(exportMarkdown('Parts', messages)).toHaveLength(101);
  });
  it('bounds paging at 20,000 messages and reports progress', async () => {
    const page = vi.fn(async (cursor: number) =>
      detail(
        Array.from({ length: 1000 }, (_, i) =>
          message(`message-${cursor + i}`),
        ),
        cursor + 1000,
      ),
    );
    const progress = vi.fn();
    const result = await collectExport(
      page,
      new AbortController().signal,
      progress,
    );
    expect(result.messages).toHaveLength(EXPORT_LIMIT);
    expect(result.truncated).toBe(true);
    expect(page).toHaveBeenCalledTimes(20);
    expect(progress).toHaveBeenLastCalledWith(EXPORT_LIMIT);
  });
  it('stops before the next fetch when canceled during progress', async () => {
    const controller = new AbortController();
    const page = vi.fn(async () => detail([message('first')], 1));
    await expect(
      collectExport(page, controller.signal, () => controller.abort()),
    ).rejects.toThrow();
    expect(page).toHaveBeenCalledTimes(1);
  });
  it('downloads a JSON Blob with session metadata and all messages', async () => {
    mockFetch({ 0: detail([message('exported')]) });
    const createObjectURL = vi.fn<(blob: Blob) => string>(
      () => 'blob:synthetic',
    );
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    render(<ExportMenu projectId="project-1" sessionId="session-0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'JSON' }));
    await screen.findByText('Export complete.');
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0];
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(content)).toMatchObject({
      session: { id: 'session-0' },
      messages: [{ uuid: 'exported' }],
      truncated: false,
    });
  });
  it('rejects non-advancing pages instead of making unbounded requests', async () => {
    const page = vi.fn(async (cursor: number) =>
      detail([message('duplicate')], cursor + 1),
    );
    await expect(
      collectExport(page, new AbortController().signal, () => {}),
    ).rejects.toThrow('Paging returned no new messages.');
    expect(page).toHaveBeenCalledTimes(2);
  });
  it('offers JSON and Markdown and cancels an in-flight request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('Canceled', 'AbortError')),
            ),
          ),
      ),
    );
    render(<ExportMenu projectId="project-1" sessionId="session-0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(await screen.findByText('Export canceled.')).toBeInTheDocument();
  });
});

describe('long conversations', () => {
  function visibleScroller(height = 500, total = 5000) {
    let viewportHeight = height;
    let scrollHeight = total;
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('conversation-window')
          ? viewportHeight
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains('conversation-window')
          ? scrollHeight
          : 0;
      },
    );
    return {
      height: (value: number) => {
        viewportHeight = value;
      },
      total: (value: number) => {
        scrollHeight = value;
      },
    };
  }
  const renderGroup = (group: Message[]) => (
    <article id={`m-${group[0]!.uuid}`}>{group[0]!.uuid}</article>
  );

  it.each([false, true])(
    'opens pinned to the bottom (windowing %s)',
    (enabled) => {
      visibleScroller();
      render(
        <WindowedMessages
          groups={[[message('bottom')]]}
          enabled={enabled}
          startAtBottom
          render={renderGroup}
        />,
      );
      expect(screen.getByLabelText('Conversation messages').scrollTop).toBe(
        4500,
      );
    },
  );

  it.each([false, true])(
    'follows appended rows only while pinned (windowing %s)',
    (enabled) => {
      const layout = visibleScroller();
      const groups = [[message('first')]];
      const { rerender } = render(
        <WindowedMessages
          groups={groups}
          enabled={enabled}
          startAtBottom
          render={renderGroup}
        />,
      );
      const scroller = screen.getByLabelText('Conversation messages');
      layout.total(5500);
      rerender(
        <WindowedMessages
          groups={[...groups, [message('second')]]}
          enabled={enabled}
          startAtBottom
          render={renderGroup}
        />,
      );
      expect(scroller.scrollTop).toBe(5000);
      fireEvent.scroll(scroller, { target: { scrollTop: 1000 } });
      layout.total(6000);
      rerender(
        <WindowedMessages
          groups={[...groups, [message('second')], [message('third')]]}
          enabled={enabled}
          startAtBottom
          render={renderGroup}
        />,
      );
      expect(scroller.scrollTop).toBe(1000);
    },
  );

  it.each([false, true])(
    'does not re-pin while a target is pending (windowing %s)',
    (enabled) => {
      visibleScroller();
      render(
        <WindowedMessages
          groups={[[message('latest')]]}
          enabled={enabled}
          target="not-loaded"
          startAtBottom
          render={renderGroup}
        />,
      );
      expect(screen.getByLabelText('Conversation messages').scrollTop).toBe(0);
    },
  );

  it('calls onNearTop only when visible, ready and near the top', () => {
    const layout = visibleScroller(0, 500);
    const near = vi.fn();
    const groups = [[message('near')]];
    const { rerender } = render(
      <WindowedMessages
        groups={groups}
        enabled={false}
        startAtBottom
        onNearTop={near}
        render={renderGroup}
      />,
    );
    const scroller = screen.getByLabelText('Conversation messages');
    fireEvent.scroll(scroller);
    expect(near).not.toHaveBeenCalled();
    layout.height(500);
    rerender(
      <WindowedMessages
        groups={[...groups]}
        enabled={false}
        startAtBottom
        onNearTop={near}
        render={renderGroup}
      />,
    );
    fireEvent.scroll(scroller);
    expect(near).toHaveBeenCalled();
    near.mockClear();
    fireEvent.scroll(scroller, { target: { scrollTop: 2000 } });
    expect(near).not.toHaveBeenCalled();
    fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
    expect(near).toHaveBeenCalledOnce();
  });

  it('keeps rows still when older rows are prepended without windowing', () => {
    visibleScroller(500, 2000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('conversation-window'))
          return { top: 100, bottom: 600, height: 500 } as DOMRect;
        const scroller = this.closest<HTMLElement>('.conversation-window');
        if (this.dataset.messageRow && scroller) {
          const rows = [...scroller.querySelectorAll('[data-message-row]')];
          const top = 100 + rows.indexOf(this) * 100 - scroller.scrollTop;
          return { top, bottom: top + 100, height: 100 } as DOMRect;
        }
        return { top: 0, bottom: 0, height: 0 } as DOMRect;
      },
    );
    const near = vi.fn();
    const groups = Array.from({ length: 10 }, (_, index) => [
      message(`dom-${index}`),
    ]);
    const { rerender } = render(
      <WindowedMessages
        groups={groups}
        enabled={false}
        render={renderGroup}
        onNearTop={near}
        isFetching
      />,
    );
    const scroller = screen.getByLabelText('Conversation messages');
    fireEvent.scroll(scroller, { target: { scrollTop: 250 } });
    near.mockClear();
    rerender(
      <WindowedMessages
        groups={[[message('older-a')], [message('older-b')], ...groups]}
        enabled={false}
        render={renderGroup}
        onNearTop={() => near()}
        isFetching={false}
      />,
    );
    expect(scroller.scrollTop).toBe(450);
    expect(near).not.toHaveBeenCalled();
  });

  it('does not double-correct a row resize already included in a DOM prepend anchor', () => {
    visibleScroller(500, 2000);
    const observers: {
      callback: ResizeObserverCallback;
      elements: Element[];
    }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        record: { callback: ResizeObserverCallback; elements: Element[] };
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, elements: [] };
          observers.push(this.record);
        }
        observe(element: Element) {
          this.record.elements.push(element);
        }
        disconnect() {}
      },
    );
    let firstHeight = 100;
    const rowHeight = (row: Element) =>
      (row as HTMLElement).dataset.messageRow === 'resize-0'
        ? firstHeight
        : 100;
    const rowOffset = (row: HTMLElement) => {
      const rows = [
        ...row.parentElement!.querySelectorAll(':scope > [data-message-row]'),
      ];
      return rows
        .slice(0, rows.indexOf(row))
        .reduce((total, previous) => total + rowHeight(previous), 0);
    };
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.messageRow ? rowOffset(this) : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('conversation-window'))
          return { top: 100, bottom: 600, height: 500 } as DOMRect;
        const scroller = this.closest<HTMLElement>('.conversation-window');
        if (this.dataset.messageRow && scroller) {
          const top = 100 + rowOffset(this) - scroller.scrollTop;
          const height = rowHeight(this);
          return { top, bottom: top + height, height } as DOMRect;
        }
        return { top: 0, bottom: 0, height: 0 } as DOMRect;
      },
    );
    const groups = Array.from({ length: 10 }, (_, index) => [
      message(`resize-${index}`),
    ]);
    const { rerender } = render(
      <WindowedMessages groups={groups} enabled={false} render={renderGroup} />,
    );
    const scroller = screen.getByLabelText('Conversation messages');
    const row = scroller.querySelector<HTMLElement>(
      '[data-message-row="resize-0"]',
    )!;
    const measure = (height: number) => {
      const observer = observers.findLast((item) =>
        item.elements.includes(row),
      )!;
      act(() =>
        observer.callback(
          [
            {
              target: row,
              borderBoxSize: [{ blockSize: height, inlineSize: 100 }],
            } as unknown as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        ),
      );
    };
    measure(100);
    fireEvent.scroll(scroller, { target: { scrollTop: 250 } });
    firstHeight = 134;
    rerender(
      <WindowedMessages
        groups={[[message('older-a')], [message('older-b')], ...groups]}
        enabled={false}
        render={renderGroup}
      />,
    );
    // The DOM anchor includes both the 200px prepend and the existing row's 34px resize.
    expect(scroller.scrollTop).toBe(484);
    measure(134);
    expect(scroller.scrollTop).toBe(484);
    // A later, independent resize above the viewport still needs compensation.
    firstHeight = 154;
    measure(154);
    expect(scroller.scrollTop).toBe(504);
  });

  it('anchors to the next surviving key when a windowed row merges on prepend', () => {
    visibleScroller();
    const groups = Array.from({ length: 50 }, (_, index) => [
      message(`survive-${index}`),
    ]);
    const { rerender } = render(
      <WindowedMessages groups={groups} enabled render={renderGroup} />,
    );
    const scroller = screen.getByLabelText('Conversation messages');
    fireEvent.scroll(scroller, { target: { scrollTop: 2200 } });
    rerender(
      <WindowedMessages
        groups={[
          [message('older-a')],
          [message('older-b')],
          ...groups.slice(0, 10),
          [message('merged-row'), ...groups[10]!],
          ...groups.slice(11),
        ]}
        enabled
        render={renderGroup}
      />,
    );
    expect(scroller.scrollTop).toBe(2640);
  });

  it('preserves the visible offset when pages append or prepend', () => {
    const many = Array.from({ length: 2000 }, (_, i) => [
      message(`stable-${i}`),
    ]);
    const renderRow = (group: Message[]) => <article>{group[0]!.uuid}</article>;
    const { rerender } = render(
      <WindowedMessages groups={many} enabled render={renderRow} />,
    );
    const container = screen.getByLabelText('Conversation messages');
    fireEvent.scroll(container, { target: { scrollTop: 2200 } });
    rerender(
      <WindowedMessages
        groups={[...many, [message('appended')]]}
        enabled
        render={renderRow}
      />,
    );
    expect(container.scrollTop).toBe(2200);
    rerender(
      <WindowedMessages
        groups={[
          [message('older-one')],
          [message('older-two')],
          ...many,
          [message('appended')],
        ]}
        enabled
        render={renderRow}
      />,
    );
    expect(container.scrollTop).toBe(2640);
  });
  it('uses supplied estimates for unmeasured row offsets', () => {
    const groups = Array.from({ length: 2000 }, (_, i) => [
      message(`estimated-${i}`),
    ]);
    render(
      <WindowedMessages
        groups={groups}
        enabled
        estimate={() => 56}
        render={(group) => <article>{group[0]!.uuid}</article>}
      />,
    );
    const scroller = screen.getByLabelText('Conversation messages');
    fireEvent.scroll(scroller, { target: { scrollTop: 2800 } });
    expect(
      document.querySelector('[data-message-row="estimated-50"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-message-row="estimated-0"]'),
    ).toBeNull();
    expect(scroller.firstElementChild).toHaveStyle({ height: '2240px' });
  });
  it('does not restart a jump or re-observe rows when the estimate changes', () => {
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect() {}
      },
    );
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const groups = Array.from({ length: 30 }, (_, i) => [
      message(`jump-stable-${i}`),
    ]);
    const renderRow = (group: Message[]) => <article>{group[0]!.uuid}</article>;
    const { rerender } = render(
      <WindowedMessages
        groups={groups}
        enabled
        target="jump-stable-2"
        estimate={() => 220}
        render={renderRow}
      />,
    );
    const observed = observe.mock.calls.length;
    const frames = requestFrame.mock.calls.length;
    rerender(
      <WindowedMessages
        groups={groups}
        enabled
        target="jump-stable-2"
        // A new function with the same result, as a parent re-render makes.
        estimate={() => 220}
        render={renderRow}
      />,
    );
    expect(observe).toHaveBeenCalledTimes(observed);
    expect(requestFrame).toHaveBeenCalledTimes(frames);
  });
  it('measures variable heights and compensates for an expanded pasted fold above the viewport', () => {
    visibleScroller();
    const observers: {
      callback: ResizeObserverCallback;
      elements: Element[];
    }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        record: { callback: ResizeObserverCallback; elements: Element[] };
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, elements: [] };
          observers.push(this.record);
        }
        observe(element: Element) {
          this.record.elements.push(element);
        }
        disconnect() {}
      },
    );
    const many = Array.from({ length: 2000 }, (_, i) => [
      message(`measured-${i}`),
    ]);
    render(
      <WindowedMessages
        groups={many}
        enabled
        render={(group) => (
          <article>
            <PastedText text={`${group[0]!.uuid}\nsecond line`} lines={2} />
          </article>
        )}
      />,
    );
    const container = screen.getByLabelText('Conversation messages');
    fireEvent.scroll(container, { target: { scrollTop: 2200 } });
    const observer = observers.at(-1)!;
    const row = observer.elements[0]!;
    const fold = within(row as HTMLElement).getByRole('button', {
      name: /Pasted text/,
    });
    fireEvent.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    act(() =>
      observer.callback(
        [
          {
            target: row,
            borderBoxSize: [{ blockSize: 400, inlineSize: 100 }],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      ),
    );
    expect(container.scrollTop).toBe(2380);
    expect(document.querySelectorAll('article').length).toBeLessThan(40);
  });

  it('renders a bounded number of messages and jumps to a non-rendered anchor among 2,000 messages', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => message(`long-${i}`));
    const { rerender } = render(<Conversation messages={many} />);
    expect(document.querySelectorAll('article').length).toBeLessThan(40);
    expect(document.getElementById('m-long-1900')).toBeNull();
    rerender(<Conversation messages={many} target="long-1900" />);
    await waitFor(() =>
      expect(document.getElementById('m-long-1900')).toBeInTheDocument(),
    );
    expect(document.querySelectorAll('article').length).toBeLessThan(40);
  });
  it('virtualizes expanded groups using scroll events from the outer conversation only', () => {
    const many = Array.from({ length: 2000 }, (_, i) => tool(`inline-${i}`));
    render(<Conversation messages={many} />);
    fireEvent.click(
      screen.getByRole('button', { name: /^2000 tool calls.*Read ×2000/ }),
    );
    const outer = document.querySelector<HTMLElement>('.conversation-window')!;
    const inline = document.querySelector<HTMLElement>('.conversation-inline')!;
    vi.spyOn(inline, 'getBoundingClientRect').mockImplementation(
      () => ({ top: -outer.scrollTop }) as DOMRect,
    );
    fireEvent.scroll(outer, { target: { scrollTop: 12_300 } });
    expect(document.getElementById('m-inline-300')).toBeInTheDocument();
    expect(document.getElementById('m-inline-0')).toBeNull();
    expect(document.querySelectorAll('.conversation-window')).toHaveLength(1);
    expect(document.querySelectorAll('article').length).toBeLessThan(40);
  });
  it('keeps a large expanded tool group windowed', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => tool(`toolturn-${i}`));
    render(<Conversation messages={many} target="toolturn-1800" />);
    await waitFor(() =>
      expect(document.getElementById('m-toolturn-1800')).toBeInTheDocument(),
    );
    expect(document.querySelectorAll('article').length).toBeLessThan(40);
  });
});

describe('session rail cards', () => {
  it('marks all outline kinds and remembers the last jumped entry', () => {
    const jump = vi.fn();
    const { container } = render(
      <Outline
        messages={[
          message(
            'command',
            'user',
            '<command-name>/model</command-name><command-args>opus</command-args>',
          ),
          message('prompt'),
          tool('plan', 'ExitPlanMode'),
          tool('question', 'AskUserQuestion'),
        ]}
        jump={jump}
      />,
    );
    expect(
      [...container.querySelectorAll('[aria-hidden="true"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['/', '›', '◆', '?']);
    const prompt = screen.getByRole('button', { name: /Prompt: prompt/ });
    fireEvent.click(prompt);
    expect(prompt).toHaveAttribute('aria-current', 'true');
    const question = screen.getByRole('button', { name: /Question:/ });
    expect(question).toHaveClass('text-need-input');
    fireEvent.click(question);
    expect(prompt).not.toHaveAttribute('aria-current');
    expect(question).toHaveAttribute('aria-current', 'true');
    expect(jump).toHaveBeenLastCalledWith('question');
  });
  it('limits token bars to 24 turns while retaining all rows and charts output plus fresh input', () => {
    const messages = Array.from({ length: 26 }, (_, i) => [
      message(`p${i}`),
      {
        ...message(`a${i}`, 'assistant'),
        usage: {
          input: i === 25 ? 110 : 10,
          cacheRead: 80,
          cacheCreation: 10,
          output: 20,
          thinking: 0,
        },
      },
    ]).flat();
    render(<ContextUsage messages={messages} />);
    const chart = screen.getByRole('img', {
      name: /Output plus new input per turn, last 24 loaded turns; latest 140 tokens/,
    });
    expect(chart.children).toHaveLength(24);
    expect(chart.lastElementChild).toHaveClass('bg-accent');
    expect(chart.firstElementChild).toHaveClass('bg-accent-soft');
    expect(screen.getByText('77.0%')).toBeInTheDocument();
    expect(screen.getByText('140')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(27);
    expect(
      screen.getByRole('columnheader', { name: 'New input' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '120' })).toBeInTheDocument();
  });
  it('shows three subagents, expands all, and jumps to parent tools with loaded metadata', () => {
    const data = {
      ...sessionDetail,
      subagents: Array.from({ length: 4 }, (_, i) => ({
        agentId: `abcdefgh-${i}`,
        description: `Review ${i}`,
        parentToolUseId: `parent-${i}`,
      })),
    };
    const call = {
      ...tool('parent', 'Agent'),
      blocks: [
        {
          type: 'tool_use' as const,
          id: 'parent-0',
          name: 'Agent',
          input: { subagent_type: 'Explore', model: 'sonnet' },
        },
      ],
    };
    const jump = vi.fn();
    render(<Subagents data={data} messages={[call]} jump={jump} />);
    expect(screen.getAllByRole('button', { name: /Review/ })).toHaveLength(3);
    expect(screen.getByText('abcdefgh · Explore · sonnet')).toBeInTheDocument();
    expect(screen.queryByText(/msgs|messages/)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show all 4' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /Review/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /Review 0/ }));
    expect(jump).toHaveBeenCalledWith('parent-0');
  });
  it('keeps subagent rows without a loaded parent reachable but disabled', () => {
    const data = {
      ...sessionDetail,
      subagents: [
        {
          agentId: 'orphan',
          description: 'Orphan agent',
          parentToolUseId: null,
        },
      ],
    };
    const jump = vi.fn();
    render(<Subagents data={data} messages={[]} jump={jump} />);
    const row = screen.getByRole('button', { name: /Orphan agent/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAttribute('title', 'Parent call not loaded');
    expect(row).toHaveStyle({ minHeight: '44px' });
    fireEvent.click(row);
    expect(jump).not.toHaveBeenCalled();
  });
  it('mounts and fetches the timeline only while Session details is open', async () => {
    const fetcher = mockFetch({ 0: sessionDetail });
    render(
      <Sidebar
        data={sessionDetail}
        projectId="project-1"
        sessionId="session-0"
      />,
      { wrapper: wrapper() },
    );
    const toggle = screen.getByRole('button', { name: 'Session details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.closest('h2')).toHaveClass('is-collapsed');
    expect(screen.queryByText('Status timeline')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.closest('h2')).not.toHaveClass('is-collapsed');
    expect(
      screen.getByText(
        'Estimated at API list prices; not your actual bill on a subscription plan.',
      ),
    ).toBeVisible();
    expect(
      await screen.findByText('No status changes recorded.'),
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/status/history'),
      expect.anything(),
    );
    fireEvent.click(toggle);
    expect(screen.queryByText('Status timeline')).toBeNull();
  });
});

describe('conversation edge', () => {
  it('announces loading and the beginning of history to screen readers', () => {
    const load = vi.fn();
    const { rerender } = render(
      <ConversationEdge hasEarlier loading={false} error={false} load={load} />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Load earlier messages');
    rerender(<ConversationEdge hasEarlier loading error={false} load={load} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading earlier messages…',
    );
    rerender(
      <ConversationEdge
        hasEarlier={false}
        loading={false}
        error={false}
        load={load}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Beginning of session',
    );
    rerender(<ConversationEdge hasEarlier loading={false} error load={load} />);
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).not.toBe(status);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load earlier messages.",
    );
  });
});

it('tracks the first visible conversation row in the outline and disconnects on unmount', () => {
  let notify: IntersectionObserverCallback = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    },
  );
  const batch = [
    message('first'),
    message('reply', 'assistant'),
    message('second'),
  ];
  const jump = vi.fn();
  const { unmount } = render(
    <>
      <Conversation messages={batch} />
      <Outline messages={batch} jump={jump} />
    </>,
  );
  const rows = [
    ...document.querySelectorAll(
      ':scope .conversation-window > [data-message-row]',
    ),
  ];
  expect(observe.mock.calls.map(([node]) => node)).toEqual(rows);
  const change = (index: number, isIntersecting: boolean) =>
    ({ target: rows[index], isIntersecting }) as IntersectionObserverEntry;
  act(() =>
    notify([change(0, true), change(1, true)], {} as IntersectionObserver),
  );
  expect(screen.getByRole('button', { name: /Prompt: first/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  act(() =>
    notify([change(0, false), change(2, true)], {} as IntersectionObserver),
  );
  expect(screen.getByRole('button', { name: /Prompt: first/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  act(() => notify([change(1, false)], {} as IntersectionObserver));
  const second = screen.getByRole('button', { name: /Prompt: second/ });
  expect(second).toHaveAttribute('aria-current', 'true');
  fireEvent.click(screen.getByRole('button', { name: /Prompt: first/ }));
  expect(jump).toHaveBeenCalledWith('first');
  expect(second).not.toHaveAttribute('aria-current');
  act(() => notify([change(2, true)], {} as IntersectionObserver));
  expect(screen.getByRole('button', { name: /Prompt: first/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  fireEvent(
    document.querySelector('.conversation-window')!,
    new Event('scrollend'),
  );
  act(() => notify([change(2, true)], {} as IntersectionObserver));
  expect(second).toHaveAttribute('aria-current', 'true');
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('keeps a notice visible alongside two tool rows in the same assistant fixture', () => {
  const fixture: Message = {
    ...message('notice-tools', 'assistant'),
    blocks: [
      {
        type: 'text',
        text: '<system-reminder>Background checks completed.</system-reminder>',
      },
      {
        type: 'tool_use',
        id: 'read-one',
        name: 'Read',
        input: { file_path: 'one.ts' },
      },
      {
        type: 'tool_use',
        id: 'read-two',
        name: 'Read',
        input: { file_path: 'two.ts' },
      },
    ],
  };
  render(<Conversation messages={[fixture]} />);
  expect(screen.getByText('Background checks completed.')).toBeVisible();
  expect(document.getElementById('tool-read-one')).toBeVisible();
  expect(document.getElementById('tool-read-two')).toBeVisible();
  expect(screen.queryByRole('button', { name: /2 tool calls/ })).toBeNull();
});

it('rechecks the top edge when a refetch finishes with unchanged rows', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  const groups = [[message('edge-row')]];
  const busy = vi.fn();
  const idle = vi.fn();
  const renderRow = (group: Message[]) => <article>{group[0]!.uuid}</article>;
  const { rerender } = render(
    <WindowedMessages
      groups={groups}
      enabled={false}
      render={renderRow}
      onNearTop={busy}
      isFetching
    />,
  );
  busy.mockClear();
  // A background refetch finishes without changing the rows.
  rerender(
    <WindowedMessages
      groups={groups}
      enabled={false}
      render={renderRow}
      onNearTop={idle}
    />,
  );
  expect(idle).toHaveBeenCalledOnce();
  rerender(
    <WindowedMessages
      groups={groups}
      enabled={false}
      render={renderRow}
      onNearTop={() => idle()}
    />,
  );
  expect(idle).toHaveBeenCalledOnce();
});

it('loads earlier history after a background refetch ends at the top edge without another scroll', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('conversation-window') ? 500 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000);
  const fetcher = pagedFetch(
    Array.from({ length: 100 }, (_, index) => message(`refetch-${index}`)),
    50,
  );
  const serve = fetcher.getMockImplementation()!;
  let release: (() => void) | undefined;
  let block = false;
  fetcher.mockImplementation(async (url: string) => {
    if (block && /[?](from=end|cursor=)/.test(url)) {
      block = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return serve(url);
  });
  openSession();
  await screen.findAllByRole('button', { name: 'Load earlier messages' });
  const node = document.querySelector<HTMLElement>('.conversation-window')!;
  expect(node.scrollTop).toBe(1500);
  block = true;
  let refetch: Promise<void> | undefined;
  act(() => {
    refetch = clients[0]!.refetchQueries({
      queryKey: ['local', 'session', 'project-1', 'session-0'],
      exact: true,
    });
  });
  await waitFor(() => expect(release).toBeTypeOf('function'));
  node.scrollTop = 0;
  fireEvent.scroll(node);
  expect(pageRequests(fetcher)).toHaveLength(2);
  await act(async () => {
    release!();
    await refetch;
  });
  await screen.findByText('Beginning of session');
  expect(
    pageRequests(fetcher).some(([url]) => url.includes('cursor=0&limit=50')),
  ).toBe(true);
});

it('observes conversation rows when the conversation mounts after the outline', async () => {
  const observe = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observe;
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  const batch = [message('late')];
  const jump = vi.fn();
  const { rerender } = render(
    <>
      <Outline messages={batch} jump={jump} />
    </>,
  );
  expect(observe).not.toHaveBeenCalled();
  rerender(
    <>
      <Outline messages={batch} jump={jump} />
      <Conversation messages={batch} />
    </>,
  );
  await waitFor(() =>
    expect(observe).toHaveBeenCalledWith(
      document.querySelector('[data-message-row]'),
    ),
  );
});

it('resumes outline observer updates after the 600 ms jump fallback', () => {
  vi.useFakeTimers();
  try {
    let notify: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const batch = [message('first'), message('second')];
    render(
      <>
        <Conversation messages={batch} />
        <Outline messages={batch} jump={vi.fn()} />
      </>,
    );
    const first = screen.getByRole('button', { name: /Prompt: first/ });
    const rows = document.querySelectorAll('[data-message-row]');
    const change = {
      target: rows[1],
      isIntersecting: true,
    } as IntersectionObserverEntry;
    fireEvent.click(first);
    act(() => notify([change], {} as IntersectionObserver));
    expect(first).toHaveAttribute('aria-current', 'true');
    act(() => vi.advanceTimersByTime(600));
    act(() => notify([change], {} as IntersectionObserver));
    expect(
      screen.getByRole('button', { name: /Prompt: second/ }),
    ).toHaveAttribute('aria-current', 'true');
  } finally {
    vi.useRealTimers();
  }
});

it('shows a partial-content notice for truncated text and paired tool-result messages', () => {
  const result = { ...fixtures[2]!, truncated: true };
  const { rerender } = render(
    <Conversation messages={[{ ...message('cut'), truncated: true }]} />,
  );
  expect(screen.getByRole('note')).toHaveTextContent(
    'This message was cut to fit the page size.',
  );
  rerender(<Conversation messages={[...fixtures.slice(0, 2), result]} />);
  expect(
    screen.getByText('This message was cut to fit the page size.'),
  ).toBeInTheDocument();
});
