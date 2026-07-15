/**
 * Persistence for Site Watch schedules.
 *
 * Backed by Supabase (`site_schedules` table) when configured, else the legacy
 * JSON file (fallback until the migration retires it). Exported functions
 * dispatch on `supabaseEnabled()`. Best-effort: errors logged, never thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { SiteSchedule, UptimeClass } from './types';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

function normKey(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

// ── JSON implementation (fallback) ───────────────────────────────────────────
const FILE_REL = 'data/snapshots/.formping-site-schedules.json';
interface FileShape {
  schedules: SiteSchedule[];
}
function filePath(): string {
  return dataPath(FILE_REL);
}
async function readAll(): Promise<SiteSchedule[]> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (!parsed || !Array.isArray(parsed.schedules)) return [];
    return parsed.schedules;
  } catch {
    return [];
  }
}
async function writeAll(schedules: SiteSchedule[]): Promise<void> {
  const fp = filePath();
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify({ schedules }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[siteWatch/scheduleStore] write failed at ${fp}: ${err}`);
  }
}

// ── Supabase implementation ──────────────────────────────────────────────────
interface SiteScheduleRow {
  id: string;
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
  'id, url, host, interval_ms, created_at, last_checked_at, next_check_at, paused, consecutive_down, alerted_down, last_ssl_threshold_alerted, last_domain_threshold_alerted, last_classification, last_status_code, last_response_ms, last_ssl_days_remaining, last_ssl_valid, last_domain_days_remaining, last_domain_valid, last_domain_expiry, last_domain_checked_at, last_domain_registrar';

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

// ── Public API (dispatches on backend) ───────────────────────────────────────
export async function listSchedules(): Promise<SiteSchedule[]> {
  if (!supabaseEnabled()) return readAll();
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_COLS);
  if (error) {
    console.warn(`[siteWatch/scheduleStore] list: ${error.message}`);
    return [];
  }
  return (data as SiteScheduleRow[]).map(toSchedule);
}

export async function getSchedule(id: string): Promise<SiteSchedule | undefined> {
  if (!supabaseEnabled()) return (await readAll()).find((s) => s.id === id);
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_COLS).eq('id', id).maybeSingle();
  if (error) {
    console.warn(`[siteWatch/scheduleStore] get: ${error.message}`);
    return undefined;
  }
  return data ? toSchedule(data as SiteScheduleRow) : undefined;
}

export async function findScheduleByUrl(url: string): Promise<SiteSchedule | undefined> {
  const norm = normKey(url);
  if (!supabaseEnabled()) return (await readAll()).find((s) => normKey(s.url) === norm);
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').select(SS_COLS);
  if (error) {
    console.warn(`[siteWatch/scheduleStore] findByUrl: ${error.message}`);
    return undefined;
  }
  const row = (data as SiteScheduleRow[]).find((r) => normKey(r.url) === norm);
  return row ? toSchedule(row) : undefined;
}

export async function upsertSchedule(entry: SiteSchedule): Promise<void> {
  if (!supabaseEnabled()) {
    const all = await readAll();
    const idx = all.findIndex((s) => s.id === entry.id);
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    await writeAll(all);
    return;
  }
  const { error } = await supabaseAdmin().from('site_watch_schedules').upsert(toRow(entry), { onConflict: 'id' });
  if (error) console.warn(`[siteWatch/scheduleStore] upsert: ${error.message}`);
}

export async function removeSchedule(id: string): Promise<boolean> {
  if (!supabaseEnabled()) {
    const all = await readAll();
    const next = all.filter((s) => s.id !== id);
    if (next.length === all.length) return false;
    await writeAll(next);
    return true;
  }
  const { data, error } = await supabaseAdmin().from('site_watch_schedules').delete().eq('id', id).select('id');
  if (error) {
    console.warn(`[siteWatch/scheduleStore] remove: ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
