/**
 * The difference between a write that IS the result and a write that merely
 * describes it. FR-87.
 *
 * Every store in this app was best-effort: log the error, return, carry on.
 * That is right for a screenshot upload or a Slack post — a storage hiccup
 * should not kill a run that otherwise succeeded. It is wrong for the row that
 * records the run, because a run whose record never persisted did not happen as
 * far as every surface that reads it is concerned.
 *
 * On 2026-09-08 that distinction cost us real data: an insert was rejected for
 * an unknown column, the warning went to the log, and the scheduler carried on
 * writing the schedule's summary fields from a DIFFERENT statement to a
 * DIFFERENT table — which succeeded. The card read "checked 1h ago" from the
 * summary while the history it summarised was empty. The app was confidently
 * wrong rather than visibly broken, which is the worst failure a monitoring
 * tool can have.
 *
 * So writes are now sorted into two kinds:
 *
 *   ESSENTIAL  — the run record, the durable per-URL result, the rollup that
 *                feeds uptime figures. These report success, and the caller is
 *                expected to act on a failure rather than paint over it.
 *   BEST-EFFORT — screenshots, notifications, activity log, pruning. These keep
 *                failing quietly, on purpose, and say so where they do it.
 *
 * Nothing here throws. The engine run already happened and its result is in
 * memory; turning a database refusal into an exception would throw away a good
 * result on top of failing to store it.
 */

/** The outcome of a write that someone is expected to check. */
export type WriteOutcome = { ok: true } | { ok: false; reason: string };

/** The shared success value — no allocation per write. */
export const WRITE_OK: WriteOutcome = { ok: true };

/**
 * Record an essential write's failure and hand back an outcome the caller must
 * deal with.
 *
 * `console.error`, not `console.warn`: this is the line that should page
 * someone. The old warning sat in a log nobody reads next to a hundred benign
 * ones, which is how a broken write survived long enough to lose a day of runs.
 */
export function essentialWriteFailed(label: string, reason: string): WriteOutcome {
  console.error(`[${label}] ESSENTIAL WRITE FAILED — the result was not saved: ${reason}`);
  return { ok: false, reason };
}

/**
 * Note a best-effort write's failure. Stays `warn`, stays quiet, and exists so
 * the choice is visible in the code rather than implied by its absence.
 */
export function bestEffortWriteFailed(label: string, reason: string): void {
  console.warn(`[${label}] best-effort write failed (ignored by design): ${reason}`);
}

/**
 * The first real failure reason among a run's writes.
 *
 * A caller usually has several outcomes in hand and wants the one that
 * actually went wrong, without narrowing each union by hand at the call site.
 */
export function failureReason(...outcomes: WriteOutcome[]): string {
  for (const outcome of outcomes) {
    if (!outcome.ok) return outcome.reason;
  }
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * Which monitors currently have an unsaved result
 * ------------------------------------------------------------------ */

/** Which scheduler a save failure belongs to. */
export type WatchKind = 'form' | 'site';

/** What a monitor needs to say "this ran, but we could not save it". */
export interface SaveFailure {
  /** When the failed attempt happened (ISO). */
  at: string;
  /** The database's own words, for the server log and for support. */
  reason: string;
}

/**
 * In-memory, per-process, deliberately NOT a database column.
 *
 * Marking this in Postgres would mean a schema migration, and the bug we are
 * fixing was caused by code that sent a column before its migration was
 * applied. A flag that says "the database is refusing writes" is also the one
 * flag that cannot rely on writing to that database. So it lives in memory,
 * on globalThis for the same reason the tickers do — Next.js bundles this
 * module separately per route, and a plain module-level Map would give each
 * bundle its own copy.
 *
 * The trade-off, stated plainly: this resets on restart. A monitor that failed
 * to save and then survived a redeploy shows a stale "last saved" time with no
 * warning, exactly as it does today. That is strictly better than now and
 * costs no schema risk; a durable column can follow once someone is confident
 * about migration ordering.
 */
const failures: Map<string, SaveFailure> =
  ((globalThis as Record<string, unknown>).__fpSaveFailures as Map<string, SaveFailure> | undefined) ??
  new Map<string, SaveFailure>();
(globalThis as Record<string, unknown>).__fpSaveFailures = failures;

function key(kind: WatchKind, scheduleId: string): string {
  return `${kind}:${scheduleId}`;
}

/** Remember that this monitor ran but could not store what it found. */
export function noteSaveFailure(kind: WatchKind, scheduleId: string, reason: string): void {
  failures.set(key(kind, scheduleId), { at: new Date().toISOString(), reason });
}

/** Forget a past failure — called when a monitor saves successfully again. */
export function clearSaveFailure(kind: WatchKind, scheduleId: string): void {
  failures.delete(key(kind, scheduleId));
}

/** The unsaved-result state for one monitor, or null when all is well. */
export function getSaveFailure(kind: WatchKind, scheduleId: string): SaveFailure | null {
  return failures.get(key(kind, scheduleId)) ?? null;
}

/** Every monitor of this kind with an unsaved result, keyed by schedule id. */
export function saveFailures(kind: WatchKind): Record<string, SaveFailure> {
  const out: Record<string, SaveFailure> = {};
  const prefix = `${kind}:`;
  for (const [k, v] of failures) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * What a monitor may carry forward when its result did not save
 * ------------------------------------------------------------------ */

/**
 * Keep the retry cadence, drop every claim about what was found.
 *
 * This is the rule that actually fixes FR-87. A scheduler pass ends by writing
 * the schedule's summary — last run time, last status, last response — from a
 * different statement to a different table than the run record. When the run
 * record is refused and the summary is written anyway, the card reports a fresh,
 * healthy check sitting above a history that does not contain it.
 *
 * So on a failed save the schedule keeps exactly ONE field from the attempt:
 * when to try again. Everything else reverts to what the monitor last actually
 * proved. The card goes stale — visibly, honestly stale — instead of confidently
 * wrong, and the next tick is not stampeded either, because the cadence still
 * moved forward.
 */
export function keepCadenceOnly<T extends object, K extends keyof T>(
  previous: T,
  advanced: T,
  cadenceField: K,
): T {
  return { ...previous, [cadenceField]: advanced[cadenceField] };
}

/**
 * The same list, stripped to what a browser is allowed to know.
 *
 * `reason` is the database's own words — it can name tables and columns, and on
 * a constraint violation it can quote the offending value. That belongs in the
 * server log, not in a JSON payload any signed-in member can read in devtools.
 * The UI only ever needed the timestamp, so only the timestamp crosses the wire.
 *
 * Same principle as FR-86: no developer error string reaches a user surface.
 */
export function saveFailuresForClient(kind: WatchKind): Record<string, { at: string }> {
  const out: Record<string, { at: string }> = {};
  for (const [id, failure] of Object.entries(saveFailures(kind))) {
    out[id] = { at: failure.at };
  }
  return out;
}

/** Test seam — drops all remembered failures. */
export function resetSaveFailures(): void {
  failures.clear();
}
