/**
 * Pure project rollup — no I/O, no server imports, so BOTH the server
 * (health.ts) and client components (the detail page) can compute the same
 * worst-case summary from a set of per-URL health records. Kept separate from
 * health.ts (which imports server-only stores) precisely so the client can use it.
 */

import type { ProjectRollup, UrlHealth } from './types';

const FORM_RANK: Record<string, number> = { healthy: 0, pending: 1, attention: 2, failing: 3 };
const UP_RANK: Record<string, number> = { up: 0, unknown: 1, blocked: 2, down: 3 };

/** Collapse a project's per-URL health into a worst-case rollup. */
export function rollupFromHealth(health: UrlHealth[]): ProjectRollup {
  let formLevel: ProjectRollup['formLevel'];
  let formLabel: string | undefined;
  let upState: ProjectRollup['upState'];
  let sslSoonest: number | null = null;
  let domainSoonest: number | null = null;
  let lastChecked: string | null = null;
  let monitored = false;

  const newer = (a: string | null, b: string | null | undefined) => (b && (!a || b > a) ? b : a);

  for (const h of health) {
    // Include STOPPED monitors' last known results (kept until project delete),
    // so a stopped monitor still shows real data and a real "checked" time.
    // `monitored` tracks LIVE monitors only, so the status word stays honest.
    if (h.form.monitored || h.form.stopped) {
      if (h.form.monitored) monitored = true;
      if (h.form.level && (!formLevel || FORM_RANK[h.form.level] > FORM_RANK[formLevel])) {
        formLevel = h.form.level;
        formLabel = h.form.label;
      }
      lastChecked = newer(lastChecked, h.form.lastRunAt);
    }
    if (h.site.monitored || h.site.stopped) {
      if (h.site.monitored) monitored = true;
      if (h.site.upState && (!upState || UP_RANK[h.site.upState] > UP_RANK[upState])) {
        upState = h.site.upState;
      }
      if (h.site.sslDaysRemaining != null) {
        sslSoonest = sslSoonest == null ? h.site.sslDaysRemaining : Math.min(sslSoonest, h.site.sslDaysRemaining);
      }
      if (h.site.domainDaysRemaining != null) {
        domainSoonest =
          domainSoonest == null ? h.site.domainDaysRemaining : Math.min(domainSoonest, h.site.domainDaysRemaining);
      }
      lastChecked = newer(lastChecked, h.site.lastCheckedAt);
    }
  }

  // Severity (higher = worse) for worst-first sorting.
  let severity = 0;
  if (formLevel) severity = Math.max(severity, FORM_RANK[formLevel] * 10);
  if (upState) severity = Math.max(severity, UP_RANK[upState] * 10);
  if (sslSoonest != null && sslSoonest <= 14) severity = Math.max(severity, 25);
  else if (sslSoonest != null && sslSoonest <= 30) severity = Math.max(severity, 15);
  if (domainSoonest != null && domainSoonest <= 14) severity = Math.max(severity, 25);
  else if (domainSoonest != null && domainSoonest <= 30) severity = Math.max(severity, 15);
  if (!monitored) severity = -1; // unmonitored sinks to the bottom

  return { monitored, formLevel, formLabel, upState, sslSoonest, domainSoonest, lastChecked, severity };
}
