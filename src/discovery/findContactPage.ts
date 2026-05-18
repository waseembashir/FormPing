import type { Browser, Page } from 'playwright';
import type { AppConfig, ContactCandidate } from '../types.js';
import { fetchHtml } from '../browser/playwrightClient.js';
import { loadHtml, extractLinks, extractTitle, extractHeading, extractText } from '../utils/dom.js';
import { normalizeUrl } from '../utils/url.js';
import { normalizeText, containsAny } from '../utils/text.js';
import { scoreContactLinks } from './scoreContactLinks.js';
import { fetchSitemapUrls } from './sitemap.js';
import { logger } from '../utils/logger.js';

const CONTACT_TITLE_PATTERNS = [/contact/i, /get\s+in\s+touch/i, /reach\s+us/i, /write\s+to\s+us/i];
const CONTACT_HEADING_PATTERNS = [/contact/i, /get\s+in\s+touch/i, /reach\s+us/i, /talk\s+to\s+us/i];
const ADDRESS_PATTERNS = [/\d+\s+\w+\s+(st|ave|rd|blvd|dr|lane|way|street|avenue)/i, /<address/i];
const PHONE_PATTERNS = [/(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/];

/** Score a page's HTML content as a contact page (0–1) */
function scorePageContent(html: string, url: string): { score: number; signals: string[] } {
  const $ = loadHtml(html);
  const signals: string[] = [];
  let raw = 0;

  const title = normalizeText(extractTitle($));
  const heading = normalizeText(extractHeading($));
  const bodyText = normalizeText(extractText($, 'body').slice(0, 4000));

  if (containsAny(title, CONTACT_TITLE_PATTERNS)) {
    raw += 20;
    signals.push('title contains contact term');
  }
  if (containsAny(heading, CONTACT_HEADING_PATTERNS)) {
    raw += 15;
    signals.push('heading contains contact term');
  }

  // Has a form
  const formCount = $('form').length;
  if (formCount > 0) {
    raw += 15;
    signals.push(`${formCount} form(s) present`);
  }

  // Form fields indicate contact form
  const hasNameField =
    $('input[name*="name" i], input[placeholder*="name" i], input[id*="name" i]').length > 0;
  const hasEmailField = $('input[type="email"], input[name*="email" i]').length > 0;
  const hasMessageField = $('textarea').length > 0;

  if (hasNameField) { raw += 10; signals.push('name field found'); }
  if (hasEmailField) { raw += 10; signals.push('email field found'); }
  if (hasMessageField) { raw += 10; signals.push('textarea/message field found'); }

  // Address or phone on page
  if (PHONE_PATTERNS.some((p) => p.test(bodyText))) {
    raw += 5;
    signals.push('phone number pattern found');
  }
  if (ADDRESS_PATTERNS.some((p) => p.test(html))) {
    raw += 5;
    signals.push('address pattern found');
  }
  if ($('[class*="map" i], #map, iframe[src*="google.com/maps"]').length > 0) {
    raw += 5;
    signals.push('map embed found');
  }

  // URL path bonus (already ranked but reinforce)
  if (/\/contact/i.test(url)) {
    raw += 10;
    signals.push('URL contains /contact');
  }

  const score = Math.min(raw / 100, 1);
  return { score, signals };
}

/** Verify top candidates using Playwright, return the best one */
async function verifyWithPlaywright(
  candidates: ContactCandidate[],
  browser: Browser,
  config: AppConfig,
): Promise<ContactCandidate | null> {
  // Only verify the top 3 to limit cost
  const toCheck = candidates.slice(0, 3);
  const results: ContactCandidate[] = [];

  for (const candidate of toCheck) {
    let page: Page | null = null;
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,
      });
      context.setDefaultNavigationTimeout(config.navigationTimeout);
      page = await context.newPage();

      await page.goto(candidate.url, { waitUntil: 'domcontentloaded' });
      const html = await page.content();
      const { score, signals } = scorePageContent(html, candidate.url);

      // Normalize link score: max raw link score is ~5 (path +3, text +2)
      const normalizedLinkScore = Math.min(Math.max(candidate.score / 5, 0), 1);
      results.push({
        ...candidate,
        pageScore: score,
        pageSignals: signals,
        totalScore: normalizedLinkScore * 0.4 + score * 0.6,
      });

      logger.debug(`  Verified ${candidate.url}: linkScore=${candidate.score} pageScore=${score.toFixed(2)}`);
      await context.close();
    } catch (err) {
      logger.debug(`  Failed to verify ${candidate.url}: ${err}`);
      if (page) {
        try { await page.context().close(); } catch { /* ignore */ }
      }
    }
  }

  if (results.length === 0) return null;
  results.sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
  return results[0] ?? null;
}

export interface FindContactPageResult {
  candidate: ContactCandidate | null;
  allCandidates: ContactCandidate[];
  usedAiFallback: boolean;
  /** Set when every attempt to load the homepage returned a tiny / stripped
   * response — the strong signature of a hosting-provider IP block. */
  blockedByHost?: boolean;
  /** Per-attempt diagnostics — used to populate notes/explanations. */
  diagnostic?: {
    lightweightBytes: number;
    playwrightBytes: number | null; // null = Playwright didn't run
    retryBytes: number | null;       // null = retry didn't run
  };
}

// Specific challenge-page text — NOT bare brand names like "cloudflare" or
// "sucuri", which appear in normal pages that use those CDNs.
const BLOCK_PAGE_MARKERS = /(?:access\s+denied|429\s+too\s+many|just\s+a\s+moment\.\.\.|please\s+enable\s+javascript\s+and\s+cookies|cloudflare\s+ray\s+id:|attention\s+required.*cloudflare|sucuri\s+website\s+firewall|hostinger.{0,30}protect|webserver\s+is\s+returning\s+an\s+unknown\s+error|verifying.{0,30}browser|checking\s+your\s+browser\s+before\s+accessing|sorry,\s+you\s+have\s+been\s+blocked)/i;

/** Returns true when the HTML looks like a hosting-provider error/block page
 * rather than a real site response. Combines three signals to avoid false
 * positives on legitimately small landing pages. */
function looksLikeBlockPage(html: string, linkCount: number): boolean {
  // Tiny body — almost always a 403/error response
  if (html.length < 2000) return true;
  // Medium body + zero navigation links — a stripped page or challenge
  if (html.length < 20000 && linkCount < 3) return true;
  // Explicit block-page text markers anywhere in the HTML
  if (BLOCK_PAGE_MARKERS.test(html)) return true;
  return false;
}

export async function findContactPage(
  inputUrl: string,
  browser: Browser,
  config: AppConfig,
): Promise<FindContactPageResult> {
  const normalized = normalizeUrl(inputUrl);
  logger.info(`Discovering contact page for ${normalized}`);

  // ── Step 1: lightweight fetch of homepage HTML ────────────────────────────
  // We try Cheerio + native fetch first because it's fast (~50ms vs ~3s for
  // Playwright). But cloud providers like Railway sometimes get treated as
  // bot traffic by Cloudflare / CDN-fronted sites, which return either an
  // empty body or a JS-challenge page with no real links. We handle both
  // cases by falling back to Playwright whenever the result looks bogus.
  async function loadHomepageWithPlaywright(reason: string): Promise<string | null> {
    logger.warn(`Falling back to Playwright for homepage (${reason})`);
    try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      ctx.setDefaultNavigationTimeout(config.navigationTimeout);
      const pg = await ctx.newPage();
      await pg.goto(normalized, { waitUntil: 'domcontentloaded' });
      // brief settle for JS-rendered navigation menus — bounded so slow resources don't block us
      await pg.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => { /* ignore */ });
      const html = await pg.content();
      await ctx.close();
      return html;
    } catch (err) {
      logger.error(`Playwright homepage fetch failed: ${err}`);
      return null;
    }
  }

  // Track each attempt so we can tell at the end if every attempt looked
  // like a hosting-provider block page (vs a site that genuinely has no
  // contact-like links). Helps us surface the right reason code to the UI.
  const attemptSizes = {
    lightweight: 0,
    playwright: null as number | null,
    retry: null as number | null,
  };
  const attemptBlocked = {
    lightweight: false,
    playwright: false,
    retry: false,
  };

  let html = await fetchHtml(normalized, config.timeout);
  let lightweightFailed = false;
  if (!html) {
    lightweightFailed = true;
    html = await loadHomepageWithPlaywright('lightweight fetch failed');
    if (!html) {
      // Both transport paths failed entirely (no response, timeout, or
      // connection drop). When a site responds normally to a residential IP
      // but gives zero response from two different cloud-IP transports, the
      // overwhelming explanation is an IP-level block from the hosting
      // provider (Hostinger, Bluehost, etc. silently hold or drop the
      // connection rather than returning a 403). Surface BLOCKED_BY_HOST so
      // the UI shows the actionable message instead of a generic failure.
      return {
        candidate: null,
        allCandidates: [],
        usedAiFallback: false,
        blockedByHost: true,
        diagnostic: {
          lightweightBytes: 0,
          playwrightBytes: 0,
          retryBytes: null,
        },
      };
    }
  }
  if (lightweightFailed) {
    logger.info('Lightweight fetch failed but Playwright recovered the homepage');
  }

  // Step 2: extract and rank links
  let $ = loadHtml(html);
  let rawLinks = extractLinks($);
  let candidates = scoreContactLinks(rawLinks, normalized, config);
  attemptSizes.lightweight = html.length;
  attemptBlocked.lightweight = looksLikeBlockPage(html, rawLinks.length);
  // Diagnostic — info level so it shows in production deploy logs
  const hasContactInHtml = /\/contact[\/"'\s]/i.test(html);
  logger.info(
    `Lightweight fetch: ${html.length}B, ${rawLinks.length} links, ${candidates.length} candidates, ` +
      `contact-substring-in-html=${hasContactInHtml}, looks-blocked=${attemptBlocked.lightweight}`,
  );

  // If we got zero candidates from a fetch that succeeded, the response is
  // suspicious. Try Playwright. If that also fails, wait 2.5s and try once
  // more — many cache/proxy issues are transient and the second hit lands
  // on a different cache edge or fully-warmed origin.
  if (candidates.length === 0) {
    const browserHtml = await loadHomepageWithPlaywright('zero candidates from lightweight fetch');
    if (browserHtml) {
      $ = loadHtml(browserHtml);
      rawLinks = extractLinks($);
      candidates = scoreContactLinks(rawLinks, normalized, config);
      attemptSizes.playwright = browserHtml.length;
      attemptBlocked.playwright = looksLikeBlockPage(browserHtml, rawLinks.length);
      const browserHasContact = /\/contact[\/"'\s]/i.test(browserHtml);
      logger.info(
        `Playwright retry: ${browserHtml.length}B, ${rawLinks.length} links, ${candidates.length} candidates, ` +
          `contact-substring-in-html=${browserHasContact}, looks-blocked=${attemptBlocked.playwright}`,
      );

      // If the HTML clearly contains a /contact link but our scoring still
      // came up empty, dump the first contact-looking anchor for debugging.
      if (candidates.length === 0 && browserHasContact) {
        const match = browserHtml.match(/<a[^>]+href=["']([^"']*\/contact[^"']*)["'][^>]*>([^<]{0,80})/i);
        if (match) {
          logger.warn(
            `Found contact-like anchor in HTML but scoring rejected it: ` +
              `href="${match[1]!.slice(0, 100)}" text="${(match[2] ?? '').trim().slice(0, 60)}"`,
          );
        }
      }
    }

    // Second-chance: maybe the first hit got an unwarmed cache / stale CDN
    // edge. Sleep and try once more — empirically helps with LiteSpeed Cache
    // and similar.
    if (candidates.length === 0) {
      logger.warn('Still 0 candidates — sleeping 2.5s and retrying once more');
      await new Promise((r) => setTimeout(r, 2500));
      const retryHtml = await loadHomepageWithPlaywright('second-chance retry after 2.5s sleep');
      if (retryHtml) {
        $ = loadHtml(retryHtml);
        rawLinks = extractLinks($);
        candidates = scoreContactLinks(rawLinks, normalized, config);
        attemptSizes.retry = retryHtml.length;
        attemptBlocked.retry = looksLikeBlockPage(retryHtml, rawLinks.length);
        logger.info(
          `Second-chance retry: ${retryHtml.length}B, ${rawLinks.length} links, ${candidates.length} candidates, ` +
            `looks-blocked=${attemptBlocked.retry}`,
        );
      }
    }
  }

  // ── Sitemap augmentation ───────────────────────────────────────────────
  // Independent of homepage links: a site's contact page is often listed in
  // sitemap.xml even when it's not prominently linked from the homepage
  // (or when CDN serves us a stripped homepage). We always try sitemap and
  // merge those URLs into the candidate pool; scoring de-duplicates by path.
  const sitemapUrls = await fetchSitemapUrls(normalized, config.timeout);
  if (sitemapUrls.length > 0) {
    const sitemapAsLinks = sitemapUrls.map((href) => ({ href, text: '' }));
    const sitemapCandidates = scoreContactLinks(sitemapAsLinks, normalized, config);
    if (sitemapCandidates.length > 0) {
      // Merge — scoreContactLinks already de-dupes by origin+path
      const merged = scoreContactLinks(
        [...rawLinks, ...sitemapAsLinks],
        normalized,
        config,
      );
      logger.info(
        `Sitemap: ${sitemapUrls.length} URLs → ${sitemapCandidates.length} contact-pattern matches, ` +
          `merged total: ${merged.length} candidates`,
      );
      candidates = merged;
    } else {
      logger.info(`Sitemap: ${sitemapUrls.length} URLs but none matched contact patterns`);
    }
  }

  // ── AI rescue ──────────────────────────────────────────────────────────
  // Deterministic + sitemap both came up empty, but we DID get real content
  // (not a block page). Ask AI to look at all the links we collected and
  // decide if any of them is a contact page in disguise. Skipped entirely
  // when AI is off, when we look blocked, or when there are no links to ask
  // about.
  let usedAiFallback = false;
  if (candidates.length === 0 && config.aiProvider !== 'off') {
    const ranAttempts = [
      attemptBlocked.lightweight,
      attemptSizes.playwright !== null ? attemptBlocked.playwright : null,
      attemptSizes.retry !== null ? attemptBlocked.retry : null,
    ].filter((v): v is boolean => v !== null);
    const allBlocked = ranAttempts.length > 0 && ranAttempts.every((b) => b);

    if (!allBlocked && (rawLinks.length > 0 || sitemapUrls.length > 0)) {
      // Combine homepage links (have anchor text) + sitemap URLs (no text)
      const sitemapAsLinks = sitemapUrls.map((href) => ({ href, text: '' }));
      const allLinks = [...rawLinks, ...sitemapAsLinks];
      const { rescueContactPage } = await import('../ai/aiClassifier.js');
      const rescue = await rescueContactPage(allLinks, normalized, config.aiProvider);
      if (rescue) {
        usedAiFallback = true;
        candidates = [
          {
            url: rescue.chosenUrl,
            score: 1, // low-confidence — flag it as AI rescue
            signals: [`AI rescue (${rescue.provider}): ${rescue.reasoning}`],
            pageScore: 0.6,
            totalScore: 0.6,
          },
        ];
        logger.info(`AI rescue produced candidate: ${rescue.chosenUrl}`);
      }
    }
  }

  if (candidates.length === 0) {
    // Decide: was this "site has no contact page" or "hosting blocked us"?
    // If every attempt that ran looked like a block page → it's the host.
    const ranAttempts = [
      attemptBlocked.lightweight,
      attemptSizes.playwright !== null ? attemptBlocked.playwright : null,
      attemptSizes.retry !== null ? attemptBlocked.retry : null,
    ].filter((v): v is boolean => v !== null);
    const allBlocked = ranAttempts.length > 0 && ranAttempts.every((b) => b);
    const diagnostic = {
      lightweightBytes: attemptSizes.lightweight,
      playwrightBytes: attemptSizes.playwright,
      retryBytes: attemptSizes.retry,
    };
    return {
      candidate: null,
      allCandidates: [],
      usedAiFallback,
      ...(allBlocked ? { blockedByHost: true } : {}),
      diagnostic,
    };
  }

  // If top candidate has a very high link score and /contact in path, skip browser verification
  const top = candidates[0]!;
  if (top.score >= 5 && /\/contact/i.test(top.url) && candidates.length === 1) {
    logger.debug(`High-confidence candidate from link scoring: ${top.url}`);
    return { candidate: { ...top, pageScore: 0.9, totalScore: 0.9 }, allCandidates: candidates, usedAiFallback };
  }

  // Step 3: Playwright verification for top candidates
  const verified = await verifyWithPlaywright(candidates, browser, config);

  // Step 4: AI disambiguation if Playwright verification failed and AI is enabled
  // (different from the AI rescue earlier — this disambiguates between candidates,
  // doesn't generate them)
  if (!verified && config.aiProvider !== 'off') {
    const { pickContactPage } = await import('../ai/aiClassifier.js');
    const choice = await pickContactPage(candidates.slice(0, 5), normalized, config.aiProvider);
    if (choice) {
      usedAiFallback = true;
      const picked = candidates.find((c) => c.url === choice.chosenUrl);
      if (picked) {
        logger.info(`AI (${choice.provider}) picked ${choice.chosenUrl}: ${choice.reasoning}`);
        return {
          candidate: { ...picked, pageScore: 0.7, totalScore: 0.7 },
          allCandidates: candidates,
          usedAiFallback,
        };
      }
    }
  }

  return { candidate: verified, allCandidates: candidates, usedAiFallback };
}
