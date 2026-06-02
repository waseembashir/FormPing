import { NextResponse } from 'next/server';
import { listWatches } from '@/lib/watchRegistry';

export const runtime = 'nodejs';

/**
 * GET /api/monitor/watches
 * Returns the list of currently-active watch processes.
 * The UI calls this on page load to hydrate "is a watch already running
 * for this site?" state — lets watches survive browser refresh.
 */
export async function GET() {
  return NextResponse.json({ watches: listWatches() });
}
