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
import { siteCheckFacts, siteCheckScope, siteManualActionFor } from './alertFacts';
import { dispatchAlert } from '@/lib/alerts/dispatch';
import { lastAlertAt } from '@/lib/alerts/store';
import { detailPathFor } from '@/lib/alerts/link';
import type { AlertSeverity } from '@/lib/alerts/types';

/** Events that count as "we already pinged about THIS ongoing outage", so a
 *  reminder is spaced from whichever fired most recently (FR-53). */
const DOWN_EVENTS = ['down', 'monitoring_started_down', 'down_reminder'];

/** Re-notify spacing for an ongoing bad state (site down / cert or domain
 *  expired). Configurable via ALERT_RENOTIFY_HOURS (default 6h). */
function renotifyMs(): number {
  const h = Number(process.env.ALERT_RENOTIFY_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 6) * 3_600_000;
}
/** True once ALERT_RENOTIFY_HOURS has passed since the last alert for `events`
 *  at `site` — i.e. it's time for another reminder. False when we've never
 *  alerted (the state machine sends the first alert) or it's too soon. */
async function dueForRenotify(site: string, events: string[]): Promise<boolean> {
  const last = await lastAlertAt(site, events);
  return last != null && Date.now() - new Date(last).getTime() >= renotifyMs();
}

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

/**
 * Plain-language reason a site is down (FR-54: say exactly WHY, don't overclaim).
 * Prefers the HTTP status when we got one; otherwise translates the raw network
 * error captured in `checks.ts` into something actionable rather than a bare
 * "Down (error)". Kept concise so it fits an alert title + Slack preview.
 */
function downReason(record: SiteCheckRecord): string {
  const { statusCode, error } = record.uptime;
  if (statusCode != null) {
    if (statusCode >= 500) return `server error (HTTP ${statusCode})`;
    if (statusCode === 404) return 'not found (HTTP 404)';
    if (statusCode === 403) return 'forbidden (HTTP 403)';
    if (statusCode === 401) return 'auth required (HTTP 401)';
    if (statusCode >= 400) return `client error (HTTP ${statusCode})`;
    return `HTTP ${statusCode}`;
  }
  const e = (error ?? '').toLowerCase();
  if (/enotfound|eai_again|getaddrinfo/.test(e)) return 'DNS not resolving';
  if (/econnrefused/.test(e)) return 'connection refused';
  if (/econnreset/.test(e)) return 'connection reset';
  if (/etimedout|timed\s?out|timeout|aborted|abort/.test(e)) return 'timed out';
  if (/cert|tls|ssl|self[- ]signed|altname|unable to (verify|get)|handshake|eproto/.test(e)) return 'TLS/SSL error';
  if (/ehostunreach|enetunreach/.test(e)) return 'host unreachable';
  return 'no response';
}

/** Human "Up (HTTP 200)" / "Down — <reason>" string for the details block. */
function statusText(record: SiteCheckRecord): string {
  const { classification, statusCode } = record.uptime;
  if (classification === 'up') return `Up (HTTP ${statusCode})`;
  if (classification === 'blocked') return `Reachable but challenged (HTTP ${statusCode})`;
  return `Down — ${downReason(record)}`;
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
  // 'info' stays green here on purpose: for a site check, green means the site
  // answered — that IS the good outcome, unlike a form we never submitted. FR-91.

  await dispatchAlert(
    {
      kind: 'site',
      event,
      severity,
      title: headerText,
      // The verdict sentence only. The numbers move to `facts` so a channel can
      // decide how many it shows, exactly as form alerts do. FR-91.
      summary: statusText(record),
      site: record.host,
      url: record.url,
      facts: siteCheckFacts(record),
      // What this check covered — and, by saying so, what it did not.
      scope: siteCheckScope(record),
      action: siteManualActionFor(record) ?? undefined,
      suggestions,
      // One occurrence == this event for this schedule at this check time.
      dedupeKey: `site:${event}:${record.scheduleId}:${record.checkedAt}`,
      occurredAt: record.checkedAt,
    },
    { detailPath: await detailPathFor('site', record.url) },
  );
}

/** Suggestions for an outage, tuned to the SPECIFIC cause so you go straight to
 *  the fix (FR-54) — matches the reasons in `downReason`. */
function downSuggestions(record: SiteCheckRecord): string[] {
  const { statusCode, error } = record.uptime;
  const e = (error ?? '').toLowerCase();
  if (statusCode != null && statusCode >= 500)
    return [
      'The app responded but errored (5xx) — check the server/application logs for the failing request.',
      'Confirm the process is healthy (not crashing on deploy or out of memory).',
    ];
  if (statusCode === 404)
    return ['The URL returns 404 — the page or route may have moved; check the path and any recent deploy.'];
  if (statusCode != null && statusCode >= 400)
    return [`The URL returns ${statusCode} — check access rules and that the route still exists.`];
  if (/enotfound|eai_again|getaddrinfo/.test(e))
    return ['DNS isn’t resolving — the domain may have lapsed or its DNS records changed. Check the registrar and DNS settings.'];
  if (/econnrefused/.test(e))
    return ['Connection refused — the server isn’t accepting connections. Check the app/process is running and the port/firewall.'];
  if (/etimedout|timed\s?out|timeout|aborted|abort/.test(e))
    return ['The server didn’t respond in time — it may be overloaded or a firewall is dropping the request.'];
  if (/cert|tls|ssl|self[- ]signed|altname|unable to (verify|get)|handshake|eproto/.test(e))
    return ['The HTTPS/TLS connection failed — check the certificate (expired or mismatched) and the web-server’s TLS config.'];
  return ['No response from the server — confirm hosting is up, the process is running, and the domain/DNS is valid.'];
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
        headerText: `Monitoring started — ${record.host} is DOWN · ${downReason(record)}`,
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
        headerText: `Site DOWN — ${record.host} · ${downReason(record)}`,
        event: 'down',
        record,
        suggestions: downSuggestions(record),
      });
      alertedDown = true;
    } else if (alertedDown && (await dueForRenotify(record.host, DOWN_EVENTS))) {
      // Still down after the initial alert — a spaced reminder so an ongoing
      // outage doesn't go silent (FR-53). Recovery still fires exactly once.
      await postAlert({
        color: COLOR.red,
        headerEmoji: '🔴',
        headerText: `Still DOWN — ${record.host} · ${downReason(record)}`,
        event: 'down_reminder',
        record,
        suggestions: downSuggestions(record),
      });
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
      } else if (sslDays <= 0 && (await dueForRenotify(record.host, ['ssl_expiring', 'ssl_expired_reminder']))) {
        // Still expired — a spaced reminder until it's renewed (FR-53).
        await postAlert({
          color: COLOR.red,
          headerEmoji: '🔴',
          headerText: `SSL still EXPIRED — ${record.host}`,
          event: 'ssl_expired_reminder',
          record,
          suggestions: sslSuggestions(sslDays, sslExpiry),
        });
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
      } else if (domainDays <= 0 && (await dueForRenotify(record.host, ['domain_expiring', 'domain_expired_reminder']))) {
        // Still expired — a spaced reminder until it's renewed (FR-53).
        await postAlert({
          color: COLOR.red,
          headerEmoji: '🔴',
          headerText: `Domain still EXPIRED — ${record.host}`,
          event: 'domain_expired_reminder',
          record,
          suggestions: domainSuggestions(domainDays, domainExpiry),
        });
      }
    }
  }

  return { consecutiveDown, alertedDown, lastSslThresholdAlerted, lastDomainThresholdAlerted };
}
