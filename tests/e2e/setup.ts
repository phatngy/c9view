import { expect, request, type FullConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { controlBaseURL, controlToken } from './control-fixture.js';

export default async function setup(config: FullConfig) {
  const baseURLs = new Set(
    config.projects.map((project) => project.use.baseURL!),
  );
  await Promise.all([...baseURLs].map(waitForIndex));
}

async function waitForIndex(baseURL: string) {
  const api = await request.newContext({
    baseURL,
  });
  const control = baseURL === controlBaseURL;
  try {
    // The control server requires login; its fixture tree is a temporary copy.
    if (control)
      await api.get(`/login?token=${controlToken}`, { maxRedirects: 0 });
    // /api/m/local/health is also 200 while building (or after an index error).
    await expect
      .poll(
        async () => {
          const response = await api.get('/api/m/local/health');
          const health = (await response.json()) as {
            index?: { state?: string };
            claudeDir?: string;
          };
          if (!control)
            expect(health.claudeDir).toBe(
              fileURLToPath(new URL('../fixtures/claude', import.meta.url)),
            );
          return health.index?.state;
        },
        { timeout: 30_000, message: `${baseURL} fixture index must be ready` },
      )
      .toBe('ready');
  } finally {
    await api.dispose();
  }
}
