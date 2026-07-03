import { NextRequest, NextResponse } from 'next/server';
import { listSchedules, upsertSchedule } from '@/lib/formWatch/scheduleStore';
import { kickFormWatchTicker } from '@/lib/formWatch/ticker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/form-watch/pause — pause or resume a schedule. Body: { id, paused }.
 * Paused schedules are skipped by the ticker but keep their run history (unlike
 * Stop, which removes them). On resume we run promptly.
 */
export async function POST(request: NextRequest) {
  let body: { id?: unknown; paused?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const paused = body.paused === true;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const schedule = (await listSchedules()).find((s) => s.id === id);
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

  const updated = { ...schedule, paused };
  if (!paused) updated.nextRunAt = new Date().toISOString(); // resume → run now
  await upsertSchedule(updated);
  if (!paused) kickFormWatchTicker();

  return NextResponse.json({ schedule: updated });
}
