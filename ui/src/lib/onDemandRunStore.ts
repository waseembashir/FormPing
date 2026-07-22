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

interface OnDemandRunRow {
  url_key: string;
  input_url: string;
  final_status: string;
  reason_code: string | null;
  mode: string | null;
  form_found: boolean;
  duration_ms: number;
  ran_at: string;
}
const RUN_COLS = 'url_key, input_url, final_status, reason_code, mode, form_found, duration_ms, ran_at';
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
}

const STATUSES = ['pass', 'fail', 'warn', 'error'] as const;

/**
 * Record a Form Tester result. Accepts the raw SiteResult as `unknown` (it comes
 * straight off the CLI's streamed stdout) and defensively extracts the fields.
 * Best-effort: never throws — a bad shape or storage error is logged and dropped.
 */
export async function recordRun(raw: unknown): Promise<void> {
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
    };

    const { error } = await supabaseAdmin().from('form_tester_runs').upsert(
      {
        url_key: run.url,
        input_url: run.inputUrl,
        final_status: run.finalStatus,
        reason_code: run.reasonCode || null,
        mode: run.mode || null,
        form_found: run.formFound,
        duration_ms: run.durationMs,
        ran_at: run.ranAt,
      },
      { onConflict: 'url_key' },
    );
    if (error) console.warn(`[onDemandRunStore] recordRun: ${error.message}`);

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
}

/** Load all recorded runs as a Map keyed by normalized+lowercased URL. */
export async function loadRuns(): Promise<Map<string, OnDemandRun>> {
  const { data, error } = await supabaseAdmin().from('form_tester_runs').select(RUN_COLS);
  if (error) {
    console.warn(`[onDemandRunStore] loadRuns: ${error.message}`);
    return new Map();
  }
  return new Map((data as OnDemandRunRow[]).map((r) => [r.url_key, rowToRun(r)]));
}
