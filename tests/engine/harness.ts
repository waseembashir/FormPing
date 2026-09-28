/**
 * Run the real engine against saved pages. FR-99.
 *
 * The engine's detection and filling code was written off as untestable because
 * it needs a live Playwright `Page`. It doesn't need a live SITE. Playwright
 * loads saved markup with `page.setContent()`, so `findContactForm`, `fillForm`
 * and the rest run against fixed HTML — offline, deterministic, no client site
 * touched, no network, nothing to rate-limit or go down.
 *
 * One browser is launched per test file and shared, because launching Chromium
 * is the expensive part; each test gets its own page.
 *
 * Fixtures are trimmed to the markup that matters (see the comment at the top of
 * each one). A fixture is a statement about a SHAPE of page — "a site whose only
 * visible form is a newsletter, with a login modal hidden behind it" — and the
 * test says what the engine should conclude about that shape.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { AppConfig } from '../../src/types.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

let browser: Browser | null = null;

/** Launch once per test file. Call in `beforeAll`. */
export async function startBrowser(): Promise<void> {
  browser ??= await chromium.launch({ headless: true });
}

/** Call in `afterAll`. */
export async function stopBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/**
 * Open a fixture as a real page.
 *
 * `setContent` is used rather than a file:// navigation so the page has no
 * origin of its own — nothing in a fixture can reach the network even by
 * accident, and a test cannot come to depend on a real host.
 */
export async function openFixture(name: string): Promise<Page> {
  if (!browser) throw new Error('startBrowser() must run before openFixture()');
  const html = readFileSync(join(FIXTURES, name), 'utf8');
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return page;
}

/**
 * The engine's real defaults, overridable per test.
 *
 * Built from DEFAULT_CONFIG rather than hand-rolled, so a test runs against the
 * same configuration production does — including `testData`, without which the
 * filler throws on every text field and a test can look like a detection
 * failure when nothing is wrong with detection at all.
 *
 * AI stays off: these tests must be deterministic and must not call out.
 */
export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, headless: true, aiProvider: 'off', ...over };
}
