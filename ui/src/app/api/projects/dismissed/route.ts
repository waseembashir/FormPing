import { NextRequest, NextResponse } from 'next/server';
import { addDismissed, listDismissedUrls, removeDismissed } from '@/lib/projects/dismissedStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/projects/dismissed — the list of URLs the user opted out of Projects. */
export async function GET() {
  const urls = await listDismissedUrls();
  return NextResponse.json({ urls });
}

/** DELETE /api/projects/dismissed — un-dismiss a URL. Body: { url: string }. */
export async function DELETE(request: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  await removeDismissed(url);
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/projects/dismissed — mark a URL as "don't track in Projects".
 * Body: { url: string }. The monitor keeps running; the URL just stays out of
 * the Unassigned bucket.
 */
export async function POST(request: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  await addDismissed(url);
  return NextResponse.json({ ok: true });
}
