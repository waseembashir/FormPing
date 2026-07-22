/**
 * Persistence for Site Watch check history.
 *
 * Backed by Supabase (`site_watch_runs` table, one row per check). Newest-first,
 * capped to the most recent MAX_RUNS. Best-effort: errors logged, never thrown.
 */

import type { SiteCheckRecord, UptimeResult, SslResult, DomainResult } from './types';
import { supabaseAdmin } from '@/lib/supabase';

const MAX_RUNS = 200;

interface SiteRunRow {
  schedule_id: string;
  url: string;
  host: string;
  checked_at: string;
  uptime: UptimeResult;
  ssl: SslResult | null;
  domain: DomainResult | null;
}
const SR_COLS = 'schedule_id, url, host, checked_at, uptime, ssl, domain';

function toRecord(r: SiteRunRow): SiteCheckRecord {
  return {
    scheduleId: r.schedule_id,
    url: r.url,
    host: r.host,
    checkedAt: r.checked_at,
    uptime: r.uptime,
    ssl: r.ssl,
    domain: r.domain ?? null,
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
  };
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
  return (data as SiteRunRow[]).map(toRecord);
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

/** Keep only the newest MAX_RUNS rows for a schedule. Best-effort. */
async function pruneToCap(scheduleId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('site_watch_runs')
    .select('id')
    .eq('schedule_id', scheduleId)
    .order('checked_at', { ascending: false })
    .range(MAX_RUNS, MAX_RUNS + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('site_watch_runs').delete().in('id', ids);
  if (delErr) console.warn(`[siteWatch/historyStore] prune: ${delErr.message}`);
}
