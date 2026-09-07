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
  /** FR-67 — what the check actually learned, beyond the day counts: who issued
   *  the certificate and when it expires, who the domain is registered with and
   *  when that lapses, and the error text when a check fails. All of it is
   *  measured on every check and was being thrown away. */
  detail?: SiteCheckDetail;
}

/** The findings a check makes that the day-count columns can't hold. FR-67. */
export interface SiteCheckDetail {
  sslIssuer?: string | null;
  /** ISO date the certificate expires — a real date beats "in 34 days". */
  sslValidTo?: string | null;
  sslError?: string | null;
  domainRegistrar?: string | null;
  domainExpiry?: string | null;
  domainError?: string | null;
  /** Why the site was unreachable, when it was. */
  uptimeError?: string | null;
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
  detail?: SiteCheckDetail | null;
}
const BASE_COLS =
  'url_key, input_url, classification, status_code, response_ms, ssl_days_remaining, ssl_valid, domain_days_remaining, checked_at';
const COLS = `${BASE_COLS}, detail`;

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
    ...(r.detail ? { detail: r.detail } : {}),
  };
}

/** Keep only the findings worth storing — undefined when a check learned none. */
function checkDetail(record: SiteCheckRecord): SiteCheckDetail | null {
  const d: SiteCheckDetail = {};
  if (record.ssl?.issuer) d.sslIssuer = record.ssl.issuer;
  if (record.ssl?.validTo) d.sslValidTo = record.ssl.validTo;
  if (record.ssl?.error) d.sslError = record.ssl.error;
  if (record.domain?.registrar) d.domainRegistrar = record.domain.registrar;
  if (record.domain?.expiryDate) d.domainExpiry = record.domain.expiryDate;
  if (record.domain?.error) d.domainError = record.domain.error;
  if (record.uptime?.error) d.uptimeError = record.uptime.error;
  return Object.keys(d).length ? d : null;
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
    const baseRow = {
      url_key: result.url,
      input_url: result.inputUrl,
      classification: result.classification ?? null,
      status_code: result.statusCode,
      response_ms: result.responseMs,
      ssl_days_remaining: result.sslDaysRemaining,
      ssl_valid: result.sslValid,
      domain_days_remaining: result.domainDaysRemaining,
      checked_at: result.checkedAt,
    };

    const { error } = await supabaseAdmin()
      .from('site_watch_results')
      .upsert({ ...baseRow, detail: checkDetail(record) }, { onConflict: 'url_key' });
    if (error) {
      // `detail` is missing until migration 0013 is applied — retry without it so
      // the check still records rather than being lost to one column. FR-67.
      const { error: retry } = await supabaseAdmin()
        .from('site_watch_results')
        .upsert(baseRow, { onConflict: 'url_key' });
      if (retry) console.warn(`[siteWatch/resultStore] record: ${retry.message}`);
    }
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
  if (!error) {
    return new Map((data as SiteResultRow[]).map((r) => [r.url_key, rowToResult(r)]));
  }
  // Pre-migration-0013 databases have no `detail` column.
  const { data: base, error: baseErr } = await supabaseAdmin().from('site_watch_results').select(BASE_COLS);
  if (baseErr) {
    console.warn(`[siteWatch/resultStore] loadResults: ${baseErr.message}`);
    return new Map();
  }
  return new Map((base as SiteResultRow[]).map((r) => [r.url_key, rowToResult(r)]));
}
