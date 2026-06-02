import { NextRequest, NextResponse } from 'next/server';
import { siteKey } from '@/lib/watchRegistry';
import { loadReports } from '@/lib/reportStore';

export const runtime = 'nodejs';

/**
 * GET /api/monitor/reports?url=...&limit=50
 * Returns persisted change reports for the given site, newest first.
 * The UI calls this on page load (and after stopping a watch) to show
 * historical reports without needing a live SSE connection.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url') ?? '';
  if (!url) {
    return NextResponse.json({ error: 'url query param required' }, { status: 400 });
  }
  const limitRaw = request.nextUrl.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 50)) : 50;

  const site = siteKey(url);
  const reports = await loadReports(site, limit);
  return NextResponse.json({ site, reports });
}
