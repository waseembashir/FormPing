/**
 * The Site Watch scheduler loop.
 *
 * Same restart-safe, single-interval design as Form Watch: a globalThis
 * singleton (so Next.js's per-bundle copies don't each start a timer), schedules
 * persisted on disk, resumed on boot. Each due schedule runs an uptime probe +
 * (for https) an SSL check, evaluates alerts, stores history, and reschedules.
 */

import type { SiteSchedule, SiteCheckRecord } from './types';
import { listSchedules, upsertSchedule } from './scheduleStore';
import { appendCheck } from './historyStore';
import { checkUptime, checkSsl } from './checks';
import { evaluateAndAlert } from './alerts';

/** How often the loop checks for due schedules. */
const TICK_MS = Number(process.env.SITE_WATCH_TICK_MS) || 60_000;

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
  const uptime = await checkUptime(schedule.url);
  // SSL only applies to https origins.
  const ssl = schedule.url.toLowerCase().startsWith('https://')
    ? await checkSsl(schedule.host)
    : null;

  const record: SiteCheckRecord = {
    scheduleId: schedule.id,
    url: schedule.url,
    host: schedule.host,
    checkedAt,
    uptime,
    ssl,
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
    };
  }

  await appendCheck(record);

  const now = Date.now();
  const updated: SiteSchedule = {
    ...schedule,
    lastCheckedAt: checkedAt,
    nextCheckAt: new Date(now + schedule.intervalMs).toISOString(),
    consecutiveDown: patch.consecutiveDown,
    alertedDown: patch.alertedDown,
    lastSslThresholdAlerted: patch.lastSslThresholdAlerted,
    lastClassification: uptime.classification,
    lastStatusCode: uptime.statusCode,
    lastResponseMs: uptime.responseMs,
    lastSslDaysRemaining: ssl?.daysRemaining ?? null,
    lastSslValid: ssl?.ok ?? undefined,
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
    const due = schedules.filter((s) => new Date(s.nextCheckAt).getTime() <= now);
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
