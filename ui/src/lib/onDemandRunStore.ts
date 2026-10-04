/**
 * Persist the LAST on-demand Form Tester run per URL.
 *
 * The Form Tester (`/api/run`) streams results to the browser and then forgets
 * them — refresh and the run is gone, and Projects had no way to show "this URL
 * was manually tested". This store keeps the most recent manual run per URL so
 * the Projects detail can surface it alongside the scheduled monitors.
 *
 * Backed by Supabase (`form_tester_runs`). Writes are BEST-EFFORT: every public
 * function swallows its own errors so a storage hiccup can never break the run
 * stream that calls it. Last-write-wins on the same URL (only the latest manual
 * run matters for the one-stop view).
 */

import { urlKey as runKey } from './projects/projectStore';
import { removeDismissed } from './projects/dismissedStore';
import { supabaseAdmin } from '@/lib/supabase';
import { extractFormRunDetail, type FormRunDetail } from './formRunDetail';
import { removeShots } from './formShots';

interface OnDemandRunRow {
  url_key: string;
  input_url: string;
  final_status: string;
  reason_code: string | null;
  mode: string | null;
  form_found: boolean;
  duration_ms: number;
  ran_at: string;
  /** FR-67 — rich run facts. Absent until migration 0012 is applied. */
  detail?: FormRunDetail | null;
}
const BASE_COLS = 'url_key, input_url, final_status, reason_code, mode, form_found, duration_ms, ran_at';
const RUN_COLS = `${BASE_COLS}, detail`;
function rowToRun(r: OnDemandRunRow): OnDemandRun {
  return {
    url: r.url_key,
    inputUrl: r.input_url,
    finalStatus: r.final_status as OnDemandRun['finalStatus'],
    reasonCode: r.reason_code ?? '',
    mode: r.mode ?? '',
    formFound: r.form_found ?? false,
    durationMs: r.duration_ms ?? 0,
    ranAt: r.ran_at,
    detail: r.detail ?? undefined,
  };
}

export interface OnDemandRun {
  /** Normalized + lowercased URL — the map key. Matches health.ts's key(). */
  url: string;
  /** The URL exactly as the user entered it. */
  inputUrl: string;
  finalStatus: 'pass' | 'fail' | 'warn' | 'error';
  reasonCode: string;
  mode: string;
  formFound: boolean;
  durationMs: number;
  /** ISO timestamp of when this run was recorded. */
  ranAt: string;
  /** FR-67 — the rich facts (form type, fields, why-failed…). Undefined for rows
   *  written before migration 0012, so every reader must treat it as optional. */
  detail?: FormRunDetail;
}

const STATUSES = ['pass', 'fail', 'warn', 'error'] as const;

/**
 * Record a Form Tester result. Accepts the raw SiteResult as `unknown` (it comes
 * straight off the CLI's streamed stdout) and defensively extracts the fields.
 * Best-effort: never throws — a bad shape or storage error is logged and dropped.
 */
export async function recordRun(
  raw: unknown,
  /** Who ran the test. Absent for legacy/shared rows. FR-74. */
  owner?: string,
): Promise<void> {
  try {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    const inputUrl =
      typeof r.inputUrl === 'string' && r.inputUrl
        ? r.inputUrl
        : typeof r.normalizedUrl === 'string'
          ? r.normalizedUrl
          : '';
    if (!inputUrl) return;

    const finalStatus = (STATUSES as readonly string[]).includes(String(r.finalStatus))
      ? (r.finalStatus as OnDemandRun['finalStatus'])
      : 'error';

    const run: OnDemandRun = {
      url: runKey(inputUrl),
      inputUrl,
      finalStatus,
      reasonCode: typeof r.reasonCode === 'string' ? r.reasonCode : '',
      mode: typeof r.mode === 'string' ? r.mode : '',
      formFound: r.formFound === true,
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
      ranAt: new Date().toISOString(),
      // FR-67 — everything the engine computed about this run, kept as jsonb so
      // the per-URL dashboard can show the detail, not just a pass/fail badge.
      detail: extractFormRunDetail(raw),
    };

    const baseRow = {
      owner: owner ?? null,
      url_key: run.url,
      input_url: run.inputUrl,
      final_status: run.finalStatus,
      reason_code: run.reasonCode || null,
      mode: run.mode || null,
      form_found: run.formFound,
      duration_ms: run.durationMs,
      ran_at: run.ranAt,
    };

    const { error } = await supabaseAdmin()
      .from('form_tester_runs')
      .upsert({ ...baseRow, detail: run.detail ?? null }, { onConflict: 'url_key' });
    if (error) {
      // `detail` is missing until migration 0012 is applied — retry without it so
      // the run still persists (best-effort: never lose the row over a new column).
      const { error: retry } = await supabaseAdmin()
        .from('form_tester_runs')
        .upsert(baseRow, { onConflict: 'url_key' });
      if (retry) console.warn(`[onDemandRunStore] recordRun: ${retry.message}`);
    }

    // Re-testing a URL un-dismisses it: if it was "Don't track"-ed, testing it
    // again means the user cares about it, so bring it back to Unassigned.
    await removeDismissed(inputUrl);
  } catch (err) {
    console.warn(`[onDemandRunStore] recordRun failed: ${err}`);
  }
}

/** Delete the manual run record for a URL (used when a project is deleted, so
 *  its URLs don't linger in the Unassigned bucket). Best-effort. */
export async function removeRun(url: string): Promise<void> {
  const k = runKey(url);
  const { error } = await supabaseAdmin().from('form_tester_runs').delete().eq('url_key', k);
  if (error) console.warn(`[onDemandRunStore] removeRun: ${error.message}`);
  // The run's screenshots are part of the run. Deleting the row and leaving the
  // images behind would orphan them in Storage — nothing left to trace them to,
  // and nothing that would ever clean them up. FR-73.
  await removeShots(url);
}

/**
 * The recorded Form Tester run for one URL, or undefined if there is none.
 *
 * Exists so setting up a monitor can reuse what a manual test already worked
 * out — chiefly `detail.resolvedPage`, the contact page that test resolved. A
 * monitor pinned from it never runs discovery at all: its very first check
 * loads one page instead of crawling the client's site. FR-79.
 *
 * A keyed select rather than `loadRuns()`, which fetches every row in the table
 * to answer a question about one URL.
 */
export async function getRun(url: string): Promise<OnDemandRun | undefined> {
  const key = runKey(url);
  const get = (columns: string) =>
    supabaseAdmin().from('form_tester_runs').select(columns).eq('url_key', key).maybeSingle();

  let { data, error } = await get(RUN_COLS);
  if (error) {
    // `detail` is missing until migration 0012 is applied — see loadRuns.
    ({ data, error } = await get(BASE_COLS));
    if (error) {
      console.warn(`[onDemandRunStore] getRun: ${error.message}`);
      return undefined;
    }
  }
  return data ? rowToRun(data as unknown as OnDemandRunRow) : undefined;
}

/** Load all recorded runs as a Map keyed by normalized+lowercased URL. */
export async function loadRuns(): Promise<Map<string, OnDemandRun>> {
  const { data, error } = await supabaseAdmin().from('form_tester_runs').select(RUN_COLS);
  if (!error) return new Map((data as OnDemandRunRow[]).map((r) => [r.url_key, rowToRun(r)]));

  // `detail` is missing until migration 0012 is applied — fall back to the thin
  // columns so the dashboard keeps working (it just has no detail to show yet).
  const { data: base, error: retry } = await supabaseAdmin().from('form_tester_runs').select(BASE_COLS);
  if (retry) {
    console.warn(`[onDemandRunStore] loadRuns: ${retry.message}`);
    return new Map();
  }
  return new Map((base as OnDemandRunRow[]).map((r) => [r.url_key, rowToRun(r)]));
}
