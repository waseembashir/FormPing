/**
 * Persistence for Form Watch run history.
 *
 * Backed by Supabase (`form_watch_runs` table, one row per run) when configured,
 * else the legacy JSON file (one file per SCHEDULE, keyed by schedule id). Each
 * schedule's before/after history is isolated so several forms on the same host
 * don't collide. Newest-first, capped to the most recent MAX_RUNS. Exported
 * functions dispatch on `supabaseEnabled()`. Best-effort: errors logged, never
 * thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { FormRunRecord, FormFingerprint, FormRunStatus, FormWatchMode } from './types';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

const MAX_RUNS = 100;

// ── JSON implementation (fallback) ───────────────────────────────────────────
const DIR_REL = 'data/snapshots/.formping-form-runs';

/** Filesystem-safe filename for a schedule id. */
function safeKey(key: string): string {
  return key.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || 'unknown';
}

function fileFor(scheduleId: string): string {
  return path.join(dataPath(DIR_REL), `${safeKey(scheduleId)}.json`);
}

async function readHistoryJson(scheduleId: string): Promise<FormRunRecord[]> {
  try {
    const raw = await readFile(fileFor(scheduleId), 'utf-8');
    const parsed = JSON.parse(raw) as FormRunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendRunJson(record: FormRunRecord): Promise<void> {
  const fp = fileFor(record.scheduleId);
  try {
    const existing = await readHistoryJson(record.scheduleId);
    const next = [record, ...existing].slice(0, MAX_RUNS);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[formWatch/historyStore] write failed at ${fp}: ${err}`);
  }
}

// ── Supabase implementation ──────────────────────────────────────────────────
interface FormRunRow {
  schedule_id: string;
  url: string;
  site: string;
  mode: string;
  ran_at: string;
  status: string;
  reason_code: string | null;
  submission_result: string | null;
  duration_ms: number;
  fingerprint: FormFingerprint | null;
  notes: string[] | null;
  errors: string[] | null;
}
const FR_COLS =
  'schedule_id, url, site, mode, ran_at, status, reason_code, submission_result, duration_ms, fingerprint, notes, errors';

function toRecord(r: FormRunRow): FormRunRecord {
  return {
    scheduleId: r.schedule_id,
    url: r.url,
    site: r.site,
    mode: r.mode as FormWatchMode,
    ranAt: r.ran_at,
    status: r.status as FormRunStatus,
    reasonCode: r.reason_code ?? '',
    submissionResult: r.submission_result ?? '',
    durationMs: Number(r.duration_ms) || 0,
    fingerprint: r.fingerprint as FormFingerprint,
    notes: r.notes ?? [],
    errors: r.errors ?? [],
  };
}

function toRow(rec: FormRunRecord): FormRunRow {
  return {
    schedule_id: rec.scheduleId,
    url: rec.url,
    site: rec.site,
    mode: rec.mode,
    ran_at: rec.ranAt,
    status: rec.status,
    reason_code: rec.reasonCode || null,
    submission_result: rec.submissionResult || null,
    duration_ms: rec.durationMs ?? 0,
    fingerprint: rec.fingerprint ?? null,
    notes: rec.notes ?? [],
    errors: rec.errors ?? [],
  };
}

// ── Public API (dispatches on backend) ───────────────────────────────────────

/** Read a schedule's run history (newest first). */
export async function readHistory(scheduleId: string): Promise<FormRunRecord[]> {
  if (!supabaseEnabled()) return readHistoryJson(scheduleId);
  const { data, error } = await supabaseAdmin()
    .from('form_watch_runs')
    .select(FR_COLS)
    .eq('schedule_id', scheduleId)
    .order('ran_at', { ascending: false })
    .limit(MAX_RUNS);
  if (error) {
    console.warn(`[formWatch/historyStore] read: ${error.message}`);
    return [];
  }
  return (data as FormRunRow[]).map(toRecord);
}

/** The most recent run for a schedule, or null. */
export async function latestRun(scheduleId: string): Promise<FormRunRecord | null> {
  if (!supabaseEnabled()) return (await readHistoryJson(scheduleId))[0] ?? null;
  const { data, error } = await supabaseAdmin()
    .from('form_watch_runs')
    .select(FR_COLS)
    .eq('schedule_id', scheduleId)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[formWatch/historyStore] latest: ${error.message}`);
    return null;
  }
  return data ? toRecord(data as FormRunRow) : null;
}

/** Prepend a new run record (keyed by its scheduleId), cap to MAX_RUNS. */
export async function appendRun(record: FormRunRecord): Promise<void> {
  if (!supabaseEnabled()) return appendRunJson(record);
  const db = supabaseAdmin();
  const { error } = await db.from('form_watch_runs').insert(toRow(record));
  if (error) {
    console.warn(`[formWatch/historyStore] append: ${error.message}`);
    return;
  }
  await pruneToCap(record.scheduleId);
}

/** Keep only the newest MAX_RUNS rows for a schedule. Best-effort. */
async function pruneToCap(scheduleId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('form_watch_runs')
    .select('id')
    .eq('schedule_id', scheduleId)
    .order('ran_at', { ascending: false })
    .range(MAX_RUNS, MAX_RUNS + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('form_watch_runs').delete().in('id', ids);
  if (delErr) console.warn(`[formWatch/historyStore] prune: ${delErr.message}`);
}
