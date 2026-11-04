import { expect, it, vi } from 'vitest';
import { loadConfig } from '@c9view/core';
import { DataStore } from './store.js';
import { HookEvents } from './hook-events.js';

it('rebuilds an invalidated in-flight snapshot before returning it to any caller', async () => {
  const hooks = new HookEvents('/synthetic/missing-hooks');
  const store = new DataStore(
    loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/missing-claude' }),
    { hooks },
  );
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refresh = vi
    .spyOn(hooks, 'refresh')
    .mockImplementationOnce(() => paused)
    .mockResolvedValue(undefined);
  try {
    const first = store.snapshot();
    const concurrent = store.snapshot();
    store.invalidate();
    release();
    const result = await first;
    expect(await concurrent).toBe(result);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(await store.snapshot()).toBe(result);
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    hooks.close();
  }
});
