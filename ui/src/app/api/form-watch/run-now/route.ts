import { NextRequest, NextResponse } from 'next/server';
import { requestManualFormRun, isManualRunInFlight } from '@/lib/formWatch/ticker';
import { requireRole } from '@/lib/auth/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/form-watch/run-now — FR-82. Run this monitor's URL immediately,
 * in its own mode, WITHOUT disturbing its schedule. Body: { id }.
 *
 * The schedule is left completely alone: the interval doesn't restart, the next
 * run stays where it was, and the result the dashboards read still belongs to
 * the schedule. All this adds is one row in that URL's run history, tagged as a
 * re-run.
 *
 * Returns as soon as the run has STARTED. A form run drives a real browser and
 * can take a minute or more — longer than an HTTP request should stay open — so
 * the client polls the history for the new row instead. `alreadyRunning` tells a
 * second click that the first is still going, rather than silently stacking
 * browsers.
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

  const alreadyRunning = isManualRunInFlight(id);
  const schedule = await requestManualFormRun(id);
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 });

  return NextResponse.json({ started: true, alreadyRunning, startedAt: new Date().toISOString() });
}
