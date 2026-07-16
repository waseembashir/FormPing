/**
 * Persistence for Site Watch check history.
 *
 * Backed by Supabase (`site_watch_runs` table, one row per check) when
 * configured, else the legacy JSON file (one file per schedule, keyed by id).
 * Newest-first, capped to the most recent MAX_RUNS. Exported functions dispatch
 * on `supabaseEnabled()`. Best-effort: errors logged, never thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { SiteCheckRecord, UptimeResult, SslResult, DomainResult } from './types';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

const MAX_RUNS = 200;

// ── JSON implementation (fallback) ───────────────────────────────────────────
const DIR_REL = 'data/snapshots/.formping-site-runs';

function safeKey(key: string): string {
  return key.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || 'unknown';
}

function fileFor(scheduleId: string): string {
  return path.join(dataPath(DIR_REL), `${safeKey(scheduleId)}.json`);
}

async function readHistoryJson(scheduleId: string): Promise<SiteCheckRecord[]> {
  try {
    const raw = await readFile(fileFor(scheduleId), 'utf-8');
    const parsed = JSON.parse(raw) as SiteCheckRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendCheckJson(record: SiteCheckRecord): Promise<void> {
  const fp = fileFor(record.scheduleId);
  try {
    const existing = await readHistoryJson(record.scheduleId);
    const next = [record, ...existing].slice(0, MAX_RUNS);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[siteWatch/historyStore] write failed at ${fp}: ${err}`);
  }
}

// ── Supabase implementation ──────────────────────────────────────────────────
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

// ── Public API (dispatches on backend) ───────────────────────────────────────

/** Read a schedule's check history (newest first). */
export async function readHistory(scheduleId: string): Promise<SiteCheckRecord[]> {
  if (!supabaseEnabled()) return readHistoryJson(scheduleId);
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
  if (!supabaseEnabled()) return appendCheckJson(record);
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
