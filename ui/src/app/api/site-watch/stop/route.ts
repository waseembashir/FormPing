import { NextRequest, NextResponse } from 'next/server';
import { removeSchedule } from '@/lib/siteWatch/scheduleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/site-watch/stop — remove a monitor by id. History is preserved. */
export async function POST(request: NextRequest) {
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Monitor id is required' }, { status: 400 });

  const removed = await removeSchedule(id);
  if (!removed) return NextResponse.json({ error: 'Monitor not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
