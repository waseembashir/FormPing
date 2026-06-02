/**
 * Server-side registry of running watch processes.
 *
 * Watch mode spawns a long-lived CLI subprocess that loops snapshot+compare
 * forever until it's killed. Previously we killed it whenever the browser
 * disconnected — bad for "leave it running overnight" use cases. Now:
 *
 *   - Watch processes are tracked in this registry by site hostname
 *   - The API route does NOT kill them on client disconnect (only snapshot
 *     and compare modes still do)
 *   - A separate /api/monitor/stop endpoint kills the process for a site
 *   - The registry auto-cleans on process exit (no leaks even if the
 *     process dies on its own)
 *
 * In-memory map only — survives across API requests (single Node process
 * on Railway) but doesn't survive a deploy. That's the right trade-off:
 * deploys are infrequent, so worst case a watch dies on deploy and the
 * user re-clicks Watch. No DB needed.
 */

import type { ChildProcess } from 'child_process';

export interface WatchRecord {
  /** Hostname-derived key for the site being watched (e.g. "optionsgoddess.com"). */
  site: string;
  /** The original URL the user provided (for display in the UI). */
  url: string;
  startedAt: Date;
  /** Watch interval the user picked, in ms. */
  watchIntervalMs: number;
  /** The OS process. */
  child: ChildProcess;
}

export interface ActiveWatchInfo {
  site: string;
  url: string;
  startedAt: string;
  watchIntervalMs: number;
  pid: number | null;
}

// We attach to globalThis because Next.js dev mode hot-reloads modules,
// which would otherwise create a fresh empty Map on each route handler
// reload and silently leak processes. In production this is just a
// regular module-level singleton.
const GLOBAL_KEY = Symbol.for('formping.watchRegistry');
type GlobalReg = { [k: symbol]: Map<string, WatchRecord> | undefined };
const g = globalThis as unknown as GlobalReg;
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
const registry: Map<string, WatchRecord> = g[GLOBAL_KEY]!;

/** Derive a stable key for a URL. Defaults to "unknown" if URL parse fails. */
export function siteKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/** Register a running watch process. Returns false if one is already running for this site. */
export function registerWatch(record: WatchRecord): boolean {
  if (registry.has(record.site)) return false;
  registry.set(record.site, record);
  // Auto-cleanup when the child process exits (crash, SIGINT, etc.).
  // Attached once so we don't accumulate handlers across reloads.
  record.child.once('exit', () => {
    const cur = registry.get(record.site);
    // Only delete if it's still the same process — a fast restart could
    // have replaced the entry already.
    if (cur && cur.child === record.child) registry.delete(record.site);
  });
  return true;
}

export function getWatch(site: string): WatchRecord | null {
  return registry.get(site) ?? null;
}

/**
 * Stop the watch for a given site. Returns true if a process was killed,
 * false if no watch was running.
 */
export function stopWatch(site: string): boolean {
  const record = registry.get(site);
  if (!record) return false;
  // SIGINT first (graceful — the CLI traps it and finishes the current cycle).
  // If it doesn't exit within 5s, SIGKILL.
  if (!record.child.killed) {
    record.child.kill('SIGINT');
    const force = setTimeout(() => {
      if (!record.child.killed) record.child.kill('SIGKILL');
    }, 5000);
    record.child.once('exit', () => clearTimeout(force));
  }
  // Don't delete from the map here — the 'exit' handler in registerWatch
  // will do that. Returning true confirms the kill was sent.
  return true;
}

/** Snapshot the list of currently-active watches (for the UI to render). */
export function listWatches(): ActiveWatchInfo[] {
  const out: ActiveWatchInfo[] = [];
  for (const [, record] of registry) {
    out.push({
      site: record.site,
      url: record.url,
      startedAt: record.startedAt.toISOString(),
      watchIntervalMs: record.watchIntervalMs,
      pid: record.child.pid ?? null,
    });
  }
  return out;
}
