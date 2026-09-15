/**
 * The Site Watch scheduler loop.
 *
 * Same restart-safe, single-interval design as Form Watch: a globalThis
 * singleton (so Next.js's per-bundle copies don't each start a timer), schedules
 * persisted on disk, resumed on boot. Each due schedule runs an uptime probe +
 * (for https) an SSL check, evaluates alerts, stores history, and reschedules.
 */

import type { SiteSchedule, SiteCheckRecord, DomainResult, RunTrigger } from './types';
import { listSchedules, upsertSchedule, getSchedule } from './scheduleStore';
import { appendCheck } from './historyStore';
import { recordResult } from './resultStore';
import { recordDaily } from './dailyStore';
import { checkUptime, checkSsl, checkDomain } from './checks';
import { evaluateAndAlert } from './alerts';
import { clearSaveFailure, failureReason, keepCadenceOnly, noteSaveFailure } from '@/lib/persistence';
import { isPermanent } from './failures';
import { clearDomainRetry, domainRetryHeld, holdDomainRetry } from './domainBackoff';

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

/**
 * Run one schedule now: probe uptime + SSL, alert, store, reschedule.
 *
 * `trigger` decides how much of that escapes this function.
 *
 * A SCHEDULED check is the monitor doing its job — the full list above.
 *
 * A MANUAL check — the Re-run button, FR-82 — runs the SAME live probes and
 * returns their real numbers (response time, status code, certificate), then
 * writes only the history row. It deliberately does not reschedule, does not
 * touch lastCheckedAt/lastResponseMs or any of the card's readouts, does not
 * fire alerts or advance the down/SSL/domain alert counters, does not overwrite
 * the durable per-URL result, and does not feed the daily rollup — that rollup
 * is the answer to "what did the schedule observe", and a check someone ran by
 * hand is not part of that answer.
 */
async function checkSiteOnce(
  schedule: SiteSchedule,
  trigger: RunTrigger = 'scheduled',
): Promise<SiteCheckRecord> {
  const manual = trigger === 'manual';
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
  //
  // A manual re-run always takes the cached path: it can't persist an advanced
  // throttle (it writes no schedule), so letting it query would mean hitting
  // RDAP on every click. Domain expiry doesn't change minute to minute, and
  // uptime/SSL — the reason you pressed Re-run — are both probed live. FR-82.
  const lastDomFetch = schedule.lastDomainCheckedAt ? Date.parse(schedule.lastDomainCheckedAt) : 0;
  /** What we already know, recomputed for today. Null if we've never had one. */
  const cachedDomain = (extra: Partial<DomainResult> = {}): DomainResult | null =>
    schedule.lastDomainExpiry
      ? {
          ok: true,
          daysRemaining: Math.floor((Date.parse(schedule.lastDomainExpiry) - now) / 86_400_000),
          expiryDate: schedule.lastDomainExpiry,
          registrar: schedule.lastDomainRegistrar ?? null,
          ...extra,
        }
      : null;

  let domain: DomainResult | null;
  let domainFetched = false;
  /**
   * Whether this attempt should consume the 12-hour success throttle. A lookup
   * that produced no answer must not, or one blip hides the expiry until
   * tomorrow — the bug behind FR-86.
   */
  let advanceThrottle = false;

  if (manual || now - lastDomFetch < DOMAIN_RECHECK_MS || domainRetryHeld(schedule.host, now)) {
    domain = cachedDomain();
  } else {
    const looked = await checkDomain(schedule.host);
    domainFetched = true;
    if (looked.ok) {
      domain = looked;
      advanceThrottle = true;
      clearDomainRetry(schedule.host);
    } else if (isPermanent('domain', looked.failure)) {
      // Nothing to wait for: this registry will not start publishing an expiry
      // because we asked twice. Keep the long throttle, as before FR-86.
      domain = looked;
      advanceThrottle = true;
      clearDomainRetry(schedule.host);
    } else {
      // Temporary. Retry in DOMAIN_RETRY_MS rather than 12 hours, and do not
      // throw away an expiry we already know just because the registry was
      // unreachable for a second — show what we have and mark it unrefreshed.
      holdDomainRetry(schedule.host, now);
      domain = cachedDomain({ stale: true, failure: looked.failure }) ?? looked;
    }
  }

  const record: SiteCheckRecord = {
    scheduleId: schedule.id,
    url: schedule.url,
    host: schedule.host,
    checkedAt,
    uptime,
    ssl,
    domain,
    trigger,
  };

  // The history row is the ONE thing a manual check writes — and the unsaved-result
  // flag is the SCHEDULE's, so a re-run does not touch it either way. Clearing it
  // here would be worse than pointless: a re-run proves only that the history
  // table accepts rows, so a successful one would wipe a warning raised by a
  // failing results or rollup write and hide a scheduled failure that is still
  // happening. A re-run must not alter the schedule, and this flag is part of
  // what the schedule's card reports. FR-82 / FR-87.
  if (manual) {
    await appendCheck(record);
    return record;
  }

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

  const savedCheck = await appendCheck(record);
  // Durable per-URL result (survives stopping/deleting this monitor; only a
  // project delete clears it). See siteWatch/resultStore.
  //
  // Both of these are skipped when the check row itself was refused: they
  // describe a result we failed to store, and writing them anyway is what let a
  // broken database look like a healthy monitor. FR-87.
  const savedResult = savedCheck.ok ? await recordResult(record) : savedCheck;
  // Daily rollup so uptime/response over 7d/30d/all-time stay truthful (raw
  // history is capped). See siteWatch/dailyStore.
  const savedDaily = savedResult.ok ? await recordDaily(record) : savedResult;

  const advanced: SiteSchedule = {
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
    // The throttle is consumed only by an attempt that actually answered —
    // either with an expiry, or with a permanent "this registry doesn't publish
    // one". A temporary failure leaves it untouched and takes the short backoff
    // instead, so a blip self-heals in half an hour rather than half a day.
    // The cached expiry/registrar survive either way. FR-86.
    lastDomainCheckedAt: advanceThrottle ? checkedAt : schedule.lastDomainCheckedAt,
    lastDomainExpiry:
      domainFetched && domain?.ok && !domain.stale ? domain.expiryDate : schedule.lastDomainExpiry,
    lastDomainRegistrar:
      domainFetched && domain?.ok && !domain.stale ? domain.registrar : schedule.lastDomainRegistrar,
  };
  if (savedCheck.ok && savedResult.ok && savedDaily.ok) {
    clearSaveFailure('site', schedule.id);
    await upsertSchedule(advanced);
  } else {
    // Keep the cadence, drop the claims — see keepCadenceOnly. Note this also
    // preserves lastDomainCheckedAt, so a failed save cannot burn the 12-hour
    // RDAP throttle on a lookup whose result was never stored.
    noteSaveFailure('site', schedule.id, failureReason(savedCheck, savedResult, savedDaily));
    await upsertSchedule({
      ...keepCadenceOnly(schedule, advanced, 'nextCheckAt'),
      // Alert bookkeeping is carried forward even here, because it is not a
      // claim about what we found — it records that we already told someone.
      // Reverting it would re-send the same "site is down" alert every
      // interval for as long as the database kept refusing writes.
      consecutiveDown: patch.consecutiveDown,
      alertedDown: patch.alertedDown,
      lastSslThresholdAlerted: patch.lastSslThresholdAlerted,
      lastDomainThresholdAlerted: patch.lastDomainThresholdAlerted,
    });
  }
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

/**
 * FR-82 — check one monitored URL NOW because a person asked, leaving the
 * schedule untouched (see `checkSiteOnce` for exactly what a manual check skips).
 *
 * Unlike a form re-run this AWAITS the result: an uptime probe plus a TLS
 * handshake takes a second or two, so the caller can hand the real numbers
 * straight back and the user sees the answer without waiting for a poll.
 *
 * Returns null if the schedule no longer exists.
 */
export async function runSiteCheckNow(scheduleId: string): Promise<SiteCheckRecord | null> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) return null;
  return checkSiteOnce(schedule, 'manual');
}
