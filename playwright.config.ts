import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end tests (docs/DECISIONS.md "M8-QA").
 *
 * One dedicated dev server (e2e/server.mjs) on 127.0.0.1:5180 with a wiped, freshly migrated D1
 * state dir, the fake AI provider and DEV_AUTH_EMAIL=e2e@example.com. Every test talks to the
 * same single user, so tests run one at a time (workers: 1) and each starts by resetting that
 * user's decks and settings through the public API (e2e/fixtures.ts).
 */
const PORT = Number(process.env.E2E_PORT ?? 5180)
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Reviews post `reviewedAt` from the browser clock; keep the default locale/timezone stable.
    locale: 'en-US',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `${baseURL}/api/health`,
    // Always a fresh server: the launcher wipes and re-migrates the e2e D1 state first.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT) },
  },
})
