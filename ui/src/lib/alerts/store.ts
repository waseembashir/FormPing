/**
 * The alert delivery log (Supabase `alerts`).
 *
 * PLUMBING, not a feature — no UI reads this. It exists so the dispatcher can do
 * two things reliably:
 *
 *   1. Dedupe across restarts (unique `dedupe_key`), so a retry or a watch that
 *      resumes after a redeploy cannot double-ping Slack.
 *   2. Record what each channel did, so a missing alert is diagnosable.
 *
 * The alert's full detail is deliberately NOT stored here — it already lives in
 * `change_reports` / `site_watch_runs` / `form_watch_runs`, and the Slack message
 * links to the dashboard that renders it.
 *
 * Best-effort throughout: logging an alert must never break the monitor run that
 * raised it.
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { AlertDelivery, AlertInput, AlertKind, AlertSeverity } from './types';

/** Bound the table. Rows are tiny, so this is generous. */
const MAX_ALERTS = 2000;

interface AlertRow {
  id: string;
  kind: string;
  event: string;
  severity: string;
  title: string;
  site: string | null;
  url: string | null;
  dedupe_key: string;
  delivery: AlertDelivery | null;
  occurred_at: string;
  created_at: string;
}
const COLS = 'id, kind, event, severity, title, site, url, dedupe_key, delivery, occurred_at, created_at';

/** A logged alert, as read back (for debugging and tests). */
export interface LoggedAlert {
  id: string;
  kind: AlertKind;
  event: string;
  severity: AlertSeverity;
  title: string;
  site: string | null;
  url: string | null;
  dedupeKey: string;
  delivery: AlertDelivery | null;
  occurredAt: string;
  createdAt: string;
}

function toLogged(r: AlertRow): LoggedAlert {
  return {
    id: r.id,
    kind: r.kind as AlertKind,
    event: r.event,
    severity: (r.severity as AlertSeverity) ?? 'info',
    title: r.title,
    site: r.site,
    url: r.url,
    dedupeKey: r.dedupe_key,
    delivery: r.delivery,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

/**
 * Log an alert, ignoring a repeat of the same occurrence.
 *
 * Returns `{ inserted: false }` when `dedupeKey` already exists — the
 * dispatcher's signal that this alert was already delivered, so channels must be
 * skipped. That is what makes the whole pipeline idempotent.
 */
export async function logAlert(input: AlertInput): Promise<{ inserted: boolean; id: string | null }> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('alerts')
      .upsert(
        {
          kind: input.kind,
          event: input.event,
          severity: input.severity ?? 'info',
          title: input.title,
          site: input.site ?? null,
          url: input.url ?? null,
          dedupe_key: input.dedupeKey,
          occurred_at: input.occurredAt,
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();

    if (error) {
      console.warn(`[alerts/store] logAlert: ${error.message}`);
      return { inserted: false, id: null };
    }
    // ignoreDuplicates returns no row when the key already existed.
    if (!data) return { inserted: false, id: null };
    void pruneToCap();
    return { inserted: true, id: (data as { id: string }).id };
  } catch (err) {
    console.warn(`[alerts/store] logAlert failed: ${err}`);
    return { inserted: false, id: null };
  }
}

/** Record how each channel fared. Best-effort. */
export async function recordDelivery(id: string, delivery: AlertDelivery): Promise<void> {
  const { error } = await supabaseAdmin().from('alerts').update({ delivery }).eq('id', id);
  if (error) console.warn(`[alerts/store] recordDelivery: ${error.message}`);
}

/** Recent alerts, newest first — for debugging "did we send X?" and for tests. */
export async function recentAlerts(limit = 50): Promise<LoggedAlert[]> {
  const { data, error } = await supabaseAdmin()
    .from('alerts')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) {
    console.warn(`[alerts/store] recentAlerts: ${error.message}`);
    return [];
  }
  return (data as AlertRow[]).map(toLogged);
}

/** Delete a site's alert log (used by the project-delete cascade). Best-effort. */
export async function removeAlertsForSite(site: string): Promise<void> {
  const { error } = await supabaseAdmin().from('alerts').delete().eq('site', site);
  if (error) console.warn(`[alerts/store] removeAlertsForSite: ${error.message}`);
}

/** Keep only the newest MAX_ALERTS rows. Best-effort. */
async function pruneToCap(): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('alerts')
    .select('id')
    .order('created_at', { ascending: false })
    .range(MAX_ALERTS, MAX_ALERTS + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('alerts').delete().in('id', ids);
  if (delErr) console.warn(`[alerts/store] prune: ${delErr.message}`);
}
