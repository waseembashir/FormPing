/**
 * Persistence for Form Watch run history.
 *
 * Backed by Supabase (`form_watch_runs` table, one row per run). Each schedule's
 * before/after history is isolated (by schedule_id) so several forms on the same
 * host don't collide. Newest-first, capped to the most recent MAX_RUNS.
 *
 * The run row is an ESSENTIAL write: it IS the result, so `appendRun` reports
 * whether it landed and the caller decides what to do about it. Reads and
 * pruning stay best-effort — neither can lose a result. See lib/persistence.
 * FR-87.
 */

import type { FormRunRecord, FormFingerprint, FormRunStatus, FormWatchMode, RunTrigger } from './types';
import { supabaseAdmin } from '@/lib/supabase';
import {
  WRITE_OK,
  bestEffortWriteFailed,
  essentialWriteFailed,
  type WriteOutcome,
} from '@/lib/persistence';

const MAX_RUNS = 100;
/**
 * How long a manual run's row survives. A re-run answers "is this working right
 * now?" — a question with a short shelf life — so its row is kept long enough to
 * be looked at again later in the day, then removed from the database and from
 * the log. FR-89.
 *
 * This replaces a count-based allowance: a time limit is one sentence a user can
 * understand, and like the count it cannot evict scheduled history, because the
 * two are pruned independently.
 */
const MANUAL_TTL_MS = 24 * 60 * 60 * 1000;

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
  /** null on every row written before FR-82 — all of which were scheduled. */
  trigger_source: string | null;
}
const FR_COLS =
  'schedule_id, url, site, mode, ran_at, status, reason_code, submission_result, duration_ms, fingerprint, notes, errors, trigger_source';

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
    trigger: r.trigger_source === 'manual' ? 'manual' : 'scheduled',
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
    trigger_source: (rec.trigger ?? 'scheduled') satisfies RunTrigger,
  };
}

/** True unless this is a manual run past its 24-hour life. FR-89. */
function notExpiredManual(r: FormRunRecord): boolean {
  if (r.trigger !== 'manual') return true;
  return Date.now() - Date.parse(r.ranAt) < MANUAL_TTL_MS;
}

/** Read a schedule's run history (newest first). */
export async function readHistory(scheduleId: string): Promise<FormRunRecord[]> {
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
  // Expired re-runs never reach a reader, even if pruning hasn't run since —
  // the 24-hour promise holds regardless of when the last write happened.
  return (data as FormRunRow[]).map(toRecord).filter(notExpiredManual);
}

/** The most recent run for a schedule, or null. */
export async function latestRun(scheduleId: string): Promise<FormRunRecord | null> {
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

/**
 * Prepend a new run record (keyed by its scheduleId), cap to MAX_RUNS.
 *
 * Returns whether the row landed. A caller that ignores this is claiming a run
 * happened on the strength of a statement that may have been refused — which is
 * precisely what FR-87 fixes, so the tickers check it.
 */
export async function appendRun(record: FormRunRecord): Promise<WriteOutcome> {
  const db = supabaseAdmin();
  const { error } = await db.from('form_watch_runs').insert(toRow(record));
  if (error) {
    return essentialWriteFailed('formWatch/historyStore', error.message);
  }
  await pruneToCap(record.scheduleId);
  return WRITE_OK;
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

/** Scheduled runs keep their count cap — manual rows are not counted against it. */
async function pruneScheduledToCap(scheduleId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('form_watch_runs')
    .select('id')
    .eq('schedule_id', scheduleId)
    .or('trigger_source.is.null,trigger_source.eq.scheduled')
    .order('ran_at', { ascending: false })
    .range(MAX_RUNS, MAX_RUNS + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('form_watch_runs').delete().in('id', ids);
  if (delErr) bestEffortWriteFailed('formWatch/historyStore: prune scheduled', delErr.message);
}

/** Manual runs expire on time, not on count. */
async function pruneExpiredManual(scheduleId: string): Promise<void> {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - MANUAL_TTL_MS).toISOString();
  const { error } = await db
    .from('form_watch_runs')
    .delete()
    .eq('schedule_id', scheduleId)
    .eq('trigger_source', 'manual')
    .lt('ran_at', cutoff);
  if (error) bestEffortWriteFailed('formWatch/historyStore: prune expired manual', error.message);
}
