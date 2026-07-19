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

function formWorking(h: UrlHealth): boolean | null {
  if (!h.form.monitored) return null;
  if (h.form.level === 'healthy') return true;
  if (h.form.level === 'attention' || h.form.level === 'failing') return false;
  return null;
}

function deriveOverall(sites: StatusSite[]): OverallStatus {
  if (sites.some((s) => s.state === 'down')) return 'down';
  const degraded = sites.some(
    (s) =>
      s.formWorking === false ||
      s.state === 'blocked' ||
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

  // One entry per URL we actively monitor (site OR form).
  const monitored = health.filter((h) => h.site.monitored || h.form.monitored);

  const sites: StatusSite[] = await Promise.all(
    monitored.map(async (h) => {
      const state: SiteUp = h.site.monitored ? (h.site.upState ?? 'unknown') : 'unknown';
      const sched = h.site.monitored ? scheduleByKey.get(key(h.url)) : undefined;
      const daily = h.site.monitored ? await loadDaily(h.url) : [];
      const win = windowDailies(daily, windowDays);
      const { uptime: dailyUptime, response: responseTrend } = series(daily, windowDays);

      const ssl =
        h.site.monitored && h.site.sslDaysRemaining != null
          ? { valid: h.site.sslDaysRemaining > 0, daysRemaining: h.site.sslDaysRemaining }
          : null;

      const site: StatusSite = {
        host: hostOf(h.url),
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
        formWorking: formWorking(h),
      };

      if (internal) {
        site.tech = {
          url: h.url,
          statusCode: h.site.statusCode ?? null,
          lastResponseMs: h.site.responseMs ?? null,
          lastCheckedAt: h.site.lastCheckedAt ?? null,
          domainDaysRemaining: h.site.domainDaysRemaining ?? null,
          avgResponseMs: avgResp(win),
          responseTrend,
          intervalMs: sched?.intervalMs ?? null,
          ...(h.form.monitored
            ? {
                form: {
                  mode: h.form.mode ?? null,
                  level: h.form.level ?? null,
                  label: h.form.label ?? null,
                  lastRunAt: h.form.lastRunAt ?? null,
                },
              }
            : {}),
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
