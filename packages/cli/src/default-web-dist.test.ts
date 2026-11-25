import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';

const exists = vi.hoisted(() => vi.fn<(path: unknown) => boolean>());
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: exists,
}));
import { defaultWebDist } from './start.js';

const hubPackage = 'file:///repo/apps/hub/package.json';
afterEach(() => exists.mockReset());
it('serves the web build bundled beside dist/ when it has an index.html', () => {
  exists.mockReturnValue(true);
  expect(defaultWebDist(hubPackage)).toBe(
    fileURLToPath(new URL('../web-dist/', import.meta.url)),
  );
  expect(String(exists.mock.calls[0]?.[0])).toMatch(/\/web-dist\/index\.html$/);
});
it('falls back to the repository layout next to the hub package', () => {
  exists.mockReturnValue(false);
  expect(defaultWebDist(hubPackage)).toBe('/repo/apps/web/dist/');
});
