import { NextResponse } from 'next/server';
import {
  loadActiveWatches,
  isProcessAlive,
} from '@/lib/activeWatchesStore';

export const runtime = 'nodejs';

/**
 * GET /api/monitor/watches
 * Returns the list of currently-active watch processes.
 *
 * Reads from disk (active-watches.json) and filters to entries whose PID
 * is currently alive via process.kill(pid, 0). This is the cross-worker
 * source of truth.
 */
export async function GET() {
  // Inline the load+filter (instead of loadAliveActiveWatches) so we can
  // log the full disk-vs-alive breakdown — critical for diagnosing the
  // "watch is running but UI shows Run button" issue.
  const all = await loadActiveWatches();
  console.log(
    `[GET /api/monitor/watches] disk has ${all.length} entry(ies): ` +
      (all.length > 0
        ? all
            .map(
              (e) =>
                `${e.site}(pid=${e.pid ?? 'none'}, alive=${isProcessAlive(e.pid)})`,
            )
            .join(', ')
        : '(empty file)'),
  );

  const aliveEntries = all.filter((e) => isProcessAlive(e.pid));
  const watches = aliveEntries.map((e) => ({
    site: e.site,
    url: e.url,
    startedAt: e.startedAt,
    watchIntervalMs: e.watchIntervalMs,
    pid: e.pid ?? null,
  }));

  console.log(
    `[GET /api/monitor/watches] returning ${watches.length} alive watch(es) to client`,
  );
  return NextResponse.json({ watches });
}
