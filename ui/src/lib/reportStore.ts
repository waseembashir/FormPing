/**
 * Read/write per-site change reports to disk.
 *
 * Snapshots are already persisted (so they survive Railway deploys) but
 * reports were ephemeral — only ever streamed to the UI in memory. That
 * meant refreshing the browser lost all the comparison history.
 *
 * Reports are now written alongside snapshots:
 *   formping/data/snapshots/<site>/<timestamp>.json   ← existing
 *   formping/data/reports/<site>/<timestamp>.json     ← new (this file)
 *
 * The CLI doesn't write these directly; the /api/monitor route does it
 * as reports come off the streamed stdout. Keeps the CLI unchanged and
 * avoids a "writes the same data twice" race.
 */

import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

// Path note: Railway's persistent volume is mounted at `data/snapshots`
// rather than `data/`, so reports written to `data/reports/...` would get
// wiped on every redeploy. Stash them INSIDE the snapshots directory in a
// dot-prefixed subdir that won't collide with hostname-named subdirs.
const REPORT_ROOT = 'data/snapshots/.formping-reports';

/** Resolve the absolute filesystem path for reports of a given site. */
function reportsDir(site: string): string {
  // Routes run with cwd = formping/ui; reports live at formping/data/reports.
  return path.join(process.cwd(), '..', REPORT_ROOT, site);
}

/** Sanitize a filesystem path component (extra paranoid — site comes from URL parser). */
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

export interface StoredReport {
  /** ISO timestamp string (used for filename and sort). */
  timestamp: string;
  /** The full ChangeReport object as JSON. */
  report: unknown;
}

/**
 * Write a report to disk. Filename is the report's checkedAt timestamp
 * (sanitized for filesystem use). Best-effort — errors are caught so a
 * disk failure doesn't break the monitor flow.
 */
export async function saveReport(
  site: string,
  report: { checkedAt?: string } & Record<string, unknown>,
): Promise<void> {
  try {
    const dir = reportsDir(safeSegment(site));
    await mkdir(dir, { recursive: true });
    const ts = (typeof report.checkedAt === 'string' && report.checkedAt) || new Date().toISOString();
    const filename = safeSegment(ts) + '.json';
    await writeFile(path.join(dir, filename), JSON.stringify(report), 'utf-8');
  } catch (err) {
    // Don't throw — disk write failure should never break a watch loop
    console.warn(`[reportStore] saveReport failed: ${err}`);
  }
}

/**
 * Load all stored reports for a site, sorted newest-first.
 * Returns up to `limit` reports (default 50).
 */
export async function loadReports(site: string, limit = 50): Promise<StoredReport[]> {
  const dir = reportsDir(safeSegment(site));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return []; // dir doesn't exist yet
  }

  const jsonFiles = files
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse() // newest first (lexicographic on ISO timestamps = chronological)
    .slice(0, limit);

  const results: StoredReport[] = [];
  for (const f of jsonFiles) {
    try {
      const raw = await readFile(path.join(dir, f), 'utf-8');
      const report = JSON.parse(raw);
      const timestamp = f.replace(/\.json$/, '');
      results.push({ timestamp, report });
    } catch {
      // Skip malformed files but keep going
    }
  }
  return results;
}
