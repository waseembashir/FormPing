import { NextRequest, NextResponse } from 'next/server';
import { projectStore, projectForUrlKey, matchKey } from '@/lib/projects/projectStore';
import { recordEvent } from '@/lib/projects/eventStore';
import { hostUsedByOtherProject } from '@/lib/projects/hostUsage';
import { buildClientStatus, parseWindow } from '@/lib/status/build';
import { loadChangeEvents, removeChangeEvents } from '@/lib/changeEventStore';
import { siteKey, stopWatch } from '@/lib/watchRegistry';
import { getUrlShareToken, removeUrlShareByKey } from '@/lib/projects/urlShareStore';
import { decodeUrlKey } from '@/lib/projects/urlKeyRoute';
import { requireRole, currentUser } from '@/lib/auth/authorize';
import { getUserName } from '@/lib/auth/userStore';
import { findScheduleByUrl as findFormByUrl, removeSchedule as removeFormSchedule } from '@/lib/formWatch/scheduleStore';
import { findScheduleByUrl as findSiteByUrl, removeSchedule as removeSiteSchedule } from '@/lib/siteWatch/scheduleStore';
import { removeRun } from '@/lib/onDemandRunStore';
import { removeResult as removeFormResult } from '@/lib/formWatch/resultStore';
import { removeResult as removeSiteResult } from '@/lib/siteWatch/resultStore';
import { removeDaily } from '@/lib/siteWatch/dailyStore';
import { removeReports } from '@/lib/reportStore';
import { removeAlertsForSite } from '@/lib/alerts/store';
import { removeActiveWatch } from '@/lib/activeWatchesStore';
import { removeSnapshotsForHost } from '@/lib/snapshotFiles';
import type { ChangePoint, InternalStatus } from '@/lib/status/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

/** The acting user's display name (falls back to email) for attribution (FR-30). */
async function actorName(request: NextRequest): Promise<string | null> {
  const actor = await currentUser(request).catch(() => null);
  if (!actor) return null;
  return (await getUserName(actor.email).catch(() => null)) ?? actor.email;
}

/**
 * GET /api/projects/[id]/url/[key] — the internal, auth-gated status snapshot for
 * a SINGLE URL of a project (FR-27). `key` is the base64url-encoded canonical
 * url_key. Reuses buildClientStatus on a one-URL project subset, plus the host's
 * change-tracking timeline (tracking is host-level). Also returns the resolved
 * URL and its current per-URL share token for the dashboard's share control.
 * Under /api/projects (behind the login wall), so team-only detail is safe.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string; key: string } }) {
  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const urlKey = decodeUrlKey(params.key);
  const subset = projectForUrlKey(project, urlKey);
  if (!subset) return NextResponse.json({ error: 'URL not in this project' }, { status: 404 });
  const url = subset.urls[0]!;

  const windowDays = parseWindow(request.nextUrl.searchParams.get('window'));
  const base = await buildClientStatus(subset, { internal: true, windowDays });

  // Host-level change timeline for this URL's site (windowed).
  const host = siteKey(url);
  const sinceIso = windowDays == null ? null : new Date(Date.now() - (windowDays - 1) * DAY).toISOString();
  const events = host && host !== 'unknown' ? await loadChangeEvents(host, { sinceIso, limit: 500 }) : [];
  const changes: ChangePoint[] = events
    .map((e) => ({
      site: e.site, mode: e.mode, checkedAt: e.checkedAt,
      changesFound: e.changesFound, pagesChanged: e.pagesChanged, severity: e.severity, summary: e.summary,
    }))
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1));

  const shareToken = await getUrlShareToken(project.id, url);
  const data: InternalStatus & { sharedUrl: string; shareToken: string | null } = {
    ...base,
    contact: project.contact ?? null,
    changes,
    sharedUrl: url,
    shareToken,
  };
  return NextResponse.json(data);
}

/**
 * DELETE /api/projects/[id]/url/[key] — permanently remove a SINGLE URL from a
 * project AND purge all of its data (FR-27). The destructive per-URL sibling of
 * the project delete; Admin+ only (owner/admins), like project delete.
 *
 * Per URL (always): its Form Watch + Site Watch schedules, manual run, durable
 * results, daily rollups, and its public share token.
 * Per HOST (change tracking is site-level): the running watch, resume entry,
 * change reports/events, alert log, and snapshot files — but ONLY when no OTHER
 * URL in this project shares that host, so a sibling page's history is never lost.
 * Then the URL is removed from the project. Distinct from Edit→remove, which is
 * NON-destructive (drops the URL to Unassigned, keeps everything).
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string; key: string } }) {
  const denied = await requireRole(request, 'admin');
  if (denied) return denied;

  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const urlKey = decodeUrlKey(params.key);
  const subset = projectForUrlKey(project, urlKey);
  if (!subset) return NextResponse.json({ error: 'URL not in this project' }, { status: 404 });
  const url = subset.urls[0]!;
  const host = siteKey(url);

  // URL-level teardown — safe to purge for just this URL.
  const f = await findFormByUrl(url);
  if (f) await removeFormSchedule(f.id);
  const s = await findSiteByUrl(url);
  if (s) await removeSiteSchedule(s.id);
  await removeRun(url);
  await removeFormResult(url);
  await removeSiteResult(url);
  await removeDaily(url);
  await removeUrlShareByKey(params.id, urlKey); // revoke its public link

  // Host-level teardown ONLY if NOTHING still uses this host (change tracking is
  // site-level — don't wipe another page's, or another project's, history). Check
  // both this project's other URLs AND every other project.
  const remaining = project.urls.filter((u) => matchKey(u) !== urlKey);
  const hostStillUsed =
    remaining.some((u) => siteKey(u) === host) || (await hostUsedByOtherProject(host, project.id));
  let hostPurged = false;
  if (host && host !== 'unknown' && !hostStillUsed) {
    stopWatch(host);
    await removeActiveWatch(host);
    await removeReports(host);
    await removeChangeEvents(host);
    await removeAlertsForSite(host);
    await removeSnapshotsForHost(host);
    hostPurged = true;
  }

  // If that was the project's ONLY URL, the project is now empty and useless —
  // remove it too (its data is already purged above). Otherwise just drop the URL.
  let projectDeleted = false;
  const actor = await actorName(request);
  if (remaining.length === 0) {
    // The project goes with its last URL; its log cascades away with it.
    await projectStore.remove(params.id);
    projectDeleted = true;
  } else {
    await projectStore.update(params.id, { urls: remaining }, actor);
    await recordEvent(params.id, actor, 'url_removed', url);
  }

  return NextResponse.json({ ok: true, hostPurged, projectDeleted });
}
