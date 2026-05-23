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
  // QA bypass header — when APEXURE_QA_TOKEN is set, attach it to every
  // request. WordPress sites running the matching mu-plugin recognize this
  // header and skip anti-spam checks. Lets us test contact forms on our
  // own dev sites without disabling spam protection for real visitors.
  // Header is omitted entirely when env var is not set — no leak risk on
  // sites without the matching code.
  const extraHTTPHeaders: Record<string, string> = {};
  if (process.env.APEXURE_QA_TOKEN) {
    extraHTTPHeaders['X-Apexure-QA'] = process.env.APEXURE_QA_TOKEN;
  }

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    ...(Object.keys(extraHTTPHeaders).length > 0 ? { extraHTTPHeaders } : {}),
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

/**
 * Launch a fresh Chromium that routes all traffic through a residential
 * (or datacenter) proxy. Caller MUST close it when done — this is NOT the
 * shared singleton.
 *
 * Env vars:
 *   RESIDENTIAL_PROXY_URL   — required, e.g. "http://p.webshare.io:80"
 *                             (bare "host:port" is accepted and prefixed)
 *   RESIDENTIAL_PROXY_USER  — optional (HTTP Basic auth username)
 *   RESIDENTIAL_PROXY_PASS  — optional (HTTP Basic auth password)
 *
 * Works with any HTTP(S) or SOCKS proxy — tested with Webshare, IPRoyal,
 * Smartproxy, Bright Data's gateway endpoints.
 */
export async function launchProxiedBrowser(config: AppConfig): Promise<Browser> {
  const rawServer = process.env.RESIDENTIAL_PROXY_URL;
  if (!rawServer) {
    throw new Error('RESIDENTIAL_PROXY_URL must be set to use the residential proxy fallback');
  }
  // Accept "p.webshare.io:80" or "http://p.webshare.io:80" or "socks5://..."
  const server = /^(https?|socks[45]?):\/\//i.test(rawServer)
    ? rawServer
    : `http://${rawServer}`;

  const username = process.env.RESIDENTIAL_PROXY_USER;
  const password = process.env.RESIDENTIAL_PROXY_PASS;

  logger.info(`Launching proxied browser via ${server} (auth=${username ? 'yes' : 'no'})`);
  return await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    proxy: {
      server,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    },
  });
}

/** Returns true when the direct-proxy env var is set. */
export function hasResidentialProxyCreds(): boolean {
  return Boolean(process.env.RESIDENTIAL_PROXY_URL);
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
