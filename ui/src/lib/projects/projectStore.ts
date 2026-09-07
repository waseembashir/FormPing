/**
 * Persistence for Projects.
 *
 * Everything goes through the small `ProjectStore` interface, so the API routes
 * only ever touch `projectStore`, never the backend directly. Backed by Supabase
 * (`projects` table) with real row-level CRUD; `updated_at` is maintained by a DB
 * trigger. Best-effort: errors are logged, never thrown (except create, which
 * must surface failure to the caller).
 */

import type { Project } from './types';
import { supabaseAdmin } from '@/lib/supabase';

export interface ProjectStore {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  create(input: { name: string; urls: string[]; notes?: string; contact?: string; createdBy?: string | null }): Promise<Project>;
  update(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'urls' | 'notes' | 'contact'>>,
    updatedBy?: string | null,
  ): Promise<Project | null>;
  remove(id: string): Promise<boolean>;
  /** Generate (or regenerate) the public status-page token; returns the updated project. */
  enableShare(id: string, updatedBy?: string | null): Promise<Project | null>;
  /** Revoke the public status-page token (sets it to null). */
  disableShare(id: string, updatedBy?: string | null): Promise<Project | null>;
  /** Find a project by its public status-page token (constant-token match). */
  findByToken(token: string): Promise<Project | null>;
}

/** Unguessable, URL-safe share token (256 bits of randomness, hex). */
function newShareToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

/** Normalize a URL for STORAGE: trim and drop trailing slashes (preserves case). */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * The canonical key for MATCHING two URLs — normalized and lowercased.
 *
 * This is the single source of truth: everything that asks "are these the same
 * URL?" (Projects health, Unassigned, dismissals, per-URL results, membership,
 * duplicate checks) MUST use this. Hosts are case-insensitive in practice and
 * users retype URLs with different casing, so comparing on `normalizeUrl` alone
 * is a bug — it made the membership check disagree with Projects and re-prompt
 * "add this URL to a project?" for URLs that were already in one.
 */
export function urlKey(url: string): string {
  return (
    normalizeUrl(url)
      .toLowerCase()
      // Treat www and non-www as the SAME site. You add "example.com" to a
      // project, but the pre-flight/tester resolves "www.example.com" (or the
      // reverse) — without this they look like different URLs, so membership
      // says "not in a project" and re-prompts "add this URL to a project?".
      // The Change Monitor already keys its reports this way (siteKey strips
      // www), so this makes the whole app agree on what "the same URL" means.
      .replace(/^(https?:\/\/)www\./, '$1')
  );
}

/**
 * A stricter identity for "is this the SAME page?" comparisons — for MATCHING
 * ONLY, never as a stored key.
 *
 * `urlKey` (above) is the app's persisted key: it is written into `url_key`
 * columns across five tables (results, runs, daily rollups, dismissals), so its
 * FORMAT MUST NOT CHANGE or existing rows go orphaned. But for the "is this URL
 * already in a project?" popup gate it is too lax — it keeps the scheme, the
 * query string and the fragment, so `http` vs `https`, a `?utm=…` tag, or a
 * `#section` made an already-tracked page look brand-new and re-prompted
 * (FR-25). `matchKey` closes those gaps WITHOUT touching any stored key:
 *
 *   - scheme-agnostic (http == https)      - strips ?query and #fragment
 *   - strips www, lowercases               - drops the trailing slash
 *   - KEEPS the path (a page is its own identity — FR-25 model (B))
 *
 * Use it only where two URLs are compared in memory (membership, owner lookup),
 * NOT for anything persisted.
 */
export function matchKey(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, ''); // drop trailing slash(es)
    return `${host}${path}`.toLowerCase(); // no scheme, no query, no fragment
  } catch {
    // Unparseable — fall back to the persisted key so we still compare *something*.
    return urlKey(raw);
  }
}

/**
 * Reduce a project to just the ONE URL matching `urlKey` (canonical matchKey),
 * returning a project subset with `urls: [thatUrl]` — or null if the project has
 * no such URL. Lets the per-URL status pages reuse `buildClientStatus` unchanged
 * (it builds from `project.urls`), so a single-URL project yields a single-site
 * status. (FR-27.)
 */
export function projectForUrlKey(project: Project, urlKey: string): Project | null {
  const url = project.urls.find((u) => matchKey(u) === urlKey);
  return url ? { ...project, urls: [url] } : null;
}

// ── Supabase implementation ──────────────────────────────────────────────────
// Real row-level CRUD against the `projects` table. `updated_at` is maintained
// by a DB trigger.
interface ProjectRow {
  id: string;
  name: string;
  urls: string[] | null;
  notes: string | null;
  contact: string | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}
const PROJECT_COLS = 'id, name, urls, notes, contact, share_token, created_at, updated_at, created_by, updated_by';

function toProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    urls: r.urls ?? [],
    notes: r.notes ?? undefined,
    contact: r.contact ?? undefined,
    shareToken: r.share_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
  };
}

/** The active project store — Supabase (`projects` table). */
export const projectStore: ProjectStore = {
  async list() {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .select(PROJECT_COLS)
      .order('created_at', { ascending: false });
    if (error) {
      console.warn(`[projects/supabase] list: ${error.message}`);
      return [];
    }
    return (data as ProjectRow[]).map(toProject);
  },

  async get(id) {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .select(PROJECT_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.warn(`[projects/supabase] get: ${error.message}`);
      return null;
    }
    return data ? toProject(data as ProjectRow) : null;
  },

  async create({ name, urls, notes, contact, createdBy }) {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .insert({
        name: name.trim(),
        urls: urls.map(normalizeUrl).filter(Boolean),
        notes: notes?.trim() || null,
        contact: contact?.trim() || null,
        created_by: createdBy ?? null,
      })
      .select(PROJECT_COLS)
      .single();
    if (error || !data) throw new Error(`[projects/supabase] create failed: ${error?.message}`);
    return toProject(data as ProjectRow);
  },

  async update(id, patch, updatedBy) {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name.trim();
    if (patch.urls !== undefined) upd.urls = patch.urls.map(normalizeUrl).filter(Boolean);
    if (patch.notes !== undefined) upd.notes = patch.notes.trim() || null;
    if (patch.contact !== undefined) upd.contact = patch.contact.trim() || null;
    // Nothing actually changed → don't touch updated_at/updated_by.
    if (Object.keys(upd).length === 0) return this.get(id);
    // A real field changed → stamp who did it (attribution, FR-30).
    //
    // Only when we actually KNOW who. `actorName()` returns null for an
    // unidentified write (an expired session, or local open-gate dev), and
    // writing that null erased the previous editor's name — an anonymous edit
    // didn't just fail to record itself, it destroyed the record that was
    // there. The event log is the real history now; this column stays the
    // at-a-glance summary and keeps its last known value. FR-66.
    if (updatedBy) upd.updated_by = updatedBy;
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .update(upd)
      .eq('id', id)
      .select(PROJECT_COLS)
      .maybeSingle();
    if (error) {
      console.warn(`[projects/supabase] update: ${error.message}`);
      return null;
    }
    return data ? toProject(data as ProjectRow) : null;
  },

  async remove(id) {
    const { data, error } = await supabaseAdmin().from('projects').delete().eq('id', id).select('id');
    if (error) {
      console.warn(`[projects/supabase] remove: ${error.message}`);
      return false;
    }
    return (data?.length ?? 0) > 0;
  },

  async enableShare(id, updatedBy) {
    // Sharing a project with a client is a real change to it, so it stamps who
    // did it like every other mutation. It used to set the token alone, which
    // left the trigger bumping `updated_at` while `updated_by` still named the
    // PREVIOUS editor — crediting the change to the wrong person. FR-66.
    const upd: Record<string, unknown> = { share_token: newShareToken() };
    if (updatedBy) upd.updated_by = updatedBy;
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .update(upd)
      .eq('id', id)
      .select(PROJECT_COLS)
      .maybeSingle();
    if (error) {
      console.warn(`[projects/supabase] enableShare: ${error.message}`);
      return null;
    }
    return data ? toProject(data as ProjectRow) : null;
  },

  async disableShare(id, updatedBy) {
    const upd: Record<string, unknown> = { share_token: null };
    if (updatedBy) upd.updated_by = updatedBy;
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .update(upd)
      .eq('id', id)
      .select(PROJECT_COLS)
      .maybeSingle();
    if (error) {
      console.warn(`[projects/supabase] disableShare: ${error.message}`);
      return null;
    }
    return data ? toProject(data as ProjectRow) : null;
  },

  async findByToken(token) {
    if (!token) return null;
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .select(PROJECT_COLS)
      .eq('share_token', token)
      .maybeSingle();
    if (error) {
      console.warn(`[projects/supabase] findByToken: ${error.message}`);
      return null;
    }
    return data ? toProject(data as ProjectRow) : null;
  },
};
