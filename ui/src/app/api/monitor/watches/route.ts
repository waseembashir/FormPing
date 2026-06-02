import { NextResponse } from 'next/server';
import { loadAliveActiveWatches } from '@/lib/activeWatchesStore';

export const runtime = 'nodejs';

/**
 * GET /api/monitor/watches
 * Returns the list of currently-active watch processes.
 *
 * Reads from disk (active-watches.json) and filters to entries whose PID
 * is currently alive via process.kill(pid, 0). This is the cross-worker
 * source of truth — the in-memory registry only has entries from the
 * worker that spawned them, which in Next.js production may not be the
 * same worker handling this GET request.
 *
 * Logs the response size for debugging.
 */
export async function GET() {
  const entries = await loadAliveActiveWatches();
  const watches = entries.map((e) => ({
    site: e.site,
    url: e.url,
    startedAt: e.startedAt,
    watchIntervalMs: e.watchIntervalMs,
    pid: e.pid ?? null,
  }));

  if (watches.length > 0) {
    console.log(
      `[GET /api/monitor/watches] returning ${watches.length} alive watch(es): ` +
        watches.map((w) => `${w.site}(pid=${w.pid})`).join(', '),
    );
  } else {
    console.log('[GET /api/monitor/watches] no alive watches on disk');
  }
  return NextResponse.json({ watches });
}
