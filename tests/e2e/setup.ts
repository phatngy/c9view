import { expect, request, type FullConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default async function setup(config: FullConfig) {
  const api = await request.newContext({
    baseURL: config.projects[0]!.use.baseURL!,
  });
  try {
    // /api/health is also 200 while building (or after an index error).
    await expect
      .poll(
        async () => {
          const response = await api.get('/api/health');
          const health = (await response.json()) as {
            index?: { state?: string };
            claudeDir?: string;
          };
          expect(health.claudeDir).toBe(
            fileURLToPath(new URL('../fixtures/claude', import.meta.url)),
          );
          return health.index?.state;
        },
        { timeout: 30_000, message: 'Synthetic fixture index must be ready' },
      )
      .toBe('ready');
  } finally {
    await api.dispose();
  }
}
