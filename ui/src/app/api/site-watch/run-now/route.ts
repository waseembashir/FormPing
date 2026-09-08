import { NextRequest, NextResponse } from 'next/server';
import { runSiteCheckNow } from '@/lib/siteWatch/ticker';
import { requireRole } from '@/lib/auth/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/site-watch/run-now — FR-82. Check this monitor's URL immediately,
 * WITHOUT disturbing its schedule. Body: { id }.
 *
 * The schedule is left completely alone: the interval doesn't restart, the
 * card's readouts still describe the scheduled checks, no alert fires, and the
 * uptime percentage still counts only what the schedule observed. All this adds
 * is one row in that URL's check history, tagged as a re-run.
 *
 * Unlike the form re-run this waits for the answer — an uptime probe plus a TLS
 * handshake is a second or two — and returns the real measurements from it.
 */
export async function POST(request: NextRequest) {
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const check = await runSiteCheckNow(id);
  if (!check) return NextResponse.json({ error: 'Monitor not found' }, { status: 404 });

  return NextResponse.json({ check });
}
