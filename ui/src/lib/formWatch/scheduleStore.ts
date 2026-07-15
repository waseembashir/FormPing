/**
 * Persistence for Form Watch schedules.
 *
 * Backed by Supabase (`form_schedules` table) when configured, else the legacy
 * JSON file (kept as a fallback until the migration fully retires it). The
 * exported functions dispatch on `supabaseEnabled()` so callers are unchanged.
 * All operations are best-effort: errors are logged, never thrown, so a bad
 * store state can't block the scheduler or the API.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { FormSchedule } from './types';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

function normKey(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

// ── JSON implementation (fallback) ───────────────────────────────────────────
const FILE_REL = 'data/snapshots/.formping-form-schedules.json';
interface FileShape {
  schedules: FormSchedule[];
}
function filePath(): string {
  return dataPath(FILE_REL);
}
async function readAll(): Promise<FormSchedule[]> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (!parsed || !Array.isArray(parsed.schedules)) return [];
    return parsed.schedules;
  } catch {
    return [];
  }
}
async function writeAll(schedules: FormSchedule[]): Promise<void> {
  const fp = filePath();
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify({ schedules }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[formWatch/scheduleStore] write failed at ${fp}: ${err}`);
  }
}

// ── Supabase implementation ──────────────────────────────────────────────────
interface FormScheduleRow {
  id: string;
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
  'id, url, site, interval_ms, mode, landing_page, created_at, last_run_at, next_run_at, paused, last_status, last_reason_code, last_form_found';

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
  };
}
function toRow(s: FormSchedule): FormScheduleRow {
  return {
    id: s.id,
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

// ── Public API (dispatches on backend) ───────────────────────────────────────
export async function listSchedules(): Promise<FormSchedule[]> {
  if (!supabaseEnabled()) return readAll();
  const { data, error } = await supabaseAdmin().from('form_watch_schedules').select(FS_COLS);
  if (error) {
    console.warn(`[formWatch/scheduleStore] list: ${error.message}`);
    return [];
  }
  return (data as FormScheduleRow[]).map(toSchedule);
}

export async function getSchedule(id: string): Promise<FormSchedule | undefined> {
  if (!supabaseEnabled()) return (await readAll()).find((s) => s.id === id);
  const { data, error } = await supabaseAdmin().from('form_watch_schedules').select(FS_COLS).eq('id', id).maybeSingle();
  if (error) {
    console.warn(`[formWatch/scheduleStore] get: ${error.message}`);
    return undefined;
  }
  return data ? toSchedule(data as FormScheduleRow) : undefined;
}

export async function findScheduleByUrl(url: string): Promise<FormSchedule | undefined> {
  const norm = normKey(url);
  if (!supabaseEnabled()) {
    return (await readAll()).find((s) => normKey(s.url) === norm);
  }
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
  if (!supabaseEnabled()) {
    const all = await readAll();
    const idx = all.findIndex((s) => s.id === entry.id);
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    await writeAll(all);
    return;
  }
  const { error } = await supabaseAdmin().from('form_watch_schedules').upsert(toRow(entry), { onConflict: 'id' });
  if (error) console.warn(`[formWatch/scheduleStore] upsert: ${error.message}`);
}

export async function removeSchedule(id: string): Promise<boolean> {
  if (!supabaseEnabled()) {
    const all = await readAll();
    const next = all.filter((s) => s.id !== id);
    if (next.length === all.length) return false;
    await writeAll(next);
    return true;
  }
  const { data, error } = await supabaseAdmin().from('form_watch_schedules').delete().eq('id', id).select('id');
  if (error) {
    console.warn(`[formWatch/scheduleStore] remove: ${error.message}`);
    return false;
  }
  return (data?.length ?? 0) > 0;
}
