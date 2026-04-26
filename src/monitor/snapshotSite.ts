import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import type { PageSnapshot, SiteSnapshot, MonitorOptions, FormFieldSnapshot } from './types.js';
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
