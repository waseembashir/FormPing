/**
 * Site Watch DAILY ROLLUP — one summarised row per URL per UTC day.
 *
 * Written by the ticker on every check so uptime/response over 7d/30d/all-time
 * are truthful (the raw `site_watch_runs` is capped at 200 rows — too short a
 * window for a frequent monitor). Read-modify-write is safe here: the ticker
 * runs checks sequentially (single writer), and writes are best-effort.
 *
 * Backed by Supabase (`site_watch_daily`).
 */

import type { SiteCheckRecord } from './types';
import { urlKey } from '@/lib/projects/projectStore';
import { supabaseAdmin } from '@/lib/supabase';

export interface SiteDaily {
  /** YYYY-MM-DD (UTC). */
  day: string;
  /** up + down (probes that counted; 'blocked' excluded — not an outage). */
  checks: number;
  up: number;
  down: number;
  blocked: number;
  /** Sum of 'up' response times (ms) + count, for the daily average. */
  respSum: number;
  respN: number;
  /** Lowest SSL days-remaining seen that day, or null. */
  sslMin: number | null;
}

interface DailyRow {
  url_key: string;
  day: string;
  checks: number;
  up: number;
  down: number;
  blocked: number;
  resp_sum: number;
  resp_n: number;
  ssl_min: number | null;
}
const COLS = 'url_key, day, checks, up, down, blocked, resp_sum, resp_n, ssl_min';

function rowToDaily(r: DailyRow): SiteDaily {
  return {
    day: r.day,
    checks: r.checks ?? 0,
    up: r.up ?? 0,
    down: r.down ?? 0,
    blocked: r.blocked ?? 0,
    respSum: Number(r.resp_sum) || 0,
    respN: r.resp_n ?? 0,
    sslMin: r.ssl_min,
  };
}

/** Fold one check into today's rollup for its URL. Best-effort. */
export async function recordDaily(record: SiteCheckRecord): Promise<void> {
  try {
    const url_key = urlKey(record.url);
    const day = record.checkedAt.slice(0, 10); // UTC calendar day (checkedAt is ...Z)
    const cls = record.uptime?.classification;
    const isUp = cls === 'up';
    const isDown = cls === 'down';
    const isBlocked = cls === 'blocked';
    const resp = isUp && typeof record.uptime?.responseMs === 'number' ? record.uptime.responseMs : null;
    const ssl = record.ssl?.daysRemaining ?? null;

    const fold = (cur: Omit<DailyRow, 'url_key' | 'day'>): Omit<DailyRow, 'url_key' | 'day'> => ({
      checks: cur.checks + (isUp || isDown ? 1 : 0),
      up: cur.up + (isUp ? 1 : 0),
      down: cur.down + (isDown ? 1 : 0),
      blocked: cur.blocked + (isBlocked ? 1 : 0),
      resp_sum: Number(cur.resp_sum) + (resp ?? 0),
      resp_n: cur.resp_n + (resp != null ? 1 : 0),
      ssl_min: ssl == null ? cur.ssl_min : cur.ssl_min == null ? ssl : Math.min(cur.ssl_min, ssl),
    });
    const empty = { checks: 0, up: 0, down: 0, blocked: 0, resp_sum: 0, resp_n: 0, ssl_min: null as number | null };

    const db = supabaseAdmin();
    const { data: existing } = await db
      .from('site_watch_daily')
      .select(COLS)
      .eq('url_key', url_key)
      .eq('day', day)
      .maybeSingle();
    const next = fold((existing as DailyRow) ?? empty);
    const { error } = await db.from('site_watch_daily').upsert({ url_key, day, ...next }, { onConflict: 'url_key,day' });
    if (error) console.warn(`[siteWatch/dailyStore] record: ${error.message}`);
  } catch (err) {
    console.warn(`[siteWatch/dailyStore] recordDaily failed: ${err}`);
  }
}

/** All daily rollups for a URL, oldest → newest. Caller windows by day. */
export async function loadDaily(url: string): Promise<SiteDaily[]> {
  const url_key = urlKey(url);
  const { data, error } = await supabaseAdmin()
    .from('site_watch_daily')
    .select(COLS)
    .eq('url_key', url_key)
    .order('day', { ascending: true });
  if (error) {
    console.warn(`[siteWatch/dailyStore] load: ${error.message}`);
    return [];
  }
  return (data as DailyRow[]).map(rowToDaily);
}

/** Delete a URL's rollups (used by project delete). Best-effort. */
export async function removeDaily(url: string): Promise<void> {
  const url_key = urlKey(url);
  const { error } = await supabaseAdmin().from('site_watch_daily').delete().eq('url_key', url_key);
  if (error) console.warn(`[siteWatch/dailyStore] removeDaily: ${error.message}`);
}
