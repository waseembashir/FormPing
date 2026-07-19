/**
 * Client-safe types for the per-client status page + internal dashboard.
 *
 * Client-safe (public) fields carry NO internal QA detail — no reason codes,
 * run modes, notes, exact URLs, response times, or check frequency. Anything
 * technical lives ONLY in `tech`, populated exclusively by
 * `buildClientStatus(project, { internal: true })`, so it can never reach a
 * client page. (FR-20: response time + latency + check frequency are internal.)
 */

export type OverallStatus = 'operational' | 'degraded' | 'down';
export type SiteUp = 'up' | 'down' | 'blocked' | 'unknown';

/** One day's uptime for the history chart (oldest → newest). */
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
 * Technical detail shown ONLY on the internal, auth-gated team view. The public
 * builder never sets it, so it can never leak to a client page. Includes the
 * response-time series + check frequency (internal-only as of FR-20).
 */
export interface SiteTech {
  /** Full monitored URL (internal only — the public page shows host alone). */
  url: string;
  statusCode: number | null;
  /** Response time (ms) of the most recent check. */
  lastResponseMs: number | null;
  lastCheckedAt: string | null;
  /** Days until the DOMAIN registration expires (client page shows SSL only). */
  domainDaysRemaining: number | null;
  /** Average response time (ms) over the selected window. */
  avgResponseMs: number | null;
  /** Daily average response time over the selected window (internal trend). */
  responseTrend: RespPoint[];
  /** How often this site is checked, in ms. */
  intervalMs: number | null;
  /** Contact-form monitor detail, when this URL has Form Watch. */
  form?: {
    mode: string | null;
    level: string | null;
    label: string | null;
    lastRunAt: string | null;
  };
}

/** One monitored site on the status page. */
export interface StatusSite {
  /** Hostname only (never the full internal URL). */
  host: string;
  state: SiteUp;
  /** Uptime % over rolling windows (null when there's no history yet). */
  uptime: { d1: number | null; d7: number | null; d30: number | null };
  /** Uptime % over the SELECTED window (drives the headline). */
  uptimeWindowPct: number | null;
  /** Daily uptime over the selected window (for the history chart). */
  dailyUptime: UptimeDay[];
  /** Incidents (days with any downtime) in the selected window. */
  incidents: number;
  /** SSL certificate summary, or null when SSL isn't monitored. */
  ssl: { valid: boolean; daysRemaining: number | null } | null;
  /** Contact-form health: true = working, false = attention, null = not monitored. */
  formWorking: boolean | null;
  /** Internal-only technical detail (present only on the auth-gated team view). */
  tech?: SiteTech;
}

/** The full client-safe payload rendered on /status/<token>. */
export interface ClientStatus {
  name: string;
  generatedAt: string;
  /** The selected window in days; null = all-time. */
  windowDays: number | null;
  overall: OverallStatus;
  sites: StatusSite[];
}

/** The internal, auth-gated payload — client-safe PLUS team-only context. */
export interface InternalStatus extends ClientStatus {
  contact?: string | null;
}
