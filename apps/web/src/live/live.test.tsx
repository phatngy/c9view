import { useControl } from '../control/useControl.js';
import { PermissionCard } from '../control/cards.js';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type InfiniteData,
} from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { MachineEvent, SessionDetailResponse } from '@c9view/api';
import { queryKeys } from '../queryKeys.js';
import {
  LiveProvider,
  invalidateLiveEvent,
  refreshMachine,
  refreshNewestPage,
  useLiveConnection,
} from './index.js';
import {
  api,
  HttpError,
  useGlobalSearch,
  useOverview,
  useProject,
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
    this.dispatchEvent(
      new MessageEvent(type, {
        data: JSON.stringify(
          type === 'machine'
            ? data
            : { machineId: 'local', event: { type, ...(data as object) } },
        ),
      }),
    );
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

it.each(['project', 'session', 'status', 'config', 'index'])(
  'isolates %s hints to their machine',
  async (type) => {
    const value = client();
    const keys = [
      queryKeys.overview('local'),
      queryKeys.project('local', 'p'),
      queryKeys.config('local'),
      queryKeys.health('local'),
    ];
    for (const key of keys) {
      value.setQueryData(key, {});
      value.setQueryData(['remote', ...key.slice(1)], {});
    }
    await invalidateLiveEvent(value, {
      machineId: 'local',
      event: { type, projectId: 'p', sessionId: 's' },
    });
    const expected = {
      project: [queryKeys.overview('local'), queryKeys.project('local', 'p')],
      session: [queryKeys.project('local', 'p')],
      status: [queryKeys.project('local', 'p')],
      config: [queryKeys.project('local', 'p'), queryKeys.config('local')],
      index: [queryKeys.overview('local'), queryKeys.health('local')],
    }[type];
    const invalidated = value
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey);
    expect(invalidated).toEqual(expected);
    expect(
      value
        .getQueryCache()
        .getAll()
        .filter((query) => query.queryKey[0] === 'remote')
        .every((query) => !query.state.isInvalidated),
    ).toBe(true);
  },
);

it('coalesces overlapping session hints and leaves the newer response in cache', async () => {
  const value = client();
  const key = queryKeys.session('local', 'p', 's');
  let resolve!: (data: number) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(2);
  value.setQueryData(key, 0);
  const observer = new QueryObserver(value, {
    queryKey: key,
    queryFn: request,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  const event: MachineEvent = {
    machineId: 'local',
    event: { type: 'session', projectId: 'p', sessionId: 's' },
  };
  const first = invalidateLiveEvent(value, event);
  const second = invalidateLiveEvent(value, event);
  const third = invalidateLiveEvent(value, event);
  expect(request).toHaveBeenCalledTimes(1);
  resolve(1);
  await Promise.all([first, second, third]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(value.getQueryData(key)).toBe(2);
  unsubscribe();
});

it('waits for an existing read before refreshing without cancelling or overwriting newer data', async () => {
  const value = client();
  const key = queryKeys.file('remote', 'p', 'a.ts');
  let resolve!: (data: number) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(2);
  const observer = new QueryObserver(value, {
    queryKey: key,
    queryFn: request,
  });
  const unsubscribe = observer.subscribe(() => {});
  const pending = refreshMachine(value, 'remote');
  expect(request).toHaveBeenCalledTimes(1);
  resolve(1);
  await pending;
  expect(request).toHaveBeenCalledTimes(2);
  expect(value.getQueryData(key)).toBe(2);
  unsubscribe();
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
  vi.spyOn(api, 'hubHealth').mockResolvedValue({
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
  vi.spyOn(api, 'hubHealth').mockResolvedValue({
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
  vi.spyOn(api, 'hubHealth').mockResolvedValue({
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
it('refetches active files, git status and changes after reopen and machine online, only for that machine', async () => {
  vi.stubGlobal('EventSource', MockSource);
  const value = client();
  const requests = [];
  const stops = [];
  for (const machine of ['local', 'remote']) {
    for (const key of [
      queryKeys.files(machine, 'p', ''),
      queryKeys.file(machine, 'p', 'a'),
      queryKeys.gitStatus(machine, 'p'),
      queryKeys.gitDiff(machine, 'p', 'a'),
      queryKeys.changes(machine, 'p', 's'),
      queryKeys.change(machine, 'p', 's', 'f'),
    ]) {
      value.setQueryData(key, {});
      const request = vi.fn(async () => ({}));
      const observer = new QueryObserver(value, {
        queryKey: key,
        queryFn: request,
        staleTime: Infinity,
      });
      stops.push(observer.subscribe(() => {}));
      requests.push({ machine, request });
    }
  }
  mount(value);
  const source = MockSource.instances[0]!;
  await act(async () => {
    source.open();
    source.emit('machine', {
      type: 'machine',
      machineId: 'remote',
      state: 'online',
      bootId: 'first',
    });
  });
  requests.forEach(({ request }) => expect(request).not.toHaveBeenCalled());
  await act(async () => {
    source.fail();
    source.open();
    source.emit('machine', {
      type: 'machine',
      machineId: 'remote',
      state: 'online',
      bootId: 'first',
    });
  });
  requests.forEach(({ request }) => expect(request).toHaveBeenCalledTimes(1));
  await act(async () => {
    source.emit('machine', {
      type: 'machine',
      machineId: 'remote',
      state: 'online',
      bootId: 'second',
    });
  });
  requests.forEach(({ machine, request }) =>
    expect(request).toHaveBeenCalledTimes(machine === 'remote' ? 2 : 1),
  );
  stops.forEach((stop) => stop());
});

it('refreshes just the newest loaded message page', async () => {
  const value = client();
  const head = { ...sessionDetail, nextCursor: 50 };
  value.setQueryData(queryKeys.session('local', 'p', 's'), {
    pages: [head, { ...sessionDetail, cursor: 50 }],
    pageParams: [{ cursor: 0, limit: 50 }, 'end'],
  });
  const request = vi
    .spyOn(api, 'session')
    .mockResolvedValue({ ...sessionDetail, totalMessages: 60 });
  await invalidateLiveEvent(value, {
    machineId: 'local',
    event: { type: 'session', projectId: 'p', sessionId: 's' },
  });
  expect(request).toHaveBeenCalledExactlyOnceWith('local', 'p', 's', {
    cursor: 50,
    limit: 50,
  });
  const data = value.getQueryData<InfiniteData<SessionDetailResponse>>([
    'local',
    'session',
    'p',
    's',
  ]);
  expect(data?.pages[0]).toBe(head);
  expect(data?.pages[1]?.totalMessages).toBe(60);
});

it('refreshes a single end page by its absolute offset', async () => {
  const value = client();
  value.setQueryData(queryKeys.session('local', 'p', 's'), {
    pages: [{ ...sessionDetail, cursor: 1538, prevCursor: 1488 }],
    pageParams: ['end'],
  });
  const request = vi.spyOn(api, 'session').mockResolvedValue(sessionDetail);
  await refreshNewestPage(value, 'local', 'p', 's');
  expect(request).toHaveBeenCalledExactlyOnceWith('local', 'p', 's', {
    cursor: 1538,
    limit: 50,
  });
});

it('preserves concurrent pagination while refreshing the newest page', async () => {
  const value = client();
  const cached = { pages: [sessionDetail], pageParams: ['end'] };
  value.setQueryData(queryKeys.session('local', 'p', 's'), cached);
  let resolve!: (page: SessionDetailResponse) => void;
  vi.spyOn(api, 'session').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = refreshNewestPage(value, 'local', 'p', 's');
  const changed = {
    ...cached,
    pages: [sessionDetail, { ...sessionDetail, cursor: 3 }],
  };
  value.setQueryData(queryKeys.session('local', 'p', 's'), changed);
  resolve({ ...sessionDetail, totalMessages: 60 });
  await pending;
  expect(value.getQueryData(queryKeys.session('local', 'p', 's'))).toEqual(
    changed,
  );
});

it('keeps a newest page custom limit during a live refresh', async () => {
  const value = client();
  value.setQueryData(queryKeys.session('local', 'p', 's'), {
    pages: [{ ...sessionDetail, cursor: 2 }],
    pageParams: [{ cursor: 2, limit: 38 }],
  });
  const request = vi.spyOn(api, 'session').mockResolvedValue(sessionDetail);
  await refreshNewestPage(value, 'local', 'p', 's');
  expect(request).toHaveBeenCalledExactlyOnceWith('local', 'p', 's', {
    cursor: 2,
    limit: 38,
  });
});

it.each(['same boot', 'new boot', 'offline then online'])(
  'refreshes once for %s after recording the first machine announcement',
  async (transition) => {
    vi.stubGlobal('EventSource', MockSource);
    const value = client();
    const request = vi.fn(async () => ({}));
    const key = queryKeys.overview('remote');
    const observer = new QueryObserver(value, {
      queryKey: key,
      queryFn: request,
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => {});
    mount(value);
    const source = MockSource.instances[0]!;
    const announce = (state: 'online' | 'offline', bootId = 'one') =>
      source.emit('machine', {
        type: 'machine',
        machineId: 'remote',
        state,
        bootId,
      });
    const machines = vi.spyOn(value, 'invalidateQueries');
    await act(async () => {
      source.open();
      announce('online');
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(machines).toHaveBeenCalledWith(
      { queryKey: queryKeys.machines(), exact: true },
      { cancelRefetch: false },
    );
    machines.mockClear();
    await act(async () => {
      if (transition === 'same boot') source.open();
      if (transition === 'offline then online') announce('offline');
      announce('online', transition === 'new boot' ? 'two' : 'one');
    });
    expect(request).toHaveBeenCalledTimes(2);
    const machineInvalidations = machines.mock.calls.filter(
      ([filters]) => filters?.queryKey?.[0] === 'machines',
    );
    expect(machineInvalidations).toHaveLength(
      transition === 'same boot' ? 0 : transition === 'new boot' ? 1 : 2,
    );
    stop();
  },
);

it('serializes newest-page reads and coalesces hints into one trailing refresh', async () => {
  const value = client();
  const key = queryKeys.session('remote', 'p', 's');
  value.setQueryData(key, { pages: [sessionDetail], pageParams: ['end'] });
  let resolve!: (page: SessionDetailResponse) => void;
  const request = vi
    .spyOn(api, 'session')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ ...sessionDetail, totalMessages: 70 });
  const first = refreshNewestPage(value, 'remote', 'p', 's');
  const second = refreshNewestPage(value, 'remote', 'p', 's');
  const third = refreshNewestPage(value, 'remote', 'p', 's');
  expect(request).toHaveBeenCalledTimes(1);
  resolve({ ...sessionDetail, totalMessages: 60 });
  await Promise.all([first, second, third]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(
    value.getQueryData<InfiniteData<SessionDetailResponse>>(key)?.pages[0]
      ?.totalMessages,
  ).toBe(70);
});

it('silently drops malformed envelopes and mismatched hint types', async () => {
  vi.stubGlobal('EventSource', MockSource);
  const value = client();
  value.setQueryData(queryKeys.overview('local'), {});
  mount(value);
  const invalidate = vi.spyOn(value, 'invalidateQueries');
  const source = MockSource.instances[0]!;
  await act(async () => {
    for (const [type, data] of [
      [
        'machine',
        { type: 'machine', machineId: 'local', state: 'online', bootId: 42 },
      ],
      ['machine', { type: 'machine', machineId: 'local', state: 'broken' }],
      [
        'project',
        { machineId: 'local', event: { type: 'project', projectId: 42 } },
      ],
      ['project', { machineId: 'local', event: { type: 'index' } }],
      ['index', { machineId: 42, event: { type: 'index' } }],
      ['index', null],
    ] as const) {
      source.dispatchEvent(
        new MessageEvent(type, { data: JSON.stringify(data) }),
      );
    }
    source.dispatchEvent(new MessageEvent('index', { data: '{' }));
  });
  expect(invalidate).not.toHaveBeenCalled();
});

it('preserves the backward fill and requested cursor when refreshing a short newest page', async () => {
  const value = client();
  const param = { cursor: 2, limit: 38, fill: 'end' as const };
  value.setQueryData(queryKeys.session('local', 'p', 's'), {
    pages: [{ ...sessionDetail, cursor: 35 }],
    pageParams: [param],
  });
  const request = vi.spyOn(api, 'session').mockResolvedValue(sessionDetail);
  await refreshNewestPage(value, 'local', 'p', 's');
  expect(request).toHaveBeenCalledExactlyOnceWith('local', 'p', 's', param);
});

it.each(['control.request', 'control.run', 'control.request.resolved'])(
  'T045 refetches runs for %s hints only on the matching machine',
  async (type) => {
    const value = client();
    const read = vi.fn(async () => ({
      runs: [],
      requests: [{ requestId: 'from-get' }],
    }));
    const local = new QueryObserver(value, {
      queryKey: queryKeys.controlRuns('local'),
      queryFn: read,
    });
    const remote = new QueryObserver(value, {
      queryKey: queryKeys.controlRuns('remote'),
      queryFn: async () => ({ runs: [], requests: [] }),
    });
    const stopLocal = local.subscribe(() => {});
    const stopRemote = remote.subscribe(() => {});
    await local.refetch();
    await remote.refetch();
    read.mockClear();
    await invalidateLiveEvent(value, {
      machineId: 'local',
      event: { type, requestId: 'hint-only', runId: 'r', sessionId: 's' },
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(value.getQueryData(queryKeys.controlRuns('local'))).toEqual({
      runs: [],
      requests: [{ requestId: 'from-get' }],
    });
    expect(
      value.getQueryState(queryKeys.controlRuns('remote'))?.isInvalidated,
    ).toBe(false);
    stopLocal();
    stopRemote();
  },
);
it('T045 SSE reconnect refetches control runs and pending receipts', async () => {
  vi.stubGlobal('EventSource', MockSource);
  const value = client();
  const runs = vi.fn(async () => ({ runs: [], requests: [] }));
  const receipt = vi.fn(async () => ({ status: 'accepted' }));
  const runObserver = new QueryObserver(value, {
    queryKey: queryKeys.controlRuns('local'),
    queryFn: runs,
  });
  const receiptObserver = new QueryObserver(value, {
    queryKey: queryKeys.controlReceipt('local', 'c'),
    queryFn: receipt,
  });
  const stopRun = runObserver.subscribe(() => {});
  const stopReceipt = receiptObserver.subscribe(() => {});
  await runObserver.refetch();
  await receiptObserver.refetch();
  render(
    <QueryClientProvider client={value}>
      <LiveProvider>
        <span>Control</span>
      </LiveProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    MockSource.instances[0]!.open();
  });
  runs.mockClear();
  receipt.mockClear();
  await act(async () => {
    MockSource.instances[0]!.open();
  });
  expect(runs).toHaveBeenCalledTimes(1);
  expect(receipt).toHaveBeenCalledTimes(1);
  stopRun();
  stopReceipt();
});

it('T045 renders the permission card read from GET after an SSE request hint', async () => {
  vi.stubGlobal('EventSource', MockSource);
  let pending = false;
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith('/machines')
            ? [
                {
                  machineId: 'local',
                  bootId: 'boot',
                  capabilities: { control: { state: 'ready' }, bypass: false },
                },
              ]
            : {
                runs: [],
                requests: pending
                  ? [
                      {
                        requestId: 'from-get',
                        runId: 'run',
                        sessionId: 's',
                        kind: 'permission',
                        toolName: 'Read',
                        summary: 'Read fixture file',
                        createdAt: '2026-11-01',
                        expiresAt: '2026-11-02',
                      },
                    ]
                  : [],
              },
        ),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const value = client();
  function Requests() {
    const query = useControl();
    return (
      <>
        {query.data?.requests.map(
          (request) =>
            request.kind === 'permission' && (
              <PermissionCard
                key={request.requestId}
                request={request}
                layout="pinned"
                onDecide={async () => {}}
              />
            ),
        )}
      </>
    );
  }
  render(
    <QueryClientProvider client={value}>
      <LiveProvider>
        <Requests />
      </LiveProvider>
    </QueryClientProvider>,
  );
  await act(async () => {
    await value.fetchQuery({
      queryKey: queryKeys.controlRuns('local'),
      queryFn: async () => ({ runs: [], requests: [] }),
    });
  });
  pending = true;
  await act(async () => {
    MockSource.instances[0]!.emit('control.request', {
      requestId: 'hint-id',
      runId: 'run',
      sessionId: 's',
    });
  });
  expect(await screen.findByText('Read fixture file')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeVisible();
  expect(
    fetcher.mock.calls.some(([url]) => url === '/api/m/local/control/runs'),
  ).toBe(true);
});
