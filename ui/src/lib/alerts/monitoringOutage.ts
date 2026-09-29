/**
 * An outage of OUR monitoring, announced as ours.
 *
 * When the outbound proxy refuses to forward a submission, the request never
 * reaches the client's site. Nothing is learned about their form — yet the
 * alert read "Contact form failing — clientsite.com", which accuses a client of
 * a fault that is entirely ours. That is the mis-attribution FR-97 set out to
 * end, arriving through a different door.
 *
 * It cannot simply go quiet, either. While the proxy is down, every Live
 * submission check is testing nothing, across every monitor at once. A silent
 * wrong all-clear is worse than a loud wrong accusation.
 *
 * So it is loud, and it is aimed at us:
 *   - `critical`, because monitoring is not doing its job;
 *   - the headline names the monitoring, never the client's form;
 *   - raised ONCE per outage window however many monitors hit it, because the
 *     cause is one thing even when forty schedules trip over it;
 *   - raised AGAIN each window while it persists, so it cannot be forgotten.
 *
 * "Once per window" is decided in `outageWindow.ts`, which holds that policy
 * with no I/O so it can be tested without standing in for a database. FR-103.
 */

import { dispatchAlert } from './dispatch';
import { outageDedupeKey } from './outageWindow';
import type { AlertSeverity } from './types';

/**
 * Announce that submissions are being blocked before they reach the site.
 *
 * `site` is recorded as the monitor that happened to discover the outage, not
 * as its subject: the message is about our monitoring. It is passed so the
 * alert log has a concrete example to look at, and deliberately NOT used in
 * the headline.
 */
export async function reportSubmissionsBlocked(opts: {
  /** The monitor that hit it first — an example, not the cause. */
  site: string;
  url: string;
  /** What the engine said, for the facts line. */
  detail?: string | null;
  occurredAt: string;
}): Promise<void> {
  const severity: AlertSeverity = 'critical';
  await dispatchAlert({
    kind: 'form',
    event: 'monitoring_blocked',
    severity,
    title: 'Form checks are not running — submissions are blocked before they reach the site',
    summary:
      'Our outbound proxy refused to forward the submission, so it never reached the site. ' +
      'No conclusion can be drawn about any monitored form until this is fixed.',
    site: opts.site,
    url: opts.url,
    facts: [
      // Named as an example so nobody reads this as "this client's form broke".
      `first seen on ${opts.site}`,
      'every Live submission check is affected',
    ],
    scope: 'This is our monitoring, not the monitored site.',
    action:
      'Check the proxy provider: an unpaid or suspended plan, incomplete verification, or an expired allowance. ' +
      'Monitored forms may be perfectly healthy — we currently cannot tell.',
    dedupeKey: outageDedupeKey(Date.parse(opts.occurredAt) || Date.now()),
    occurredAt: opts.occurredAt,
  });
}
