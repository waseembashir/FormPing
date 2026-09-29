/**
 * When one outage becomes one alert — the policy, with no I/O.
 *
 * If the outbound proxy is down, every monitor meets it on its next run: forty
 * schedules, forty identical messages, one cause. The alert belongs at the level
 * of the cause.
 *
 * That needs no coordination, no lock and no new table. The dispatcher already
 * refuses a duplicate `dedupeKey` — the unique constraint that makes the whole
 * pipeline idempotent — so a key that changes only when the window rolls over
 * gives exactly the behaviour wanted: the first monitor to hit the outage
 * speaks, every other monitor in that window is deduped in silence, and the
 * next window speaks again so a persisting outage cannot be forgotten.
 *
 * Kept apart from the dispatching module deliberately. This is policy, and it
 * is the part worth testing hard; keeping it free of the database client means
 * its tests need no stand-in for infrastructure they never touch. FR-103.
 */

/** The re-notify spacing used everywhere else, so one cadence, not two. */
function windowMs(): number {
  const h = Number(process.env.ALERT_RENOTIFY_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 6) * 3_600_000;
}

/**
 * Which outage window a moment falls in.
 *
 * The "one alert per outage" guarantee rests entirely on this number being
 * stable within a window and different across one.
 */
export function outageWindow(now: number = Date.now()): number {
  return Math.floor(now / windowMs());
}

/** The key two monitors in the same window must agree on — and do. */
export function outageDedupeKey(now: number = Date.now()): string {
  return `monitoring-blocked:${outageWindow(now)}`;
}
