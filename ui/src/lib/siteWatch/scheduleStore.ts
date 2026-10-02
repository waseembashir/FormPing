/**
 * Persistence for Site Watch schedules.
 *
 * Backed by Supabase (`site_watch_schedules` table). Exported functions keep the
 * same signatures so callers are unchanged. Best-effort: errors logged, never
 * thrown.
 */

import type { SiteSchedule, UptimeClass } from './types';
import { supabaseAdmin } from '@/lib/supabase';
import { ownerFilterExpression, visibleTo } from '@/lib/ownership';
import { urlKey } from '@/lib/projects/projectStore';

/**
 * Canonical URL match key — delegates to the app-wide `urlKey`, so a schedule is
 * matched the SAME way Projects matches URLs, including treating `www.` and
 * non-`www` as the same site. See the note in formWatch/scheduleStore: a local
 * key that ignored `www.` meant a project delete could silently miss its monitor
 * and leave it running.
 */
const normKey = urlKey;

interface SiteScheduleRow {
  id: string;
  owner: string | null;
  url: string;
  host: string;
  interval_ms: number;
  created_at: string;
  last_checked_at: string | null;
  next_check_at: string;
  paused: boolean;
  consecutive_down: number;
  alerted_down: boolean;
  last_ssl_threshold_alerted: number | null;
  last_domain_threshold_alerted: number | null;
  last_classification: string | null;
  last_status_code: number | null;
  last_response_ms: number | null;
  last_ssl_days_remaining: number | null;
  last_ssl_valid: boolean | null;
  last_domain_days_remaining: number | null;
  last_domain_valid: boolean | null;
  last_domain_expiry: string | null;
  last_domain_checked_at: string | null;
  last_domain_registrar: string | null;
}
const SS_COLS =
  'id, url, host, interval_ms, created_at, last_checked_at, next_check_at, paused, consecutive_down, alerted_down, last_ssl_threshold_alerted, last_domain_threshold_alerted, last_classification, last_status_code, last_response_ms, last_ssl_days_remaining, last_ssl_valid, last_domain_days_remaining, last_domain_valid, last_domain_expiry, last_domain_checked_at, last_domain_registrar, owner';

function toSchedule(r: SiteScheduleRow): SiteSchedule {
  return {
    id: r.id,
    url: r.url,
    host: r.host,
    intervalMs: Number(r.interval_ms),
    createdAt: r.created_at,
    lastCheckedAt: r.last_checked_at,
    nextCheckAt: r.next_check_at,
    paused: r.paused ?? false,
    consecutiveDown: r.consecutive_down ?? 0,
    alertedDown: r.alerted_down ?? false,
    lastSslThresholdAlerted: r.last_ssl_threshold_alerted,
    lastDomainThresholdAlerted: r.last_domain_threshold_alerted,
    lastClassification: (r.last_classification as UptimeClass) ?? undefined,
    ...(r.owner ? { owner: r.owner } : {}),
    lastStatusCode: r.last_status_code,
    lastResponseMs: r.last_response_ms,
    lastSslDaysRemaining: r.last_ssl_days_remaining,
    lastSslValid: r.last_ssl_valid ?? undefined,
    lastDomainDaysRemaining: r.last_domain_days_remaining,
    lastDomainValid: r.last_domain_valid ?? undefined,
    lastDomainExpiry: r.last_domain_expiry,
    lastDomainCheckedAt: r.last_domain_checked_at,
    lastDomainRegistrar: r.last_domain_registrar,
  };
}
function toRow(s: SiteSchedule): SiteScheduleRow {
  return {
    id: s.id,
    owner: s.owner ?? null,
    url: s.url,
    host: s.host,
    interval_ms: s.intervalMs,
    created_at: s.createdAt,
    last_checked_at: s.lastCheckedAt ?? null,
    next_check_at: s.nextCheckAt,
    paused: s.paused ?? false,
    consecutive_down: s.consecutiveDown ?? 0,
    alerted_down: s.alertedDown ?? false,
    last_ssl_threshold_alerted: s.lastSslThresholdAlerted ?? null,
    last_domain_threshold_alerted: s.lastDomainThresholdAlerted ?? null,
    last_classification: s.lastClassification ?? null,
    last_status_code: s.lastStatusCode ?? null,
    last_response_ms: s.lastResponseMs ?? null,
    last_ssl_days_remaining: s.lastSslDaysRemaining ?? null,
    last_ssl_valid: s.lastSslValid ?? null,
    last_domain_days_remaining: s.lastDomainDaysRemaining ?? null,
    last_domain_valid: s.lastDomainValid ?? null,
    last_domain_expiry: s.lastDomainExpiry ?? null,
    last_domain_checked_at: s.lastDomainCheckedAt ?? null,
    last_domain_registrar: s.lastDomainRegistrar ?? null,
  };
}

/**
 * Every monitor, or only those `scope` may see when one is given.
 *
 * Optional, defaulting to the old behaviour, for the same reason as the form
 * side: the TICKER calls this with no argument and must keep seeing every
 * monitor, including other people's -- it runs them on a timer with nobody
 * signed in. Narrowing it here would stop every uptime check firing, and a
 * site that silently stops being monitored is the worst failure this app has,
 * because the whole point is noticing when something breaks.
 */
export async function listSchedules(scope?: string): Promise<SiteSchedule[]> {
  let query = supabaseAdmin().from('site_watch_schedules').select(SS_COLS);

  const filter = ownerFilterExpression(scope);
  if (filter) query = query.or(filter);

  const { data, error } = await query;
  if (error) {
    console.warn(`[siteWatch/scheduleStore] list: ${error.message}`);
    return [];
  }

  const rows = (data as SiteScheduleRow[]).map(toSchedule);
  // Also the only correct path when the address was one the expression builder
  // declined to put in a query -- see ownerFilterExpression.
  return scope ? rows.filter((s) => visibleTo(scope, s.owner)) : rows;
}

export async function getSchedule(id: string): Promise<SiteSchedule | undefined> {
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_COLS).eq('id', id).maybeSingle();
  if (error) {
    console.warn(`[siteWatch/scheduleStore] get: ${error.message}`);
    return undefined;
  }
  return data ? toSchedule(data as SiteScheduleRow) : undefined;
}

export async function findScheduleByUrl(url: string): Promise<SiteSchedule | undefined> {
  const norm = normKey(url);
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_COLS);
  if (error) {
    console.warn(`[siteWatch/scheduleStore] findByUrl: ${error.message}`);
    return undefined;
  }
  const row = (data as SiteScheduleRow[]).find((r) => normKey(r.url) === norm);
  return row ? toSchedule(row) : undefined;
}

export async function upsertSchedule(entry: SiteSchedule): Promise<void> {
  const { error } = await supabaseAdmin().from('site_watch_schedules').upsert(toRow(entry), { onConflict: 'id' });
  if (error) console.warn(`[siteWatch/scheduleStore] upsert: ${error.message}`);
}

export async function removeSchedule(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').delete().eq('id', id).select('id');
  if (error) {
    console.warn(`[siteWatch/scheduleStore] remove: ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
