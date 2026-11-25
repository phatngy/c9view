import { afterEach, expect, it, vi } from 'vitest';

const exists = vi.hoisted(() => vi.fn<(path: unknown) => boolean>());
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: exists,
}));
import { hookEntryUrl } from './hook-entry-path.js';

afterEach(() => exists.mockReset());
it('falls back to the built core package when no bundled hook entry exists', () => {
  exists.mockReturnValue(false);
  expect(hookEntryUrl().href).toBe(
    new URL('../dist/hooks/hook-entry.js', import.meta.resolve('@c9view/core'))
      .href,
  );
});
it('prefers the hook entry bundled beside the CLI', () => {
  exists.mockReturnValue(true);
  const url = hookEntryUrl();
  expect(url.href).toBe(new URL('./hooks/hook-entry.js', import.meta.url).href);
  expect(exists).toHaveBeenCalledWith(url);
});
