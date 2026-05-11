/**
 * Discover URLs on a site by reading its sitemap(s).
 *
 * Tries these in order until one returns URLs:
 *   1. robots.txt → all `Sitemap:` directives
 *   2. /sitemap.xml
 *   3. /sitemap_index.xml
 *   4. /wp-sitemap.xml (WordPress default since 5.5)
 *   5. /sitemaps.xml
 *
 * Sitemap index files (which reference sub-sitemaps) are resolved one level
 * deep. We cap total URLs to keep snapshot/scoring cheap and avoid abuse.
 */

import { fetchHtml } from '../browser/playwrightClient.js';
import { isSameOrigin } from '../utils/url.js';
import { logger } from '../utils/logger.js';

const MAX_URLS = 500;
const MAX_CHILD_SITEMAPS = 8;

const FALLBACK_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/wp-sitemap.xml',
  '/sitemaps.xml',
];

/** Extract all <loc>...</loc> values from a sitemap XML body. Exported for tests. */
export function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1]?.trim();
    if (url) out.push(decodeXmlEntities(url));
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Look at /robots.txt for explicit Sitemap: directives. */
async function findSitemapsFromRobots(
  origin: string,
  timeoutMs: number,
): Promise<string[]> {
  const robots = await fetchHtml(`${origin}/robots.txt`, timeoutMs);
  if (!robots) return [];
  const out: string[] = [];
  const re = /^\s*Sitemap:\s*(\S+)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(robots)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Parse a single sitemap URL. Handles both regular sitemaps and sitemap-index files.
 * Sitemap-index is resolved one level deep (we don't recurse arbitrarily). */
async function fetchAndParseSitemap(
  url: string,
  timeoutMs: number,
  remainingBudget: number,
): Promise<string[]> {
  if (remainingBudget <= 0) return [];
  const xml = await fetchHtml(url, timeoutMs);
  if (!xml) return [];

  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  if (isIndex) {
    const children = extractLocs(xml).slice(0, MAX_CHILD_SITEMAPS);
    const collected: string[] = [];
    for (const childUrl of children) {
      if (collected.length >= remainingBudget) break;
      const childUrls = await fetchAndParseSitemap(
        childUrl,
        timeoutMs,
        remainingBudget - collected.length,
      );
      collected.push(...childUrls);
    }
    return collected;
  }

  return extractLocs(xml).slice(0, remainingBudget);
}

/**
 * Fetch and parse a site's sitemap(s), returning same-origin URLs.
 * Returns an empty array if no sitemap can be found — never throws.
 */
export async function fetchSitemapUrls(
  rootUrl: string,
  timeoutMs: number,
): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(rootUrl).origin;
  } catch {
    return [];
  }

  // 1) Try robots.txt first
  const robotsSitemaps = await findSitemapsFromRobots(origin, timeoutMs);

  // 2) Build the full candidate list — robots.txt entries first, then fallbacks
  const sitemapsToTry = [
    ...robotsSitemaps,
    ...FALLBACK_SITEMAP_PATHS.map((p) => `${origin}${p}`),
  ];

  // De-dupe (a site might list /sitemap.xml in robots.txt AND have it at the default path)
  const seen = new Set<string>();
  const unique = sitemapsToTry.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  const collected: string[] = [];
  for (const sitemapUrl of unique) {
    if (collected.length >= MAX_URLS) break;
    const urls = await fetchAndParseSitemap(
      sitemapUrl,
      timeoutMs,
      MAX_URLS - collected.length,
    );
    if (urls.length > 0) {
      // Only accept same-origin URLs (some sites' sitemaps include external links)
      const sameOrigin = urls.filter((u) => isSameOrigin(u, rootUrl));
      collected.push(...sameOrigin);
      logger.debug(`Sitemap ${sitemapUrl}: +${sameOrigin.length} URLs (raw ${urls.length})`);
      // First sitemap that returns useful URLs is usually enough
      break;
    }
  }

  // De-dupe by path+origin
  const finalSeen = new Set<string>();
  const final: string[] = [];
  for (const url of collected) {
    try {
      const u = new URL(url);
      const key = u.origin + u.pathname.replace(/\/$/, '');
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      final.push(url);
    } catch {
      /* skip malformed */
    }
  }

  return final.slice(0, MAX_URLS);
}
