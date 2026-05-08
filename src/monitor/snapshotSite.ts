import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import type {
  PageSnapshot,
  SiteSnapshot,
  MonitorOptions,
  FormFieldSnapshot,
  TextBlocks,
  HeadingTag,
  TextLocation,
} from './types.js';
import { fetchHtml, newPage, closePage } from '../browser/playwrightClient.js';
import { loadHtml } from '../utils/dom.js';
import { normalizeUrl } from '../utils/url.js';
import { discoverImportantPages } from './discoverPages.js';
import { logger } from '../utils/logger.js';
import { writeFile, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';

function timestampForFile(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function safeFilename(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\//g, '_').replace(/^_/, '') || 'home';
    return p.slice(0, 60);
  } catch {
    return 'page';
  }
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Get direct text content of an element (text nodes only, not children). */
function directText(el: { children?: { type?: string; data?: string }[] }): string {
  let text = '';
  for (const child of el.children ?? []) {
    if (child.type === 'text' && child.data) text += child.data;
  }
  return text.replace(/\s+/g, ' ').trim();
}

const SECTION_TAGS = new Set(['main', 'article', 'section', 'aside', 'header', 'footer', 'nav']);
const SEMANTIC_CLASS_RE = /(hero|features?|pricing|about|contact|cta|testimonial|services?|faq|footer|header|banner|story|team)/i;

/** Resolve a human-readable name for the closest meaningful ancestor of `el`.
 * Tries: aria-label → id → semantic class → parent tag. */
function getSectionName(
  $: ReturnType<typeof loadHtml>,
  el: unknown,
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = $(el as any).parent();
  while (current.length > 0) {
    const node = current[0] as { name?: string } | undefined;
    const tag = node?.name;
    if (!tag || tag === 'body' || tag === 'html') break;

    if (SECTION_TAGS.has(tag)) {
      const ariaLabel = current.attr('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const id = current.attr('id')?.trim();
      // Skip generated/short ids like "n-2" or "x"
      if (id && id.length > 1 && !/^[a-z]+-?\d+$/i.test(id)) return id;
      const cls = current.attr('class') ?? '';
      const match = cls.match(SEMANTIC_CLASS_RE);
      if (match) return (match[1] as string).toLowerCase();
      return tag;
    }
    current = current.parent();
  }
  return '';
}

/** Build a short CSS-ish selector for `el`, capped to 4 levels. */
function getShortSelector(
  $: ReturnType<typeof loadHtml>,
  el: unknown,
): string {
  const parts: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = $(el as any);
  let depth = 0;
  while (current.length > 0 && depth < 4) {
    const node = current[0] as { name?: string } | undefined;
    const tag = node?.name;
    if (!tag || tag === 'body' || tag === 'html') break;

    let segment = tag;
    const id = current.attr('id')?.trim();
    if (id && id.length > 1 && !/^[a-z]+-?\d+$/i.test(id)) {
      segment = `${tag}#${id}`;
      parts.unshift(segment);
      break; // id is unique enough on its own
    }
    parts.unshift(segment);
    current = current.parent();
    depth++;
  }
  return parts.join(' > ');
}

/** Extract structured visible text blocks (with location context) for granular diffing. */
function extractTextBlocks($: ReturnType<typeof loadHtml>): TextBlocks {
  // Strip noise — script/style content shouldn't pollute text diffs.
  // (We intentionally do NOT strip nav/footer/header here — extraction below
  // uses .closest() to skip those, and getSectionName needs to see them.)
  $('script, style, noscript').remove();

  const locations: Record<string, TextLocation> = {};
  const recordLocation = (text: string, loc: TextLocation) => {
    if (!locations[text]) locations[text] = loc;
  };

  // First pass: walk in document order to track the running heading.
  // We attach the most recent h1/h2/h3 to each subsequent text block.
  let lastHeading = '';

  // ── Headings (h1–h6) ──
  const headings: { tag: HeadingTag; text: string }[] = [];

  // ── Paragraphs ──
  const paragraphs: string[] = [];

  // ── List items ──
  const listItems: string[] = [];

  // ── "Other" — direct text inside divs/spans/sections etc.
  const otherSeen = new Set<string>();
  const other: string[] = [];

  // Single document-order walk so lastHeading stays in sync with positions.
  $('h1, h2, h3, h4, h5, h6, p, li, div, span, section, article, aside, blockquote, td, th, dt, dd, label, summary, figcaption').each(
    (_, el) => {
      const node = el as {
        name?: string;
        attribs?: Record<string, string>;
        children?: { type?: string; data?: string }[];
      };
      const tag = node.name?.toLowerCase();
      if (!tag) return;

      // Headings
      if (/^h[1-6]$/.test(tag)) {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!text || text.length > 200) return;
        // Skip headings inside nav/footer/header chrome
        if ($(el).closest('nav, footer, header').length > 0) return;
        headings.push({ tag: tag as HeadingTag, text });
        // Track last meaningful heading (only h1/h2/h3) for context propagation
        if (['h1', 'h2', 'h3'].includes(tag)) lastHeading = text;
        recordLocation(text, {
          tag,
          section: getSectionName($, node),
          selector: getShortSelector($, node),
          // a heading is its own context; no parent heading
        });
        return;
      }

      // Paragraphs
      if (tag === 'p') {
        if ($(el).closest('nav, footer, header').length > 0) return;
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!text || text.length < 15) return;
        const truncated = text.slice(0, 300);
        paragraphs.push(truncated);
        recordLocation(truncated, {
          tag: 'p',
          section: getSectionName($, node),
          heading: lastHeading,
          selector: getShortSelector($, node),
        });
        return;
      }

      // List items
      if (tag === 'li') {
        if ($(el).closest('nav, footer, header').length > 0) return;
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!text || text.length < 4 || text.length > 200) return;
        listItems.push(text);
        recordLocation(text, {
          tag: 'li',
          section: getSectionName($, node),
          heading: lastHeading,
          selector: getShortSelector($, node),
        });
        return;
      }

      // "Other" — direct text inside misc containers
      if ($(el).closest('nav, footer, header').length > 0) return;
      const text = directText(node);
      if (text.length < 15 || text.length > 500) return;
      if (otherSeen.has(text)) return;
      otherSeen.add(text);
      other.push(text);
      recordLocation(text, {
        tag,
        section: getSectionName($, node),
        heading: lastHeading,
        selector: getShortSelector($, node),
      });
    },
  );

  // Avoid double-counting "other" text that's already in another bucket
  const seenInOtherBuckets = new Set<string>([
    ...headings.map((h) => h.text),
    ...paragraphs,
    ...listItems,
  ]);
  const otherFiltered = other.filter((t) => !seenInOtherBuckets.has(t));

  return {
    headings: headings.slice(0, 50),
    paragraphs: dedupeStrings(paragraphs).slice(0, 80),
    listItems: dedupeStrings(listItems).slice(0, 80),
    other: otherFiltered.slice(0, 150),
    locations,
  };
}

const EMPTY_TEXT_BLOCKS: TextBlocks = { headings: [], paragraphs: [], listItems: [], other: [], locations: {} };

/** Parse already-fetched HTML into a PageSnapshot. */
function parseHtmlToSnapshot(
  url: string,
  html: string,
  loadTime: number,
  fetchedVia: 'fetch' | 'playwright',
  screenshotPath: string | null,
): PageSnapshot {
  const $ = loadHtml(html);

  const title = $('title').first().text().trim();
  const metaDescription = ($('meta[name="description"]').attr('content') ?? '').trim();
  const metaRobots = ($('meta[name="robots"]').attr('content') ?? '').trim();
  const canonical = ($('link[rel="canonical"]').attr('href') ?? '').trim();
  const h1 = $('h1').first().text().trim();

  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const textContentHash = createHash('sha256').update(text).digest('hex').slice(0, 16);

  const formFields: FormFieldSnapshot[] = $('form input, form textarea, form select')
    .map((_, el) => {
      const $el = $(el);
      const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? 'input';
      const type = ($el.attr('type') ?? tag).toLowerCase();
      const name = $el.attr('name') ?? '';
      const id = $el.attr('id') ?? '';
      let label = '';
      if (id) label = $(`label[for="${id}"]`).first().text().trim();
      if (!label) label = $el.parent('label').text().trim();
      return { name, type, required: $el.attr('required') !== undefined, label };
    })
    .get()
    .filter((f) => f.type !== 'hidden');

  const buttons: string[] = $('button, input[type="submit"], input[type="button"]')
    .map((_, el) => {
      const $el = $(el);
      return ($el.text() || $el.attr('value') || '').trim();
    })
    .get()
    .filter(Boolean);

  const links: string[] = $('a[href]')
    .map((_, el) => $(el).attr('href') ?? '')
    .get()
    .filter(Boolean)
    .slice(0, 60);

  const scripts: string[] = $('script[src]')
    .map((_, el) => $(el).attr('src') ?? '')
    .get()
    .filter(Boolean);

  // Full body text — fallback diff source. Strip nav/footer/header to mirror
  // what extractTextBlocks excludes, so the two stay in sync.
  const $bodyClone = $('body').clone();
  $bodyClone.find('script, style, noscript, nav, footer, header').remove();
  const fullBodyText = $bodyClone
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, 60_000);

  const textBlocks = extractTextBlocks($);

  return {
    url,
    title,
    metaDescription,
    metaRobots,
    canonical,
    h1,
    textContentHash,
    textContentLength: text.length,
    formFields,
    buttons,
    links,
    scripts,
    textBlocks,
    fullBodyText,
    loadTime,
    screenshotPath,
    timestamp: new Date().toISOString(),
    fetchedVia,
  };
}

/** Snapshot a single page using lightweight fetch (no JS execution). */
async function snapshotPageWithFetch(url: string, config: AppConfig): Promise<PageSnapshot> {
  const start = Date.now();
  const html = await fetchHtml(url, config.timeout);
  const loadTime = Date.now() - start;

  if (!html) {
    return {
      url,
      title: '',
      metaDescription: '',
      metaRobots: '',
      canonical: '',
      h1: '',
      textContentHash: '',
      textContentLength: 0,
      formFields: [],
      buttons: [],
      links: [],
      scripts: [],
      textBlocks: EMPTY_TEXT_BLOCKS,
      fullBodyText: '',
      loadTime,
      screenshotPath: null,
      timestamp: new Date().toISOString(),
      fetchedVia: 'fetch',
      error: 'Failed to fetch HTML',
    };
  }

  return parseHtmlToSnapshot(url, html, loadTime, 'fetch', null);
}

/** Snapshot a page with Playwright (gets full JS-rendered HTML + load time + optional screenshot). */
async function snapshotPageWithPlaywright(
  url: string,
  browser: Browser,
  config: AppConfig,
  takeScreenshot: boolean,
  screenshotDir: string | null,
): Promise<PageSnapshot> {
  const start = Date.now();
  const { context, page } = await newPage(browser, config);
  let screenshotPath: string | null = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const loadTime = Date.now() - start;

    if (takeScreenshot && screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      screenshotPath = path.join(screenshotDir, `${safeFilename(url)}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch((err) => {
        logger.debug(`Screenshot failed for ${url}: ${err}`);
        screenshotPath = null;
      });
    }

    const html = await page.content();
    return parseHtmlToSnapshot(url, html, loadTime, 'playwright', screenshotPath);
  } catch (err) {
    return {
      url,
      title: '',
      metaDescription: '',
      metaRobots: '',
      canonical: '',
      h1: '',
      textContentHash: '',
      textContentLength: 0,
      formFields: [],
      buttons: [],
      links: [],
      scripts: [],
      textBlocks: EMPTY_TEXT_BLOCKS,
      fullBodyText: '',
      loadTime: Date.now() - start,
      screenshotPath,
      timestamp: new Date().toISOString(),
      fetchedVia: 'playwright',
      error: String(err),
    };
  } finally {
    await closePage(context);
  }
}

/**
 * Snapshot a website: discover important pages, snapshot each, save to disk.
 */
export async function snapshotSite(
  rootUrl: string,
  browser: Browser,
  config: AppConfig,
  options: MonitorOptions,
): Promise<{ snapshot: SiteSnapshot; path: string }> {
  const normalized = normalizeUrl(rootUrl);
  const site = hostname(normalized);
  const timestamp = new Date().toISOString();
  const tsFile = timestampForFile(timestamp);

  const baseDir = path.join(process.cwd(), options.snapshotRoot, site);
  const screenshotDir = options.takeScreenshots
    ? path.join(baseDir, 'screenshots', tsFile)
    : null;

  logger.info(`Taking snapshot of ${normalized} (max ${options.maxPages} pages)`);

  const pageUrls = await discoverImportantPages(normalized, browser, config, options.maxPages);

  const pages: PageSnapshot[] = [];
  for (const pageUrl of pageUrls) {
    logger.info(`  Snapshotting ${pageUrl}`);
    const snapshot = options.takeScreenshots
      ? await snapshotPageWithPlaywright(pageUrl, browser, config, true, screenshotDir)
      : await snapshotPageWithFetch(pageUrl, config);
    pages.push(snapshot);
  }

  const siteSnapshot: SiteSnapshot = {
    site,
    rootUrl: normalized,
    timestamp,
    pagesScanned: pages.length,
    pages,
  };

  await mkdir(baseDir, { recursive: true });
  const snapshotPath = path.join(baseDir, `${tsFile}.json`);
  await writeFile(snapshotPath, JSON.stringify(siteSnapshot, null, 2), 'utf-8');

  logger.info(`Saved snapshot: ${snapshotPath}`);
  return { snapshot: siteSnapshot, path: snapshotPath };
}
