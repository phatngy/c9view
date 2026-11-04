import { stat } from 'node:fs/promises';
import { sessionChanges } from '@c9view/core';
import type { DataStore } from './store.js';

export async function fileProject(store: DataStore, projectId: string) {
  const found = (await store.snapshot()).find(
    (p) => p.project.id === projectId,
  );
  if (!found) return undefined;
  try {
    if (!(await stat(found.project.path)).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  return found;
}

// Entry objects are retained by the transcript LRU. Each changed transcript gets
// a new records array; the weak ownership releases results when it is evicted.
const changeCache = new WeakMap<
  object,
  {
    key: string;
    value: ReturnType<typeof sessionChanges>;
  }
>();
export async function cachedSessionChanges(
  store: DataStore,
  found: NonNullable<Awaited<ReturnType<DataStore['findSession']>>>,
  root: string,
) {
  const records = found.cached.records ?? [];
  const key = JSON.stringify([
    found.path,
    found.cached.size,
    found.cached.mtimeMs,
    root,
  ]);
  const previous = changeCache.get(records);
  if (previous?.key === key) return previous.value;
  const value = sessionChanges({
    claudeDir: store.config.claudeDir,
    sessionId: found.session.id,
    records,
    root,
  });
  changeCache.set(records, { key, value });
  return value;
}
