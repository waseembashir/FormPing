/**
 * Change Tracking EVENT STREAM — one slim row per run (snapshot | compare | watch).
 *
 * Why this exists: a `snapshot` run used to persist nothing to the database (only
 * a file on disk), and `change_reports` was pruned to the newest ONE row per site
 * — so a project had no way to show that a URL was being tracked, and there was
 * no "on this date, N things changed" history to draw a timeline from.
 *
 * Deliberately separate from `reportStore`:
 *   changeEventStore — small rows, kept long   → Projects status + timeline
 *   reportStore      — heavy `details` jsonb, pruned → drill-in detail
 * Watch mode runs hourly, so keeping full details forever would bloat Postgres.
 *
 * KEYED BY HOST (`siteKey()` = hostname minus `www.`), because the crawler
 * snapshots a whole SITE from its homepage — change tracking is site-level, not
 * per-URL. The UI labels it that way.
 *
 * Best-effort: every function swallows its own errors. Recording an event must
 * NEVER break a monitor run.
 */

import type { ChangeSeverity } from '@/types';
import { supabaseAdmin } from '@/lib/supabase';

/** How many events to keep per site. Slim rows, so this is generous: at watch
 *  mode's hourly cadence it is roughly 11 weeks of continuous history. */
const MAX_EVENTS_PER_SITE = 2000;

export type ChangeMode = 'snapshot' | 'compare' | 'watch';

export interface ChangeEvent {
  id: string;
  site: string;
  rootUrl: string | null;
  mode: ChangeMode;
  checkedAt: string;
  pagesScanned: number;
  pagesChanged: number;
  changesFound: number;
  severity: ChangeSeverity | null;
  summary: string | null;
}

interface ChangeEventRow {
  id: string;
  site: string;
  root_url: string | null;
  mode: string;
  checked_at: string;
  pages_scanned: number;
  pages_changed: number;
  changes_found: number;
  severity: string | null;
  summary: string | null;
}
const COLS =
  'id, site, root_url, mode, checked_at, pages_scanned, pages_changed, changes_found, severity, summary';

function toEvent(r: ChangeEventRow): ChangeEvent {
  return {
    id: r.id,
    site: r.site,
    rootUrl: r.root_url,
    mode: (r.mode as ChangeMode) ?? 'compare',
    checkedAt: r.checked_at,
    pagesScanned: r.pages_scanned ?? 0,
    pagesChanged: r.pages_changed ?? 0,
    changesFound: r.changes_found ?? 0,
    severity: (r.severity as ChangeSeverity) ?? null,
    summary: r.summary,
  };
}

export interface RecordEventInput {
  site: string;
  rootUrl?: string | null;
  mode: ChangeMode;
  /** ISO timestamp of the run. Defaults to now. */
  checkedAt?: string;
  pagesScanned?: number;
  pagesChanged?: number;
  changesFound?: number;
  severity?: ChangeSeverity | null;
  summary?: string | null;
}

/** Record one change-tracking run. Best-effort — never throws. */
export async function recordChangeEvent(input: RecordEventInput): Promise<void> {
  try {
    if (!input.site || input.site === 'unknown') return;
    const { error } = await supabaseAdmin().from('change_events').insert({
      site: input.site,
      root_url: input.rootUrl ?? null,
      mode: input.mode,
      checked_at: input.checkedAt ?? new Date().toISOString(),
      pages_scanned: input.pagesScanned ?? 0,
      pages_changed: input.pagesChanged ?? 0,
      changes_found: input.changesFound ?? 0,
      severity: input.severity ?? null,
      summary: input.summary ?? null,
    });
    if (error) {
      console.warn(`[changeEventStore] record: ${error.message}`);
      return;
    }
    await pruneToCap(input.site);
  } catch (err) {
    console.warn(`[changeEventStore] recordChangeEvent failed: ${err}`);
  }
}

/** Keep only the newest MAX_EVENTS_PER_SITE rows for a site. Best-effort. */
async function pruneToCap(site: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('change_events')
    .select('id')
    .eq('site', site)
    .order('checked_at', { ascending: false })
    .range(MAX_EVENTS_PER_SITE, MAX_EVENTS_PER_SITE + 500);
  if (error || !data || data.length === 0) return;
  const ids = (data as { id: string }[]).map((r) => r.id);
  const { error: delErr } = await db.from('change_events').delete().in('id', ids);
  if (delErr) console.warn(`[changeEventStore] prune: ${delErr.message}`);
}

/** Events for a site, newest first. `sinceIso` windows the timeline (FR-20 filters). */
export async function loadChangeEvents(
  site: string,
  opts: { limit?: number; sinceIso?: string | null } = {},
): Promise<ChangeEvent[]> {
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 200));
  let q = supabaseAdmin()
    .from('change_events')
    .select(COLS)
    .eq('site', site)
    .order('checked_at', { ascending: false })
    .limit(limit);
  if (opts.sinceIso) q = q.gte('checked_at', opts.sinceIso);
  const { data, error } = await q;
  if (error) {
    console.warn(`[changeEventStore] load: ${error.message}`);
    return [];
  }
  return (data as ChangeEventRow[]).map(toEvent);
}

/** The most recent event per site, for a set of sites (Projects status line). */
export async function latestEventsForSites(sites: string[]): Promise<Map<string, ChangeEvent>> {
  const uniq = Array.from(new Set(sites)).filter((s) => s && s !== 'unknown');
  const out = new Map<string, ChangeEvent>();
  if (uniq.length === 0) return out;
  // One row per site is all we need; fetch newest-first for the whole set and
  // keep the first seen per site (cheap at our scale, avoids N queries).
  const { data, error } = await supabaseAdmin()
    .from('change_events')
    .select(COLS)
    .in('site', uniq)
    .order('checked_at', { ascending: false })
    .limit(uniq.length * 25);
  if (error) {
    console.warn(`[changeEventStore] latestForSites: ${error.message}`);
    return out;
  }
  for (const row of data as ChangeEventRow[]) {
    if (!out.has(row.site)) out.set(row.site, toEvent(row));
  }
  return out;
}

/**
 * Distinct URLs that have been change-tracked, newest first.
 *
 * Feeds the Unassigned bucket: a URL you ran through Change tracking is a URL
 * you clearly care about, so it must be offerable to a project. Before this,
 * Unassigned only knew about Form/Site Watch schedules, Form Tester runs and
 * durable results — so a change-tracked URL could never appear there, and
 * choosing "Decide later" on the prompt left it with nowhere to go.
 */
export async function listTrackedUrls(limit = 500): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from('change_events')
    .select('root_url, checked_at')
    .not('root_url', 'is', null)
    .order('checked_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn(`[changeEventStore] listTrackedUrls: ${error.message}`);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of data as { root_url: string | null }[]) {
    const u = r.root_url?.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** Delete a site's events (used by the project-delete cascade). Best-effort. */
export async function removeChangeEvents(site: string): Promise<void> {
  const { error } = await supabaseAdmin().from('change_events').delete().eq('site', site);
  if (error) console.warn(`[changeEventStore] removeChangeEvents: ${error.message}`);
}
