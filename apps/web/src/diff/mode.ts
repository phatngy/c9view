import { useSyncExternalStore } from 'react';

export type DiffMode = 'unified' | 'split';
const listeners = new Set<() => void>();
let fallback: DiffMode = 'unified';
let memoryOnly = false;
function snapshot(): DiffMode {
  if (memoryOnly) return fallback;
  try {
    return localStorage.getItem('c9view-diff-mode') === 'split'
      ? 'split'
      : 'unified';
  } catch {
    return fallback;
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}
function setMode(mode: DiffMode) {
  fallback = mode;
  try {
    localStorage.setItem('c9view-diff-mode', mode);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  listeners.forEach((listener) => listener());
}
export function useDiffMode(): [DiffMode, (mode: DiffMode) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => 'unified'), setMode];
}
