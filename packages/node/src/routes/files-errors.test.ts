import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createGit } from '@c9view/core';
import type { DataStore } from '../data/store.js';
import { fileRoutes } from './files.js';
vi.mock('@c9view/core', async (original) => ({
  ...(await original<typeof import('@c9view/core')>()),
  createGit: vi.fn(),
}));
it.each(['status', 'diff'])(
  'returns generic git %s failures and timeout ApiErrors and logs details',
  async (endpoint) => {
    const root = await mkdtemp(join(tmpdir(), 'c9view-git-errors-'));
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = {
      snapshot: async () => [{ project: { id: 'p', path: root } }],
    } as unknown as DataStore;
    try {
      for (const timedOut of [false, true]) {
        const failure = Object.assign(new Error('sensitive failure detail'), {
          timedOut,
        });
        vi.mocked(createGit).mockReturnValue({
          isRepo: async () => true,
          status: async () => {
            throw failure;
          },
          diff: async () => {
            throw failure;
          },
        } as unknown as ReturnType<typeof createGit>);
        const response = await fileRoutes(store).request(
          `/projects/p/git/${endpoint}`,
        );
        expect(response.status).toBe(timedOut ? 504 : 400);
        expect(await response.json()).toEqual({ error: 'Git read failed' });
        expect(logger).toHaveBeenCalledWith(`Git ${endpoint} failed`, failure);
      }
    } finally {
      logger.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);
