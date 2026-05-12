import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { AppConfig } from '../types.js';
import { logger } from '../utils/logger.js';

let sharedBrowser: Browser | null = null;

export async function launchBrowser(config: AppConfig): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  logger.debug('Launching Playwright browser');
  sharedBrowser = await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
    logger.debug('Browser closed');
  }
}

export async function newPage(browser: Browser, config: AppConfig): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });

  context.setDefaultTimeout(config.timeout);
  context.setDefaultNavigationTimeout(config.navigationTimeout);

  const page = await context.newPage();

  // Remove webdriver flag so automation is less detectable (still ethical — we're not bypassing CAPTCHAs)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return { context, page };
}

export async function closePage(context: BrowserContext): Promise<void> {
  await context.close();
}

/**
 * Connect to a Browserbase-hosted Chrome instance routed through a residential
 * IP. Used as a fallback when a site blocks our cloud IP (BLOCKED_BY_HOST).
 *
 * Caller MUST close the returned browser when done — Browserbase bills per
 * session-second, so leaking a session is real money.
 *
 * Requires env vars: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
 */
export async function connectResidentialBrowser(): Promise<Browser> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error(
      'BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set to use residential fallback',
    );
  }

  logger.info('Creating Browserbase session (residential IP)');
  const sessionResp = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BB-API-Key': apiKey,
    },
    body: JSON.stringify({
      projectId,
      // `proxies: true` enables Browserbase's built-in residential proxy pool.
      // Without this we'd be on their datacenter IPs — same problem we have on
      // Railway, just shifted to a different cloud.
      proxies: true,
    }),
  });

  if (!sessionResp.ok) {
    const text = await sessionResp.text().catch(() => '');
    throw new Error(`Browserbase session create failed: ${sessionResp.status} ${text}`);
  }

  const session = (await sessionResp.json()) as { id: string; connectUrl: string };
  logger.info(`Browserbase session ${session.id} created — connecting via CDP`);
  const browser = await chromium.connectOverCDP(session.connectUrl);
  return browser;
}

/** Returns true when both Browserbase env vars are present. */
export function hasBrowserbaseCreds(): boolean {
  return Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

/** Lightweight fetch using node's built-in — no browser needed */
export async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        // Bust intermediate caches so monitor sees fresh content
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
