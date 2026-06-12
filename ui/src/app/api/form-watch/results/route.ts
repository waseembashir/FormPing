import { NextRequest, NextResponse } from 'next/server';
import { readHistory } from '@/lib/formWatch/historyStore';
import { getSchedule } from '@/lib/formWatch/scheduleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/form-watch/results?id=<scheduleId>
 * Returns the run history (newest first) for a schedule.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });

  const schedule = await getSchedule(id);
  const runs = await readHistory(id);

  return NextResponse.json({ schedule: schedule ?? null, runs });
}
