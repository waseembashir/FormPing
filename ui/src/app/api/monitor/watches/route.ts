import { NextResponse } from 'next/server';
import { listWatches } from '@/lib/watchRegistry';

export const runtime = 'nodejs';

/**
 * GET /api/monitor/watches
 * Returns the list of currently-active watch processes.
 * The UI calls this on page load to hydrate "is a watch already running
 * for this site?" state — lets watches survive browser refresh.
 *
 * Logs the response size for debugging: if a watch is running but this
 * endpoint returns empty, the in-memory registry got separated from the
 * subprocess (worker boundary, module reload, etc.) — useful clue.
 */
export async function GET() {
  const watches = listWatches();
  if (watches.length > 0) {
    console.log(
      `[GET /api/monitor/watches] returning ${watches.length} active watch(es): ` +
        watches.map((w) => `${w.site}(pid=${w.pid})`).join(', '),
    );
  } else {
    console.log('[GET /api/monitor/watches] no active watches in registry');
  }
  return NextResponse.json({ watches });
}
