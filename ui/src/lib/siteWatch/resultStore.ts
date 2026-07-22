/**
 * Persist the LAST Site Watch result per URL (durable, url-keyed).
 *
 * Same idea as formWatch/resultStore: the single "last known" uptime/SSL/domain
 * result shown against a project URL, written every scheduled check and
 * SURVIVING monitor stop/delete — cleared only when the project is deleted.
 * (The run *history* stays monitor-scoped; this is the durable per-URL result.)
 *
 * Backed by Supabase (`site_watch_results`). Best-effort: errors are logged,
 * never thrown.
 */

import type { SiteCheckRecord, UptimeClass } from './types';
import { urlKey as resultKey } from '@/lib/projects/projectStore';
import { supabaseAdmin } from '@/lib/supabase';

export interface SiteWatchResult {
  /** Normalized + lowercased URL — the map key. */
  url: string;
  inputUrl: string;
  classification?: UptimeClass;
  statusCode: number | null;
  responseMs: number | null;
  sslDaysRemaining: number | null;
  sslValid: boolean | null;
  domainDaysRemaining: number | null;
  checkedAt: string;
}

interface SiteResultRow {
  url_key: string;
  input_url: string;
  classification: string | null;
  status_code: number | null;
  response_ms: number | null;
  ssl_days_remaining: number | null;
  ssl_valid: boolean | null;
  domain_days_remaining: number | null;
  checked_at: string;
}
const COLS =
  'url_key, input_url, classification, status_code, response_ms, ssl_days_remaining, ssl_valid, domain_days_remaining, checked_at';

function rowToResult(r: SiteResultRow): SiteWatchResult {
  return {
    url: r.url_key,
    inputUrl: r.input_url,
    classification: (r.classification as UptimeClass) ?? undefined,
    statusCode: r.status_code,
    responseMs: r.response_ms,
    sslDaysRemaining: r.ssl_days_remaining,
    sslValid: r.ssl_valid,
    domainDaysRemaining: r.domain_days_remaining,
    checkedAt: r.checked_at,
  };
}

/** Record the latest Site Watch result for a URL (upsert, last-write-wins). */
export async function recordResult(record: SiteCheckRecord): Promise<void> {
  try {
    const result: SiteWatchResult = {
      url: resultKey(record.url),
      inputUrl: record.url,
      classification: record.uptime?.classification,
      statusCode: record.uptime?.statusCode ?? null,
      responseMs: record.uptime?.responseMs ?? null,
      sslDaysRemaining: record.ssl?.daysRemaining ?? null,
      sslValid: record.ssl ? record.ssl.ok : null,
      domainDaysRemaining: record.domain?.daysRemaining ?? null,
      checkedAt: record.checkedAt,
    };
    const { error } = await supabaseAdmin().from('site_watch_results').upsert(
      {
        url_key: result.url,
        input_url: result.inputUrl,
        classification: result.classification ?? null,
        status_code: result.statusCode,
        response_ms: result.responseMs,
        ssl_days_remaining: result.sslDaysRemaining,
        ssl_valid: result.sslValid,
        domain_days_remaining: result.domainDaysRemaining,
        checked_at: result.checkedAt,
      },
      { onConflict: 'url_key' },
    );
    if (error) console.warn(`[siteWatch/resultStore] record: ${error.message}`);
  } catch (err) {
    console.warn(`[siteWatch/resultStore] recordResult failed: ${err}`);
  }
}

/** Delete the persisted result for a URL (used when a project is deleted). */
export async function removeResult(url: string): Promise<void> {
  const k = resultKey(url);
  const { error } = await supabaseAdmin().from('site_watch_results').delete().eq('url_key', k);
  if (error) console.warn(`[siteWatch/resultStore] removeResult: ${error.message}`);
}

/** All persisted results as a Map keyed by normalized+lowercased URL. */
export async function loadResults(): Promise<Map<string, SiteWatchResult>> {
  const { data, error } = await supabaseAdmin().from('site_watch_results').select(COLS);
  if (error) {
    console.warn(`[siteWatch/resultStore] loadResults: ${error.message}`);
    return new Map();
  }
  return new Map((data as SiteResultRow[]).map((r) => [r.url_key, rowToResult(r)]));
}
