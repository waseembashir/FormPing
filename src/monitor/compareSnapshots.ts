import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import type { ChangeReport, MonitorOptions, SiteSnapshot } from './types.js';
import { snapshotSite } from './snapshotSite.js';
import { diffSnapshots, totalChanges } from './diffEngine.js';
import { summarizeChanges } from './summarizeChanges.js';
import { sendSlackChangeNotification } from '../notifications/slack.js';
import { normalizeUrl } from '../utils/url.js';
import { logger } from '../utils/logger.js';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/** Find the most recent snapshot file for a site (excluding the one just written). */
async function findPreviousSnapshot(
  site: string,
  snapshotRoot: string,
  excludePath?: string,
): Promise<{ path: string; data: SiteSnapshot } | null> {
  const dir = path.join(process.cwd(), snapshotRoot, site);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const jsonFiles = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f))
    .filter((p) => p !== excludePath)
    .sort()
    .reverse();

  if (jsonFiles.length === 0) return null;

  const latestPath = jsonFiles[0]!;
  try {
    const raw = await readFile(latestPath, 'utf-8');
    return { path: latestPath, data: JSON.parse(raw) as SiteSnapshot };
  } catch (err) {
    logger.warn(`Failed to read previous snapshot ${latestPath}: ${err}`);
    return null;
  }
}

/**
 * Take a fresh snapshot, compare it with the most recent stored snapshot,
 * and return a structured change report.
 */
export async function runCompare(
  rootUrl: string,
  browser: Browser,
  config: AppConfig,
  options: MonitorOptions,
): Promise<ChangeReport> {
  const normalized = normalizeUrl(rootUrl);
  const site = hostname(normalized);
  const checkedAt = new Date().toISOString();

  // Find previous snapshot BEFORE writing the new one
  const previous = await findPreviousSnapshot(site, options.snapshotRoot);

  // Take fresh snapshot
  const { snapshot: current, path: currentPath } = await snapshotSite(
    rootUrl,
    browser,
    config,
    options,
  );

  if (!previous) {
    logger.info(`No previous snapshot found for ${site} — saved as initial baseline`);
    return {
      site,
      rootUrl: normalized,
      checkedAt,
      previousSnapshot: null,
      pagesScanned: current.pagesScanned,
      pagesChanged: 0,
      changesFound: 0,
      summary: 'Initial snapshot taken — no previous snapshot to compare against.',
      details: [],
    };
  }

  const details = diffSnapshots(previous.data, current);
  const changesFound = totalChanges(details);

  const summary = await summarizeChanges(details, site, options.aiProvider);
  // summary = { text, aiProvider? }

  // Diagnostic: per-page raw text hash comparison — useful when changesFound === 0
  // but the user expected changes (helps distinguish "page is identical" from
  // "page changed but our extractor missed it")
  const oldByUrl = new Map(previous.data.pages.map((p) => [p.url, p]));
  const hashStatus = current.pages.map((newPage) => {
    const oldPage = oldByUrl.get(newPage.url);
    return {
      url: newPage.url,
      hashChanged: oldPage ? oldPage.textContentHash !== newPage.textContentHash : true,
      oldLength: oldPage?.textContentLength ?? 0,
      newLength: newPage.textContentLength,
    };
  });

  const report: ChangeReport = {
    site,
    rootUrl: normalized,
    checkedAt,
    previousSnapshot: previous.path,
    pagesScanned: current.pagesScanned,
    pagesChanged: details.length,
    changesFound,
    summary: summary.text,
    ...(summary.aiProvider ? { summaryProvider: summary.aiProvider } : {}),
    details,
    hashStatus,
  };

  // Fire Slack notification if SLACK_WEBHOOK_URL is set and any changes
  // were detected. No-op otherwise. Errors are logged but never thrown so
  // a misconfigured webhook can't break the monitor loop.
  await sendSlackChangeNotification(report);

  return report;
}

/** Re-export so the CLI can call snapshot mode through one entry point. */
export { snapshotSite } from './snapshotSite.js';
