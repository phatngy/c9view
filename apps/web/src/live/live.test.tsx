import { act, cleanup, render, screen } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiveEvent, SessionDetailResponse } from '@c9view/api';
import {
  LiveProvider,
  invalidateLiveEvent,
  refreshNewestPage,
  useLiveConnection,
} from './index.js';
import {
  api,
  type SessionPageParam,
  HttpError,
  useGlobalSearch,
  useOverview,
  useProject,
  useSession,
  useSessionPoll,
} from '../api.js';
import { overview, projectDetail, sessionDetail } from '../test-fixtures.js';

class MockSource extends EventTarget {
  static instances: MockSource[] = [];
  static CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockSource.CLOSED;
  });
  constructor(public url: string) {
    super();
    MockSource.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail() {
    this.onerror?.();
  }
  failClosed() {
    this.readyState = MockSource.CLOSED;
    this.onerror?.();
  }
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(value);
  return value;
}
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  MockSource.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([
  [
    { event: 'project', data: { projectId: 'p' } },
    [['usage'], ['overview'], ['projects'], ['project', 'p']],
  ],
  [
    { event: 'session', data: { projectId: 'p', sessionId: 's' } },
    [
      ['project', 'p'],
      ['session-poll', 'p', 's'],
      ['session', 'p', 's'],
    ],
  ],
  [
    {
      event: 'status',
      data: { projectId: 'p', sessionId: 's', column: 'inactive' },
    },
    [
      ['project', 'p'],
      ['session-poll', 'p', 's'],
    ],
  ],
  [
    { event: 'config', data: {} },
    [['config'], ['project', 'p'], ['project', 'other']],
  ],
  [
    { event: 'index', data: { state: 'ready' } },
    [['health'], ['usage'], ['overview'], ['search', { q: 'hello' }]],
  ],
] as [LiveEvent, string[][]][])(
  'invalidates only the relevant caches for $event',
  async (event, expected) => {
    const value = client();
    const keys = [
      ['overview'],
      ['projects'],
      ['project', 'p'],
      ['project', 'other'],
      ['session-poll', 'p', 's'],
      ['session-poll', 'other', 's'],
      ['session', 'p', 's'],
      ['config'],
      ['health'],
      ['usage'],
      ['search', { q: 'hello' }],
      ['files', 'p', ''],
    ];
    for (const key of keys)
      value.setQueryData(key, key[0] === 'session' ? undefined : {});
    // A session event also marks an existing unloaded conversation query stale.
    if (event.event === 'session')
      value.setQueryData(['session', 'p', 's'], { pages: [], pageParams: [] });
    await invalidateLiveEvent(value, event);
    const invalidated = value
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey);
    if (event.event === 'index') {
      expect(invalidated).toEqual(
        expect.arrayContaining([
          ['health'],
          ['overview'],
          ['search', { q: 'hello' }],
        ]),
      );
      expect(invalidated).toHaveLength(4);
    } else {
      expect(invalidated).toEqual(expect.arrayContaining(expected));
      expect(invalidated).toHaveLength(expected.length);
      if (event.event === 'session')
        expect(invalidated).not.toContainEqual(['usage']);
    }
  },
);

it('refreshes just the newest loaded message page', async () => {
  const value = client();
  const head = { ...sessionDetail, nextCursor: 50 };
  value.setQueryData(['session', 'p', 's'], {
    pages: [head, { ...sessionDetail, cursor: 50 }],
    pageParams: [{ cursor: 0, limit: 50 }, 'end'],
  });
  const request = vi
    .spyOn(api, 'session')
    .mockResolvedValue({ ...sessionDetail, totalMessages: 60 });
  await invalidateLiveEvent(value, {
    event: 'session',
    data: { projectId: 'p', sessionId: 's' },
  });
  expect(request).toHaveBeenCalledExactlyOnceWith('p', 's', {
    cursor: 50,
    limit: 50,
  });
  const data = value.getQueryData<InfiniteData<SessionDetailResponse>>([
    'session',
    'p',
    's',
  ]);
  expect(data?.pages[0]).toBe(head);
  expect(data?.pages[1]?.totalMessages).toBe(60);
});

function Connection() {
  const { state, polling } = useLiveConnection();
  return (
    <output>
      {state}:{String(polling)}
    </output>
  );
}
function Queries() {
  useOverview();
  useProject('p');
  useSessionPoll('p', 's');
  return <Connection />;
}
function SearchQuery() {
  const result = useGlobalSearch({
    q: 'hello',
    projectId: '',
    from: '',
    to: '',
    model: '',
  });
  return (
    <output>
      {result.error
        ? 'search-error'
        : result.data
          ? 'search-ready'
          : 'search-loading'}
    </output>
  );
}
function ActiveSession() {
  useSession('active-project', 'active-session');
  return null;
}
function mount(value: QueryClient, queries = false) {
  return render(
    <QueryClientProvider client={value}>
      <LiveProvider>{queries ? <Queries /> : <Connection />}</LiveProvider>
    </QueryClientProvider>,
  );
}
it('refetches failed search queries after an index event', async () => {
  vi.stubGlobal('EventSource', MockSource);
  const search = vi
    .spyOn(api, 'search')
    .mockRejectedValueOnce(new HttpError('indexing', 503))
    .mockResolvedValue({ results: [], nextCursor: null });
  const value = client();
  render(
    <QueryClientProvider client={value}>
      <LiveProvider>
        <SearchQuery />
      </LiveProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('search-error')).toBeInTheDocument();
  await act(async () => {
    MockSource.instances[0]!.emit('index', { state: 'ready' });
  });
  expect(await screen.findByText('search-ready')).toBeInTheDocument();
  expect(search).toHaveBeenCalledTimes(2);
});
it('shares a source, handles named events and restores polling after prolonged offline errors', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', MockSource);
  vi.spyOn(api, 'health').mockResolvedValue({
    ok: true,
    version: 'test',
    claudeDir: '',
  });
  const requests = [
    vi.spyOn(api, 'overview').mockResolvedValue(overview),
    vi.spyOn(api, 'project').mockResolvedValue(projectDetail),
    vi.spyOn(api, 'sessionPoll').mockResolvedValue({
      status: sessionDetail.session.status,
      totalMessages: 3,
      lastAt: null,
    }),
  ];
  const value = client();
  mount(value, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText('connecting:false')).toBeInTheDocument();
  mount(value);
  expect(MockSource.instances).toHaveLength(1);
  const source = MockSource.instances[0]!;
  await act(async () => {
    source.open();
    await vi.advanceTimersByTimeAsync(0);
  });
  requests.forEach((request) => request.mockClear());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  requests.forEach((request) => expect(request).not.toHaveBeenCalled());
  await act(async () => {
    source.emit('project', { projectId: 'p' });
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(requests[0]).toHaveBeenCalledTimes(1);
  expect(requests[1]).toHaveBeenCalledTimes(1);
  requests.forEach((request) => request.mockClear());
  await act(async () => {
    source.fail();
    await vi.advanceTimersByTimeAsync(6_000);
    source.fail();
    await vi.advanceTimersByTimeAsync(4_002);
  });
  expect(screen.getAllByText('offline:true')).toHaveLength(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  requests.forEach((request) => expect(request).toHaveBeenCalledTimes(1));
  await act(async () => {
    source.open();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getAllByText('live:false')).toHaveLength(2);
  requests.forEach((request) => request.mockClear());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  requests.forEach((request) => expect(request).not.toHaveBeenCalled());
});
it('starts polling ten seconds into an outage across exponential retries', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', MockSource);
  vi.spyOn(api, 'health').mockResolvedValue({
    ok: true,
    version: 'test',
    claudeDir: '',
  });
  mount(client());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  for (const delay of [1_000, 2_000, 4_000]) {
    const source = MockSource.instances.at(-1)!;
    await act(async () => {
      source.failClosed();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay);
    });
  }

  expect(MockSource.instances).toHaveLength(4);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_999);
  });
  expect(screen.getByText('connecting:false')).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText('connecting:true')).toBeInTheDocument();
});
it('closes on a 401 and dispatches the existing login event', async () => {
  vi.stubGlobal('EventSource', MockSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ auth: 'password' }), { status: 401 }),
    ),
  );
  const login = vi.fn();
  window.addEventListener('c9view:login', login);
  mount(client());
  await act(async () => {
    MockSource.instances[0]!.fail();
  });
  expect(MockSource.instances[0]!.close).toHaveBeenCalledOnce();
  expect(login).toHaveBeenCalledOnce();
  window.removeEventListener('c9view:login', login);
});
it('reopens a closed EventSource with one second backoff after a non-401 probe', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', MockSource);
  vi.spyOn(api, 'health').mockResolvedValue({
    ok: true,
    version: 'test',
    claudeDir: '',
  });
  mount(client());
  const first = MockSource.instances[0]!;
  await act(async () => {
    first.failClosed();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(MockSource.instances).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999);
  });
  expect(MockSource.instances).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(MockSource.instances).toHaveLength(2);
  expect(MockSource.instances[1]!.url).toBe('/api/events');
});
it('skips first-open catch-up and refreshes only observed session tails on reconnect', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', MockSource);
  vi.spyOn(api, 'health').mockResolvedValue({
    ok: true,
    version: 'test',
    claudeDir: '',
  });
  const sessionRequest = vi
    .spyOn(api, 'session')
    .mockResolvedValue({ ...sessionDetail, totalMessages: 10 });
  const value = client();
  value.setQueryDefaults(['session'], { staleTime: Infinity });
  const cached = {
    pages: [sessionDetail, { ...sessionDetail, cursor: 50 }],
    pageParams: [{ cursor: 0, limit: 50 }, 'end'],
  } satisfies InfiniteData<SessionDetailResponse, SessionPageParam>;
  value.setQueryData(['session', 'active-project', 'active-session'], cached);
  value.setQueryData(
    ['session', 'inactive-project', 'inactive-session'],
    cached,
  );
  render(
    <QueryClientProvider client={value}>
      <LiveProvider>
        <ActiveSession />
      </LiveProvider>
    </QueryClientProvider>,
  );
  const first = MockSource.instances[0]!;
  await act(async () => {
    first.open();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(sessionRequest).not.toHaveBeenCalled();
  await act(async () => {
    first.failClosed();
    await vi.advanceTimersByTimeAsync(1_000);
  });
  const reconnected = MockSource.instances[1]!;
  await act(async () => {
    reconnected.open();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(sessionRequest).toHaveBeenCalledExactlyOnceWith(
    'active-project',
    'active-session',
    { cursor: 50, limit: 50 },
  );
  expect(
    value.getQueryData(['session', 'inactive-project', 'inactive-session']),
  ).toEqual(cached);
});

it('refreshes a single end page by its absolute offset', async () => {
  const value = client();
  value.setQueryData(['session', 'p', 's'], {
    pages: [{ ...sessionDetail, cursor: 1538, prevCursor: 1488 }],
    pageParams: ['end'],
  });
  const request = vi.spyOn(api, 'session').mockResolvedValue(sessionDetail);
  await refreshNewestPage(value, 'p', 's');
  expect(request).toHaveBeenCalledExactlyOnceWith('p', 's', {
    cursor: 1538,
    limit: 50,
  });
});

it('preserves concurrent pagination while refreshing the newest page', async () => {
  const value = client();
  const cached = { pages: [sessionDetail], pageParams: ['end'] };
  value.setQueryData(['session', 'p', 's'], cached);
  let resolve!: (page: SessionDetailResponse) => void;
  vi.spyOn(api, 'session').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = refreshNewestPage(value, 'p', 's');
  const changed = {
    ...cached,
    pages: [sessionDetail, { ...sessionDetail, cursor: 3 }],
  };
  value.setQueryData(['session', 'p', 's'], changed);
  resolve({ ...sessionDetail, totalMessages: 60 });
  await pending;
  expect(value.getQueryData(['session', 'p', 's'])).toEqual(changed);
});

it('keeps a newest page custom limit during a live refresh', async () => {
  const value = client();
  value.setQueryData(['session', 'p', 's'], {
    pages: [{ ...sessionDetail, cursor: 2 }],
    pageParams: [{ cursor: 2, limit: 38 }],
  });
  const request = vi.spyOn(api, 'session').mockResolvedValue(sessionDetail);
  await refreshNewestPage(value, 'p', 's');
  expect(request).toHaveBeenCalledExactlyOnceWith('p', 's', {
    cursor: 2,
    limit: 38,
  });
});
