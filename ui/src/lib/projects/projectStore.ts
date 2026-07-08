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

/** Normalize a URL for storage + matching: trim and drop trailing slashes. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
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

/** The active project store. Swap this for a Supabase impl later — same interface. */
export const projectStore: ProjectStore = jsonProjectStore;
