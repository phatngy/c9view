import { useEffect, type ReactNode } from 'react';
import {
  useQueryClient,
  type QueryClient,
  type Query,
} from '@tanstack/react-query';
import type { MachineEvent, MachineStateEvent } from '@c9view/api';
import { queryKeys } from '../queryKeys.js';
import { api, HttpError } from '../api.js';
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
/** Polling uses the same serialized invalidation path as live hints. */
export async function refreshSession(
  client: QueryClient,
  machineId: string,
  projectId: string,
  sessionId: string,
) {
  const query = client
    .getQueryCache()
    .find({
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
  ]) {
    current.addEventListener(type, (message) => {
      if (source !== current) return;
      let data: MachineEvent | MachineStateEvent;
      try {
        data = JSON.parse((message as MessageEvent<string>).data) as
          MachineEvent | MachineStateEvent;
      } catch {
        return;
      }
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.machineId !== 'string'
      )
        return;
      if (type === 'machine') {
        if (
          'type' in data &&
          data.type === 'machine' &&
          data.state === 'online'
        )
          for (const client of clients.keys())
            void refreshMachine(client, data.machineId).catch(() => {});
        return;
      }
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
        authBlocked = false;
        stopProbe?.abort();
        stopProbe = undefined;
        resetConnection();
      }
    };
  }, [client]);
  return children;
}
