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

/** Result of a single domain-registration (WHOIS/RDAP) check. */
export interface DomainResult {
  ok: boolean;
  /** Days until the domain registration expires (negative if already expired). */
  daysRemaining: number | null;
  /** ISO expiry date. */
  expiryDate: string | null;
  registrar: string | null;
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
  /** The most severe DOMAIN-expiry threshold (days) we've already alerted at, or null. */
  lastDomainThresholdAlerted: number | null;

  // ── Compact last-result summary (for list views) ──
  lastClassification?: UptimeClass;
  lastStatusCode?: number | null;
  lastResponseMs?: number | null;
  lastSslDaysRemaining?: number | null;
  lastSslValid?: boolean;
  // ── Domain-expiry (RDAP) — the network lookup is throttled (~12h) and cached
  //    here; days-remaining is recomputed from lastDomainExpiry every cycle. ──
  lastDomainDaysRemaining?: number | null;
  lastDomainValid?: boolean;
  /** ISO expiry date from the last successful RDAP lookup (cache for recompute). */
  lastDomainExpiry?: string | null;
  /** When we last actually queried RDAP (throttles network calls). */
  lastDomainCheckedAt?: string | null;
  lastDomainRegistrar?: string | null;
}

/** One recorded check (uptime + optional SSL + optional domain). */
export interface SiteCheckRecord {
  scheduleId: string;
  url: string;
  host: string;
  checkedAt: string;
  uptime: UptimeResult;
  ssl: SslResult | null;
  /** Optional so older stored records (pre-domain-expiry) still parse. */
  domain?: DomainResult | null;
}
