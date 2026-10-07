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
import { listUsers } from '@/lib/auth/userStore';
import { ownerLabel } from '@/lib/monitorCollision';
import { removeRun } from '@/lib/onDemandRunStore';
import { teardownUrls, teardownHosts, purgeableHosts, type TeardownIO } from '@/lib/projects/teardown';
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

  /**
   * Turn the owner EMAILS the builder stamps on each site into something worth
   * reading. `formOwner` / `siteOwner` have carried the creator's address since
   * per-user isolation and have never been displayed; Projects is where they
   * belong, because "who do I talk to about this URL" is exactly what a shared
   * record is for.
   *
   * One directory read for the whole payload rather than a lookup per site. An
   * address with no `app_users` row — or a person with no Google display name —
   * keeps the email, which is reachable and already on the Team page; a blank
   * where a name should be would be worse than the address itself.
   */
  const names = new Map((await listUsers()).map((u) => [u.email, u.name] as const));
  const label = (email?: string) => (email ? ownerLabel(names.get(email) ?? null, email) ?? undefined : undefined);
  /**
   * Every owner field resolved by walking a list rather than naming each one.
   *
   * Naming them individually is exactly how the content watcher was missed on
   * the project page: it was added after the other two and simply never joined
   * them, so it reached the screen as a raw email beside two display names. A
   * fourth owner added here is one entry, not a thing to remember. FR-118.
   */
  const OWNER_FIELDS = ['formOwner', 'siteOwner', 'changeOwner'] as const;
  const sites = base.sites.map((site) => {
    const named = { ...site };
    for (const field of OWNER_FIELDS) {
      const email = named[field];
      if (email) named[field] = label(email);
    }
    return named;
  });

  const shareToken = await getUrlShareToken(project.id, url);
  const data: InternalStatus & { sharedUrl: string; shareToken: string | null } = {
    ...base,
    sites,
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

  const remaining = project.urls.filter((u) => matchKey(u) !== urlKey);

  /**
   * Both schedule lookups and the host question together — none of the three
   * depends on the others. This whole teardown used to run one await at a
   * time, thirteen deep, which is most of why deleting a URL felt slow.
   */
  const [f, s, hostUsedElsewhere] = await Promise.all([
    findFormByUrl(url),
    findSiteByUrl(url),
    host && host !== 'unknown' ? hostUsedByOtherProject(host, project.id) : Promise.resolve(false),
  ]);

  const io: TeardownIO = {
    removeFormSchedule,
    removeSiteSchedule,
    removeRun,
    removeFormResult,
    removeSiteResult,
    removeDaily,
    stopWatch,
    removeActiveWatch,
    removeReports,
    removeChangeEvents,
    removeAlertsForSite,
    removeSnapshotsForHost,
  };

  // The same tested cascade the project delete uses, so one URL and a whole
  // project cannot drift into clearing different things.
  await Promise.all([
    teardownUrls([url], () => ({ formId: f?.id, siteId: s?.id }), io),
    removeUrlShareByKey(params.id, urlKey), // revoke its public link
  ]);

  /**
   * Host-level teardown ONLY if nothing still uses this host — change tracking
   * is site-level, so this must not wipe another page's, or another project's,
   * history. Both this project's other URLs and every other project count.
   */
  const stillUsed = new Set(
    remaining.some((u) => siteKey(u) === host) || hostUsedElsewhere ? [host] : [],
  );
  const purged = purgeableHosts([host], stillUsed);
  await teardownHosts(purged, io);
  const hostPurged = purged.length > 0;

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
