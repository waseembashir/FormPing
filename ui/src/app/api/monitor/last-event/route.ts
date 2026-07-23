import { NextRequest, NextResponse } from 'next/server';
import { siteKey } from '@/lib/watchRegistry';
import { latestEventsForSites } from '@/lib/changeEventStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/monitor/last-event?url=…
 *
 * The most recent change-tracking run for a site, used to REHYDRATE the Change
 * tracking tab after a full page reload.
 *
 * Why this exists: reload previously restored only stored *reports*, and a
 * `snapshot` run produces no report — so refreshing the page made a just-taken
 * baseline vanish from the panel even though it was safely recorded. The slim
 * event carries everything the result card needs (host + pages scanned + when),
 * so the baseline can be shown again without reading the snapshot file itself.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  if (!url) return NextResponse.json({ error: 'url query param required' }, { status: 400 });

  const site = siteKey(url);
  if (!site || site === 'unknown') return NextResponse.json({ event: null });

  const latest = await latestEventsForSites([site]);
  return NextResponse.json({ event: latest.get(site) ?? null });
}
