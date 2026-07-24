/**
 * The canonical alert.
 *
 * Every notification in FormPing — Change Monitor, Form Watch, Site Watch — is
 * expressed as ONE of these and handed to the dispatcher. Channels are then just
 * renderers: adding one never means re-deciding what an alert is or re-trimming
 * its content.
 *
 * INTERNAL-ONLY. Alerts carry full technical detail (reason codes, full URLs,
 * change diffs) and go to the team, never to a client — "we are responsible for
 * their websites". Client-facing notification would be a separate feature with
 * its own client-safety review.
 */

export type AlertKind = 'change' | 'form' | 'site';
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** What a sender hands to the dispatcher. */
export interface AlertInput {
  /** Which tool raised it. */
  kind: AlertKind;
  /** What happened: 'changes_detected' | 'down' | 'recovered' | 'ssl_expiring' | … */
  event: string;
  severity?: AlertSeverity;
  /** One line, shown as the headline everywhere. */
  title: string;
  /** One or two sentences of plain-language context. */
  summary?: string;
  /** Hostname, when applicable. */
  site?: string | null;
  /** The monitored URL, when applicable. */
  url?: string | null;
  /**
   * The COMPLETE structured payload — the whole change report, the whole run
   * record, whatever the sender has. Never pre-trimmed: the inbox keeps all of
   * it, and it is a channel's job to decide how much of it it can show.
   */
  detail?: unknown;
  /** Concrete next steps ("Renew the certificate before …"). */
  suggestions?: string[];
  /**
   * Stable identifier for THIS OCCURRENCE — include the event's own timestamp,
   * e.g. `site:down:example.com:2026-07-24T09:00:00.000Z`.
   *
   * The dispatcher stores it uniquely, so re-running or retrying can never
   * produce a duplicate row or a duplicate Slack message. It is a safety net,
   * not the primary logic: senders still decide whether an alert is warranted at
   * all (Site Watch's `alertedDown` flag already stops repeat outage pings).
   */
  dedupeKey: string;
  /** ISO timestamp of the underlying event (not of the send). */
  occurredAt: string;
}

/** Per-channel delivery outcome, kept for debugging and circuit-breaking. */
export interface AlertDelivery {
  [channel: string]: {
    ok: boolean;
    /** Why it failed, or why it was skipped (e.g. "not configured", "rate limited"). */
    note?: string;
    at: string;
  };
}

// NOTE: `detail` and `suggestions` above are used to BUILD the notification; they
// are not persisted. The full detail already lives in `change_reports` /
// `site_watch_runs` / `form_watch_runs`, and the message links to the dashboard
// that renders it — so copying it into the alert log would duplicate data for no
// reader. What IS stored is in `store.ts` (`LoggedAlert`): enough to dedupe and
// to answer "did we send this, and what did the channel say?".
