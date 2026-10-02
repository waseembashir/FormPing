import { NextRequest, NextResponse } from 'next/server';
import { readHistory } from '@/lib/siteWatch/historyStore';
import { getSchedule } from '@/lib/siteWatch/scheduleStore';
import { ownerScope } from '@/lib/ownerScope';
import { visibleTo } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-watch/results?id=<scheduleId> — check history, newest first. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });

  const schedule = await getSchedule(id);

  // Reached by schedule id, so the list filter alone would leave someone
  // else's check history readable to anyone who guesses one. Answered as "no
  // such monitor" rather than "not yours", since the latter confirms the id
  // exists and whose it is.
  const scope = await ownerScope(request);
  if (schedule && !visibleTo(scope, schedule.owner)) {
    return NextResponse.json({ error: 'No such monitor' }, { status: 404 });
  }

  const checks = await readHistory(id);
  return NextResponse.json({ schedule: schedule ?? null, checks });
}
