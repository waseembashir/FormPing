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
}

interface FormResultRow {
  url_key: string;
  input_url: string;
  status: string;
  reason_code: string | null;
  form_found: boolean;
  mode: string | null;
  ran_at: string;
}
const COLS = 'url_key, input_url, status, reason_code, form_found, mode, ran_at';

function rowToResult(r: FormResultRow): FormWatchResult {
  return {
    url: r.url_key,
    inputUrl: r.input_url,
    status: r.status as FormRunStatus,
    reasonCode: r.reason_code ?? '',
    formFound: r.form_found ?? false,
    mode: r.mode ?? '',
    ranAt: r.ran_at,
  };
}

/** Record the latest scheduled form result for a URL (upsert, last-write-wins). */
export async function recordResult(record: FormRunRecord): Promise<void> {
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
    const { error } = await supabaseAdmin().from('form_watch_results').upsert(
      {
        url_key: result.url,
        input_url: result.inputUrl,
        status: result.status,
        reason_code: result.reasonCode || null,
        form_found: result.formFound,
        mode: result.mode || null,
        ran_at: result.ranAt,
      },
      { onConflict: 'url_key' },
    );
    if (error) console.warn(`[formWatch/resultStore] record: ${error.message}`);
  } catch (err) {
    console.warn(`[formWatch/resultStore] recordResult failed: ${err}`);
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
  if (error) {
    console.warn(`[formWatch/resultStore] loadResults: ${error.message}`);
    return new Map();
  }
  return new Map((data as FormResultRow[]).map((r) => [r.url_key, rowToResult(r)]));
}
