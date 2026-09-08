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

import type { FormSchedule, FormRunRecord, FormRunStatus, RunTrigger } from './types';
import { listSchedules, upsertSchedule, getSchedule } from './scheduleStore';
import { appendRun } from './historyStore';
import { recordResult } from './resultStore';
import { hostFormShots } from '@/lib/formShots';
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
  /**
   * Serialises EVERY run in this process — scheduled passes and manual re-runs
   * alike — so two Chromium instances are never up at once. The `ticking` flag
   * only stops one tick pass overlapping another; it can't hold back a re-run
   * that arrives mid-pass, and a re-run must wait rather than be dropped. FR-82.
   */
  queue: Promise<unknown>;
  /** Schedule ids with a re-run in flight, so the UI can say so honestly even
   *  after a refresh (the run outlives the request that started it). FR-82. */
  manual: Set<string>;
}
const tickerState: FormWatchTickerState =
  ((globalThis as Record<string, unknown>).__formWatchTicker as FormWatchTickerState | undefined) ?? {
    started: false,
    ticking: false,
    interval: null,
    queue: Promise.resolve(),
    manual: new Set<string>(),
  };
(globalThis as Record<string, unknown>).__formWatchTicker = tickerState;
// A process that booted before this field existed still has the old shape.
tickerState.queue ??= Promise.resolve();
tickerState.manual ??= new Set<string>();

/**
 * Run `job` once everything already queued has finished, and hand back its
 * result. Failures are absorbed into the chain so one bad run can't wedge it.
 */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tickerState.queue.then(job, job);
  tickerState.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function toStatus(raw: RawSiteResult): FormRunStatus {
  const s = raw.finalStatus;
  if (s === 'pass' || s === 'fail' || s === 'warn' || s === 'error') return s;
  return 'error';
}

function toRecord(schedule: FormSchedule, raw: RawSiteResult, ranAt: string, trigger: RunTrigger): FormRunRecord {
  return {
    trigger,
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
      formType: raw.formType,
      embedProvider: raw.embedProvider ?? null,
      embedKind: raw.embedKind ?? null,
      fieldCount: typeof raw.fieldCount === 'number' ? raw.fieldCount : undefined,
      fields: Array.isArray(raw.fields) ? raw.fields : undefined,
      isMultiStep: Boolean(raw.isMultiStep),
      landingPageMode: Boolean(raw.landingPageMode),
      formsOnPage: raw.formsOnPage && typeof raw.formsOnPage === 'object' ? raw.formsOnPage : undefined,
      tracking: raw.tracking && typeof raw.tracking === 'object' ? raw.tracking : undefined,
      // FR-73 — the same engine ran this, so it carries the same doubts. Without
      // these a scheduled run would present a weak match as a confident pass
      // while the Tester, on the identical result, said it wasn't sure.
      formConfidenceLevel:
        raw.formConfidenceLevel === 'low' || raw.formConfidenceLevel === 'high' ? raw.formConfidenceLevel : undefined,
      lowConfidenceReason: typeof raw.lowConfidenceReason === 'string' ? raw.lowConfidenceReason : undefined,
      pageProtection: typeof raw.pageProtection === 'boolean' ? raw.pageProtection : undefined,
    },
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
    errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  };
}

/** An error-shaped record for when the run produced no result at all. */
function errorRecord(schedule: FormSchedule, ranAt: string, reason: string, trigger: RunTrigger): FormRunRecord {
  return {
    trigger,
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
 * Run one schedule now.
 *
 * `trigger` decides how much of the run is allowed to escape this function.
 *
 * A SCHEDULED run is the monitor doing its job: it notifies, stores the durable
 * per-URL result, and reschedules itself.
 *
 * A MANUAL run — the Re-run button, FR-82 — takes the IDENTICAL engine path with
 * the same mode and landing-page setting (that identity is the whole point: a
 * re-run must never be able to drift from what the monitor actually does), then
 * writes ONLY the history row. It deliberately does not:
 *   • reschedule, or touch lastRunAt/lastStatus — the card keeps reporting the
 *     schedule's own cadence, so "checked 1d ago" stays true
 *   • fire onRunComplete — no Slack alert, no before/after diff against a run
 *     the user didn't ask to be compared with
 *   • call recordResult — Projects and the dashboards keep showing what the
 *     SCHEDULE observed, which is what those surfaces claim to show
 *   • overwrite the scheduled run's screenshots (see the folder note below)
 *
 * You want to check a URL right now; that should not cost you the schedule you
 * set up for it.
 */
async function runScheduleOnce(
  schedule: FormSchedule,
  trigger: RunTrigger = 'scheduled',
): Promise<FormRunRecord> {
  const manual = trigger === 'manual';
  const ranAt = new Date().toISOString();
  let record: FormRunRecord;
  // The raw engine result, kept so the durable per-URL row can store the SAME
  // rich detail a manual test does. The scheduler runs the identical engine;
  // only its storage was thinner. FR-67.
  let raw: RawSiteResult | null = null;

  try {
    raw = await runFormTest(schedule.url, schedule.mode, schedule.landingPage ?? false);
    if (raw) {
      // Screenshots arrive as inline `data:` URLs. Host them before anything is
      // stored, exactly as /api/run does — base64 in a database row would bloat
      // every read of it. Bounded: images are keyed per URL and replaced, so a
      // monitor checking every 3 days does not accumulate them. FR-73.
      //
      // A re-run uses its OWN folder. The per-URL folder is cleared before each
      // upload, so hosting a manual run there would delete the images the
      // scheduled result still points at — the stored run would keep its verdict
      // but lose its evidence. FR-82.
      await hostFormShots(raw, manual ? { variant: 'manual' } : undefined);
    }
    record = raw
      ? toRecord(schedule, raw, ranAt, trigger)
      : errorRecord(schedule, ranAt, 'Form test produced no result (timeout or spawn failure)', trigger);
  } catch (err) {
    record = errorRecord(schedule, ranAt, `Run threw: ${String(err)}`, trigger);
  }

  // Notification + before/after diff happen here (layered in by notify.ts),
  // BEFORE we overwrite "latest" so it can compare against the prior run.
  if (!manual) {
    try {
      await onRunComplete(schedule, record);
    } catch (err) {
      console.warn(`[formWatch/ticker] onRunComplete threw for ${schedule.url}: ${err}`);
    }
  }

  // The history row is the ONE thing a manual run writes.
  await appendRun(record);
  if (manual) return record;

  // Durable per-URL result (survives stopping/deleting this monitor; only a
  // project delete clears it). See formWatch/resultStore.
  await recordResult(record, raw);

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
      // Sequential: one browser at a time — via the shared queue, so a re-run
      // that lands mid-pass waits its turn instead of racing this one.
      await enqueue(() => runScheduleOnce(schedule));
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

/** True while a Re-run is in flight for this schedule. */
export function isManualRunInFlight(scheduleId: string): boolean {
  return tickerState.manual.has(scheduleId);
}

/**
 * FR-82 — run one schedule NOW because a person asked, and leave the schedule
 * itself untouched (see `runScheduleOnce` for exactly what a manual run skips).
 *
 * Returns as soon as the run is QUEUED, not when it finishes: a form run spawns
 * Chromium and can take a minute or more, far too long to hold an HTTP request
 * open. The caller polls the history for the new row, which is also what makes
 * the result survive a refresh or a tab change mid-run.
 */
export function startManualFormRun(schedule: FormSchedule): void {
  if (tickerState.manual.has(schedule.id)) return; // already running — don't stack
  tickerState.manual.add(schedule.id);
  void enqueue(() => runScheduleOnce(schedule, 'manual'))
    .catch((err) => console.warn(`[formWatch/ticker] manual run failed for ${schedule.url}: ${err}`))
    .finally(() => tickerState.manual.delete(schedule.id));
}

/** Look up a schedule and start a manual run for it. Returns false if unknown. */
export async function requestManualFormRun(scheduleId: string): Promise<FormSchedule | null> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) return null;
  startManualFormRun(schedule);
  return schedule;
}
