/**
 * Persist active watches to disk so they survive Railway redeploys.
 *
 * Each entry contains everything needed to re-spawn the CLI:
 *   url, monitorMode, maxPages, takeScreenshots, aiProvider, watchIntervalMs
 *
 * Lifecycle:
 *   - When a watch starts (via /api/monitor) → saveActiveWatch(...)
 *   - When the user explicitly stops it (via /api/monitor/stop) → removeActiveWatch(...)
 *   - When the process crashes or the server restarts → entry STAYS on disk;
 *     the next server boot reads the file via watchResume and re-spawns it.
 *
 * File lives at:  formping/data/active-watches.json   (root next to snapshots/reports)
 *
 * All operations are best-effort — disk errors get logged but don't throw,
 * so a bad disk state never blocks a watch from starting or stopping.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

// Path note: Railway's persistent volume is mounted at `data/snapshots`
// rather than `data/`, so anything written to `data/active-watches.json`
// gets wiped on every redeploy. Put the file INSIDE the snapshots
// directory so it lives in the volume too. The dot-prefix marks it as
// a "system" file — won't collide with the hostname-named subdirectories
// snapshotSite.ts creates.
const FILE_REL = 'data/snapshots/.formping-active-watches.json';

export interface ActiveWatchEntry {
  /** Hostname-only key (matches siteKey() in watchRegistry.ts). */
  site: string;
  url: string;
  monitorMode: 'watch'; // only watch mode is persisted; snapshot/compare are one-offs
  maxPages: number;
  takeScreenshots: boolean;
  aiSummary: boolean;
  aiProvider?: string;
  watchIntervalMs: number;
  /** ISO timestamp of when it was first started. */
  startedAt: string;
  /** OS PID of the CLI subprocess. Used as the cross-worker source of truth
   * for "is this watch still running?" — we send signal 0 to check liveness
   * regardless of which Node worker handles the API request. */
  pid?: number;
}

interface FileShape {
  watches: ActiveWatchEntry[];
}

/** Absolute path to the JSON file (formping/data/active-watches.json). */
function filePath(): string {
  // Routes/server modules run with cwd = formping/ui; data lives one level up.
  return path.join(process.cwd(), '..', FILE_REL);
}

/** Read with safe fallback to empty list. */
async function readFile_(): Promise<FileShape> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (!parsed || !Array.isArray(parsed.watches)) return { watches: [] };
    return { watches: parsed.watches };
  } catch {
    return { watches: [] };
  }
}

async function writeFile_(data: FileShape): Promise<void> {
  const fp = filePath();
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[activeWatchesStore] wrote ${data.watches.length} entry(ies) to ${fp}`);
  } catch (err) {
    console.warn(`[activeWatchesStore] write failed at ${fp}: ${err}`);
  }
}

/** Add or update an entry (keyed by site). */
export async function saveActiveWatch(entry: ActiveWatchEntry): Promise<void> {
  console.log(`[activeWatchesStore] saveActiveWatch called for site=${entry.site} url=${entry.url}`);
  try {
    const data = await readFile_();
    const idx = data.watches.findIndex((w) => w.site === entry.site);
    if (idx >= 0) data.watches[idx] = entry;
    else data.watches.push(entry);
    await writeFile_(data);
  } catch (err) {
    console.warn(`[activeWatchesStore] saveActiveWatch threw for site=${entry.site}: ${err}`);
  }
}

/** Remove the entry for a given site (no-op if absent). */
export async function removeActiveWatch(site: string): Promise<void> {
  const data = await readFile_();
  const next = data.watches.filter((w) => w.site !== site);
  if (next.length === data.watches.length) return; // nothing changed
  await writeFile_({ watches: next });
}

/** Snapshot the list of persisted watches. Used by watchResume on startup. */
export async function loadActiveWatches(): Promise<ActiveWatchEntry[]> {
  const fp = filePath();
  const data = await readFile_();
  console.log(
    `[activeWatchesStore] loadActiveWatches: ${data.watches.length} entry(ies) from ${fp}`,
  );
  return data.watches;
}

/**
 * Check whether a process with the given PID is alive.
 *
 * Sends signal 0 — a no-op kernel call that just checks if the process
 * exists and we have permission to signal it. Returns true if alive,
 * false if the PID doesn't exist (or is undefined). This is the
 * cross-worker source of truth for "is this watch still running?" —
 * works regardless of which Node worker spawned the process.
 */
export function isProcessAlive(pid: number | undefined): boolean {
  if (typeof pid !== 'number' || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH (process doesn't exist) or EPERM (can't signal it — almost
    // always means it's gone since we spawned it ourselves)
    return false;
  }
}

/** Load only entries whose PID is currently alive. Used by /api/monitor/watches. */
export async function loadAliveActiveWatches(): Promise<ActiveWatchEntry[]> {
  const all = await loadActiveWatches();
  const alive = all.filter((e) => isProcessAlive(e.pid));
  if (alive.length !== all.length) {
    console.log(
      `[activeWatchesStore] filtered ${all.length - alive.length} dead entry(ies); ${alive.length} alive`,
    );
  }
  return alive;
}
