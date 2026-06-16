import { NextRequest, NextResponse } from 'next/server';
import { readHistory } from '@/lib/siteWatch/historyStore';
import { getSchedule } from '@/lib/siteWatch/scheduleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-watch/results?id=<scheduleId> — check history, newest first. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });

  const schedule = await getSchedule(id);
  const checks = await readHistory(id);
  return NextResponse.json({ schedule: schedule ?? null, checks });
}
