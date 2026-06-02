import { NextRequest, NextResponse } from 'next/server';
import { siteKey, stopWatch, getWatch } from '@/lib/watchRegistry';

export const runtime = 'nodejs';

/**
 * POST /api/monitor/stop
 * Body: { url: string }
 * Stops the watch process for the given site (if one is active).
 */
export async function POST(request: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url : '';
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  const site = siteKey(url);
  const record = getWatch(site);
  if (!record) {
    return NextResponse.json({ ok: true, stopped: false, message: 'No active watch for this site' });
  }

  stopWatch(site);
  return NextResponse.json({ ok: true, stopped: true, site });
}
