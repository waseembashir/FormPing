/**
 * FR-66 — the project activity log: who did what to a project, and when.
 *
 * WHY THIS EXISTS. Attribution was two columns on `projects` — `created_by` and
 * `updated_by` — which cannot answer the question people actually ask of a
 * shared tool. They hold one name each, so every edit overwrites the last;
 * nothing records WHAT changed; and an unidentified write wrote NULL straight
 * over the previous name, destroying the little history there was.
 *
 * Events accumulate instead. The columns on `projects` stay as the at-a-glance
 * summary on the card; this is the record behind it.
 *
 * INTERNAL ONLY — never rendered on `/status/*`, and the page that reads it is
 * gated to Owner/Admin. Knowing who on the team opened a client's project is
 * team information, not client information.
 *
 * Best-effort throughout: recording an event must never break the action it
 * describes. A failed log write is logged and swallowed.
 */

import { createHash } from 'crypto';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

/** What happened. Deliberately a closed set — a log whose vocabulary drifts
 *  can't be read at a glance or filtered reliably. */
export type ProjectAction =
  | 'created'
  | 'renamed'
  | 'url_added'
  | 'url_removed'
  | 'notes_changed'
  | 'contact_changed'
  | 'share_enabled'
  | 'share_disabled'
  | 'viewed';

export interface ProjectEvent {
  id: string;
  projectId: string;
  /** Display name, or null when nobody was signed in (local open-gate writes). */
  actor: string | null;
  action: ProjectAction;
  /** What it happened to — the URL added, the new name, and so on. */
  target: string | null;
  at: string;
}

interface EventRow {
  id: string;
  project_id: string;
  actor: string | null;
  action: string;
  target: string | null;
  created_at: string;
}
const COLS = 'id, project_id, actor, action, target, created_at';

/** How many events to keep per project. Generous — the rows are tiny — but
 *  bounded, so a busy project can't grow its log without limit. */
const MAX_EVENTS = 500;

/** Don't record the same person viewing the same project more than once an
 *  hour. Without this, opening a project ten times buries every real edit under
 *  ten "viewed" rows and the log stops being worth reading. */
const VIEW_DEDUPE_MS = 60 * 60 * 1000;

function toEvent(r: EventRow): ProjectEvent {
  return {
    id: r.id,
    projectId: r.project_id,
    actor: r.actor,
    action: r.action as ProjectAction,
    target: r.target,
    at: r.created_at,
  };
}

/**
 * A stable id for "this person viewed this project during this hour".
 *
 * Deduping a view by READING first and then inserting is a check-then-act race,
 * and it loses: the project page fires its GET twice on mount, both requests see
 * no recent view, and both insert. That is exactly what put two identical
 * "opened the project" rows a second apart in the log.
 *
 * Deriving the primary key from (project, actor, hour) instead makes the
 * DATABASE the arbiter — the second insert collides on the key and is dropped,
 * however many requests race. It also removes a query per page view.
 */
function viewId(projectId: string, actor: string | null, atMs: number): string {
  const bucket = Math.floor(atMs / VIEW_DEDUPE_MS);
  const h = createHash('sha1').update(`view:${projectId}:${actor ?? ''}:${bucket}`).digest('hex');
  // Shape the digest as a UUID so it fits the column's type.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Record one action. Never throws.
 *
 * A `viewed` event carries a derived id, so repeat views inside the dedupe
 * window collide and are silently dropped rather than filling the log.
 */
export async function recordEvent(
  projectId: string,
  actor: string | null,
  action: ProjectAction,
  target?: string | null,
): Promise<void> {
  if (!supabaseEnabled()) return;
  try {
    const row: Record<string, unknown> = { project_id: projectId, actor, action, target: target ?? null };
    if (action === 'viewed') row.id = viewId(projectId, actor, Date.now());

    const { error } = await supabaseAdmin().from('project_events').insert(row);
    if (error) {
      // A duplicate view is the mechanism working, not a failure — say nothing.
      const duplicate = action === 'viewed' && /duplicate key|23505/i.test(error.message);
      if (!duplicate) console.warn(`[projects/eventStore] record ${action}: ${error.message}`);
      return;
    }
    await prune(projectId);
  } catch (err) {
    console.warn(`[projects/eventStore] recordEvent failed: ${err}`);
  }
}

/** Trim a project's log to the newest MAX_EVENTS. Best-effort. */
async function prune(projectId: string): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from('project_events')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(MAX_EVENTS, MAX_EVENTS + 200);
    const ids = (data ?? []).map((r) => (r as { id: string }).id);
    if (ids.length) await db.from('project_events').delete().in('id', ids);
  } catch {
    /* pruning is housekeeping — never worth surfacing */
  }
}

/** One project's log, newest first. */
export async function listEvents(projectId: string, limit = 200): Promise<ProjectEvent[]> {
  if (!supabaseEnabled()) return [];
  try {
    const { data, error } = await supabaseAdmin()
      .from('project_events')
      .select(COLS)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn(`[projects/eventStore] listEvents: ${error.message}`);
      return [];
    }
    return (data as EventRow[]).map(toEvent);
  } catch (err) {
    console.warn(`[projects/eventStore] listEvents failed: ${err}`);
    return [];
  }
}
