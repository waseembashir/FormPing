import { NextRequest, NextResponse } from 'next/server';
import { getSchedule, upsertSchedule } from '@/lib/formWatch/scheduleStore';
import { kickFormWatchTicker } from '@/lib/formWatch/ticker';
import { requireRole } from '@/lib/auth/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/form-watch/find-form — FR-79. "Find the form again": search the
 * site for this monitor's contact form and watch whatever it finds. Body: { id }.
 *
 * A monitor watches one form on one page, resolved once when it was set up, so
 * that every later check can load that page instead of re-crawling the client's
 * site. This is the escape hatch for when a site moves its contact page: the
 * pin is the one thing a monitor cannot work out for itself, because a check
 * that only looks at one page cannot tell "the form is broken" from "the form
 * is now somewhere else".
 *
 * It CLEARS the pin rather than guessing a new one. Re-resolving is then the
 * identical code path as resolving the first time — one discovery check, which
 * pins itself from its own result — so there is no second way for a monitor to
 * acquire a page, and no way for this action to point one at a page nothing
 * verified.
 *
 * It also brings the next check forward to now, because this is a setup action
 * and not a probe: somebody pressing it is telling us what the monitor watches
 * is wrong, and leaving that uncorrected for another three days would be an odd
 * reading of the request. That does restart the interval, which is the one
 * difference from Re-run (FR-82) — a re-run deliberately leaves the cadence
 * alone because it only asks a question, while this changes the answer.
 *
 * Landing-page monitors are refused: their URL *is* their page, asserted by the
 * person who set them up. There is nothing to search for, and clearing a pin
 * they never had would do nothing — so saying so is better than reporting a
 * success that changes nothing.
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

  const schedule = await getSchedule(id);
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

  if (schedule.landingPage) {
    return NextResponse.json(
      {
        error:
          'This monitor watches the exact URL it was set up with, so there is no page to find. Turn Landing-page mode off to let FormPing search the site for the form.',
      },
      { status: 409 },
    );
  }

  const updated = { ...schedule };
  delete updated.pinnedPage;
  delete updated.pinnedAt;
  updated.nextRunAt = new Date().toISOString();

  await upsertSchedule(updated);
  kickFormWatchTicker();

  return NextResponse.json({ schedule: updated });
}
