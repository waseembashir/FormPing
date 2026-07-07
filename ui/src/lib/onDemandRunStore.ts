/**
 * Persist the LAST on-demand Form Tester run per URL.
 *
 * The Form Tester (`/api/run`) streams results to the browser and then forgets
 * them — refresh and the run is gone, and Projects had no way to show "this URL
 * was manually tested". This store keeps the most recent manual run per URL so
 * the Projects detail can surface it alongside the scheduled monitors.
 *
 * Writes are BEST-EFFORT: every public function swallows its own errors so a
 * disk hiccup can never break the run stream that calls it. Last-write-wins on
 * the same URL (only the latest manual run matters for the one-stop view).
 *
 * Path note: like reportStore, this lives INSIDE the snapshots dir so it
 * survives Railway redeploys (the persistent volume is mounted there).
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { normalizeUrl } from './projects/projectStore';
import { dataPath } from '@/lib/dataPaths';

const FILE = 'data/snapshots/.formping-ondemand-runs.json';

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

/** Default: formping/data/snapshots/…; override with FORMPING_DATA_DIR. */
function filePath(): string {
  return dataPath(FILE);
}

/** Same key shape Projects uses to match URLs to monitors. */
function runKey(url: string): string {
  return normalizeUrl(url).toLowerCase();
}

async function readAll(): Promise<Record<string, OnDemandRun>> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, OnDemandRun>) : {};
  } catch {
    return {}; // file doesn't exist yet, or is malformed — start fresh
  }
}

const STATUSES = ['pass', 'fail', 'warn', 'error'] as const;

/**
 * Record a Form Tester result. Accepts the raw SiteResult as `unknown` (it comes
 * straight off the CLI's streamed stdout) and defensively extracts the fields.
 * Best-effort: never throws — a bad shape or disk error is logged and dropped.
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

    const all = await readAll();
    all[run.url] = run;
    await mkdir(path.dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(all), 'utf-8');
  } catch (err) {
    console.warn(`[onDemandRunStore] recordRun failed: ${err}`);
  }
}

/** Load all recorded runs as a Map keyed by normalized+lowercased URL. */
export async function loadRuns(): Promise<Map<string, OnDemandRun>> {
  const all = await readAll();
  return new Map(Object.entries(all));
}
