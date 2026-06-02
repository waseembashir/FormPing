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

const FILE_REL = 'data/active-watches.json';

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
  try {
    await mkdir(path.dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[activeWatchesStore] write failed: ${err}`);
  }
}

/** Add or update an entry (keyed by site). */
export async function saveActiveWatch(entry: ActiveWatchEntry): Promise<void> {
  const data = await readFile_();
  const idx = data.watches.findIndex((w) => w.site === entry.site);
  if (idx >= 0) data.watches[idx] = entry;
  else data.watches.push(entry);
  await writeFile_(data);
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
  const data = await readFile_();
  return data.watches;
}
