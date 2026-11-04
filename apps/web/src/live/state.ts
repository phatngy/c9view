import { useSyncExternalStore } from 'react';

export type ConnectionState = 'connecting' | 'live' | 'offline';
let snapshot: { state: ConnectionState; polling: boolean } = {
  state: 'offline',
  polling: true,
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
// True once an outage has lasted 10 s; stays true across retry flips
// (connecting <-> offline) until the stream is live again.
let fallback = false;
export function setConnection(state: ConnectionState) {
  if (snapshot.state === state) return;
  if (state === 'live') {
    clearTimeout(timer);
    timer = undefined;
    fallback = false;
  }
  snapshot = { state, polling: state !== 'live' && fallback };
  listeners.forEach((listener) => listener());
  if (state !== 'live' && !fallback && !timer) {
    timer = setTimeout(() => {
      timer = undefined;
      fallback = true;
      snapshot = { ...snapshot, polling: true };
      listeners.forEach((listener) => listener());
    }, 10_000);
  }
}
export function resetConnection() {
  clearTimeout(timer);
  timer = undefined;
  fallback = false;
  if (snapshot.state === 'offline' && snapshot.polling) return;
  snapshot = { state: 'offline', polling: true };
  listeners.forEach((listener) => listener());
}
export function useLiveConnection() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}
export function useLivePolling(): false | 5000 {
  return useLiveConnection().polling ? 5000 : false;
}
/** Session query hooks already consume live updates; call this for connection UI. */
export function useLiveSession(projectId: string, sessionId: string) {
  return { ...useLiveConnection(), projectId, sessionId };
}
