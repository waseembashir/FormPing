import type { Browser, Page } from 'playwright';
import type { AppConfig, ContactCandidate } from '../types.js';
import { fetchHtml } from '../browser/playwrightClient.js';
import { loadHtml, extractLinks, extractTitle, extractHeading, extractText } from '../utils/dom.js';
import { normalizeUrl } from '../utils/url.js';
import { normalizeText, containsAny } from '../utils/text.js';
import { scoreContactLinks } from './scoreContactLinks.js';
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
}

export async function findContactPage(
  inputUrl: string,
  browser: Browser,
  config: AppConfig,
): Promise<FindContactPageResult> {
  const normalized = normalizeUrl(inputUrl);
  logger.info(`Discovering contact page for ${normalized}`);

  // Step 1: lightweight fetch of homepage HTML
  let html = await fetchHtml(normalized, config.timeout);
  if (!html) {
    logger.warn('Lightweight fetch failed, falling back to Playwright for homepage');
    try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      ctx.setDefaultNavigationTimeout(config.navigationTimeout);
      const pg = await ctx.newPage();
      await pg.goto(normalized, { waitUntil: 'domcontentloaded' });
      html = await pg.content();
      await ctx.close();
    } catch (err) {
      logger.error(`Could not load homepage: ${err}`);
      return { candidate: null, allCandidates: [], usedAiFallback: false };
    }
  }

  // Step 2: extract and rank links
  const $ = loadHtml(html);
  const rawLinks = extractLinks($);
  logger.debug(`Found ${rawLinks.length} links on homepage`);

  const candidates = scoreContactLinks(rawLinks, normalized, config);
  logger.debug(`Ranked ${candidates.length} contact candidates`);

  if (candidates.length === 0) {
    return { candidate: null, allCandidates: [], usedAiFallback: false };
  }

  // If top candidate has a very high link score and /contact in path, skip browser verification
  const top = candidates[0]!;
  if (top.score >= 5 && /\/contact/i.test(top.url) && candidates.length === 1) {
    logger.debug(`High-confidence candidate from link scoring: ${top.url}`);
    return { candidate: { ...top, pageScore: 0.9, totalScore: 0.9 }, allCandidates: candidates, usedAiFallback: false };
  }

  // Step 3: Playwright verification for top candidates
  const verified = await verifyWithPlaywright(candidates, browser, config);

  // Step 4: AI fallback if confidence is ambiguous
  let usedAiFallback = false;
  if (!verified && config.aiEnabled) {
    // aiClassifier would be called here — see src/ai/aiClassifier.ts
    usedAiFallback = true;
  }

  return { candidate: verified, allCandidates: candidates, usedAiFallback };
}
