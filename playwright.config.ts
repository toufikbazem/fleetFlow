import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys — FF-1202.
 *
 * These are the only tests that exercise the product the way a person does:
 * a real browser, a real API, a real database, and the route guards, the
 * session refresh and the forms all in play at once. Everything below them
 * proves a layer; this proves the layers were joined up.
 *
 * There are deliberately five of them — one per role — rather than a broad
 * suite. E2E tests are the slowest and flakiest thing in any test pyramid, so
 * they are spent on the journeys the client will actually perform at acceptance
 * (see `docs/UAT_SCRIPT.md`), and everything else is covered a layer down where
 * a failure names one function instead of one screen.
 *
 *   npm run db:up && npm run db:seed
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  // Serial: the suites share one database, and a journey that creates a vehicle
  // while another counts vehicles is a flake nobody can reproduce.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5173',
    // Kept only for failures: a trace per passing test is gigabytes nobody reads.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      // D6–D7 of the UAT script are explicitly a phone journey: a driver filing
      // a damage report at the roadside is the most mobile-critical flow in the
      // product, and a desktop-only suite would never exercise it.
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: /driver\.spec\.ts/,
    },
  ],

  // Playwright starts both halves and waits for the web server. `reuseExisting`
  // means a developer with `npm run dev` already running does not get a second
  // copy fighting for the port.
  webServer: [
    {
      command: 'npm run start:api',
      url: 'http://localhost:4000/healthz',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
