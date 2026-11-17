import { useMemo } from 'react';
import {
  useQuery,
  useQueries,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { CommandReceipt } from '@c9view/api';
import { HttpError } from '../api.js';
import { useMachineId } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import type { controlApi } from './api.js';

type Service = ReturnType<typeof controlApi>;

const MAX_COMMANDS = 3;
const AVAILABILITY_POLL_MS = 10_000;
const RECEIPT_POLL_MS = 2_000;
// Delivery states that can still change while the receipt lives.
const OPEN_STATES = ['sent', 'not-seen', 'uncertain'];

const storageKey = (machineId: string, projectId: string, sessionId: string) =>
  `c9view.remote.${machineId}.${projectId}.${sessionId}`;
// Browser storage is a per-viewer convenience only; every access may fail.
function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter((id): id is string => typeof id === 'string')
          .slice(0, MAX_COMMANDS)
      : [];
  } catch {
    return [];
  }
}
function writeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Not remembered; the live hints still fill the list.
  }
}

/**
 * Remember a remote command so its outcome shows in this tab. Called for this
 * tab's own sends and, from the live hints, for commands sent from any tab.
 * Newest first; IDs only, never text.
 */
export function addRemoteCommand(
  client: QueryClient,
  machineId: string,
  projectId: string,
  sessionId: string,
  id: string,
) {
  const key = queryKeys.remoteCommands(machineId, projectId, sessionId);
  const current = client.getQueryData<string[]>(key) ?? [];
  if (current.includes(id)) return;
  const next = [id, ...current].slice(0, MAX_COMMANDS);
  client.setQueryData(key, next);
  writeIds(storageKey(machineId, projectId, sessionId), next);
}

/** The session's remote availability, rechecked every 10 s while the page is visible. */
export function useRemoteAvailability(
  service: Service,
  projectId: string,
  sessionId: string,
  enabled: boolean,
) {
  const machineId = useMachineId();
  return useQuery({
    queryKey: queryKeys.remoteAvailability(machineId, projectId, sessionId),
    queryFn: ({ signal }) =>
      service.remoteAvailability(projectId, sessionId, signal),
    enabled,
    retry: false,
    refetchInterval: AVAILABILITY_POLL_MS,
  });
}

export interface RemoteCommand {
  id: string;
  receipt?: CommandReceipt;
  /** The node no longer holds the receipt. */
  expired: boolean;
  /** Restored from this browser after a reload, not seen live. */
  restored: boolean;
}

/** Receipts of this session's recent remote commands, newest first. */
export function useRemoteCommands(
  service: Service,
  projectId: string,
  sessionId: string,
  enabled: boolean,
): RemoteCommand[] {
  const machineId = useMachineId();
  const client = useQueryClient();
  const listKey = queryKeys.remoteCommands(machineId, projectId, sessionId);
  const ids = useQuery({
    queryKey: listKey,
    queryFn: () => client.getQueryData<string[]>(listKey) ?? [],
    initialData: () =>
      readIds(storageKey(machineId, projectId, sessionId)) as string[],
    staleTime: Infinity,
    // Only addRemoteCommand writes it; a refetch must never reset it.
    enabled: false,
  });
  // Read once per session: what an earlier page load remembered, not later sends.
  const restored = useMemo(
    () => readIds(storageKey(machineId, projectId, sessionId)),
    [machineId, projectId, sessionId],
  );
  const list = useMemo(() => ids.data ?? [], [ids.data]);
  const receipts = useQueries({
    queries: list.map((id) => ({
      queryKey: queryKeys.controlReceipt(machineId, id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        service.receipt(id, signal),
      enabled,
      retry: false,
      refetchInterval: (query: {
        state: { data?: CommandReceipt | undefined; error: unknown };
      }) =>
        query.state.error instanceof HttpError &&
        query.state.error.status === 404
          ? false
          : OPEN_STATES.includes(query.state.data?.delivery?.state ?? 'sent')
            ? RECEIPT_POLL_MS
            : false,
    })),
    // Structurally shared, so the result is stable until a receipt changes.
    combine: (results) =>
      results.map((result) => ({ data: result.data, error: result.error })),
  });
  return useMemo(
    () =>
      list.map((id, index): RemoteCommand => {
        const result = receipts[index];
        return {
          id,
          ...(result?.data ? { receipt: result.data } : {}),
          expired:
            result?.error instanceof HttpError && result.error.status === 404,
          restored: restored.includes(id),
        };
      }),
    [list, receipts, restored],
  );
}
