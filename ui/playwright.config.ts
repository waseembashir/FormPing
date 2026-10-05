import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Test config for the FormPing web app (FR-58).
 *
 * This is the END-TO-END test runner — separate from the `playwright` library the
 * engine uses to drive real form submissions. Tests live in `e2e/` and run against
 * a real browser hitting the running Next.js app.
 *
 * The app runs with an OPEN gate (no login) and file-based storage when the
 * auth/Supabase env vars are unset, so these tests need NO secrets to run.
 */
export default defineConfig({
  testDir: './e2e',
  // Fail the run if a test is left focused with test.only (guards CI).
  forbidOnly: !!process.env.CI,
  // One retry in CI to absorb flakiness; none locally so failures are loud.
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    // Capture a trace only when a test retries — cheap locally, useful in CI.
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Playwright boots the app itself, waits for it, runs the tests, then tears it
  // down. `reuseExistingServer` lets you keep `npm run dev` running while you
  // iterate locally. The 120s timeout covers Next.js's first on-demand compile.
  webServer: {
    // Run our OWN app on a dedicated test port (3100), and never reuse whatever
    // is already listening — a stray dev server on the default 3000 was getting
    // silently reused and failing the test. `false` guarantees we test FormPing.
    command: 'npx next dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    // Force the OPEN gate for tests by clearing the auth vars that .env.local
    // sets — in Next.js the process environment wins over .env files. Without
    // this, a logged-out visit to `/` redirects to /welcome and the test never
    // sees the app. Keeps the smoke test deterministic and login-free.
    env: {
      // Build into `.next-e2e` instead of `.next`, so the suite does not race a
      // dev server you left running over the same output. See next.config.mjs.
      NEXT_TEST_BUILD: '1',
      // Auth OFF → open gate (no login), so `/` renders the app not /welcome.
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      AUTH_USER: '',
      AUTH_PASSWORD: '',
      // Storage/integrations OFF → the app's built-in file-storage fallback.
      // The test contacts NO real Supabase or Slack and needs NO secrets — fully
      // hermetic, which also makes CI safe (never ship real secrets to CI).
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SLACK_WEBHOOK_URL: '',
      BUG_REPORT_SLACK_WEBHOOK_URL: '',
    },
  },
});
