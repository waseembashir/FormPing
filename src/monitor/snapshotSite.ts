import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import type {
  PageSnapshot,
  SiteSnapshot,
  MonitorOptions,
  FormFieldSnapshot,
  TextBlocks,
  HeadingTag,
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

/** Extract structured visible text blocks for granular diffing. */
function extractTextBlocks($: ReturnType<typeof loadHtml>): TextBlocks {
  // Strip noise — script/style/nav/footer content shouldn't pollute text diffs
  $('script, style, noscript').remove();

  // ── Headings (h1–h6) ──
  const headings: { tag: HeadingTag; text: string }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = ((el as { tagName?: string }).tagName ?? 'h2').toLowerCase() as HeadingTag;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && text.length <= 200) headings.push({ tag, text });
  });

  // ── Paragraphs ──
  const paragraphs: string[] = [];
  $('p').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && text.length >= 15) paragraphs.push(text.slice(0, 300));
  });

  // ── List items ──
  const listItems: string[] = [];
  $('li').each((_, el) => {
    if ($(el).closest('nav, footer, header').length > 0) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && text.length >= 4 && text.length <= 200) listItems.push(text);
  });

  // ── "Other" — direct text inside divs/spans/sections etc.
  // This catches modern WP/Elementor/Gutenberg markup that doesn't use <p> tags.
  // We extract DIRECT text only (not children's text) to avoid duplication.
  const seen = new Set<string>([
    ...headings.map((h) => h.text),
    ...paragraphs,
    ...listItems,
  ]);
  const other: string[] = [];
  $('div, span, section, article, aside, blockquote, td, th, dt, dd, label, summary, figcaption').each(
    (_, el) => {
      if ($(el).closest('nav, footer, header').length > 0) return;
      const text = directText(el);
      if (text.length < 15 || text.length > 500) return;
      if (seen.has(text)) return;
      seen.add(text);
      other.push(text);
    },
  );

  return {
    headings: headings.slice(0, 50),
    paragraphs: dedupeStrings(paragraphs).slice(0, 80),
    listItems: dedupeStrings(listItems).slice(0, 80),
    other: other.slice(0, 150),
  };
}

const EMPTY_TEXT_BLOCKS: TextBlocks = { headings: [], paragraphs: [], listItems: [], other: [] };

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
