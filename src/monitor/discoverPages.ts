import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import { fetchHtml } from '../browser/playwrightClient.js';
import { loadHtml, extractLinks } from '../utils/dom.js';
import { resolveHref, isSameOrigin, normalizeUrl, urlPath } from '../utils/url.js';
import { findContactPage } from '../discovery/findContactPage.js';
import { logger } from '../utils/logger.js';

const PAGE_PATTERNS: { name: string; patterns: RegExp[] }[] = [
  { name: 'about',    patterns: [/\/about(-us)?(\/|$|\?)/i, /\/company(\/|$|\?)/i, /\/our-(team|story)(\/|$|\?)/i, /\/who-we-are(\/|$|\?)/i] },
  { name: 'pricing',  patterns: [/\/pricing(\/|$|\?)/i, /\/plans(\/|$|\?)/i, /\/cost(\/|$|\?)/i, /\/price(\/|$|\?)/i] },
  { name: 'services', patterns: [/\/services(\/|$|\?)/i, /\/solutions(\/|$|\?)/i, /\/features(\/|$|\?)/i, /\/products(\/|$|\?)/i, /\/what-we-do(\/|$|\?)/i] },
  { name: 'contact',  patterns: [/\/contact(-us)?(\/|$|\?)/i, /\/get-in-touch(\/|$|\?)/i] },
  { name: 'thank-you',patterns: [/\/thank-you(\/|$|\?)/i, /\/thanks(\/|$|\?)/i, /\/success(\/|$|\?)/i] },
];

const EXCLUDE = [/\/login/i, /\/signup/i, /\/cart/i, /\/checkout/i, /\/account/i, /\/blog\//i, /\/news\//i, /\/article\//i, /\/post\//i, /\/wp-/i];

/**
 * Find a small set of important pages on a site to monitor.
 * Always returns the homepage; adds about / pricing / services / contact / thank-you when found.
 */
export async function discoverImportantPages(
  rootUrl: string,
  browser: Browser,
  config: AppConfig,
  maxPages: number,
): Promise<string[]> {
  const homepage = normalizeUrl(rootUrl);
  const found = new Map<string, string>(); // url -> category
  found.set(homepage, 'homepage');

  // Lightweight homepage fetch
  const html = await fetchHtml(homepage, config.timeout);
  if (!html) {
    logger.warn(`discoverPages: could not fetch homepage HTML for ${homepage}`);
    return [...found.keys()];
  }

  const $ = loadHtml(html);
  const rawLinks = extractLinks($);

  for (const { href } of rawLinks) {
    const resolved = resolveHref(homepage, href);
    if (!resolved || !isSameOrigin(resolved, homepage)) continue;

    const path = urlPath(resolved);
    if (EXCLUDE.some((p) => p.test(path))) continue;

    // Dedupe by path-only key
    let key: string;
    try {
      const u = new URL(resolved);
      key = u.origin + u.pathname.replace(/\/$/, '') || u.origin + '/';
    } catch {
      key = resolved;
    }
    if (found.has(key)) continue;

    for (const { name, patterns } of PAGE_PATTERNS) {
      if (patterns.some((p) => p.test(path))) {
        found.set(key, name);
        break;
      }
    }
    if (found.size >= maxPages) break;
  }

  // If we didn't find a contact page via patterns, fall back to the existing detector
  const hasContact = [...found.values()].includes('contact');
  if (!hasContact && found.size < maxPages) {
    try {
      const { candidate } = await findContactPage(homepage, browser, config);
      if (candidate) {
        const key = candidate.url.replace(/\/$/, '');
        if (!found.has(key)) found.set(key, 'contact');
      }
    } catch (err) {
      logger.debug(`Contact-page fallback failed: ${err}`);
    }
  }

  const urls = [...found.keys()];
  logger.info(`Discovered ${urls.length} page(s) to monitor`);
  return urls;
}
