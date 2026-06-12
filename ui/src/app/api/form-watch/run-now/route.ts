import { NextRequest, NextResponse } from 'next/server';
import { getSchedule } from '@/lib/formWatch/scheduleStore';
import { runScheduleOnce } from '@/lib/formWatch/ticker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A live form test can take ~30-60s.
export const maxDuration = 300;

/**
 * POST /api/form-watch/run-now — run a schedule immediately (manual trigger).
 * Body: { id: string }
 * Runs the same path the ticker uses (test → diff → Slack → store → reschedule)
 * and returns the resulting run record.
 */
export async function POST(request: NextRequest) {
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'Schedule id is required' }, { status: 400 });

  const schedule = await getSchedule(id);
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

  const record = await runScheduleOnce(schedule);
  return NextResponse.json({ record });
}
