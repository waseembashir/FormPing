/**
 * Persistence for Site Watch check history.
 *
 * Backed by Supabase (`site_watch_runs` table, one row per check). Newest-first,
 * capped to the most recent MAX_RUNS. Best-effort: errors logged, never thrown.
 */

import type { SiteCheckRecord, UptimeResult, SslResult, DomainResult, RunTrigger } from './types';
import { supabaseAdmin } from '@/lib/supabase';

const MAX_RUNS = 200;
/**
 * How long a manual check's row survives. A re-run answers "is this working right
 * now?" — a question with a short shelf life — so its row is kept long enough to
 * be looked at again later in the day, then removed from the database and from
 * the log. FR-89.
 *
 * This replaces a count-based allowance: a time limit is one sentence a user can
 * understand, and like the count it cannot evict scheduled history, because the
 * two are pruned independently.
 */
const MANUAL_TTL_MS = 24 * 60 * 60 * 1000;

interface SiteRunRow {
  schedule_id: string;
  url: string;
  host: string;
  checked_at: string;
  uptime: UptimeResult;
  ssl: SslResult | null;
  domain: DomainResult | null;
  /** null on every row written before FR-82 — all of which were scheduled. */
  trigger_source: string | null;
}
const SR_COLS = 'schedule_id, url, host, checked_at, uptime, ssl, domain, trigger_source';

function toRecord(r: SiteRunRow): SiteCheckRecord {
  return {
    scheduleId: r.schedule_id,
    url: r.url,
    host: r.host,
    checkedAt: r.checked_at,
    uptime: r.uptime,
    ssl: r.ssl,
    domain: r.domain ?? null,
    trigger: r.trigger_source === 'manual' ? 'manual' : 'scheduled',
  };
}

function toRow(rec: SiteCheckRecord): SiteRunRow {
  return {
    schedule_id: rec.scheduleId,
    url: rec.url,
    host: rec.host,
    checked_at: rec.checkedAt,
    uptime: rec.uptime,
    ssl: rec.ssl ?? null,
    domain: rec.domain ?? null,
    trigger_source: (rec.trigger ?? 'scheduled') satisfies RunTrigger,
  };
}

/** True unless this is a manual check past its 24-hour life. FR-89. */
function notExpiredManual(r: SiteCheckRecord): boolean {
  if (r.trigger !== 'manual') return true;
  return Date.now() - Date.parse(r.checkedAt) < MANUAL_TTL_MS;
}

/** Read a schedule's check history (newest first). */
export async function readHistory(scheduleId: string): Promise<SiteCheckRecord[]> {
  const { data, error } = await supabaseAdmin()
    .from('site_watch_runs')
    .select(SR_COLS)
    .eq('schedule_id', scheduleId)
    .order('checked_at', { ascending: false })
    .limit(MAX_RUNS);
  if (error) {
    console.warn(`[siteWatch/historyStore] read: ${error.message}`);
    return [];
  }
  // Expired re-runs never reach a reader, even if pruning hasn't run since —
  // the 24-hour promise holds regardless of when the last write happened.
  return (data as SiteRunRow[]).map(toRecord).filter(notExpiredManual);
}

/** Append a new check record (keyed by its scheduleId), cap to MAX_RUNS. */
export async function appendCheck(record: SiteCheckRecord): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from('site_watch_runs').insert(toRow(record));
  if (error) {
    console.warn(`[siteWatch/historyStore] append: ${error.message}`);
    return;
  }
  await pruneToCap(record.scheduleId);
}

/**
 * Trim a schedule's history, counting scheduled runs and re-runs SEPARATELY.
 *
 * One shared cap let re-runs evict real history: the newest N rows were kept
 * whatever started them, so a handful of re-runs while debugging silently
 * dropped that many days of scheduled results. A re-run is not allowed to
 * change anything the schedule owns, and its own history is very much
 * something it owns. FR-85.
 *
 * Rows written before FR-82 have no trigger_source and count as scheduled,
 * which is what they were. Best-effort throughout.
 */
async function pruneToCap(scheduleId: string): Promise<void> {
  await Promise.all([pruneScheduledToCap(scheduleId), pruneExpiredManual(scheduleId)]);
}

/** Scheduled checks keep their count cap — manual rows are not counted against it. */
async function pruneScheduledToCap(scheduleId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('site_watch_runs')
    .select('id')
    .eq('schedule_id', scheduleId)
    .or('trigger_source.is.null,trigger_source.eq.scheduled')
    .order('checked_at', { ascending: false })
    .range(MAX_RUNS, MAX_RUNS + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('site_watch_runs').delete().in('id', ids);
  if (delErr) console.warn(`[siteWatch/historyStore] prune scheduled: ${delErr.message}`);
}

/** Manual checks expire on time, not on count. */
async function pruneExpiredManual(scheduleId: string): Promise<void> {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - MANUAL_TTL_MS).toISOString();
  const { error } = await db
    .from('site_watch_runs')
    .delete()
    .eq('schedule_id', scheduleId)
    .eq('trigger_source', 'manual')
    .lt('checked_at', cutoff);
  if (error) console.warn(`[siteWatch/historyStore] prune expired manual: ${error.message}`);
}
