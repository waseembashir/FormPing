/**
 * Persist the LAST Form Watch result per URL (durable, url-keyed).
 *
 * Unlike the run *history* (which is a monitor's detailed log and dies with the
 * schedule), this is the single "last known result" shown against a project URL.
 * It's written on every scheduled run and SURVIVES stopping/deleting the monitor
 * — the result only goes away when the project is deleted (or the URL re-tested).
 * Mirrors the `onDemandRunStore` (manual Form Tester) pattern so Projects treats
 * scheduled and manual results consistently.
 *
 * Backed by Supabase (`form_watch_results`). Best-effort: every function swallows
 * its own errors so a storage hiccup never breaks the ticker that calls it.
 */

import type { FormRunRecord, FormRunStatus } from './types';
import { urlKey as resultKey } from '@/lib/projects/projectStore';
import { supabaseAdmin } from '@/lib/supabase';
import { WRITE_OK, essentialWriteFailed, type WriteOutcome } from '@/lib/persistence';
import { extractFormRunDetail, type FormRunDetail } from '@/lib/formRunDetail';

export interface FormWatchResult {
  /** Normalized + lowercased URL — the map key (matches health.ts key()). */
  url: string;
  /** The URL as stored on the schedule. */
  inputUrl: string;
  status: FormRunStatus;
  reasonCode: string;
  formFound: boolean;
  mode: string;
  /** ISO timestamp of the run that produced this result. */
  ranAt: string;
  /** FR-67 — everything the engine found on this check, so the per-URL dashboard
   *  can show a scheduled run in the same depth as a manual one. Absent on rows
   *  written before the column existed. */
  detail?: FormRunDetail;
}

interface FormResultRow {
  url_key: string;
  input_url: string;
  status: string;
  reason_code: string | null;
  form_found: boolean;
  mode: string | null;
  ran_at: string;
  detail?: FormRunDetail | null;
}
const BASE_COLS = 'url_key, input_url, status, reason_code, form_found, mode, ran_at';
const COLS = `${BASE_COLS}, detail`;

function rowToResult(r: FormResultRow): FormWatchResult {
  return {
    url: r.url_key,
    inputUrl: r.input_url,
    status: r.status as FormRunStatus,
    reasonCode: r.reason_code ?? '',
    formFound: r.form_found ?? false,
    mode: r.mode ?? '',
    ranAt: r.ran_at,
    ...(r.detail ? { detail: r.detail } : {}),
  };
}

/**
 * Record the latest scheduled form result for a URL (upsert, last-write-wins).
 *
 * ESSENTIAL: this row is what Projects and the dashboards read, so a silent
 * failure here shows a stale verdict as though it were current. Reports its
 * outcome; the ticker refuses to advance the card past a failure. FR-87.
 */
export async function recordResult(record: FormRunRecord, raw?: unknown): Promise<WriteOutcome> {
  try {
    const result: FormWatchResult = {
      url: resultKey(record.url),
      inputUrl: record.url,
      status: record.status,
      reasonCode: record.reasonCode || '',
      formFound: record.fingerprint?.formFound ?? false,
      mode: record.mode || '',
      ranAt: record.ranAt,
    };
    const baseRow = {
      url_key: result.url,
      input_url: result.inputUrl,
      status: result.status,
      reason_code: result.reasonCode || null,
      form_found: result.formFound,
      mode: result.mode || null,
      ran_at: result.ranAt,
    };

    // FR-67 — the same rich detail a manual Form Tester run stores, built by the
    // same extractor from the same engine output. Without it, adding a monitor
    // to a URL left its dashboard showing one line no matter how many checks had
    // run, while a one-off test of the same page showed everything.
    const detail = raw ? extractFormRunDetail(raw) : null;

    const { error } = await supabaseAdmin()
      .from('form_watch_results')
      .upsert({ ...baseRow, detail }, { onConflict: 'url_key' });
    if (error) {
      // `detail` is missing until migration 0013 is applied — retry without it,
      // so a check still records its result rather than being lost to a column.
      const { error: retry } = await supabaseAdmin()
        .from('form_watch_results')
        .upsert(baseRow, { onConflict: 'url_key' });
      if (retry) return essentialWriteFailed('formWatch/resultStore', retry.message);
    }
    return WRITE_OK;
  } catch (err) {
    return essentialWriteFailed('formWatch/resultStore', String(err));
  }
}

/** Delete the persisted result for a URL (used when a project is deleted). */
export async function removeResult(url: string): Promise<void> {
  const k = resultKey(url);
  const { error } = await supabaseAdmin().from('form_watch_results').delete().eq('url_key', k);
  if (error) console.warn(`[formWatch/resultStore] removeResult: ${error.message}`);
}

/** All persisted results as a Map keyed by normalized+lowercased URL. */
export async function loadResults(): Promise<Map<string, FormWatchResult>> {
  const { data, error } = await supabaseAdmin().from('form_watch_results').select(COLS);
  if (!error) {
    return new Map((data as FormResultRow[]).map((r) => [r.url_key, rowToResult(r)]));
  }
  // Pre-migration-0013 databases have no `detail` column. Fall back to the thin
  // columns rather than losing every monitor's result over one missing field.
  const { data: base, error: baseErr } = await supabaseAdmin().from('form_watch_results').select(BASE_COLS);
  if (baseErr) {
    console.warn(`[formWatch/resultStore] loadResults: ${baseErr.message}`);
    return new Map();
  }
  return new Map((base as FormResultRow[]).map((r) => [r.url_key, rowToResult(r)]));
}
