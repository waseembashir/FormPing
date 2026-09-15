import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest runs ONLY the engine's unit tests in `tests/`.
 *
 * Without this, Vitest's default glob also matches the web app's Playwright
 * specs (`ui/e2e/*.spec.ts`) and errors — those files use `@playwright/test`,
 * not Vitest. Playwright is scoped separately by `ui/playwright.config.ts`.
 *
 * The `@` alias mirrors `ui/tsconfig.json` so a test can import the web app's
 * modules directly instead of restating their logic. That matters for FR-87:
 * the bug was in how a store's failure was WIRED to its caller, so a test that
 * mirrored the constants would have passed while the app lost data. Playwright
 * cannot cover it either — the hermetic e2e environment has no database to
 * refuse a write.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./ui/src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
