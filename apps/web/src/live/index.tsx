import { useEffect, type ReactNode } from 'react';
import {
  useQueryClient,
  type QueryClient,
  type Query,
  type InfiniteData,
} from '@tanstack/react-query';
import type { MachineEvent, SessionDetailResponse } from '@c9view/api';
import { queryKeys } from '../queryKeys.js';
import {
  api,
  HttpError,
  SESSION_PAGE_SIZE,
  type SessionPageParam,
} from '../api.js';
import { machineEventSchema, machineStateEventSchema } from './events.js';
import { resetConnection, setConnection } from './state.js';
export { useLiveConnection, useLivePolling, useLiveSession } from './state.js';

// Each query has one refresh loop. Hints during a read coalesce into a trailing read.
const refreshes = new WeakMap<
  QueryClient,
  Map<string, { dirty: boolean; promise: Promise<void> }>
>();
async function refreshQuery(client: QueryClient, query: Query) {
  let pending = refreshes.get(client);
  if (!pending) {
    pending = new Map();
    refreshes.set(client, pending);
  }
  const running = pending.get(query.queryHash);
  if (running) {
    running.dirty = true;
    return running.promise;
  }
  const state = { dirty: false, promise: Promise.resolve() };
  pending.set(query.queryHash, state);
  state.promise = (async () => {
    try {
      do {
        state.dirty = false;
        // Include a request already started by mounting, polling or pagination.
        if (query.state.fetchStatus !== 'idle')
          await query.promise?.catch(() => {});
        if (
          query.queryKey[1] === 'session' &&
          (query.state.data as InfiniteData<SessionDetailResponse> | undefined)
            ?.pages
        ) {
          void client.invalidateQueries(
            { queryKey: query.queryKey, exact: true, refetchType: 'none' },
            { cancelRefetch: false },
          );
          await readNewestPage(client, query);
          continue;
        }
        await client.invalidateQueries(
          { queryKey: query.queryKey, exact: true },
          { cancelRefetch: false },
        );
      } while (state.dirty);
    } finally {
      pending.delete(query.queryHash);
    }
  })();
  return state.promise;
}
// A concurrent cache update (including pagination) wins over this response.
async function readNewestPage(client: QueryClient, query: Query) {
  const cached = query.state.data as InfiniteData<
    SessionDetailResponse,
    SessionPageParam
  >;
  const last = cached.pages.at(-1);
  const param = cached.pageParams.at(-1);
  if (!last) return;
  const [machineId, , projectId, sessionId] = query.queryKey as string[];
  const page = await api.session(
    machineId!,
    projectId!,
    sessionId!,
    typeof param === 'object'
      ? param
      : { cursor: last.cursor, limit: SESSION_PAGE_SIZE },
  );
  client.setQueryData(query.queryKey, (current: unknown) =>
    current === cached
      ? { ...cached, pages: [...cached.pages.slice(0, -1), page] }
      : current,
  );
}
export const refreshNewestPage = refreshSession;
/** Polling uses the same serialized invalidation path as live hints. */
export async function refreshSession(
  client: QueryClient,
  machineId: string,
  projectId: string,
  sessionId: string,
) {
  const query = client.getQueryCache().find({
    queryKey: queryKeys.session(machineId, projectId, sessionId),
    exact: true,
  });
  if (query) await refreshQuery(client, query);
}
export async function refreshMachine(client: QueryClient, machineId?: string) {
  await Promise.all(
    client
      .getQueryCache()
      .getAll()
      .filter(
        (query) =>
          query.queryKey.length > 1 &&
          (machineId === undefined || query.queryKey[0] === machineId),
      )
      .map((query) => refreshQuery(client, query)),
  );
}
export async function invalidateLiveEvent(
  client: QueryClient,
  envelope: MachineEvent,
) {
  const { machineId, event } = envelope;
  await Promise.all(
    client
      .getQueryCache()
      .getAll()
      .filter((query) => {
        const [machine, kind, projectId, sessionId] = query.queryKey;
        if (machine !== machineId) return false;
        switch (event.type) {
          case 'control.run':
          case 'control.request':
          case 'control.request.resolved':
            return kind === 'control-runs';
          case 'control.project':
            return (
              kind === 'control-receipt' && projectId === event.clientRequestId
            );
          case 'project':
            return (
              ['usage', 'overview', 'projects'].includes(String(kind)) ||
              (kind === 'project' && projectId === event.projectId)
            );
          case 'session':
            return (
              projectId === event.projectId &&
              (kind === 'project' ||
                (['session', 'session-poll', 'status-history'].includes(
                  String(kind),
                ) &&
                  sessionId === event.sessionId))
            );
          case 'status':
            return (
              projectId === event.projectId &&
              (kind === 'project' ||
                (['session-poll', 'status-history'].includes(String(kind)) &&
                  sessionId === event.sessionId))
            );
          case 'config':
            return kind === 'config' || kind === 'project';
          case 'index':
            return ['health', 'usage', 'overview', 'search'].includes(
              String(kind),
            );
          default:
            return false;
        }
      })
      .map((query) => refreshQuery(client, query)),
  );
}
let source: EventSource | undefined;
const clients = new Map<QueryClient, number>();
let stopProbe: AbortController | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1_000;
let hasOpened = false;
const machineStates = new Map<
  string,
  { state: 'online' | 'offline'; bootId?: string | undefined }
>();
let authBlocked = false;
let probeUnauthorized = false;
function start() {
  setConnection('connecting');
  source = new EventSource('/api/events');
  const current = source;
  current.onopen = () => {
    if (source !== current) return;
    const reconnect = hasOpened;
    hasOpened = true;
    retryDelay = 1_000;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    setConnection('live');
    if (reconnect) {
      for (const client of clients.keys())
        void refreshMachine(client).catch(() => {});
    }
  };
  current.onerror = () => {
    if (source !== current) return;
    setConnection('offline');
    if (stopProbe) return;
    stopProbe = new AbortController();
    probeUnauthorized = false;
    void api
      .hubHealth(stopProbe.signal)
      .catch((error: unknown) => {
        if (
          error instanceof HttpError &&
          error.status === 401 &&
          source === current
        ) {
          probeUnauthorized = true;
          authBlocked = true;
          current.close();
          return;
        }
      })
      .finally(() => {
        stopProbe = undefined;
        if (
          source !== current ||
          probeUnauthorized ||
          current.readyState !== EventSource.CLOSED ||
          retryTimer
        )
          return;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30_000);
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (source !== current || !clients.size) return;
          current.close();
          start();
        }, delay);
      });
  };
  for (const type of [
    'project',
    'session',
    'status',
    'config',
    'index',
    'machine',
    'control.run',
    'control.request',
    'control.request.resolved',
    'control.project',
  ]) {
    current.addEventListener(type, (message) => {
      if (source !== current) return;
      let raw: unknown;
      try {
        raw = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (type === 'machine') {
        const parsed = machineStateEventSchema.safeParse(raw);
        if (!parsed.success) return;
        const data = parsed.data;
        const previous = machineStates.get(data.machineId);
        machineStates.set(data.machineId, data);
        for (const client of clients.keys()) {
          if (
            !previous ||
            previous.state !== data.state ||
            previous.bootId !== data.bootId
          )
            void client
              .invalidateQueries(
                { queryKey: queryKeys.machines(), exact: true },
                { cancelRefetch: false },
              )
              .catch(() => {});
          if (
            previous &&
            data.state === 'online' &&
            (previous.state === 'offline' || previous.bootId !== data.bootId)
          )
            void refreshMachine(client, data.machineId).catch(() => {});
        }
        return;
      }
      const parsed = machineEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const data = parsed.data;
      if (
        !('event' in data) ||
        !data.event ||
        typeof data.event !== 'object' ||
        data.event.type !== type
      )
        return;
      if (
        ['project', 'session', 'status'].includes(type) &&
        typeof data.event.projectId !== 'string'
      )
        return;
      if (
        ['session', 'status'].includes(type) &&
        typeof data.event.sessionId !== 'string'
      )
        return;
      for (const client of clients.keys())
        void invalidateLiveEvent(client, data).catch(() => {});
    });
  }
}
export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  useEffect(() => {
    clients.set(client, (clients.get(client) ?? 0) + 1);
    if (!source && !authBlocked && typeof EventSource !== 'undefined') start();
    return () => {
      const remaining = (clients.get(client) ?? 1) - 1;
      if (remaining) clients.set(client, remaining);
      else clients.delete(client);
      if (!clients.size) {
        source?.close();
        source = undefined;
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryDelay = 1_000;
        hasOpened = false;
        machineStates.clear();
        authBlocked = false;
        stopProbe?.abort();
        stopProbe = undefined;
        resetConnection();
      }
    };
  }, [client]);
  return children;
}
