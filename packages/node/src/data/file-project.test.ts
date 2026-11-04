import { expect, it } from 'vitest';
import { parseRecord } from '@c9view/core';
import { cachedSessionChanges } from './file-project.js';
import type { DataStore } from './store.js';
it('memoizes changes by transcript path size and mtime and invalidates on change', async () => {
  const store = { config: { claudeDir: '/nonexistent' } } as DataStore;
  const found = {
    path: '/synthetic/s.jsonl',
    session: { id: 's' },
    cached: {
      records: [parseRecord({ type: 'user', message: { content: 'fixture' } })],
      size: 10,
      mtimeMs: 1,
    },
  } as NonNullable<Awaited<ReturnType<DataStore['findSession']>>>;
  const first = await cachedSessionChanges(store, found, '/project');
  expect(await cachedSessionChanges(store, found, '/project')).toBe(first);
  found.cached.mtimeMs++;
  const next = await cachedSessionChanges(store, found, '/project');
  expect(next).not.toBe(first);
  found.cached.size++;
  expect(await cachedSessionChanges(store, found, '/project')).not.toBe(next);
});
