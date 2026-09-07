/**
 * Client-safe types for the per-client status page + internal dashboard.
 *
 * Client-safe (public) fields carry NO internal QA detail — no reason codes,
 * run modes, notes, exact URLs, response times, or check frequency. Anything
 * technical lives ONLY in `tech`, populated exclusively by
 * `buildClientStatus(project, { internal: true })`, so it can never reach a
 * client page. (FR-20: response time + latency + check frequency are internal.)
 */

import type { FormRunDetail } from '../formRunDetail';
import type { SiteCheckDetail } from '../siteWatch/resultStore';

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
  /** Average response (ms) over the window immediately BEFORE the selected one —
   *  for the trend delta. null when there's no prior history. */
  avgResponsePrevMs?: number | null;
  /** Daily average response time over the selected window (internal trend). */
  responseTrend: RespPoint[];
  /** How often this site is checked, in ms. */
  intervalMs: number | null;
  /** FR-67 — what the uptime check learned beyond the day counts: the
   *  certificate's issuer and expiry date, the domain's registrar and expiry,
   *  and why a failing check failed. Internal-only, like the rest of `tech`. */
  check?: SiteCheckDetail;
  /** Contact-form monitor detail, when this URL has Form Watch. */
  form?: {
    mode: string | null;
    level: string | null;
    label: string | null;
    lastRunAt: string | null;
    /** FR-67 — the last manual Form Tester run's reason code + rich facts, so the
     *  per-URL dashboard can explain WHAT was found and WHY it failed. Internal
     *  only (it lives in `tech`, which never reaches the public status page). */
    reasonCode?: string | null;
    /** How long the run took, in ms — shown as "took 98s" beside when it ran. */
    durationMs?: number | null;
    detail?: FormRunDetail;
    /** When the run that produced `detail` happened. A monitored URL shows its
     *  MONITOR's last check in the header, while the detail comes from the last
     *  full Form Tester run — often a different moment. Captioned rather than
     *  quietly presented under the wrong timestamp. FR-73. */
    detailRanAt?: string | null;
    /** Which tool produced `detail` — the manual Form Tester, or the scheduled
     *  monitor. A URL can have both; the newer one is shown, and named. FR-67. */
    detailSource?: 'tester' | 'monitor';
  };
}

/** One monitored site on the status page. */
export interface StatusSite {
  /** Hostname only — used to group content-change runs (tracking is site-level)
   *  and as the card's stable key. */
  host: string;
  /** Full monitored URL (host + path). Client-safe: it's the client's own page,
   *  and it's what distinguishes multiple URLs that share a host on the cards. */
  url: string;
  state: SiteUp;
  /** Uptime % over rolling windows (null when there's no history yet). */
  uptime: { d1: number | null; d7: number | null; d30: number | null };
  /** Uptime % over the SELECTED window (drives the headline). */
  uptimeWindowPct: number | null;
  /** Uptime % over the window immediately BEFORE the selected one — for the
   *  trend delta. null when there's no prior history (or all-time). Client-safe. */
  uptimePrevPct?: number | null;
  /** Incidents in that previous window — for the trend delta. Client-safe. */
  incidentsPrev?: number;
  /** Daily uptime over the selected window (for the history chart). */
  dailyUptime: UptimeDay[];
  /** Incidents (days with any downtime) in the selected window. */
  incidents: number;
  /** SSL certificate summary, or null when SSL isn't monitored. */
  ssl: { valid: boolean; daysRemaining: number | null } | null;
  /** Contact-form health: true = working, false = attention, null = not monitored. */
  formWorking: boolean | null;
  /** When this site was last checked. Client-safe — used to caption a paused
   *  monitor's last-known result ("checked X ago") so stale data reads honestly. */
  lastCheckedAt?: string | null;
  /** Internal-only: this site is tracked for content changes (labels the card when
   *  there's no uptime/form signal). Set only on the auth-gated team view. */
  changeTracked?: boolean;
  /** The uptime/SSL shown is the LAST result of a PAUSED (stopped) monitor, not a
   *  live check — the card labels it "Monitoring paused". Shown on BOTH the team
   *  view and the public client page, but always captioned with when it was
   *  checked, so a client never reads stale data as live (FR-49 follow-up). */
  stale?: boolean;
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

/**
 * One change-tracking run, for the internal timeline (FR-21).
 *
 * INTERNAL-ONLY, deliberately: content diffs are a technical QA signal, and a
 * client seeing "84 changes detected" would be alarmed by what is often their
 * own team's intentional edits. Same contract as response times.
 */
export interface ChangePoint {
  /** Hostname the run covered (change tracking is site-level, not per-URL). */
  site: string;
  mode: 'snapshot' | 'compare' | 'watch';
  checkedAt: string;
  changesFound: number;
  pagesChanged: number;
  severity: 'low' | 'medium' | 'high' | null;
  summary: string | null;
}

/** The internal, auth-gated payload — client-safe PLUS team-only context. */
export interface InternalStatus extends ClientStatus {
  contact?: string | null;
  /** Change-tracking timeline over the selected window (newest first). */
  changes?: ChangePoint[];
}
