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
  /** FR-116 — the handover event. Absent until migration 0019. */
  assigned_at?: string | null;
  assigned_by?: string | null;
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
/**
 * The columns every deployed database is known to have, and the ones FR-116
 * added on top. Reads try the full set and fall back, so a build that lands
 * before migration 0019 keeps listing monitors — they simply read as never
 * handed over, which is what they were before the columns existed.
 */
const SS_BASE_COLS =
  'id, url, host, interval_ms, created_at, last_checked_at, next_check_at, paused, consecutive_down, alerted_down, last_ssl_threshold_alerted, last_domain_threshold_alerted, last_classification, last_status_code, last_response_ms, last_ssl_days_remaining, last_ssl_valid, last_domain_days_remaining, last_domain_valid, last_domain_expiry, last_domain_checked_at, last_domain_registrar, owner';
const SS_COLS = `${SS_BASE_COLS}, assigned_at, assigned_by`;

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
    ...(r.assigned_at ? { assignedAt: r.assigned_at } : {}),
    ...(r.assigned_by ? { assignedBy: r.assigned_by } : {}),
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
function baseRow(s: SiteSchedule): SiteScheduleRow {
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

function toRow(s: SiteSchedule): SiteScheduleRow {
  return {
    ...baseRow(s),
    assigned_at: s.assignedAt ?? null,
    assigned_by: s.assignedBy ?? null,
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
  // Returns the built query rather than its result, so the fallback below can
  // run the identical read against a narrower column list.
  const select = (columns: string) => {
    let query = supabaseAdmin().from('site_watch_schedules').select(columns);
    const filter = ownerFilterExpression(scope);
    if (filter) query = query.or(filter);
    return query;
  };

  let { data, error } = await select(SS_COLS);
  if (error) {
    // `assigned_at` is missing until migration 0019. Falling back keeps every
    // monitor listed and running — they read as never handed over, which is
    // how they behaved before the column existed. Returning [] would instead
    // hand the ticker no monitors at all, and a site that silently stops being
    // checked is the worst failure this app has.
    ({ data, error } = await select(SS_BASE_COLS));
    if (error) {
      console.warn(`[siteWatch/scheduleStore] list: ${error.message}`);
      return [];
    }
  }

  const rows = (data as unknown as SiteScheduleRow[]).map(toSchedule);
  // Also the only correct path when the address was one the expression builder
  // declined to put in a query -- see ownerFilterExpression.
  return scope ? rows.filter((s) => visibleTo(scope, s.owner)) : rows;
}

export async function getSchedule(id: string): Promise<SiteSchedule | undefined> {
  const get = (columns: string) =>
    supabaseAdmin().from('site_watch_schedules').select(columns).eq('id', id).maybeSingle();

  let { data, error } = await get(SS_COLS);
  if (error) {
    ({ data, error } = await get(SS_BASE_COLS)); // pre-0019 database — see listSchedules
    if (error) {
      console.warn(`[siteWatch/scheduleStore] get: ${error.message}`);
      return undefined;
    }
  }
  return data ? toSchedule(data as unknown as SiteScheduleRow) : undefined;
}

export async function findScheduleByUrl(url: string): Promise<SiteSchedule | undefined> {
  const norm = normKey(url);
  let { data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_COLS);
  if (error) {
    // pre-0019 database — see listSchedules. This one guards the duplicate
    // check, so failing open would let a second monitor be created for a URL
    // that already has one.
    ({ data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_BASE_COLS));
    if (error) {
      console.warn(`[siteWatch/scheduleStore] findByUrl: ${error.message}`);
      return undefined;
    }
  }
  const row = (data as unknown as SiteScheduleRow[]).find((r) => normKey(r.url) === norm);
  return row ? toSchedule(row) : undefined;
}

export async function upsertSchedule(entry: SiteSchedule): Promise<void> {
  const { error } = await supabaseAdmin().from('site_watch_schedules').upsert(toRow(entry), { onConflict: 'id' });
  if (!error) return;

  // Retry without the FR-116 handover columns. This write advances
  // `next_check_at`, so letting a column from an unapplied migration refuse it
  // would leave every monitor permanently due and the ticker re-running each
  // one on every pass — a missing column becoming a loop against somebody's
  // site. The handover record is the thing worth losing here; the cadence is
  // not. Same shape as the form side (FR-79).
  const { error: retry } = await supabaseAdmin()
    .from('site_watch_schedules')
    .upsert(baseRow(entry), { onConflict: 'id' });
  if (retry) console.warn(`[siteWatch/scheduleStore] upsert: ${retry.message}`);
  else console.warn(`[siteWatch/scheduleStore] upsert: saved without handover record (${error.message})`);
}

export async function removeSchedule(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').delete().eq('id', id).select('id');
  if (error) {
    console.warn(`[siteWatch/scheduleStore] remove: ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
