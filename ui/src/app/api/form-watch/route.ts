import { NextRequest, NextResponse } from 'next/server';
import { listSchedules, upsertSchedule, findScheduleByUrl } from '@/lib/formWatch/scheduleStore';
import { kickFormWatchTicker } from '@/lib/formWatch/ticker';
import { removeDismissed } from '@/lib/projects/dismissedStore';
import type { FormSchedule, FormWatchMode } from '@/lib/formWatch/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimum interval: 1 hour. Keeps a health monitor from hammering a form. */
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const VALID_MODES: FormWatchMode[] = ['live', 'safe', 'detect-only'];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Pre-flight check before adding a schedule. Confirms the URL the user entered
 * is actually reachable (not a 404 / dead link) so we don't watch a wrong URL.
 *
 * We deliberately do NOT require a <form> on this exact page — the form often
 * lives on a /contact page, and the monitor's discovery finds it. If no form
 * is ever found, the scheduled run reports that as a failing health check
 * (FORM_NOT_FOUND) and alerts you — which is the monitor doing its job.
 */
async function validateFormUrl(url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.status >= 400) {
      return { ok: false, error: `This URL returned HTTP ${res.status}. Please check the URL is correct.` };
    }
  } catch {
    return { ok: false, error: 'This URL could not be reached. Please check the URL is correct.' };
  }
  return { ok: true };
}

/** GET /api/form-watch — list all schedules. */
export async function GET() {
  const schedules = await listSchedules();
  return NextResponse.json({ schedules });
}

/**
 * POST /api/form-watch — create a schedule.
 * Body: { url: string, intervalMs?: number, intervalDays?: number, mode?: FormWatchMode }
 */
export async function POST(request: NextRequest) {
  let body: {
    url?: unknown;
    intervalMs?: unknown;
    intervalDays?: unknown;
    mode?: unknown;
    landingPage?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'A valid http(s) URL is required' }, { status: 400 });
  }

  // Interval: accept either intervalMs or intervalDays.
  let intervalMs =
    typeof body.intervalMs === 'number'
      ? body.intervalMs
      : typeof body.intervalDays === 'number'
        ? body.intervalDays * 24 * 60 * 60 * 1000
        : NaN;
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: `Interval must be at least ${MIN_INTERVAL_MS / 3_600_000} hour(s)` },
      { status: 400 },
    );
  }
  intervalMs = Math.round(intervalMs);

  const mode: FormWatchMode = VALID_MODES.includes(body.mode as FormWatchMode)
    ? (body.mode as FormWatchMode)
    : 'live';

  const landingPage = body.landingPage === true;

  const existing = await findScheduleByUrl(url);
  if (existing) {
    return NextResponse.json(
      { error: 'A schedule already exists for this URL', schedule: existing },
      { status: 409 },
    );
  }

  // Reject wrong/dead URLs (or pages with no form) before creating a schedule.
  const check = await validateFormUrl(url);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 422 });
  }

  const now = Date.now();
  const schedule: FormSchedule = {
    id: crypto.randomUUID(),
    url,
    site: hostnameOf(url),
    intervalMs,
    mode,
    landingPage,
    createdAt: new Date(now).toISOString(),
    lastRunAt: null,
    // Run an immediate baseline check on the next tick, then every interval.
    nextRunAt: new Date(now).toISOString(),
  };

  await upsertSchedule(schedule);
  // Setting up a monitor means you care about this URL again — so un-dismiss it
  // (same rule as re-running a Form Tester test). Without this, a URL you once
  // said "don't track" about stays silently suppressed: no "add to a project?"
  // prompt, and it never returns to Unassigned.
  await removeDismissed(url);
  // Ensure the loop is running and run the baseline check now (single fire —
  // guarded against the interval so it can't double up).
  kickFormWatchTicker();

  return NextResponse.json({ schedule }, { status: 201 });
}
