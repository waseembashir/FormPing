/**
 * Read/write per-site change reports.
 *
 * Backed by Supabase (`change_reports` table, one row per report) when
 * configured, else the legacy JSON files. Only the most recent report per site
 * is kept (KEEP_REPORTS_PER_SITE) — watch mode runs hourly, so unbounded growth
 * would fill storage + flood the UI history. Best-effort: errors logged, never
 * thrown, so a storage failure never breaks a watch loop.
 *
 * JSON layout (fallback), written alongside snapshots so it survives Railway
 * deploys (the volume is mounted at data/snapshots):
 *   data/snapshots/.formping-reports/<site>/<timestamp>.json
 *
 * The CLI doesn't write these; the watch spawner does it as reports come off
 * the streamed stdout, keeping the CLI unchanged.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

/** How many reports to keep per site (user wants only the most recent visible;
 *  a tiny buffer guards against losing the latest if a write races a prune). */
const KEEP_REPORTS_PER_SITE = 1;

export interface StoredReport {
  /** ISO timestamp string (the report's checkedAt; used as key + sort). */
  timestamp: string;
  /** The full ChangeReport object as JSON. */
  report: unknown;
}

/** Sanitize a path/key component (extra paranoid — site comes from URL parser). */
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/** The report's own timestamp (its filename/key), or now if absent. */
function reportTs(report: { checkedAt?: string }): string {
  return (typeof report.checkedAt === 'string' && report.checkedAt) || new Date().toISOString();
}

// ── JSON implementation (fallback) ───────────────────────────────────────────
// Path note: Railway's persistent volume is mounted at `data/snapshots` rather
// than `data/`, so reports under `data/reports/...` would be wiped every deploy.
// Stash them INSIDE snapshots in a dot-prefixed subdir that won't collide with
// hostname-named subdirs.
const REPORT_ROOT = 'data/snapshots/.formping-reports';

function reportsDir(site: string): string {
  return path.join(dataPath(REPORT_ROOT), site);
}

async function saveReportJson(
  site: string,
  report: { checkedAt?: string } & Record<string, unknown>,
): Promise<void> {
  try {
    const dir = reportsDir(safeSegment(site));
    await mkdir(dir, { recursive: true });
    const filename = safeSegment(reportTs(report)) + '.json';
    await writeFile(path.join(dir, filename), JSON.stringify(report), 'utf-8');
    await pruneOldReportsJson(dir, KEEP_REPORTS_PER_SITE);
  } catch (err) {
    console.warn(`[reportStore] saveReport failed: ${err}`);
  }
}

/** Delete all but the `keep` newest report files in `dir`. Best-effort. */
async function pruneOldReportsJson(dir: string, keep: number): Promise<void> {
  try {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse();
    const toDelete = jsonFiles.slice(keep);
    for (const f of toDelete) {
      try {
        await unlink(path.join(dir, f));
      } catch { /* ignore unlink races */ }
    }
    if (toDelete.length > 0) {
      console.log(`[reportStore] pruned ${toDelete.length} old report(s) in ${dir}`);
    }
  } catch { /* dir vanished — nothing to prune */ }
}

async function loadReportsJson(site: string, limit: number): Promise<StoredReport[]> {
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
      results.push({ timestamp: f.replace(/\.json$/, ''), report });
    } catch {
      // Skip malformed files but keep going
    }
  }
  return results;
}

// ── Public API (dispatches on backend) ───────────────────────────────────────

/**
 * Write a report. Keyed by the report's checkedAt timestamp. Best-effort — a
 * storage failure is caught so it never breaks the monitor flow.
 */
export async function saveReport(
  site: string,
  report: { checkedAt?: string } & Record<string, unknown>,
): Promise<void> {
  if (!supabaseEnabled()) return saveReportJson(site, report);
  const key = safeSegment(site);
  const ts = reportTs(report);
  const db = supabaseAdmin();
  const { error } = await db
    .from('change_reports')
    .upsert({ site: key, report_ts: ts, report }, { onConflict: 'site,report_ts' });
  if (error) {
    console.warn(`[reportStore] saveReport: ${error.message}`);
    return;
  }
  await pruneOldReportsSupabase(key);
}

/** Keep only the newest KEEP_REPORTS_PER_SITE rows for a site. Best-effort. */
async function pruneOldReportsSupabase(site: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('change_reports')
    .select('id')
    .eq('site', site)
    .order('report_ts', { ascending: false })
    .range(KEEP_REPORTS_PER_SITE, KEEP_REPORTS_PER_SITE + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('change_reports').delete().in('id', ids);
  if (delErr) console.warn(`[reportStore] prune: ${delErr.message}`);
}

/** Load stored reports for a site, newest-first, up to `limit` (default 50). */
export async function loadReports(site: string, limit = 50): Promise<StoredReport[]> {
  if (!supabaseEnabled()) return loadReportsJson(site, limit);
  const { data, error } = await supabaseAdmin()
    .from('change_reports')
    .select('report_ts, report')
    .eq('site', safeSegment(site))
    .order('report_ts', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`[reportStore] loadReports: ${error.message}`);
    return [];
  }
  return (data as { report_ts: string; report: unknown }[]).map((r) => ({
    timestamp: r.report_ts,
    report: r.report,
  }));
}
