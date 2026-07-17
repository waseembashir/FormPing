/**
 * The Form Watch scheduler loop.
 *
 * A single in-process interval ("tick") wakes periodically, finds schedules
 * whose nextRunAt is due, and runs them sequentially (so concurrent Chromium
 * instances never pile up regardless of how many URLs are scheduled).
 *
 * Restart-safe: schedules live on disk (scheduleStore), so after a Railway
 * redeploy the ticker — started from instrumentation on boot — simply finds
 * any now-overdue schedules and catches them up.
 *
 * Phase 1 scope: run + record history + reschedule. Notification and
 * before/after diffing are layered on in onRunComplete without touching this
 * loop's control flow.
 */

import type { FormSchedule, FormRunRecord, FormRunStatus } from './types';
import { listSchedules, upsertSchedule } from './scheduleStore';
import { appendRun } from './historyStore';
import { recordResult } from './resultStore';
import { runFormTest, type RawSiteResult } from './runner';
import { onRunComplete } from './notify';

/** How often the loop checks for due schedules. Override via env for tests. */
const TICK_MS = Number(process.env.FORM_WATCH_TICK_MS) || 60_000;

// Singleton state on globalThis. Next.js bundles this module separately for
// instrumentation and for each API route that imports it, so a plain
// module-level flag is NOT shared — each bundle would start its own interval
// (we observed the ticker start 5×, running each schedule multiple times).
// globalThis is shared across all bundles in the one Node process, so there is
// exactly ONE interval and ONE shared in-progress guard.
interface FormWatchTickerState {
  started: boolean;
  ticking: boolean;
  interval: ReturnType<typeof setInterval> | null;
}
const tickerState: FormWatchTickerState =
  ((globalThis as Record<string, unknown>).__formWatchTicker as FormWatchTickerState | undefined) ?? {
    started: false,
    ticking: false,
    interval: null,
  };
(globalThis as Record<string, unknown>).__formWatchTicker = tickerState;

function toStatus(raw: RawSiteResult): FormRunStatus {
  const s = raw.finalStatus;
  if (s === 'pass' || s === 'fail' || s === 'warn' || s === 'error') return s;
  return 'error';
}

function toRecord(schedule: FormSchedule, raw: RawSiteResult, ranAt: string): FormRunRecord {
  return {
    scheduleId: schedule.id,
    url: schedule.url,
    site: schedule.site,
    mode: schedule.mode,
    ranAt,
    status: toStatus(raw),
    reasonCode: String(raw.reasonCode ?? 'ERROR'),
    submissionResult: String(raw.submissionResult ?? 'not_attempted'),
    durationMs: Number(raw.durationMs ?? 0),
    fingerprint: {
      contactPage: raw.resolvedContactPage ?? null,
      formFound: Boolean(raw.formFound),
      formConfidence: Number(raw.formConfidence ?? 0),
      formId: raw.formIdentifier?.id ?? null,
      formAction: raw.formIdentifier?.action ?? null,
      formMethod: raw.formIdentifier?.method ?? null,
      captchaDetected: Boolean(raw.captchaDetected),
    },
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
    errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  };
}

/** An error-shaped record for when the run produced no result at all. */
function errorRecord(schedule: FormSchedule, ranAt: string, reason: string): FormRunRecord {
  return {
    scheduleId: schedule.id,
    url: schedule.url,
    site: schedule.site,
    mode: schedule.mode,
    ranAt,
    status: 'error',
    reasonCode: 'ERROR',
    submissionResult: 'not_attempted',
    durationMs: 0,
    fingerprint: {
      contactPage: null,
      formFound: false,
      formConfidence: 0,
      formId: null,
      formAction: null,
      formMethod: null,
      captchaDetected: false,
    },
    notes: [],
    errors: [reason],
  };
}

/**
 * Run one schedule now: read the previous run (for diffing), execute the form
 * test, store the result, reschedule, and fire the completion hook.
 */
async function runScheduleOnce(schedule: FormSchedule): Promise<FormRunRecord> {
  const ranAt = new Date().toISOString();
  let record: FormRunRecord;

  try {
    const raw = await runFormTest(schedule.url, schedule.mode, schedule.landingPage ?? false);
    record = raw
      ? toRecord(schedule, raw, ranAt)
      : errorRecord(schedule, ranAt, 'Form test produced no result (timeout or spawn failure)');
  } catch (err) {
    record = errorRecord(schedule, ranAt, `Run threw: ${String(err)}`);
  }

  // Notification + before/after diff happen here (layered in by notify.ts),
  // BEFORE we overwrite "latest" so it can compare against the prior run.
  try {
    await onRunComplete(schedule, record);
  } catch (err) {
    console.warn(`[formWatch/ticker] onRunComplete threw for ${schedule.url}: ${err}`);
  }

  await appendRun(record);
  // Durable per-URL result (survives stopping/deleting this monitor; only a
  // project delete clears it). See formWatch/resultStore.
  await recordResult(record);

  // Reschedule from now so intervals don't drift if a run was slow.
  const now = Date.now();
  const updated: FormSchedule = {
    ...schedule,
    lastRunAt: ranAt,
    nextRunAt: new Date(now + schedule.intervalMs).toISOString(),
    lastStatus: record.status,
    lastReasonCode: record.reasonCode,
    lastFormFound: record.fingerprint.formFound,
  };
  await upsertSchedule(updated);

  return record;
}

/** One scheduler pass: run every schedule that is currently due. */
async function tick(): Promise<void> {
  if (tickerState.ticking) return; // never overlap passes (shared across bundles)
  tickerState.ticking = true;
  try {
    const schedules = await listSchedules();
    const now = Date.now();
    const due = schedules.filter((s) => !s.paused && new Date(s.nextRunAt).getTime() <= now);
    if (due.length === 0) return;
    console.log(`[formWatch/ticker] ${due.length} schedule(s) due`);
    for (const schedule of due) {
      // Sequential: one browser at a time.
      await runScheduleOnce(schedule);
    }
  } catch (err) {
    console.warn(`[formWatch/ticker] tick failed: ${err}`);
  } finally {
    tickerState.ticking = false;
  }
}

/** Start the loop once per process (globally singleton). Safe to call repeatedly. */
export function startFormWatchTicker(): void {
  if (tickerState.started) return;
  tickerState.started = true;
  console.log(`[formWatch/ticker] started (interval ${Math.round(TICK_MS / 1000)}s)`);
  // Kick an immediate pass so overdue schedules run promptly on boot.
  void tick();
  tickerState.interval = setInterval(() => void tick(), TICK_MS);
  // Don't keep the event loop alive solely for the ticker.
  if (tickerState.interval && typeof tickerState.interval.unref === 'function') {
    tickerState.interval.unref();
  }
}

/**
 * Ensure the ticker is running and run one pass immediately. Used when a
 * schedule is added so its baseline check runs right away — guarded by the
 * shared in-progress flag, so it can never double up with the interval.
 */
export function kickFormWatchTicker(): void {
  startFormWatchTicker();
  void tick();
}
