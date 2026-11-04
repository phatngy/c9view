import { useEffect, type ReactNode } from 'react';
import {
  useQueryClient,
  type QueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { LiveEvent, SessionDetailResponse } from '@c9view/api';
import {
  api,
  HttpError,
  SESSION_PAGE_SIZE,
  type SessionPageParam,
} from '../api.js';
import { resetConnection, setConnection } from './state.js';
export { useLiveConnection, useLivePolling, useLiveSession } from './state.js';

// Refresh by absolute offset so growth cannot shift a loaded tail and leave gaps.
export async function refreshNewestPage(
  client: QueryClient,
  projectId: string,
  sessionId: string,
) {
  const key = ['session', projectId, sessionId];
  const cached =
    client.getQueryData<InfiniteData<SessionDetailResponse, SessionPageParam>>(
      key,
    );
  const last = cached?.pages.at(-1);
  const param = cached?.pageParams.at(-1);
  if (!cached || !last) return;
  const limit = typeof param === 'object' ? param.limit : SESSION_PAGE_SIZE;
  const page = await api.session(projectId, sessionId, {
    cursor: last.cursor,
    limit,
  });
  client.setQueryData<InfiniteData<SessionDetailResponse, SessionPageParam>>(
    key,
    (current) =>
      current === cached
        ? { ...cached, pages: [...cached.pages.slice(0, -1), page] }
        : current,
  );
}

export async function invalidateLiveEvent(
  client: QueryClient,
  event: LiveEvent,
) {
  const invalidate = (queryKey: readonly unknown[]) =>
    client.invalidateQueries({ queryKey, exact: true });
  switch (event.event) {
    case 'project':
      await Promise.all([
        client.invalidateQueries({ queryKey: ['usage'] }),
        invalidate(['overview']),
        invalidate(['projects']),
        invalidate(['project', event.data.projectId]),
      ]);
      break;
    case 'session': {
      const { projectId, sessionId } = event.data;
      const key = ['session', projectId, sessionId];
      await Promise.all([
        invalidate(['project', projectId]),
        invalidate(['session-poll', projectId, sessionId]),
        client.invalidateQueries({
          queryKey: key,
          exact: true,
          refetchType: 'none',
        }),
      ]);
      await refreshNewestPage(client, projectId, sessionId);
      break;
    }
    case 'status':
      await Promise.all([
        invalidate(['project', event.data.projectId]),
        invalidate([
          'session-poll',
          event.data.projectId,
          event.data.sessionId,
        ]),
      ]);
      break;
    case 'config':
      await Promise.all([
        invalidate(['config']),
        client.invalidateQueries({ queryKey: ['project'] }),
      ]);
      break;
    case 'index':
      await Promise.all([
        invalidate(['health']),
        client.invalidateQueries({ queryKey: ['usage'] }),
        invalidate(['overview']),
        client.invalidateQueries({ queryKey: ['search'], exact: false }),
      ]);
      break;
  }
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
      // Catch up after missed events during a disconnection.
      for (const client of clients.keys()) {
        for (const query of client
          .getQueryCache()
          .findAll({ queryKey: ['session'] })) {
          if (query.getObserversCount() === 0) continue;
          const [, projectId, sessionId] = query.queryKey;
          if (typeof projectId === 'string' && typeof sessionId === 'string')
            void invalidateLiveEvent(client, {
              event: 'session',
              data: { projectId, sessionId },
            }).catch(() => {});
        }
        void client.invalidateQueries({
          predicate: (query) =>
            [
              'overview',
              'projects',
              'project',
              'session-poll',
              'config',
              'health',
              'search',
              'usage',
            ].includes(String(query.queryKey[0])),
        });
      }
    }
  };
  current.onerror = () => {
    if (source !== current) return;
    setConnection('offline');
    if (stopProbe) return;
    stopProbe = new AbortController();
    probeUnauthorized = false;
    void api
      .health(stopProbe.signal)
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
  for (const event of [
    'project',
    'session',
    'status',
    'config',
    'index',
  ] as const) {
    current.addEventListener(event, (message) => {
      if (source !== current) return;
      let data: unknown;
      try {
        data = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object') return;
      if (
        (event === 'project' || event === 'session' || event === 'status') &&
        (!('projectId' in data) || typeof data.projectId !== 'string')
      )
        return;
      if (
        (event === 'session' || event === 'status') &&
        (!('sessionId' in data) || typeof data.sessionId !== 'string')
      )
        return;
      for (const client of clients.keys())
        void invalidateLiveEvent(client, { event, data } as LiveEvent).catch(
          () => {
            /* Keep stale data; the next event or reconnect retries. */
          },
        );
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
