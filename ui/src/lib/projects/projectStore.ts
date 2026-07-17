/**
 * Persistence for Projects.
 *
 * Everything goes through the small `ProjectStore` interface, so the backend can
 * be swapped later (e.g. Supabase) by writing a new implementation of the same
 * interface — the API routes only ever touch `projectStore`, never the file
 * directly. The current implementation is the same JSON-on-the-Railway-volume
 * pattern used by Form Watch / Site Watch. Best-effort: disk errors are logged,
 * never thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Project } from './types';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

export interface ProjectStore {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  create(input: { name: string; urls: string[]; notes?: string; contact?: string }): Promise<Project>;
  update(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'urls' | 'notes' | 'contact'>>,
  ): Promise<Project | null>;
  remove(id: string): Promise<boolean>;
  /** Generate (or regenerate) the public status-page token; returns the updated project. */
  enableShare(id: string): Promise<Project | null>;
  /** Revoke the public status-page token (sets it to null). */
  disableShare(id: string): Promise<Project | null>;
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

// ── JSON-file implementation ────────────────────────────────────────────────
const FILE_REL = 'data/snapshots/.formping-projects.json';

interface FileShape {
  projects: Project[];
}

/** Default: formping/data/snapshots/…; override with FORMPING_DATA_DIR. */
function filePath(): string {
  return dataPath(FILE_REL);
}

async function readAll(): Promise<Project[]> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (!parsed || !Array.isArray(parsed.projects)) return [];
    return parsed.projects;
  } catch {
    return [];
  }
}

async function writeAll(projects: Project[]): Promise<void> {
  const fp = filePath();
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify({ projects }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[projects/store] write failed at ${fp}: ${err}`);
  }
}

const jsonProjectStore: ProjectStore = {
  async list() {
    const all = await readAll();
    return [...all].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  },

  async get(id) {
    return (await readAll()).find((p) => p.id === id) ?? null;
  },

  async create({ name, urls, notes, contact }) {
    const all = await readAll();
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      urls: urls.map(normalizeUrl).filter(Boolean),
      notes: notes?.trim() || undefined,
      contact: contact?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    all.push(project);
    await writeAll(all);
    return project;
  },

  async update(id, patch) {
    const all = await readAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const cur = all[idx]!;
    const next: Project = {
      ...cur,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.urls !== undefined ? { urls: patch.urls.map(normalizeUrl).filter(Boolean) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() || undefined } : {}),
      ...(patch.contact !== undefined ? { contact: patch.contact.trim() || undefined } : {}),
      updatedAt: new Date().toISOString(),
    };
    all[idx] = next;
    await writeAll(all);
    return next;
  },

  async remove(id) {
    const all = await readAll();
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) return false;
    await writeAll(next);
    return true;
  },

  async enableShare(id) {
    const all = await readAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const next: Project = {
      ...all[idx]!,
      shareToken: newShareToken(),
      updatedAt: new Date().toISOString(),
    };
    all[idx] = next;
    await writeAll(all);
    return next;
  },

  async disableShare(id) {
    const all = await readAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const next: Project = {
      ...all[idx]!,
      shareToken: null,
      updatedAt: new Date().toISOString(),
    };
    all[idx] = next;
    await writeAll(all);
    return next;
  },

  async findByToken(token) {
    if (!token) return null;
    const all = await readAll();
    return all.find((p) => !!p.shareToken && p.shareToken === token) ?? null;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
// Real row-level CRUD against the `projects` table. Same interface as the JSON
// store, so API routes are unchanged. `updated_at` is maintained by a DB trigger.
interface ProjectRow {
  id: string;
  name: string;
  urls: string[] | null;
  notes: string | null;
  contact: string | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}
const PROJECT_COLS = 'id, name, urls, notes, contact, share_token, created_at, updated_at';

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
  };
}

const supabaseProjectStore: ProjectStore = {
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

  async create({ name, urls, notes, contact }) {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .insert({
        name: name.trim(),
        urls: urls.map(normalizeUrl).filter(Boolean),
        notes: notes?.trim() || null,
        contact: contact?.trim() || null,
      })
      .select(PROJECT_COLS)
      .single();
    if (error || !data) throw new Error(`[projects/supabase] create failed: ${error?.message}`);
    return toProject(data as ProjectRow);
  },

  async update(id, patch) {
    const upd: Record<string, unknown> = {};
    if (patch.name !== undefined) upd.name = patch.name.trim();
    if (patch.urls !== undefined) upd.urls = patch.urls.map(normalizeUrl).filter(Boolean);
    if (patch.notes !== undefined) upd.notes = patch.notes.trim() || null;
    if (patch.contact !== undefined) upd.contact = patch.contact.trim() || null;
    if (Object.keys(upd).length === 0) return this.get(id);
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

  async enableShare(id) {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .update({ share_token: newShareToken() })
      .eq('id', id)
      .select(PROJECT_COLS)
      .maybeSingle();
    if (error) {
      console.warn(`[projects/supabase] enableShare: ${error.message}`);
      return null;
    }
    return data ? toProject(data as ProjectRow) : null;
  },

  async disableShare(id) {
    const { data, error } = await supabaseAdmin()
      .from('projects')
      .update({ share_token: null })
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

/** Pick the backend PER CALL, exactly like every other store does.
 *
 *  This used to be `supabaseEnabled() ? supabase : json` evaluated once at module
 *  load — so whichever backend was configured at first import got frozen in for
 *  the life of the process. If the env wasn't ready yet (any importer that loads
 *  this module before env is populated), Projects silently fell back to JSON
 *  while every other store used Supabase — a split-brain that's invisible until
 *  data goes missing. Dispatching per call removes the load-order dependency. */
function active(): ProjectStore {
  return supabaseEnabled() ? supabaseProjectStore : jsonProjectStore;
}

/** The active project store — Supabase when configured, else the JSON file store. */
export const projectStore: ProjectStore = {
  list: () => active().list(),
  get: (id) => active().get(id),
  create: (input) => active().create(input),
  update: (id, patch) => active().update(id, patch),
  remove: (id) => active().remove(id),
  enableShare: (id) => active().enableShare(id),
  disableShare: (id) => active().disableShare(id),
  findByToken: (token) => active().findByToken(token),
};
