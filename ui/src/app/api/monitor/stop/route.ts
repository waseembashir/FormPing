import { NextRequest, NextResponse } from 'next/server';
import { siteKey, stopWatch, getWatch } from '@/lib/watchRegistry';
import {
  loadActiveWatches,
  removeActiveWatch,
  isProcessAlive,
} from '@/lib/activeWatchesStore';

export const runtime = 'nodejs';

/**
 * POST /api/monitor/stop
 * Body: { url: string }
 * Stops the watch process for the given site (if one is active).
 *
 * Tries both:
 *   - In-memory registry (works for same-worker stop)
 *   - Disk file + process.kill by PID (works cross-worker)
 *
 * Either path removes the entry from active-watches.json so the next
 * server start doesn't auto-resume the killed watch.
 */
export async function POST(request: NextRequest) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url : '';
  if (!url) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  const site = siteKey(url);

  // Path 1: in-memory registry (handles the case where this worker spawned the watch)
  let stoppedInMemory = false;
  if (getWatch(site)) {
    stopWatch(site);
    stoppedInMemory = true;
  }

  // Path 2: cross-worker — find PID on disk + signal it directly
  const entries = await loadActiveWatches();
  const entry = entries.find((e) => e.site === site);
  let stoppedViaPid = false;
  if (entry && entry.pid && isProcessAlive(entry.pid)) {
    try {
      process.kill(entry.pid, 'SIGINT');
      stoppedViaPid = true;
      console.log(`[POST /api/monitor/stop] sent SIGINT to pid=${entry.pid} for site=${site}`);
      // Force-kill if still alive after 5s. Using setTimeout in a serverless
      // route is risky if the function ends — but Next.js Node runtime here
      // keeps it alive until the timeout fires.
      setTimeout(() => {
        if (isProcessAlive(entry.pid)) {
          try {
            process.kill(entry.pid!, 'SIGKILL');
            console.log(`[POST /api/monitor/stop] SIGKILL backstop fired for pid=${entry.pid}`);
          } catch { /* already dead */ }
        }
      }, 5000);
    } catch (err) {
      console.warn(`[POST /api/monitor/stop] kill failed: ${err}`);
    }
  }

  // Always remove from disk so the next boot doesn't auto-resume. Idempotent.
  if (entry) {
    await removeActiveWatch(site);
  }

  if (!stoppedInMemory && !stoppedViaPid && !entry) {
    return NextResponse.json({
      ok: true,
      stopped: false,
      message: 'No active watch for this site',
    });
  }

  return NextResponse.json({
    ok: true,
    stopped: true,
    site,
    via: stoppedInMemory ? 'registry' : 'pid',
  });
}
