import { NextRequest, NextResponse } from 'next/server';
import { listSchedules, upsertSchedule, findScheduleByUrl } from '@/lib/siteWatch/scheduleStore';
import { kickSiteWatchTicker } from '@/lib/siteWatch/ticker';
import { removeDismissed } from '@/lib/projects/dismissedStore';
import { checkUptime, hostResolves } from '@/lib/siteWatch/checks';
import type { SiteSchedule } from '@/lib/siteWatch/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Minimum interval: 1 minute. Uptime checks are cheap, but don't hammer. */
const MIN_INTERVAL_MS = 60_000;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** GET /api/site-watch — list all site monitors. */
export async function GET() {
  const schedules = await listSchedules();
  return NextResponse.json({ schedules });
}

/**
 * POST /api/site-watch — create a monitor.
 * Body: { url: string, intervalMinutes?: number }
 */
export async function POST(request: NextRequest) {
  let body: { url?: unknown; intervalMinutes?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // `force` = the user confirmed "add anyway" after a down/unreachable warning.
  const force = body.force === true;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'A valid http(s) URL is required' }, { status: 400 });
  }

  let intervalMs =
    typeof body.intervalMinutes === 'number' ? body.intervalMinutes * 60_000 : DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) intervalMs = MIN_INTERVAL_MS;
  intervalMs = Math.round(intervalMs);

  const existing = await findScheduleByUrl(url);
  if (existing) {
    return NextResponse.json(
      { error: 'A monitor already exists for this URL', schedule: existing },
      { status: 409 },
    );
  }

  // Hard reject domains that don't exist in DNS (genuine typos). No override —
  // there's nothing to monitor if the domain itself isn't real.
  if (!(await hostResolves(hostnameOf(url)))) {
    return NextResponse.json(
      { error: 'This domain doesn’t exist — check the URL for a typo.' },
      { status: 422 },
    );
  }

  // Probe the URL up front. If it's down/unreachable, DON'T silently add it —
  // but DON'T hard-block either: return needsConfirm so the UI can warn and
  // offer "Add anyway". That catches typos (user sees the error and fixes it)
  // while still letting a genuinely-down site be monitored for recovery (force).
  // A Cloudflare challenge counts as reachable, so it's allowed without a prompt.
  if (!force) {
    const probe = await checkUptime(url);
    if (probe.classification === 'down') {
      const detail = probe.statusCode != null ? `returns HTTP ${probe.statusCode}` : 'is not responding';
      return NextResponse.json(
        {
          needsConfirm: true,
          error: `This URL ${detail} right now. If it's a typo, fix it. If it's a real site that's currently down, choose "Add anyway" to monitor it for recovery.`,
        },
        { status: 422 },
      );
    }
  }

  const now = Date.now();
  const schedule: SiteSchedule = {
    id: crypto.randomUUID(),
    url,
    host: hostnameOf(url),
    intervalMs,
    createdAt: new Date(now).toISOString(),
    lastCheckedAt: null,
    nextCheckAt: new Date(now).toISOString(), // first check runs immediately
    consecutiveDown: 0,
    alertedDown: false,
    lastSslThresholdAlerted: null,
    lastDomainThresholdAlerted: null,
  };

  await upsertSchedule(schedule);
  // Setting up a monitor means you care about this URL again — un-dismiss it
  // (same rule as re-running a Form Tester test). See form-watch route.
  await removeDismissed(url);
  kickSiteWatchTicker();

  return NextResponse.json({ schedule }, { status: 201 });
}
