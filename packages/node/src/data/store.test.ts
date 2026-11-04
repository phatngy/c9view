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

it('bounds continuously invalidated builds and leaves the snapshot uncached', async () => {
  const hooks = new HookEvents('/synthetic/missing-hooks');
  const store = new DataStore(
    loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/missing-claude' }),
    { hooks },
  );
  const refresh = vi.spyOn(hooks, 'refresh').mockImplementation(async () => {
    store.invalidate();
  });
  try {
    const result = await store.snapshot();
    expect(result).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(await store.snapshot()).not.toBe(result);
    expect(refresh).toHaveBeenCalledTimes(6);
  } finally {
    hooks.close();
  }
});

it('rebuilds for a caller joining after the last bounded build was invalidated', async () => {
  const hooks = new HookEvents('/synthetic/missing-hooks');
  const store = new DataStore(
    loadConfig({ C9VIEW_CLAUDE_DIR: '/synthetic/missing-claude' }),
    { hooks },
  );
  let late: ReturnType<DataStore['snapshot']> | undefined;
  const refresh = vi
    .spyOn(hooks, 'refresh')
    .mockImplementationOnce(async () => {
      store.invalidate();
    })
    .mockImplementationOnce(async () => {
      store.invalidate();
    })
    .mockImplementationOnce(async () => {
      store.invalidate();
      late = store.snapshot();
    })
    .mockResolvedValue(undefined);
  try {
    const first = await store.snapshot();
    expect(late).toBeDefined();
    const newest = await late;
    expect(newest).not.toBe(first);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(await store.snapshot()).toBe(newest);
    expect(refresh).toHaveBeenCalledTimes(4);
  } finally {
    hooks.close();
  }
});
