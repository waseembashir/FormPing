/**
 * Ask the database, once at boot, whether it actually has the columns this
 * build is about to write. FR-87.
 *
 * The 2026-09-08 data loss had a simple shape: code shipped that sent a column
 * the deployed database did not have yet. Every insert was refused, and because
 * each refusal was only a warning in a log, the app degraded quietly for hours.
 *
 * The cheapest possible defence is to find out at startup rather than at the
 * first scheduled run. One `select` per critical table, `limit(0)` so no rows
 * cross the wire, and PostgREST fails the request outright if a named column
 * does not exist — which is exactly the question being asked.
 *
 * This deliberately does NOT stop the server. A monitoring tool that refuses to
 * boot is worse than one running with a stale column: uptime checks, alerts and
 * the dashboards all still work, and the ticker now declines to overwrite good
 * summaries with unsaved results anyway. So the guard's job is to be impossible
 * to miss in the logs and to be readable from the app, not to take the app down.
 */

import { supabaseAdmin, supabaseEnabled, supabaseSchema } from '@/lib/supabase';

/** A table and the columns this build depends on being present. */
interface TableContract {
  table: string;
  columns: string;
}

/**
 * The writes that can lose a result if a column is missing. Read-only surfaces
 * are left out: a failed read shows an empty page, which is visible, and it
 * cannot destroy anything.
 */
const CONTRACTS: TableContract[] = [
  {
    table: 'form_watch_runs',
    columns:
      'schedule_id, url, site, mode, ran_at, status, reason_code, submission_result, duration_ms, fingerprint, notes, errors, trigger_source',
  },
  {
    table: 'site_watch_runs',
    columns: 'schedule_id, url, host, checked_at, uptime, ssl, domain, trigger_source',
  },
  {
    table: 'form_watch_results',
    columns: 'url_key, input_url, status, reason_code, form_found, mode, ran_at',
  },
  {
    table: 'site_watch_results',
    columns:
      'url_key, input_url, classification, status_code, response_ms, ssl_days_remaining, ssl_valid, domain_days_remaining, checked_at',
  },
  {
    table: 'site_watch_daily',
    columns: 'url_key, day, checks, up, down, blocked, resp_sum, resp_n, ssl_min',
  },
];

/** What the last check found. `null` until the guard has run. */
export interface SchemaGuardReport {
  checkedAt: string;
  schema: string;
  /** Tables that answered cleanly. */
  ok: string[];
  /** Tables that refused, with the database's own message. */
  failing: { table: string; reason: string }[];
}

let lastReport: SchemaGuardReport | null = null;

/** The most recent schema check, or null if it has not run in this process. */
export function schemaReport(): SchemaGuardReport | null {
  return lastReport;
}

/**
 * Verify every write contract. Safe to call repeatedly; never throws.
 *
 * Returns null when Supabase is not configured at all — local dev without
 * credentials and the hermetic Playwright environment both run that way, and
 * neither should be told its schema is broken when it simply has no database.
 */
export async function verifySchema(): Promise<SchemaGuardReport | null> {
  if (!supabaseEnabled()) return null;

  const ok: string[] = [];
  const failing: { table: string; reason: string }[] = [];

  for (const { table, columns } of CONTRACTS) {
    try {
      const { error } = await supabaseAdmin().from(table).select(columns).limit(0);
      if (error) failing.push({ table, reason: error.message });
      else ok.push(table);
    } catch (err) {
      failing.push({ table, reason: String(err) });
    }
  }

  const report: SchemaGuardReport = {
    checkedAt: new Date().toISOString(),
    schema: supabaseSchema(),
    ok,
    failing,
  };
  lastReport = report;

  if (failing.length > 0) {
    // Loud, multi-line, and unambiguous about the consequence — this is the
    // message that should have existed on 2026-09-08.
    console.error(
      [
        '',
        '  ####################################################################',
        '  #  SCHEMA MISMATCH — results may fail to save                      #',
        '  ####################################################################',
        `  schema: ${report.schema}`,
        ...failing.map((f) => `  ✗ ${f.table}: ${f.reason}`),
        '',
        '  This build expects columns the database does not have. Apply the',
        '  pending migration in supabase/migrations before trusting any',
        '  monitor result. Scheduled runs will refuse to overwrite a good',
        '  summary with a result they could not store, so cards will go stale',
        '  rather than silently wrong.',
        '',
      ].join('\n'),
    );
  } else {
    console.log(`[schemaGuard] ${ok.length} write contracts verified against schema "${report.schema}"`);
  }

  return report;
}
