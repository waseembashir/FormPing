import { NextRequest, NextResponse } from 'next/server';
import { addDismissed } from '@/lib/projects/dismissedStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
