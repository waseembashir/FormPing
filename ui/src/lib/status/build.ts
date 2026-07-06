/**
 * Builds the CLIENT-SAFE status payload for a project's public status page.
 *
 * Read-only overlay on existing data:
 *  - per-URL current health from Projects' `urlHealthFor` (form level, up state, SSL)
 *  - uptime %, daily uptime history, and response-time trend from Site Watch's
 *    persisted check history
 *
 * It deliberately strips everything internal (reason codes, run modes, notes,
 * full URLs) — only a hostname, coarse status, uptime numbers, a daily history,
 * a response-time trend, an SSL bucket, and a form working/not flag ever leave
 * this function.
 */

import type { Project, UrlHealth } from '@/lib/projects/types';
import { urlHealthFor } from '@/lib/projects/health';
import { listSchedules as listSiteSchedules } from '@/lib/siteWatch/scheduleStore';
import { readHistory } from '@/lib/siteWatch/historyStore';
import type { SiteCheckRecord } from '@/lib/siteWatch/types';
import { normalizeUrl } from '@/lib/projects/projectStore';
import type { ClientStatus, OverallStatus, RespPoint, SiteUp, StatusSite, UptimeDay } from './types';

const WINDOW_DAYS = 30;
const DAY = 86_400_000;

function key(url: string): string {
  return normalizeUrl(url).toLowerCase();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** YYYY-MM-DD (UTC) for a timestamp. */
function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Uptime % over a rolling window, or null if there's no up/down signal.
 *  Only 'up' and 'down' count; 'blocked' (couldn't check — e.g. bot
 *  protection) is excluded so it never looks like an outage. */
function uptimeOver(records: SiteCheckRecord[], windowMs: number): number | null {
  const cutoff = Date.now() - windowMs;
  let up = 0;
  let down = 0;
  for (const r of records) {
    if (new Date(r.checkedAt).getTime() < cutoff) continue;
    if (r.uptime.classification === 'up') up++;
    else if (r.uptime.classification === 'down') down++;
  }
  const total = up + down;
  if (total === 0) return null;
  return Math.round((up / total) * 1000) / 10;
}

/** Average response time (ms) of 'up' checks over a window, or null. */
function avgResponse(records: SiteCheckRecord[], windowMs: number): number | null {
  const cutoff = Date.now() - windowMs;
  let sum = 0;
  let n = 0;
  for (const r of records) {
    if (new Date(r.checkedAt).getTime() < cutoff) continue;
    if (r.uptime.classification === 'up' && typeof r.uptime.responseMs === 'number') {
      sum += r.uptime.responseMs;
      n++;
    }
  }
  return n === 0 ? null : Math.round(sum / n);
}

/** Bucket the last 30 days into daily uptime % + daily avg response time. */
function dailySeries(records: SiteCheckRecord[]): { uptime: UptimeDay[]; response: RespPoint[] } {
  const now = Date.now();
  const buckets = new Map<string, { up: number; down: number; rSum: number; rN: number }>();
  for (const r of records) {
    const t = new Date(r.checkedAt).getTime();
    if (now - t > WINDOW_DAYS * DAY) continue;
    const k = dayKey(t);
    const b = buckets.get(k) ?? { up: 0, down: 0, rSum: 0, rN: 0 };
    if (r.uptime.classification === 'up') {
      b.up++;
      if (typeof r.uptime.responseMs === 'number') {
        b.rSum += r.uptime.responseMs;
        b.rN++;
      }
    } else if (r.uptime.classification === 'down') {
      b.down++;
    }
    buckets.set(k, b);
  }

  const uptime: UptimeDay[] = [];
  const response: RespPoint[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    const b = buckets.get(k);
    const total = b ? b.up + b.down : 0;
    uptime.push({ date: k, pct: total ? Math.round((b!.up / total) * 1000) / 10 : null });
    response.push({ date: k, ms: b && b.rN ? Math.round(b.rSum / b.rN) : null });
  }
  return { uptime, response };
}

/** Map a Form Watch level to the client-facing working/not/unknown flag. */
function formWorking(h: UrlHealth): boolean | null {
  if (!h.form.monitored) return null;
  if (h.form.level === 'healthy') return true;
  if (h.form.level === 'attention' || h.form.level === 'failing') return false;
  return null; // pending / never run
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

/** Build a client-safe status snapshot for one project.
 *  With `{ internal: true }` each site also carries `tech` (full URL, HTTP
 *  status, exact last response/checked, domain expiry, form verdict) for the
 *  AUTH-GATED team view. Public callers omit the option, so `tech` is never
 *  emitted and nothing internal can leak. */
export async function buildClientStatus(
  project: Project,
  opts?: { internal?: boolean },
): Promise<ClientStatus> {
  const internal = opts?.internal === true;
  const [health, siteSchedules] = await Promise.all([
    urlHealthFor(project.urls),
    listSiteSchedules(),
  ]);
  const scheduleByKey = new Map(siteSchedules.map((s) => [key(s.url), s]));

  // One entry per URL we actively monitor (site OR form). Unmonitored URLs are
  // omitted — a status page should only show what's watched.
  const monitored = health.filter((h) => h.site.monitored || h.form.monitored);

  const sites: StatusSite[] = await Promise.all(
    monitored.map(async (h) => {
      const state: SiteUp = h.site.monitored ? (h.site.upState ?? 'unknown') : 'unknown';
      const sched = h.site.monitored ? scheduleByKey.get(key(h.url)) : undefined;
      const records = sched ? await readHistory(sched.id) : [];

      const { uptime: dailyUptime, response: responseTrend } = dailySeries(records);

      const ssl =
        h.site.monitored && h.site.sslDaysRemaining != null
          ? { valid: h.site.sslDaysRemaining > 0, daysRemaining: h.site.sslDaysRemaining }
          : null;

      const site: StatusSite = {
        host: hostOf(h.url),
        state,
        uptime: {
          d1: uptimeOver(records, DAY),
          d7: uptimeOver(records, 7 * DAY),
          d30: uptimeOver(records, 30 * DAY),
        },
        avgResponseMs: avgResponse(records, 7 * DAY),
        intervalMs: sched?.intervalMs ?? null,
        dailyUptime,
        responseTrend,
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
    windowDays: WINDOW_DAYS,
    overall: deriveOverall(sites),
    sites,
  };
}
