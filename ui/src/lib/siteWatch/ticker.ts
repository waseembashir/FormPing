/**
 * The Site Watch scheduler loop.
 *
 * Same restart-safe, single-interval design as Form Watch: a globalThis
 * singleton (so Next.js's per-bundle copies don't each start a timer), schedules
 * persisted on disk, resumed on boot. Each due schedule runs an uptime probe +
 * (for https) an SSL check, evaluates alerts, stores history, and reschedules.
 */

import type { SiteSchedule, SiteCheckRecord, DomainResult } from './types';
import { listSchedules, upsertSchedule } from './scheduleStore';
import { appendCheck } from './historyStore';
import { recordResult } from './resultStore';
import { recordDaily } from './dailyStore';
import { checkUptime, checkSsl, checkDomain } from './checks';
import { evaluateAndAlert } from './alerts';

/** How often the loop checks for due schedules. */
const TICK_MS = Number(process.env.SITE_WATCH_TICK_MS) || 60_000;

/** Re-query RDAP at most this often per domain. Domain expiry only changes
 *  yearly, and public RDAP endpoints rate-limit — so between fetches we just
 *  recompute days-remaining from the cached expiry date (no network). */
const DOMAIN_RECHECK_MS = 12 * 60 * 60 * 1000;

interface SiteTickerState {
  started: boolean;
  ticking: boolean;
  interval: ReturnType<typeof setInterval> | null;
}
const tickerState: SiteTickerState =
  ((globalThis as Record<string, unknown>).__siteWatchTicker as SiteTickerState | undefined) ?? {
    started: false,
    ticking: false,
    interval: null,
  };
(globalThis as Record<string, unknown>).__siteWatchTicker = tickerState;

/** Run one schedule now: probe uptime + SSL, alert, store, reschedule. */
async function checkSiteOnce(schedule: SiteSchedule): Promise<SiteCheckRecord> {
  const checkedAt = new Date().toISOString();
  const now = Date.now();
  const uptime = await checkUptime(schedule.url);
  // SSL only applies to https origins.
  const ssl = schedule.url.toLowerCase().startsWith('https://')
    ? await checkSsl(schedule.host)
    : null;

  // Domain expiry — throttled. Only hit RDAP if it's been > DOMAIN_RECHECK_MS
  // since the last network lookup; otherwise recompute days from the cached
  // expiry (or report unknown if we've never got one). A failed lookup still
  // advances the throttle so we don't hammer RDAP on unsupported TLDs.
  const lastDomFetch = schedule.lastDomainCheckedAt ? Date.parse(schedule.lastDomainCheckedAt) : 0;
  let domain: DomainResult | null;
  let domainFetched = false;
  if (now - lastDomFetch < DOMAIN_RECHECK_MS) {
    domain = schedule.lastDomainExpiry
      ? {
          ok: true,
          daysRemaining: Math.floor((Date.parse(schedule.lastDomainExpiry) - now) / 86_400_000),
          expiryDate: schedule.lastDomainExpiry,
          registrar: schedule.lastDomainRegistrar ?? null,
        }
      : null; // last lookup failed / never succeeded — don't re-hit RDAP yet
  } else {
    domain = await checkDomain(schedule.host);
    domainFetched = true;
  }

  const record: SiteCheckRecord = {
    scheduleId: schedule.id,
    url: schedule.url,
    host: schedule.host,
    checkedAt,
    uptime,
    ssl,
    domain,
  };

  let patch;
  try {
    patch = await evaluateAndAlert(schedule, record, schedule.lastCheckedAt === null);
  } catch (err) {
    console.warn(`[siteWatch/ticker] alert eval failed for ${schedule.url}: ${err}`);
    patch = {
      consecutiveDown: schedule.consecutiveDown,
      alertedDown: schedule.alertedDown,
      lastSslThresholdAlerted: schedule.lastSslThresholdAlerted,
      lastDomainThresholdAlerted: schedule.lastDomainThresholdAlerted,
    };
  }

  await appendCheck(record);
  // Durable per-URL result (survives stopping/deleting this monitor; only a
  // project delete clears it). See siteWatch/resultStore.
  await recordResult(record);
  // Daily rollup so uptime/response over 7d/30d/all-time stay truthful (raw
  // history is capped). See siteWatch/dailyStore.
  await recordDaily(record);

  const updated: SiteSchedule = {
    ...schedule,
    lastCheckedAt: checkedAt,
    nextCheckAt: new Date(now + schedule.intervalMs).toISOString(),
    consecutiveDown: patch.consecutiveDown,
    alertedDown: patch.alertedDown,
    lastSslThresholdAlerted: patch.lastSslThresholdAlerted,
    lastDomainThresholdAlerted: patch.lastDomainThresholdAlerted,
    lastClassification: uptime.classification,
    lastStatusCode: uptime.statusCode,
    lastResponseMs: uptime.responseMs,
    lastSslDaysRemaining: ssl?.daysRemaining ?? null,
    lastSslValid: ssl?.ok ?? undefined,
    lastDomainDaysRemaining: domain?.daysRemaining ?? null,
    lastDomainValid: domain?.ok ?? undefined,
    // Advance the throttle timestamp whenever we actually queried; keep the
    // cached expiry/registrar unless a fresh lookup succeeded (so a transient
    // RDAP failure never wipes a known-good expiry).
    lastDomainCheckedAt: domainFetched ? checkedAt : schedule.lastDomainCheckedAt,
    lastDomainExpiry: domainFetched && domain?.ok ? domain.expiryDate : schedule.lastDomainExpiry,
    lastDomainRegistrar:
      domainFetched && domain?.ok ? domain.registrar : schedule.lastDomainRegistrar,
  };
  await upsertSchedule(updated);
  return record;
}

async function tick(): Promise<void> {
  if (tickerState.ticking) return;
  tickerState.ticking = true;
  try {
    const schedules = await listSchedules();
    const now = Date.now();
    const due = schedules.filter((s) => !s.paused && new Date(s.nextCheckAt).getTime() <= now);
    if (due.length === 0) return;
    console.log(`[siteWatch/ticker] ${due.length} site(s) due`);
    for (const schedule of due) {
      await checkSiteOnce(schedule);
    }
  } catch (err) {
    console.warn(`[siteWatch/ticker] tick failed: ${err}`);
  } finally {
    tickerState.ticking = false;
  }
}

/** Start the loop once per process (globally singleton). Safe to call repeatedly. */
export function startSiteWatchTicker(): void {
  if (tickerState.started) return;
  tickerState.started = true;
  console.log(`[siteWatch/ticker] started (interval ${Math.round(TICK_MS / 1000)}s)`);
  void tick();
  tickerState.interval = setInterval(() => void tick(), TICK_MS);
  if (tickerState.interval && typeof tickerState.interval.unref === 'function') {
    tickerState.interval.unref();
  }
}

/** Ensure the ticker is running and run one pass immediately (for add-time UX). */
export function kickSiteWatchTicker(): void {
  startSiteWatchTicker();
  void tick();
}
