/**
 * Types for Site Watch — a NEW, self-contained feature that monitors site
 * availability (uptime) and TLS certificate expiry (SSL) on a schedule.
 *
 * Deliberately separate from Form Watch: the data is different (no form
 * submission, no fingerprint), so it gets its own light data model. It reuses
 * the same proven patterns (globalThis-singleton ticker, JSON-on-volume
 * storage, Slack webhook) without importing or modifying Form Watch.
 */

export type UptimeClass = 'up' | 'down' | 'blocked';

/** Result of a single uptime probe. */
export interface UptimeResult {
  classification: UptimeClass;
  statusCode: number | null;
  responseMs: number;
  error?: string;
}

/** Result of a single TLS-certificate check. */
export interface SslResult {
  ok: boolean;
  /** Days until the certificate expires (can be negative if already expired). */
  daysRemaining: number | null;
  /** ISO expiry date. */
  validTo: string | null;
  issuer: string | null;
  error?: string;
}

/** A recurring availability/SSL monitor for one site. */
export interface SiteSchedule {
  id: string;
  url: string;
  host: string;
  /** How often to check, in milliseconds. */
  intervalMs: number;
  createdAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;

  // ── Alert state (persisted so alerts fire only on change, not every cycle) ──
  /** Consecutive down probes — used for flap protection. */
  consecutiveDown: number;
  /** True once we've alerted for the current outage (so we don't repeat). */
  alertedDown: boolean;
  /** The most severe SSL threshold (days) we've already alerted at, or null. */
  lastSslThresholdAlerted: number | null;

  // ── Compact last-result summary (for list views) ──
  lastClassification?: UptimeClass;
  lastStatusCode?: number | null;
  lastResponseMs?: number | null;
  lastSslDaysRemaining?: number | null;
  lastSslValid?: boolean;
}

/** One recorded check (uptime + optional SSL). */
export interface SiteCheckRecord {
  scheduleId: string;
  url: string;
  host: string;
  checkedAt: string;
  uptime: UptimeResult;
  ssl: SslResult | null;
}
