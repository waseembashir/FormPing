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

// Paths we deliberately exclude — auth flows, ecommerce checkout state, and
// content-archive zones (blog posts, news articles) where each page is
// short-lived and the diff signal would be dominated by noise.
const EXCLUDE = [/\/login/i, /\/signup/i, /\/cart/i, /\/checkout/i, /\/account/i, /\/blog\//i, /\/news\//i, /\/article\//i, /\/post\//i, /\/wp-/i];

// File extensions we never want to "monitor" — assets, downloads, feeds.
const EXCLUDED_EXTENSIONS = /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|json|xml|pdf|zip|gz|mp4|mp3|wav|woff2?|ttf|otf|eot)(\?|#|$)/i;

/** Build the dedupe key for a resolved URL (origin + path, no trailing slash). */
function dedupeKey(resolved: string): string {
  try {
    const u = new URL(resolved);
    const pathPart = u.pathname.replace(/\/$/, '');
    return u.origin + (pathPart || '/');
  } catch {
    return resolved;
  }
}

/**
 * Discover pages on a site to monitor.
 *
 * Strategy is two-tiered so the limited maxPages budget is spent well:
 *   1. PRIORITY pass — match known patterns (about, pricing, services,
 *      contact, thank-you). These are high-signal pages that almost
 *      certainly matter on any marketing/SaaS site.
 *   2. FILL pass — same-origin internal pages that don't match a known
 *      pattern but aren't on the exclude list. Lets us monitor whatever
 *      remains in the budget (custom pages: /demo, /case-studies, /docs,
 *      etc.) instead of stopping at the priority hits.
 *
 * Source mix: links extracted from the homepage HTML + the sitemap.xml.
 * Sitemap covers pages the homepage doesn't link to (deep navigation,
 * footer-only links, etc.) so the union is much more complete.
 *
 * The homepage is always included as the first entry. The contact-page
 * detector (with its own AI rescue) is the last-resort fallback only when
 * none of the above turned up a contact match.
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

  /** Resolve, validate, dedupe — common prelude to both passes. */
  function prepare(rawUrl: string): { resolved: string; key: string; path: string } | null {
    if (found.size >= maxPages) return null;
    const resolved = resolveHref(homepage, rawUrl);
    if (!resolved || !isSameOrigin(resolved, homepage)) return null;
    const path = urlPath(resolved);
    if (EXCLUDE.some((p) => p.test(path))) return null;
    if (EXCLUDED_EXTENSIONS.test(path)) return null;
    const key = dedupeKey(resolved);
    if (found.has(key)) return null;
    return { resolved, key, path };
  }

  /** Priority pass: only add if the URL matches a known important-page pattern. */
  function classifyAndAdd(rawUrl: string): boolean {
    const prepared = prepare(rawUrl);
    if (!prepared) return false;
    for (const { name, patterns } of PAGE_PATTERNS) {
      if (patterns.some((p) => p.test(prepared.path))) {
        found.set(prepared.key, name);
        return true;
      }
    }
    return false;
  }

  /** Fill pass: add any same-origin non-excluded URL, regardless of pattern. */
  function addGeneric(rawUrl: string): boolean {
    const prepared = prepare(rawUrl);
    if (!prepared) return false;
    found.set(prepared.key, 'other');
    return true;
  }

  // ── Source 1: homepage HTML links ────────────────────────────────────────
  const $ = loadHtml(html);
  const rawLinks = extractLinks($);

  // ── Source 2: sitemap.xml ────────────────────────────────────────────────
  // Fetched up-front so both the priority and fill passes can use it
  // without an extra round-trip. fetchSitemapUrls returns [] on failure.
  const sitemapUrls = await fetchSitemapUrls(homepage, config.timeout);

  // ── Priority pass (homepage links → sitemap URLs) ────────────────────────
  let fromHomepagePriority = 0;
  for (const { href } of rawLinks) {
    if (classifyAndAdd(href)) fromHomepagePriority++;
    if (found.size >= maxPages) break;
  }
  logger.debug(`Homepage links: ${fromHomepagePriority} important page(s) identified`);

  let fromSitemapPriority = 0;
  if (found.size < maxPages) {
    for (const url of sitemapUrls) {
      if (classifyAndAdd(url)) fromSitemapPriority++;
      if (found.size >= maxPages) break;
    }
  }
  if (sitemapUrls.length > 0) {
    logger.info(
      `Sitemap: ${sitemapUrls.length} URL(s) → +${fromSitemapPriority} important page(s)`,
    );
  }

  // ── Contact-page fallback ────────────────────────────────────────────────
  // Run before generic fill so we don't burn slots on random pages while
  // missing the contact page (it's almost always worth monitoring).
  const hasContact = [...found.values()].includes('contact');
  if (!hasContact && found.size < maxPages) {
    try {
      const { candidate } = await findContactPage(homepage, browser, config);
      if (candidate) {
        const key = dedupeKey(candidate.url);
        if (!found.has(key)) found.set(key, 'contact');
      }
    } catch (err) {
      logger.debug(`Contact-page fallback failed: ${err}`);
    }
  }

  // ── Fill pass (any other internal pages until we hit maxPages) ───────────
  let fromHomepageFill = 0;
  if (found.size < maxPages) {
    for (const { href } of rawLinks) {
      if (addGeneric(href)) fromHomepageFill++;
      if (found.size >= maxPages) break;
    }
  }

  let fromSitemapFill = 0;
  if (found.size < maxPages) {
    for (const url of sitemapUrls) {
      if (addGeneric(url)) fromSitemapFill++;
      if (found.size >= maxPages) break;
    }
  }

  if (fromHomepageFill > 0 || fromSitemapFill > 0) {
    logger.info(
      `Generic fill: +${fromHomepageFill} from homepage links, +${fromSitemapFill} from sitemap`,
    );
  }

  const urls = [...found.keys()];
  logger.info(
    `Discovered ${urls.length} page(s) to monitor (cap ${maxPages})` +
      (urls.length < maxPages ? ' — site has fewer eligible pages than the cap' : ''),
  );
  return urls;
}
