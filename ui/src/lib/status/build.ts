/**
 * Builds the status payload for a project — client-safe by default, or with
 * internal `tech` for the auth-gated team dashboard.
 *
 * Uptime/response aggregates + charts come from the Site Watch DAILY ROLLUP
 * (siteWatch/dailyStore), so 7d / 30d / all-time windows are truthful (the raw
 * history is capped). Response time, latency + check frequency live ONLY in
 * `tech` (internal). Everything else is stripped to hostname-level, client-safe
 * facts.
 */

import type { Project, UrlHealth } from '@/lib/projects/types';
import { urlHealthFor } from '@/lib/projects/health';
import { listSchedules as listSiteSchedules } from '@/lib/siteWatch/scheduleStore';
import { loadDaily, type SiteDaily } from '@/lib/siteWatch/dailyStore';
import { urlKey as key } from '@/lib/projects/projectStore';
import type { ClientStatus, OverallStatus, RespPoint, SiteUp, StatusSite, UptimeDay } from './types';
import { pickDetailSource } from './detailSource';

const DAY = 86_400_000;

/** Parse the `?window=` query into windowDays (null = all-time). Default 30. */
export function parseWindow(param: string | null | undefined): number | null {
  switch ((param ?? '').toLowerCase()) {
    case 'today':
    case '1':
    case '1d':
      return 1;
    case '7d':
    case '7':
      return 7;
    case 'all':
      return null;
    case '30d':
    case '30':
    case '':
    default:
      return 30;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Daily rollups within the last `windowDays` (null = all). */
function windowDailies(daily: SiteDaily[], windowDays: number | null): SiteDaily[] {
  if (windowDays == null) return daily;
  const cutoff = dayKey(Date.now() - (windowDays - 1) * DAY);
  return daily.filter((d) => d.day >= cutoff);
}
/** Daily rollups in the equal-length window immediately BEFORE the current one
 *  (for trend deltas). null for all-time (no defined "previous"). Empty array
 *  when there simply isn't prior history yet. */
function prevWindowDailies(daily: SiteDaily[], windowDays: number | null): SiteDaily[] | null {
  if (windowDays == null) return null;
  const cutoff = dayKey(Date.now() - (windowDays - 1) * DAY);
  const cutoffPrev = dayKey(Date.now() - (2 * windowDays - 1) * DAY);
  return daily.filter((d) => d.day >= cutoffPrev && d.day < cutoff);
}
/** Uptime % across a set of daily rollups (blocked excluded), or null. */
function uptimePct(rows: SiteDaily[]): number | null {
  let up = 0, down = 0;
  for (const r of rows) { up += r.up; down += r.down; }
  const total = up + down;
  return total ? Math.round((up / total) * 1000) / 10 : null;
}
/** Average response (ms) across daily rollups, or null. */
function avgResp(rows: SiteDaily[]): number | null {
  let sum = 0, n = 0;
  for (const r of rows) { sum += r.respSum; n += r.respN; }
  return n ? Math.round(sum / n) : null;
}
/** Incidents = days with any downtime in the window. */
function incidentDays(rows: SiteDaily[]): number {
  return rows.filter((r) => r.down > 0).length;
}

/** Contiguous per-day uptime + response series for the window (gaps → null),
 *  so the charts have an even x-axis. */
function series(daily: SiteDaily[], windowDays: number | null): { uptime: UptimeDay[]; response: RespPoint[] } {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const now = Date.now();
  // Span: fixed window, or earliest-rollup→today for all-time (capped at 120d for the chart).
  let span: number;
  if (windowDays != null) span = windowDays;
  else {
    const earliest = daily[0]?.day;
    span = earliest ? Math.min(120, Math.round((now - new Date(earliest + 'T00:00:00Z').getTime()) / DAY) + 1) : 1;
  }
  const uptime: UptimeDay[] = [];
  const response: RespPoint[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    const b = byDay.get(k);
    const total = b ? b.up + b.down : 0;
    uptime.push({ date: k, pct: total ? Math.round((b!.up / total) * 1000) / 10 : null });
    response.push({ date: k, ms: b && b.respN ? Math.round(b.respSum / b.respN) : null });
  }
  return { uptime, response };
}

/**
 * Reason codes that mean "we couldn't LOCATE a contact page/form to test" — as
 * opposed to "we tested the form and it's broken". Telling a client their
 * "contact form needs attention" for these is a false alarm: the honest state is
 * that there's nothing to report. So on the CLIENT page they read as
 * not-monitored; internally they stay a real signal (the team still sees the
 * "No contact page found" detail on the dashboard, and it still degrades the
 * internal overall).
 */
const NOT_LOCATABLE = new Set(['CONTACT_PAGE_NOT_FOUND', 'CONTACT_PAGE_AMBIGUOUS']);

/** Does this URL have uptime/SSL data to show — an active OR stopped Site Watch
 *  (a stopped monitor keeps its last result until the project is deleted)? */
function hasUptimeData(h: UrlHealth): boolean {
  return h.site.monitored || h.site.stopped === true;
}
/** Does this URL have a contact-form result to show — a scheduled/stopped Form
 *  Watch, or a manual Form Tester run? */
function hasFormResult(h: UrlHealth): boolean {
  return h.form.monitored || h.form.stopped === true || h.lastRun != null;
}

/**
 * Contact-form working/attention/not-monitored, from whichever form signal exists:
 * a scheduled/stopped Form Watch (its health level) or a manual Form Tester run
 * (a point-in-time result). Client-safe: "couldn't locate a contact page" reads
 * as not-a-result rather than a false "form is broken".
 */
function formWorking(h: UrlHealth, internal: boolean): boolean | null {
  if (h.form.monitored || h.form.stopped) {
    if (h.form.level === 'healthy') return true;
    // A recognised third-party embed is present and expected — reads as working
    // on the client-facing page, not a broken/unknown form. FR-60.
    if (h.form.level === 'detected') return true;
    if (!internal && h.form.reasonCode && NOT_LOCATABLE.has(h.form.reasonCode)) return null;
    if (h.form.level === 'attention' || h.form.level === 'failing') return false;
    return null;
  }
  if (h.lastRun) {
    if (!internal && h.lastRun.reasonCode && NOT_LOCATABLE.has(h.lastRun.reasonCode)) return null;
    if (h.lastRun.formFound) return true;
    if (h.lastRun.finalStatus === 'fail') return false;
    return null;
  }
  return null;
}

/** Internal `tech.form` block from whichever form signal exists (monitor or manual run). */
function formTech(h: UrlHealth): Pick<NonNullable<StatusSite['tech']>, 'form'> | Record<string, never> {
  // A URL can carry TWO accounts of its form: a manual Form Tester run, and a
  // Form Scheduler monitor's last check. Both come from the same engine, so
  // rather than privileging one, show whichever ran MOST RECENTLY and say which
  // it was — a panel that silently mixes two moments is how a dashboard starts
  // disagreeing with the tab it came from. FR-67.
  const run = h.lastRun;
  const monitorDetail = h.form.detail;

  const source = pickDetailSource({
    hasMonitorDetail: Boolean(monitorDetail),
    hasRunDetail: Boolean(run?.detail),
    monitorAt: h.form.lastRunAt,
    runAt: run?.ranAt,
  });

  const detailPart = source === 'monitor'
    ? {
        detail: monitorDetail,
        detailRanAt: h.form.lastRunAt ?? null,
        detailSource: 'monitor' as const,
        reasonCode: h.form.reasonCode ?? null,
      }
    : run
      ? {
          detail: run.detail,
          detailRanAt: run.ranAt ?? null,
          detailSource: 'tester' as const,
          reasonCode: run.reasonCode ?? null,
          durationMs: run.durationMs ?? null,
        }
      : {};

  if (h.form.monitored || h.form.stopped) {
    return {
      form: {
        mode: h.form.mode ?? null,
        level: h.form.level ?? null,
        label: h.form.label ?? null,
        lastRunAt: h.form.lastRunAt ?? null,
        ...detailPart,
      },
    };
  }
  if (run) {
    return {
      form: {
        mode: run.mode ?? null,
        level: null,
        label: null,
        lastRunAt: run.ranAt ?? null,
        ...detailPart,
      },
    };
  }
  return {};
}

function deriveOverall(sites: StatusSite[]): OverallStatus {
  // A PAUSED (stale) monitor's state is its last-known one, not current — so it
  // must not push the banner to "Outage"/"degraded" on uptime state alone. SSL
  // and form facts still count (SSL expiry is a fixed date; form is its own signal).
  if (sites.some((s) => s.state === 'down' && !s.stale)) return 'down';
  const degraded = sites.some(
    (s) =>
      s.formWorking === false ||
      (s.state === 'blocked' && !s.stale) ||
      (s.ssl != null && (!s.ssl.valid || (s.ssl.daysRemaining != null && s.ssl.daysRemaining <= 14))),
  );
  return degraded ? 'degraded' : 'operational';
}

/** Build a status snapshot for one project over a window (default 30 days;
 *  null = all-time). `{ internal: true }` adds per-site `tech` (full URL, HTTP
 *  status, response-time series, check frequency, domain expiry, form verdict). */
export async function buildClientStatus(
  project: Project,
  opts?: { internal?: boolean; windowDays?: number | null },
): Promise<ClientStatus> {
  const internal = opts?.internal === true;
  const windowDays = opts?.windowDays === undefined ? 30 : opts.windowDays;

  const [health, siteSchedules] = await Promise.all([urlHealthFor(project.urls), listSiteSchedules()]);
  const scheduleByKey = new Map(siteSchedules.map((s) => [key(s.url), s]));

  // Which URLs earn a status card. A card appears when we have something real to
  // show: uptime/SSL data, or a contact-form result (a monitor OR a manual run).
  // INTERNAL also cards a content-change-only URL. The PUBLIC client page is
  // stricter — only client-safe, current signals: an ACTIVE uptime monitor or a
  // form result. A stopped monitor's stale uptime is never shown to a client as
  // if live, and content changes stay internal-only (they render in the timeline).
  const included = health.filter((h) =>
    internal
      ? hasUptimeData(h) || hasFormResult(h) || h.change?.tracked === true
      : h.site.monitored || hasFormResult(h),
  );

  const sites: StatusSite[] = await Promise.all(
    included.map(async (h) => {
      // Uptime/SSL come from the last known check. A stopped monitor still shows
      // its LAST result — on BOTH the team view and the public client page — so a
      // client's status page is never blank; the `stale` flag captions it
      // "Monitoring paused · checked X ago" so stale data is never read as live
      // (FR-49 follow-up: the client-facing pages exist to inform clients, and a
      // blank card informs no one).
      const showUptime = h.site.monitored || h.site.stopped === true;
      // Showing a stopped monitor's LAST result — flag it so the card says
      // "Monitoring paused" instead of implying a live check.
      const uptimeStale = showUptime && !h.site.monitored;
      const state: SiteUp = showUptime ? (h.site.upState ?? 'unknown') : 'unknown';
      const sched = h.site.monitored ? scheduleByKey.get(key(h.url)) : undefined;
      const daily = showUptime ? await loadDaily(h.url) : [];
      const win = windowDailies(daily, windowDays);
      // Previous equal-length window, for trend deltas (null = all-time / none).
      const prev = showUptime ? prevWindowDailies(daily, windowDays) : null;
      const hasPrev = prev != null && prev.length > 0;
      const { uptime: dailyUptime, response: responseTrend } = series(daily, windowDays);

      const ssl =
        showUptime && h.site.sslDaysRemaining != null
          ? { valid: h.site.sslDaysRemaining > 0, daysRemaining: h.site.sslDaysRemaining }
          : null;

      const site: StatusSite = {
        host: hostOf(h.url),
        url: h.url,
        state,
        uptime: {
          d1: uptimePct(windowDailies(daily, 1)),
          d7: uptimePct(windowDailies(daily, 7)),
          d30: uptimePct(windowDailies(daily, 30)),
        },
        uptimeWindowPct: uptimePct(win),
        dailyUptime,
        incidents: incidentDays(win),
        ssl,
        formWorking: formWorking(h, internal),
        ...(hasPrev ? { uptimePrevPct: uptimePct(prev!), incidentsPrev: incidentDays(prev!) } : {}),
        ...(showUptime ? { lastCheckedAt: h.site.lastCheckedAt ?? null } : {}),
        ...(internal && h.change?.tracked === true ? { changeTracked: true } : {}),
        ...(uptimeStale ? { stale: true } : {}),
      };

      // Technical block — only when there's uptime or a form result to detail
      // (a content-change-only card is covered by the timeline, not tech).
      if (internal && (showUptime || hasFormResult(h))) {
        site.tech = {
          url: h.url,
          statusCode: h.site.statusCode ?? null,
          lastResponseMs: h.site.responseMs ?? null,
          lastCheckedAt: h.site.lastCheckedAt ?? null,
          domainDaysRemaining: h.site.domainDaysRemaining ?? null,
          avgResponseMs: avgResp(win),
          avgResponsePrevMs: hasPrev ? avgResp(prev!) : null,
          responseTrend,
          intervalMs: sched?.intervalMs ?? null,
          // What the last check learned about the certificate + domain. FR-67.
          ...(h.site.detail ? { check: h.site.detail } : {}),
          ...formTech(h),
        };
      }

      return site;
    }),
  );

  return {
    name: project.name,
    generatedAt: new Date().toISOString(),
    windowDays,
    overall: deriveOverall(sites),
    sites,
  };
}
