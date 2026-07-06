/**
 * Client-safe types for the PUBLIC per-client status page.
 *
 * Intentionally minimal and reassuring — NO internal QA detail (no reason
 * codes, run modes, notes, or exact monitored URLs beyond the hostname). Pure
 * types so both the server builder and the public client page can import them
 * without pulling server code into the public bundle.
 */

export type OverallStatus = 'operational' | 'degraded' | 'down';
export type SiteUp = 'up' | 'down' | 'blocked' | 'unknown';

/** One day's uptime for the history bar (oldest → newest). */
export interface UptimeDay {
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** Uptime % for that day, or null when there were no checks. */
  pct: number | null;
}

/** One day's average response time for the trend chart (oldest → newest). */
export interface RespPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** Average response time in ms for that day, or null when no checks. */
  ms: number | null;
}

/**
 * Extra technical detail shown ONLY on the internal, auth-gated team view.
 * Populated exclusively by `buildClientStatus(project, { internal: true })` —
 * the public builder never sets it, so it can never leak to a client page.
 */
export interface SiteTech {
  /** Full monitored URL (internal only — the public page shows host alone). */
  url: string;
  /** Last HTTP status code from the uptime probe. */
  statusCode: number | null;
  /** Response time (ms) of the most recent check. */
  lastResponseMs: number | null;
  /** ISO of the last uptime check. */
  lastCheckedAt: string | null;
  /** Days until the DOMAIN registration expires (client page only shows SSL). */
  domainDaysRemaining: number | null;
  /** Contact-form monitor detail, when this URL has Form Watch. */
  form?: {
    mode: string | null;
    level: string | null;
    /** Human verdict label, e.g. "Form healthy — filled, not submitted". */
    label: string | null;
    lastRunAt: string | null;
  };
}

/** One monitored site on the client's status page. */
export interface StatusSite {
  /** Hostname only (never the full internal URL). */
  host: string;
  /** Current availability. */
  state: SiteUp;
  /** Uptime % over rolling windows (null when there's no history yet). */
  uptime: { d1: number | null; d7: number | null; d30: number | null };
  /** Average response time (ms) over the last 7 days, or null. */
  avgResponseMs: number | null;
  /** How often this site is checked, in ms (drives "checked every…"). */
  intervalMs: number | null;
  /** Last 30 days of daily uptime (for the history bar). */
  dailyUptime: UptimeDay[];
  /** Last 30 days of daily average response time (for the trend chart). */
  responseTrend: RespPoint[];
  /** SSL certificate summary, or null when SSL isn't monitored. */
  ssl: { valid: boolean; daysRemaining: number | null } | null;
  /** Contact-form health: true = working, false = attention, null = not monitored. */
  formWorking: boolean | null;
  /** Internal-only technical detail (present only on the auth-gated team view). */
  tech?: SiteTech;
}

/** The full client-safe payload rendered on /status/<token>. */
export interface ClientStatus {
  /** Client / project display name. */
  name: string;
  /** ISO timestamp this snapshot was generated. */
  generatedAt: string;
  /** Rolling uptime history window, in days. */
  windowDays: number;
  /** Worst-case overall status across all sites. */
  overall: OverallStatus;
  sites: StatusSite[];
}

/**
 * The internal, auth-gated payload — the client-safe status PLUS team-only
 * context (each site carries `tech`; the project's notify contact is included).
 * Never served from the public /api/status/[token] route.
 */
export interface InternalStatus extends ClientStatus {
  contact?: string | null;
}
