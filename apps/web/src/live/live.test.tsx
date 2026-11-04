import { act, cleanup, render, screen } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { MachineEvent } from '@c9view/api';
import { queryKeys } from '../queryKeys.js';
import {
  LiveProvider,
  invalidateLiveEvent,
  refreshMachine,
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
  });
  requests.forEach(({ request }) => expect(request).not.toHaveBeenCalled());
  await act(async () => {
    source.fail();
    source.open();
  });
  requests.forEach(({ request }) => expect(request).toHaveBeenCalledTimes(1));
  await act(async () => {
    source.emit('machine', {
      type: 'machine',
      machineId: 'remote',
      state: 'online',
    });
  });
  requests.forEach(({ machine, request }) =>
    expect(request).toHaveBeenCalledTimes(machine === 'remote' ? 2 : 1),
  );
  stops.forEach((stop) => stop());
});
