import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/e2e/setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:7791',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      testMatch: ['dashboard.spec.ts', 'security.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-phone',
      testMatch: ['phone.spec.ts'],
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'node --experimental-strip-types tests/e2e/server.ts',
    url: 'http://127.0.0.1:7791/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
