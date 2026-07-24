/**
 * Site Watch alerting — rich, color-coded Slack notifications.
 *
 * Covers BOTH healthy and problem states, with distinct styling, a details
 * block, and suggestions:
 *   - First check after a monitor is added → a "monitoring started" baseline
 *     (green if healthy, red if already down) so you immediately see it working.
 *   - Ongoing: DOWN (after 2 consecutive fails — flap protection) and RECOVERED
 *     ("all good again"); SSL warnings once per threshold (30/14/7/expired).
 *
 * Delivery goes through the shared alert dispatcher (deduped, rate-limited,
 * backed off on 429, logged). Best-effort — never throws.
 *
 * Cadence is change-based, not every cycle — checks run every few minutes, so
 * a ping per check would be spam. The "all fine" signal is the baseline +
 * recovered notifications.
 */

import type { SiteSchedule, SiteCheckRecord } from './types';
import { dispatchAlert } from '@/lib/alerts/dispatch';
import { detailPathFor } from '@/lib/alerts/link';
import type { AlertSeverity } from '@/lib/alerts/types';

export interface AlertStatePatch {
  consecutiveDown: number;
  alertedDown: boolean;
  lastSslThresholdAlerted: number | null;
  lastDomainThresholdAlerted: number | null;
}

const COLOR = { green: '#16a34a', amber: '#d97706', red: '#dc2626' };

/** Expiry severity bucket (days). Lower = more severe; null = healthy (>30d).
 *  Shared by both the SSL-certificate and domain-registration checks. */
function expiryBucket(days: number): number | null {
  if (days <= 0) return 0;
  if (days <= 7) return 7;
  if (days <= 14) return 14;
  if (days <= 30) return 30;
  return null;
}

/** Human "Up (HTTP 200)" / "Down (error)" string for the details block. */
function statusText(record: SiteCheckRecord): string {
  const { classification, statusCode, error } = record.uptime;
  if (classification === 'up') return `Up (HTTP ${statusCode})`;
  if (classification === 'blocked') return `Reachable but challenged (HTTP ${statusCode})`;
  return statusCode ? `Down (HTTP ${statusCode})` : `Down (${error ?? 'no response'})`;
}

/** SSL summary string for the details block. */
function sslText(record: SiteCheckRecord): string {
  const ssl = record.ssl;
  if (!ssl) return 'n/a (not HTTPS)';
  if (!ssl.ok || ssl.daysRemaining == null) return ssl.error ?? 'check failed';
  const expiry = ssl.validTo ? new Date(ssl.validTo).toLocaleDateString() : '?';
  return ssl.daysRemaining <= 0
    ? `EXPIRED (was valid to ${expiry})`
    : `${ssl.daysRemaining} day${ssl.daysRemaining === 1 ? '' : 's'} left (expires ${expiry})`;
}

/** Domain-registration summary string for the details block. */
function domainText(record: SiteCheckRecord): string {
  const d = record.domain;
  if (!d) return 'n/a';
  if (!d.ok || d.daysRemaining == null) return d.error ?? 'check failed';
  const expiry = d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : '?';
  return d.daysRemaining <= 0
    ? `EXPIRED (was valid to ${expiry})`
    : `${d.daysRemaining} day${d.daysRemaining === 1 ? '' : 's'} left (expires ${expiry})`;
}

/**
 * Hand one alert to the shared dispatcher. Best-effort — never throws.
 *
 * This used to POST straight to the Slack webhook itself. It now goes through
 * `dispatchAlert`, so it is deduped, rate-limited, backed off on 429 and logged
 * like every other alert. The DECISIONS about when to alert (the state machine
 * in `evaluateAndAlert` below — consecutive-down counting, threshold buckets)
 * are deliberately unchanged: this function only changes delivery.
 *
 * `headerEmoji` is retained on the signature so call sites stay untouched; the
 * dispatcher now picks the emoji from `severity`.
 */
async function postAlert(opts: {
  color: string;
  headerEmoji: string;
  headerText: string;
  /** Machine-readable event name for the alert log + dedupe key. */
  event: string;
  record: SiteCheckRecord;
  suggestions?: string[];
}): Promise<void> {
  const { color, headerText, event, record, suggestions } = opts;
  const severity: AlertSeverity =
    color === COLOR.red ? 'critical' : color === COLOR.amber ? 'warning' : 'info';

  await dispatchAlert(
    {
      kind: 'site',
      event,
      severity,
      title: headerText,
      summary:
        `${statusText(record)} · ${record.uptime.responseMs} ms · ` +
        `SSL ${sslText(record)} · Domain ${domainText(record)}`,
      site: record.host,
      url: record.url,
      suggestions,
      // One occurrence == this event for this schedule at this check time.
      dedupeKey: `site:${event}:${record.scheduleId}:${record.checkedAt}`,
      occurredAt: record.checkedAt,
    },
    { detailPath: await detailPathFor('site', record.url) },
  );
}

/** Suggestions for an outage, tuned to the kind of failure. */
function downSuggestions(record: SiteCheckRecord): string[] {
  const code = record.uptime.statusCode;
  const out = ['Check the hosting/server and confirm the domain hasn’t lapsed.'];
  if (code && code >= 500) {
    out.push('A 5xx means the app responded but errored — check the server/app logs.');
  } else if (code == null) {
    out.push('No response at all — the server may be down, or DNS/the domain may have failed.');
  }
  return out;
}

function sslSuggestions(days: number, expiry: string): string[] {
  if (days <= 0) {
    return [
      'Renew the certificate immediately — visitors currently see a "Not Secure" warning.',
      'If on Let’s Encrypt, the auto-renewal has failed — check the renewal job.',
    ];
  }
  return [
    `Renew the TLS certificate before ${expiry}.`,
    'If on Let’s Encrypt, verify auto-renewal is working so it doesn’t lapse.',
  ];
}

function domainSuggestions(days: number, expiry: string): string[] {
  if (days <= 0) {
    return [
      'Renew the domain registration immediately — the site will stop resolving for everyone.',
      'Contact the registrar; the domain may still be in a grace/redemption period.',
    ];
  }
  return [
    `Renew the domain registration before ${expiry}.`,
    'Turn on registrar auto-renew so it can’t lapse.',
  ];
}

/**
 * Evaluate the new check, fire any styled Slack alerts, and return the updated
 * alert-state fields. `isFirstCheck` triggers the baseline notification.
 */
export async function evaluateAndAlert(
  schedule: SiteSchedule,
  record: SiteCheckRecord,
  isFirstCheck: boolean,
): Promise<AlertStatePatch> {
  let consecutiveDown = schedule.consecutiveDown ?? 0;
  let alertedDown = schedule.alertedDown ?? false;
  let lastSslThresholdAlerted = schedule.lastSslThresholdAlerted ?? null;
  let lastDomainThresholdAlerted = schedule.lastDomainThresholdAlerted ?? null;

  const cls = record.uptime.classification;
  const isUp = cls === 'up' || cls === 'blocked';
  const sslDays = record.ssl?.ok ? record.ssl.daysRemaining : null;
  const sslExpiry = record.ssl?.validTo ? new Date(record.ssl.validTo).toLocaleDateString() : '?';
  const domainDays = record.domain?.ok ? record.domain.daysRemaining : null;
  const domainExpiry = record.domain?.expiryDate
    ? new Date(record.domain.expiryDate).toLocaleDateString()
    : '?';

  // ── Baseline notification on the very first check ──
  if (isFirstCheck) {
    if (isUp) {
      await postAlert({
        color: COLOR.green,
        headerEmoji: '✅',
        headerText: `Monitoring started — ${record.host} is healthy`,
        event: 'monitoring_started',
        record,
        suggestions: ['We’ll alert you here if it goes down or the SSL certificate nears expiry.'],
      });
    } else {
      await postAlert({
        color: COLOR.red,
        headerEmoji: '🔴',
        headerText: `Monitoring started — ${record.host} is DOWN`,
        event: 'monitoring_started_down',
        record,
        suggestions: downSuggestions(record),
      });
      consecutiveDown = 1;
      alertedDown = true; // we've announced it; don't double-alert next cycle
    }
    // Seed SSL state so we don't immediately re-announce an already-near expiry.
    if (sslDays != null && sslDays <= 30) lastSslThresholdAlerted = expiryBucket(sslDays);
    // SSL warning still worth saying on day one if it's already close — handled below
    if (sslDays != null && sslDays <= 30) {
      await postAlert({
        color: sslDays <= 0 ? COLOR.red : COLOR.amber,
        headerEmoji: sslDays <= 0 ? '🔴' : '⚠️',
        headerText:
          sslDays <= 0 ? `SSL EXPIRED — ${record.host}` : `SSL expiring soon — ${record.host}`,
        event: 'ssl_expiring',
        record,
        suggestions: sslSuggestions(sslDays, sslExpiry),
      });
    }
    // Seed + announce a near/expired DOMAIN registration on day one, same as SSL.
    if (domainDays != null && domainDays <= 30) {
      lastDomainThresholdAlerted = expiryBucket(domainDays);
      await postAlert({
        color: domainDays <= 0 ? COLOR.red : COLOR.amber,
        headerEmoji: domainDays <= 0 ? '🔴' : '⚠️',
        headerText:
          domainDays <= 0 ? `Domain EXPIRED — ${record.host}` : `Domain expiring soon — ${record.host}`,
        event: 'domain_expiring',
        record,
        suggestions: domainSuggestions(domainDays, domainExpiry),
      });
    }
    return { consecutiveDown, alertedDown, lastSslThresholdAlerted, lastDomainThresholdAlerted };
  }

  // ── Uptime (change-based) ──
  if (cls === 'down') {
    consecutiveDown += 1;
    if (consecutiveDown >= 2 && !alertedDown) {
      await postAlert({
        color: COLOR.red,
        headerEmoji: '🔴',
        headerText: `Site DOWN — ${record.host}`,
        event: 'down',
        record,
        suggestions: downSuggestions(record),
      });
      alertedDown = true;
    }
  } else {
    if (alertedDown) {
      await postAlert({
        color: COLOR.green,
        headerEmoji: '✅',
        headerText: `Site back UP — ${record.host}`,
        event: 'recovered',
        record,
        suggestions: ['Recovered. Confirm the root cause so it doesn’t recur.'],
      });
    }
    consecutiveDown = 0;
    alertedDown = false;
  }

  // ── SSL (threshold-based) ──
  if (sslDays != null) {
    if (sslDays > 30) {
      lastSslThresholdAlerted = null; // renewed — reset
    } else {
      const bucket = expiryBucket(sslDays);
      if (bucket !== null && (lastSslThresholdAlerted === null || bucket < lastSslThresholdAlerted)) {
        await postAlert({
          color: sslDays <= 0 ? COLOR.red : COLOR.amber,
          headerEmoji: sslDays <= 0 ? '🔴' : '⚠️',
          headerText:
            sslDays <= 0 ? `SSL EXPIRED — ${record.host}` : `SSL expiring soon — ${record.host}`,
          event: 'ssl_expiring',
          record,
          suggestions: sslSuggestions(sslDays, sslExpiry),
        });
        lastSslThresholdAlerted = bucket;
      }
    }
  }

  // ── Domain registration (threshold-based, mirrors SSL) ──
  if (domainDays != null) {
    if (domainDays > 30) {
      lastDomainThresholdAlerted = null; // renewed — reset
    } else {
      const bucket = expiryBucket(domainDays);
      if (bucket !== null && (lastDomainThresholdAlerted === null || bucket < lastDomainThresholdAlerted)) {
        await postAlert({
          color: domainDays <= 0 ? COLOR.red : COLOR.amber,
          headerEmoji: domainDays <= 0 ? '🔴' : '⚠️',
          headerText:
            domainDays <= 0 ? `Domain EXPIRED — ${record.host}` : `Domain expiring soon — ${record.host}`,
          event: 'domain_expiring',
          record,
          suggestions: domainSuggestions(domainDays, domainExpiry),
        });
        lastDomainThresholdAlerted = bucket;
      }
    }
  }

  return { consecutiveDown, alertedDown, lastSslThresholdAlerted, lastDomainThresholdAlerted };
}
