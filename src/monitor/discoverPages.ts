import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import { fetchHtml } from '../browser/playwrightClient.js';
import { loadHtml, extractLinks } from '../utils/dom.js';
import { resolveHref, isSameOrigin, normalizeUrl, urlPath } from '../utils/url.js';
import { findContactPage } from '../discovery/findContactPage.js';
import { fetchSitemapUrls } from '../discovery/sitemap.js';
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

  /** Try to classify a URL against PAGE_PATTERNS, add it to `found` if it matches. */
  function classifyAndAdd(rawUrl: string): boolean {
    if (found.size >= maxPages) return false;
    const resolved = resolveHref(homepage, rawUrl);
    if (!resolved || !isSameOrigin(resolved, homepage)) return false;
    const path = urlPath(resolved);
    if (EXCLUDE.some((p) => p.test(path))) return false;

    // Dedupe by origin + path (strip trailing slash)
    let key: string;
    try {
      const u = new URL(resolved);
      key = u.origin + u.pathname.replace(/\/$/, '') || u.origin + '/';
    } catch {
      key = resolved;
    }
    if (found.has(key)) return false;

    for (const { name, patterns } of PAGE_PATTERNS) {
      if (patterns.some((p) => p.test(path))) {
        found.set(key, name);
        return true;
      }
    }
    return false;
  }

  const $ = loadHtml(html);
  const rawLinks = extractLinks($);
  let fromHomepage = 0;
  for (const { href } of rawLinks) {
    if (classifyAndAdd(href)) fromHomepage++;
    if (found.size >= maxPages) break;
  }
  logger.debug(`Homepage links: ${fromHomepage} important pages identified`);

  // Sitemap source: lots of sites don't link to every section from the
  // homepage (or our homepage fetch got a stripped version). Sitemap fills
  // in the gaps and is essentially free.
  if (found.size < maxPages) {
    const sitemapUrls = await fetchSitemapUrls(homepage, config.timeout);
    let fromSitemap = 0;
    for (const url of sitemapUrls) {
      if (classifyAndAdd(url)) fromSitemap++;
      if (found.size >= maxPages) break;
    }
    if (sitemapUrls.length > 0) {
      logger.info(`Sitemap: ${sitemapUrls.length} URLs → +${fromSitemap} important pages`);
    }
  }

  // If we still didn't find a contact page, fall back to the dedicated detector
  // (it has its own AI-rescue + sitemap logic for the harder cases)
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
