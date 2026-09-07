/**
 * FR-67 — decide WHICH run's detail a URL's dashboard should show.
 *
 * A URL can carry two accounts of its contact form: a manual Form Tester run,
 * and a Form Scheduler monitor's last check. Both come from the same engine, so
 * neither is inherently more truthful — the useful one is simply the more
 * RECENT one, and the panel then names which it was.
 *
 * Getting this wrong is quiet and confusing: show the older one and the page
 * contradicts the tab the user just came from; show one without saying which and
 * two different moments read as a single event.
 *
 * Deliberately import-free and pure so the engine's Vitest can cover it.
 */

export type DetailSource = 'tester' | 'monitor';

export function pickDetailSource(input: {
  /** The scheduled monitor's last check has stored detail. */
  hasMonitorDetail: boolean;
  /** The manual Form Tester run has stored detail. */
  hasRunDetail: boolean;
  /** ISO timestamp of the monitor's last check. */
  monitorAt?: string | null;
  /** ISO timestamp of the manual run. */
  runAt?: string | null;
}): DetailSource | null {
  const { hasMonitorDetail, hasRunDetail } = input;
  if (!hasMonitorDetail && !hasRunDetail) return null;
  if (!hasMonitorDetail) return 'tester';
  if (!hasRunDetail) return 'monitor';

  // Both exist — the newer one wins. When a timestamp is missing or unparseable
  // we fall back to the monitor, because it is the thing still running: a live
  // check is a better default than a manual run of unknown age.
  const m = input.monitorAt ? Date.parse(input.monitorAt) : NaN;
  const r = input.runAt ? Date.parse(input.runAt) : NaN;
  if (Number.isNaN(m) || Number.isNaN(r)) return 'monitor';
  return m >= r ? 'monitor' : 'tester';
}
