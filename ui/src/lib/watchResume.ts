/**
 * Auto-resume watches across server restarts.
 *
 * On every Node process boot (Railway redeploy, manual restart, etc.) the
 * in-memory watch registry starts empty — but the user's intent is on disk
 * in data/active-watches.json. This module reads that file and re-spawns
 * each watch, registering it in the registry as if the user had just
 * clicked Watch.
 *
 * Wired into Next.js's `instrumentation.ts` hook, which runs once when
 * the server boots. Idempotent: if a watch is somehow already running for
 * a site (e.g. dev mode HMR re-running register), it's skipped.
 */

import { loadActiveWatches, saveActiveWatch } from './activeWatchesStore';
import { registerWatch, getWatch } from './watchRegistry';
import { spawnMonitor } from './watchSpawner';

let resumed = false;

/**
 * Read persisted active watches from disk and re-spawn each. Safe to call
 * multiple times — only the first invocation does work.
 */
export async function resumeActiveWatches(): Promise<void> {
  if (resumed) return;
  resumed = true;

  let entries;
  try {
    entries = await loadActiveWatches();
  } catch (err) {
    console.warn(`[watchResume] failed to load active-watches.json: ${err}`);
    return;
  }

  if (entries.length === 0) {
    console.log('[watchResume] no persisted watches to resume');
    return;
  }

  console.log(`[watchResume] resuming ${entries.length} persisted watch(es)`);

  for (const entry of entries) {
    // Skip if a watch is already registered for this site (paranoia — should
    // never happen since registry starts empty on boot, but covers HMR cases
    // in dev and any unexpected restart paths).
    if (getWatch(entry.site)) {
      console.log(`[watchResume] skipping ${entry.site} — already running`);
      continue;
    }

    try {
      const child = spawnMonitor(
        {
          url: entry.url,
          monitorMode: 'watch',
          maxPages: entry.maxPages,
          takeScreenshots: entry.takeScreenshots,
          aiSummary: entry.aiSummary,
          aiProvider: entry.aiProvider,
          watchIntervalMs: entry.watchIntervalMs,
        },
        {
          // No live SSE listener on resume — the report-persisting side-effect
          // inside spawnMonitor still runs, and Slack notifications still fire
          // from the CLI itself, so the user sees changes through Slack while
          // the report history fills on disk for the next UI session.
        },
      );

      registerWatch({
        site: entry.site,
        url: entry.url,
        startedAt: new Date(entry.startedAt),
        watchIntervalMs: entry.watchIntervalMs,
        child,
      });

      // Update the disk entry with the NEW PID — the old one is from a dead
      // process and would always fail the liveness check.
      void saveActiveWatch({
        ...entry,
        ...(typeof child.pid === 'number' ? { pid: child.pid } : { pid: undefined }),
      });

      console.log(
        `[watchResume] resumed ${entry.site} (pid=${child.pid}, interval ${Math.round(entry.watchIntervalMs / 1000)}s, max ${entry.maxPages} pages)`,
      );
    } catch (err) {
      // Don't let one bad entry break the others
      console.warn(`[watchResume] failed to resume ${entry.site}: ${err}`);
    }
  }
}
