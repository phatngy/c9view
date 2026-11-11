import { defineConfig, devices } from '@playwright/test';
import { controlBaseURL, controlToken } from './tests/e2e/control-fixture.js';
import { budgetBaseURL, pageBudgetBytes } from './tests/e2e/budget.js';

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
    {
      name: 'chromium-budget',
      testMatch: ['budget.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: budgetBaseURL,
      },
    },
    {
      name: 'chromium-control',
      testMatch: ['control.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: controlBaseURL,
      },
    },
    {
      name: 'chromium-control-phone',
      testMatch: ['control-phone.spec.ts'],
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        baseURL: controlBaseURL,
      },
    },
  ],
  webServer: [
    {
      command: 'node --experimental-strip-types tests/e2e/server.ts',
      url: 'http://127.0.0.1:7791/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node --experimental-strip-types tests/e2e/server.ts',
      env: {
        C9VIEW_E2E_PORT: '7792',
        C9VIEW_PAGE_BUDGET_BYTES: String(pageBudgetBytes),
      },
      url: `${budgetBaseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node --experimental-strip-types tests/e2e/control-server.ts',
      env: { C9VIEW_TOKEN: controlToken },
      url: `${controlBaseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
