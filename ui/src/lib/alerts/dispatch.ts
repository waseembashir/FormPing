/**
 * The single path every alert takes.
 *
 * Before this, Change Monitor, Form Watch and Site Watch each POSTed straight to
 * the Slack webhook with their own `fetch()`. No shared dispatcher meant no rate
 * limiting, no dedupe, no retry — and detail was trimmed to fit a Slack message
 * and then lost, because nothing else kept it.
 *
 * Now:
 *   1. RECORD FIRST. The alert is written to the database with 100% of its
 *      detail. That row is the record; everything else is a notification about
 *      it. If every channel fails, nothing is lost.
 *   2. DEDUPE FOR FREE. The insert is keyed on `dedupeKey`, so a repeat of the
 *      same occurrence is not stored and — crucially — not re-sent.
 *   3. FAN OUT SAFELY. Channels go through the guarded sender (queued, spaced,
 *      backed off on 429, circuit-broken).
 *   4. NEVER THROW. A channel outage must not break the monitor run.
 *
 * Adding a channel means writing a renderer, not re-deciding any of the above.
 */

import { logAlert, recordDelivery } from './store';
import { sendToSlack } from './channels/slack';
import type { AlertDelivery, AlertInput } from './types';

/** App base URL, for deep-linking a notification back to where the detail lives. */
function appBaseUrl(): string | null {
  const base =
    process.env.FORMPING_PUBLIC_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  return base ? base.replace(/\/+$/, '') : null;
}

export interface DispatchResult {
  /** False when this occurrence had already been dispatched (deduped). */
  dispatched: boolean;
  alertId: string | null;
  delivery: AlertDelivery;
}

/**
 * Record an alert and notify the configured channels.
 *
 * `moreNote` lets a sender say "there is more detail than a chat message can
 * hold" (e.g. "84 changes across 3 pages"). Channels render it verbatim next to
 * the link, so the rest is always accounted for rather than silently dropped.
 */
export async function dispatchAlert(
  alert: AlertInput,
  opts: { moreNote?: string | null; detailPath?: string | null } = {},
): Promise<DispatchResult> {
  const delivery: AlertDelivery = {};
  try {
    // 1. Log first, and let the unique dedupe_key decide whether this occurrence
    //    is new. Doing this BEFORE sending is what makes the pipeline idempotent.
    const { inserted, id } = await logAlert(alert);

    // 2. Already dispatched: do not notify again.
    if (!inserted) return { dispatched: false, alertId: id, delivery };

    // 3. Fan out. Each channel is independently guarded and allowed to fail.
    const base = appBaseUrl();
    const detailUrl = base && opts.detailPath ? `${base}${opts.detailPath}` : null;
    const slack = await sendToSlack(alert, { detailUrl, moreNote: opts.moreNote ?? null });
    delivery.slack = { ok: slack.ok, note: slack.note, at: new Date().toISOString() };

    // 4. Persist the outcome for debugging (best-effort; never blocks).
    if (id) void recordDelivery(id, delivery);

    return { dispatched: true, alertId: id, delivery };
  } catch (err) {
    // A dispatcher failure must never surface into a monitor run.
    console.warn(`[alerts/dispatch] failed for "${alert.title}": ${err}`);
    return { dispatched: false, alertId: null, delivery };
  }
}
