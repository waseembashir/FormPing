/**
 * Read/write per-site change reports.
 *
 * Backed by Supabase (`change_reports` table, one row per report). Only the most
 * recent report per site is kept (KEEP_REPORTS_PER_SITE) — watch mode runs
 * hourly, so unbounded growth would fill storage + flood the UI history.
 * Best-effort: errors logged, never thrown, so a storage failure never breaks a
 * watch loop.
 *
 * The CLI doesn't write these; the watch spawner does it as reports come off the
 * streamed stdout, keeping the CLI unchanged.
 */

import { supabaseAdmin } from '@/lib/supabase';

/**
 * How many reports to keep per site.
 *
 * Was 1 — only the newest survived, which meant the "on this date, N things
 * changed" history was deleted on every run and no timeline could be built
 * (FR-21). Keeping a recent window lets you drill into past comparisons while
 * the heavy `details` payload still ages out; the slim per-run history lives in
 * `change_events` (see changeEventStore), which is what the timeline reads.
 *
 * Raising this is a RELAXATION — it only ever preserves more rows than before,
 * so it cannot delete existing data (working-agreement rule 6).
 */
const KEEP_REPORTS_PER_SITE = 20;

export interface StoredReport {
  /** ISO timestamp string (the report's checkedAt; used as key + sort). */
  timestamp: string;
  /** The full ChangeReport object as JSON. */
  report: unknown;
}

/** Sanitize a key component (extra paranoid — site comes from URL parser). */
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/** The report's own timestamp (its key), or now if absent. */
function reportTs(report: { checkedAt?: string }): string {
  return (typeof report.checkedAt === 'string' && report.checkedAt) || new Date().toISOString();
}

/**
 * Write a report. Keyed by the report's checkedAt timestamp. Best-effort — a
 * storage failure is caught so it never breaks the monitor flow.
 */
export async function saveReport(
  site: string,
  report: { checkedAt?: string } & Record<string, unknown>,
): Promise<void> {
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
  await pruneOldReports(key);
}

/** Keep only the newest KEEP_REPORTS_PER_SITE rows for a site. Best-effort. */
async function pruneOldReports(site: string): Promise<void> {
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

/** Delete all change reports for a site (used when a project is deleted, so
 *  nothing lingers by hostname). Best-effort. */
export async function removeReports(site: string): Promise<void> {
  const key = safeSegment(site);
  const { error } = await supabaseAdmin().from('change_reports').delete().eq('site', key);
  if (error) console.warn(`[reportStore] removeReports: ${error.message}`);
}

/** Load stored reports for a site, newest-first, up to `limit` (default 50). */
export async function loadReports(site: string, limit = 50): Promise<StoredReport[]> {
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
