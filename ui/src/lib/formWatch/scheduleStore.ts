/**
 * Persistence for Form Watch schedules.
 *
 * Backed by Supabase (`form_watch_schedules` table). Exported functions keep the
 * same signatures so callers are unchanged. All operations are best-effort:
 * errors are logged, never thrown, so a bad store state can't block the
 * scheduler or the API.
 */

import type { FormSchedule } from './types';
import { supabaseAdmin } from '@/lib/supabase';
import { ownerFilterExpression, visibleTo } from '@/lib/ownership';
import { urlKey } from '@/lib/projects/projectStore';

/**
 * Canonical URL match key — delegates to the app-wide `urlKey`, so a schedule is
 * matched the SAME way Projects matches URLs, including treating `www.` and
 * non-`www` as the same site.
 *
 * This was previously a local trim/lowercase-only key that did NOT strip `www.`,
 * while Projects did. The consequence: a project holding
 * `https://www.site.com` could not find a monitor stored as `https://site.com`,
 * so deleting the project silently left its monitor running (an orphan still
 * crawling a client's site). Same class of bug as FR-17's urlKey fix — this was
 * the last place it survived.
 */
const normKey = urlKey;

interface FormScheduleRow {
  id: string;
  owner: string | null;
  url: string;
  site: string;
  interval_ms: number;
  mode: string;
  landing_page: boolean;
  created_at: string;
  last_run_at: string | null;
  next_run_at: string;
  paused: boolean;
  last_status: string | null;
  last_reason_code: string | null;
  last_form_found: boolean | null;
}
const FS_COLS =
  'id, url, site, interval_ms, mode, landing_page, created_at, last_run_at, next_run_at, paused, last_status, last_reason_code, last_form_found, owner';

function toSchedule(r: FormScheduleRow): FormSchedule {
  return {
    id: r.id,
    url: r.url,
    site: r.site,
    intervalMs: Number(r.interval_ms),
    mode: r.mode as FormSchedule['mode'],
    landingPage: r.landing_page ?? false,
    createdAt: r.created_at,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    paused: r.paused ?? false,
    lastStatus: (r.last_status as FormSchedule['lastStatus']) ?? undefined,
    lastReasonCode: r.last_reason_code ?? undefined,
    lastFormFound: r.last_form_found ?? undefined,
    ...(r.owner ? { owner: r.owner } : {}),
  };
}
function toRow(s: FormSchedule): FormScheduleRow {
  return {
    id: s.id,
    owner: s.owner ?? null,
    url: s.url,
    site: s.site,
    interval_ms: s.intervalMs,
    mode: s.mode,
    landing_page: s.landingPage ?? false,
    created_at: s.createdAt,
    last_run_at: s.lastRunAt ?? null,
    next_run_at: s.nextRunAt,
    paused: s.paused ?? false,
    last_status: s.lastStatus ?? null,
    last_reason_code: s.lastReasonCode ?? null,
    last_form_found: s.lastFormFound ?? null,
  };
}

/**
 * Every schedule, or only those `scope` may see when one is given.
 *
 * The parameter is optional and defaults to the old behaviour deliberately.
 * The TICKER calls this with no argument and must keep seeing every schedule,
 * including other people's -- it runs them on a timer with nobody signed in.
 * Narrowing this function by default would stop every scheduled monitor
 * firing, and "monitors silently stopped running" looks nothing like its cause.
 * So the filter is something a caller opts into, and only a request does.
 */
export async function listSchedules(scope?: string): Promise<FormSchedule[]> {
  let query = supabaseAdmin().from('form_watch_schedules').select(FS_COLS);

  const filter = ownerFilterExpression(scope);
  if (filter) query = query.or(filter);

  const { data, error } = await query;
  if (error) {
    console.warn(`[formWatch/scheduleStore] list: ${error.message}`);
    return [];
  }

  const rows = (data as FormScheduleRow[]).map(toSchedule);
  // Belt and braces, and the only correct path if the address was one the
  // expression builder refused to put in a query. Re-checking rows the
  // database already narrowed costs nothing and cannot be wrong.
  return scope ? rows.filter((s) => visibleTo(scope, s.owner)) : rows;
}

export async function getSchedule(id: string): Promise<FormSchedule | undefined> {
  const { data, error } = await supabaseAdmin().from('form_watch_schedules').select(FS_COLS).eq('id', id).maybeSingle();
  if (error) {
    console.warn(`[formWatch/scheduleStore] get: ${error.message}`);
    return undefined;
  }
  return data ? toSchedule(data as FormScheduleRow) : undefined;
}

export async function findScheduleByUrl(url: string): Promise<FormSchedule | undefined> {
  const norm = normKey(url);
  // Match case-insensitively on the normalized URL (rows are stored as entered).
  const { data, error } = await supabaseAdmin().from('form_watch_schedules').select(FS_COLS);
  if (error) {
    console.warn(`[formWatch/scheduleStore] findByUrl: ${error.message}`);
    return undefined;
  }
  const row = (data as FormScheduleRow[]).find((r) => normKey(r.url) === norm);
  return row ? toSchedule(row) : undefined;
}

export async function upsertSchedule(entry: FormSchedule): Promise<void> {
  const { error } = await supabaseAdmin().from('form_watch_schedules').upsert(toRow(entry), { onConflict: 'id' });
  if (error) console.warn(`[formWatch/scheduleStore] upsert: ${error.message}`);
}

export async function removeSchedule(id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from('form_watch_schedules').delete().eq('id', id).select('id');
  if (error) {
    console.warn(`[formWatch/scheduleStore] remove: ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
