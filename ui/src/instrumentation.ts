/**
 * Next.js server-startup hook.
 *
 * Runs once when the Node server boots (both `next dev` and `next start`).
 * Used here to auto-resume any watches that were running at the time of
 * the previous shutdown — Railway redeploys, manual restarts, crashes all
 * wipe the in-memory watch registry, but the user's intent persists on
 * disk in data/active-watches.json. This module replays that on boot.
 *
 * Edge runtime is excluded: the watchResume module uses child_process,
 * which is Node-only.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Dynamic import keeps Node-only code out of any Edge bundle.
  const { resumeActiveWatches } = await import('./lib/watchResume');
  // Fire-and-await — boot waits for resume to finish before serving the
  // first request, so the first /api/monitor/watches call sees the
  // resumed watches.
  try {
    await resumeActiveWatches();
  } catch (err) {
    console.warn(`[instrumentation] resumeActiveWatches threw: ${err}`);
  }

  // Form Watch scheduler — additive, independent of the monitor watches above.
  // Starts the recurring form-test loop; schedules persist on disk so this
  // simply picks up any that are due after a restart/redeploy.
  try {
    const { startFormWatchTicker } = await import('./lib/formWatch/ticker');
    startFormWatchTicker();
  } catch (err) {
    console.warn(`[instrumentation] startFormWatchTicker threw: ${err}`);
  }

  // Site Watch scheduler — additive, independent of the above. Starts the
  // uptime/SSL monitoring loop; schedules persist on disk and resume here.
  try {
    const { startSiteWatchTicker } = await import('./lib/siteWatch/ticker');
    startSiteWatchTicker();
  } catch (err) {
    console.warn(`[instrumentation] startSiteWatchTicker threw: ${err}`);
  }
}
