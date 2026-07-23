/**
 * Change Monitor SNAPSHOT files on disk.
 *
 * Snapshots (raw page captures used as the diff baseline) are one of only two
 * things still stored as files rather than in Postgres — see `dataPaths.ts`.
 * They live per-host under `data/snapshots/<host>/`.
 *
 * This module exists so the path resolution + safety guard live in ONE place:
 * both the snapshots API route and the project-delete cascade delete through it.
 * Previously the logic was inline in the route only, so deleting a project wiped
 * its database rows but left the snapshot files behind (FR-21).
 */

import { rm, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/** Root of the snapshots tree. ui/ runs from formping/ui — snapshots sit at formping/data/snapshots. */
export function snapshotsRoot(): string {
  return path.resolve(process.cwd(), '..', 'data', 'snapshots');
}

/** Hostname key used for the per-site snapshot folder (matches siteKey()). */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Resolve a host's snapshot directory, verifying it stays inside the snapshots
 * root. Returns null for anything suspicious — this is the path-traversal guard,
 * so ALWAYS go through it rather than joining paths by hand.
 */
export function safeHostDir(host: string): string | null {
  if (!/^[a-z0-9.-]+$/i.test(host)) return null; // strict allow-list
  const root = snapshotsRoot();
  const dir = path.resolve(root, host);
  if (dir !== root && !dir.startsWith(root + path.sep)) return null;
  return dir;
}

/** Total bytes on disk under a directory. Best-effort. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(full);
      else total += (await stat(full)).size;
    }
  } catch {
    /* ignore */
  }
  return total;
}

/**
 * Delete every snapshot file for a host. Best-effort and safe: refuses to touch
 * anything outside the snapshots root, and a missing directory is a no-op.
 * Returns true when a directory was actually removed.
 */
export async function removeSnapshotsForHost(host: string): Promise<boolean> {
  try {
    const dir = safeHostDir(host);
    if (!dir) return false;
    const root = snapshotsRoot();
    // Hard safety: never remove the root itself, only a folder beneath it.
    if (dir === root || !dir.startsWith(root + path.sep)) return false;
    if (!existsSync(dir)) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.warn(`[snapshotFiles] removeSnapshotsForHost(${host}) failed: ${err}`);
    return false;
  }
}
