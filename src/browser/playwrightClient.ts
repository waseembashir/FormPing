import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { AppConfig } from '../types.js';
import { logger } from '../utils/logger.js';

let sharedBrowser: Browser | null = null;

// One realistic User-Agent + matching client-hint values, kept in sync so the
// fingerprint is consistent across HTTP headers AND the JS-level navigator props.
const REAL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REAL_SEC_CH_UA = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
const REAL_SEC_CH_UA_MOBILE = '?0';
const REAL_SEC_CH_UA_PLATFORM = '"Windows"';

/** Default HTTP headers — added to every Playwright request and every
 * lightweight fetch. Mirrors what a real Chrome 124 on Windows sends. */
const REALISTIC_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Ch-Ua': REAL_SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': REAL_SEC_CH_UA_MOBILE,
  'Sec-Ch-Ua-Platform': REAL_SEC_CH_UA_PLATFORM,
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

/**
 * Stealth patches injected into every page BEFORE any site script runs.
 * Each one undoes a different headless-detection signal that WAFs commonly
 * check. None of these are bypass-CAPTCHA tricks — they just make the
 * automated browser look like a real Chrome instead of HeadlessChrome.
 */
function stealthInitScript(): string {
  return `
    (() => {
      // 1) navigator.webdriver: real browsers don't set it
      try {
        Object.defineProperty(Navigator.prototype, 'webdriver', {
          get: () => false,
          configurable: true,
        });
      } catch {}

      // 2) navigator.plugins: empty in headless, populated in real browsers
      try {
        const plugins = [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ];
        Object.defineProperty(navigator, 'plugins', {
          get: () => plugins,
          configurable: true,
        });
      } catch {}

      // 3) navigator.languages: should match the Accept-Language header
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
          configurable: true,
        });
      } catch {}

      // 4) navigator.permissions.query: headless returns 'denied' for everything;
      //    real Chrome returns 'prompt' for most permissions and matches
      //    Notification.permission for notifications.
      try {
        const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
        window.navigator.permissions.query = (parameters) => {
          if (parameters && parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission || 'default' });
          }
          return originalQuery(parameters);
        };
      } catch {}

      // 5) window.chrome: missing in headless, present in real Chrome
      try {
        if (!window.chrome) {
          Object.defineProperty(window, 'chrome', {
            value: { runtime: {}, app: { isInstalled: false }, csi: () => {}, loadTimes: () => ({}) },
            configurable: true,
            writable: true,
          });
        }
      } catch {}

      // 6) Hide HeadlessChrome from useragent metadata (the UA itself is already
      //    overridden at the context level; this catches stray usages).
      try {
        if (navigator.userAgent && navigator.userAgent.includes('HeadlessChrome')) {
          Object.defineProperty(navigator, 'userAgent', {
            get: () => '${REAL_USER_AGENT}',
            configurable: true,
          });
        }
      } catch {}

      // 7) WebGL renderer/vendor: headless reveals 'SwiftShader' or 'ANGLE
      //    (Google Inc., Vulkan)'; real GPUs return something like
      //    'ANGLE (NVIDIA, NVIDIA GeForce ...)'. Spoof to a common Windows value.
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          // UNMASKED_VENDOR_WEBGL
          if (parameter === 37445) return 'Google Inc. (Intel)';
          // UNMASKED_RENDERER_WEBGL
          if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return getParameter.call(this, parameter);
        };
      } catch {}

      // 8) navigator.platform: should match the UA platform string
      try {
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32',
          configurable: true,
        });
      } catch {}
    })();
  `;
}

export async function launchBrowser(config: AppConfig): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  logger.debug('Launching Playwright browser');
  sharedBrowser = await chromium.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      // Reduce more obvious automation hints
      '--disable-features=IsolateOrigins,site-per-process,AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
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
    userAgent: REAL_USER_AGENT,
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: REALISTIC_HEADERS,
  });

  context.setDefaultTimeout(config.timeout);
  context.setDefaultNavigationTimeout(config.navigationTimeout);

  // Inject the stealth patches into every page in this context, before any
  // site JS runs.
  await context.addInitScript(stealthInitScript());

  const page = await context.newPage();

  return { context, page };
}

export async function closePage(context: BrowserContext): Promise<void> {
  await context.close();
}

/** Lightweight fetch using node's built-in — no browser needed */
export async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': REAL_USER_AGENT,
        ...REALISTIC_HEADERS,
        // Bust intermediate caches so monitor sees fresh content (overrides the
        // empty Cache-Control above)
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
