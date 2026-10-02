import { NextRequest, NextResponse } from 'next/server';
import { readHistory } from '@/lib/formWatch/historyStore';
import { getSchedule } from '@/lib/formWatch/scheduleStore';
import { isManualRunInFlight } from '@/lib/formWatch/ticker';
import { ownerScope } from '@/lib/ownerScope';
import { visibleTo } from '@/lib/ownership';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/form-watch/results?id=<scheduleId>
 * Returns the run history (newest first) for a schedule, plus whether a Re-run
 * is in flight right now — a form run outlives the request that started it, so
 * this is what lets the card still say "Running…" after a refresh. FR-82.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });

  const schedule = await getSchedule(id);

  // Filtering the LIST is not enough on its own: this endpoint is reached by
  // schedule id, so without a check here someone else's run history stays
  // readable to anyone who knows or guesses an id. Hiding a monitor from the
  // tab while leaving its history served would be isolation in appearance only.
  //
  // Answered as "no such schedule" rather than "not yours", because the latter
  // confirms the id exists and whose it is -- which is part of what is being
  // kept private.
  const scope = await ownerScope(request);
  if (schedule && !visibleTo(scope, schedule.owner)) {
    return NextResponse.json({ error: 'No such schedule' }, { status: 404 });
  }

  const runs = await readHistory(id);

  return NextResponse.json({ schedule: schedule ?? null, runs, manualRunning: isManualRunInFlight(id) });
}
