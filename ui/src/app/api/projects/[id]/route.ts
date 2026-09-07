import { NextRequest, NextResponse } from 'next/server';
import { projectStore, matchKey } from '@/lib/projects/projectStore';
import { hostsUsedByOtherProjects } from '@/lib/projects/hostUsage';
import { firstUrlOwnedElsewhere, firstDuplicatePage } from '@/lib/projects/urlOwnership';
import { removeUrlShareByKey } from '@/lib/projects/urlShareStore';
import { requireRole, currentUser } from '@/lib/auth/authorize';
import { recordEvent } from '@/lib/projects/eventStore';
import { atLeast } from '@/lib/auth/roles';
import { getUserName } from '@/lib/auth/userStore';
import { urlHealthFor } from '@/lib/projects/health';
import {
  findScheduleByUrl as findFormByUrl,
  removeSchedule as removeFormSchedule,
} from '@/lib/formWatch/scheduleStore';
import {
  findScheduleByUrl as findSiteByUrl,
  removeSchedule as removeSiteSchedule,
} from '@/lib/siteWatch/scheduleStore';
import { removeRun } from '@/lib/onDemandRunStore';
import { removeResult as removeFormResult } from '@/lib/formWatch/resultStore';
import { removeResult as removeSiteResult } from '@/lib/siteWatch/resultStore';
import { removeDaily } from '@/lib/siteWatch/dailyStore';
import { removeDismissed } from '@/lib/projects/dismissedStore';
import { removeReports } from '@/lib/reportStore';
import { removeChangeEvents } from '@/lib/changeEventStore';
import { removeAlertsForSite } from '@/lib/alerts/store';
import { siteKey, stopWatch } from '@/lib/watchRegistry';
import { removeActiveWatch } from '@/lib/activeWatchesStore';
import { removeSnapshotsForHost } from '@/lib/snapshotFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reject malformed URLs — well-formed http(s) with a real domain, or it's bad. */
function badUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return !/^https?:$/.test(url.protocol) || !url.hostname.includes('.');
  } catch {
    return true;
  }
}

/** The acting user's display name (falls back to email) for attribution (FR-30). */
async function actorName(request: NextRequest): Promise<string | null> {
  const actor = await currentUser(request).catch(() => null);
  if (!actor) return null;
  return (await getUserName(actor.email).catch(() => null)) ?? actor.email;
}

/** GET /api/projects/[id] — the project plus per-URL health (form + uptime/SSL). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  // Record that someone opened this project. Deduped to once per person per
  // hour inside the store — without that, revisiting a project a few times
  // would bury every real edit under a wall of "viewed" rows. Fire-and-forget:
  // reading a project must never fail because its log could not be written. FR-66.
  void recordEvent(params.id, await actorName(request), 'viewed');
  const health = await urlHealthFor(project.urls);
  return NextResponse.json({ project: { ...project, health } });
}

/** PATCH /api/projects/[id] — update name / urls / notes. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  // Editing a project (name/URLs/notes) is Member+ — viewers are read-only.
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  let body: { name?: unknown; urls?: unknown; notes?: unknown; contact?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const patch: { name?: string; urls?: string[]; notes?: string; contact?: string } = {};

  if (typeof body.name === 'string') {
    if (!body.name.trim()) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    patch.name = body.name;
  }
  if (Array.isArray(body.urls)) {
    const urls = body.urls
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter(Boolean);
    const bad = urls.find(badUrl);
    if (bad) {
      return NextResponse.json(
        { error: `Invalid URL: "${bad}" — must start with http:// or https://` },
        { status: 400 },
      );
    }
    // The same page can't be listed twice in this project.
    const dupe = firstDuplicatePage(urls);
    if (dupe) {
      return NextResponse.json(
        { error: `“${dupe}” is already in this project — the same URL can’t be added twice.` },
        { status: 409 },
      );
    }
    // One page = one client: a URL that already lives in ANOTHER project can't be
    // added here (exclude this project so its own existing URLs never clash).
    const clash = await firstUrlOwnedElsewhere(urls, params.id);
    if (clash) {
      return NextResponse.json(
        { error: `“${clash.url}” is already in the project “${clash.owner.name}”. A URL can only belong to one project.` },
        { status: 409 },
      );
    }
    patch.urls = urls;
  }
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (typeof body.contact === 'string') patch.contact = body.contact;

  // Current project — needed to spot removed URLs (revoke their share links,
  // FR-27) and to skip a no-op save (don't bump "updated" when nothing changed).
  const before = await projectStore.get(params.id);
  if (!before) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Removing a URL from a project — including removing the last one, which deletes
  // the project — is Admin+ ONLY (FR-37). Members/viewers can rename, edit notes
  // and ADD URLs, but not take existing URLs out. Enforced here, not just in the
  // UI: compare the incoming set to what's stored and 403 if anything is dropped.
  if (patch.urls !== undefined && before) {
    const keptKeys = new Set(patch.urls.map(matchKey));
    const removesAny = before.urls.some((u) => !keptKeys.has(matchKey(u)));
    if (removesAny) {
      const actor = await currentUser(request).catch(() => null);
      if (!actor || !atLeast(actor.role, 'admin')) {
        return NextResponse.json(
          { error: 'Only an admin or owner can remove a URL from a project.' },
          { status: 403 },
        );
      }
    }
  }

  // Removing the LAST URL leaves an empty, useless project — delete it instead
  // (FR-27). The URLs keep their data (they drop to Unassigned); only their
  // per-URL share links are revoked. Same end-state as deleting the last URL.
  if (patch.urls !== undefined && patch.urls.length === 0) {
    if (!before) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    await Promise.all(
      before.urls.map((u) => removeUrlShareByKey(params.id, matchKey(u)).catch(() => {})),
    );
    await projectStore.remove(params.id);
    return NextResponse.json({ projectDeleted: true });
  }

  // No-op guard: if nothing actually changed, leave the project — and its
  // "updated / edited by" stamp — exactly as it was. A save that changes nothing
  // shouldn't look like an edit.
  const norm = (s?: string) => (s ?? '').trim();
  const changed =
    (patch.name !== undefined && norm(patch.name) !== norm(before.name)) ||
    (patch.notes !== undefined && norm(patch.notes) !== norm(before.notes)) ||
    (patch.contact !== undefined && norm(patch.contact) !== norm(before.contact)) ||
    (patch.urls !== undefined &&
      (patch.urls.length !== before.urls.length || patch.urls.some((u, i) => u !== before.urls[i])));
  if (!changed) return NextResponse.json({ project: before });

  const actor = await actorName(request);
  const updated = await projectStore.update(params.id, patch, actor);
  if (!updated) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Log WHAT changed, not just "edited". One save can rename a project and add
  // two URLs; a single "updated" row would tell the reader nothing they can act
  // on. Compared against `before`, so a field submitted unchanged is not logged. FR-66.
  if (patch.name !== undefined && norm(patch.name) !== norm(before.name)) {
    await recordEvent(params.id, actor, 'renamed', patch.name.trim());
  }
  if (patch.notes !== undefined && norm(patch.notes) !== norm(before.notes)) {
    await recordEvent(params.id, actor, 'notes_changed');
  }
  if (patch.contact !== undefined && norm(patch.contact) !== norm(before.contact)) {
    await recordEvent(params.id, actor, 'contact_changed');
  }
  if (patch.urls !== undefined) {
    const beforeKeys = new Map(before.urls.map((u) => [matchKey(u), u]));
    const afterKeys = new Map(patch.urls.map((u) => [matchKey(u), u]));
    for (const [k, u] of afterKeys) if (!beforeKeys.has(k)) await recordEvent(params.id, actor, 'url_added', u);
    for (const [k, u] of beforeKeys) if (!afterKeys.has(k)) await recordEvent(params.id, actor, 'url_removed', u);
  }

  // A URL removed from the project must not keep a live public share link
  // (FR-27). Revoke the per-URL token for every URL that left. Best-effort.
  if (before && patch.urls) {
    const kept = new Set(patch.urls.map(matchKey));
    const removedKeys = before.urls.map(matchKey).filter((k) => !kept.has(k));
    await Promise.all(
      removedKeys.map((k) =>
        removeUrlShareByKey(params.id, k).catch((err) =>
          console.warn(`[projects/${params.id}] revoke url share for ${k} failed: ${err}`),
        ),
      ),
    );
  }

  // URLs now in the project are being tracked — clear any stale "don't track"
  // dismissal so the two states can't contradict. Best-effort per URL.
  if (patch.urls?.length) {
    await Promise.all(
      patch.urls.map((u) =>
        removeDismissed(u).catch((err) =>
          console.warn(`[projects/${params.id}] removeDismissed failed for ${u} (edit still succeeded): ${err}`),
        ),
      ),
    );
  }

  return NextResponse.json({ project: updated });
}

/**
 * DELETE /api/projects/[id] — remove a project AND everything tied to it.
 *
 * Deleting a project is a COMPLETE delete: no monitoring keeps running and no
 * data survives. (Rule: ONLY a project delete clears results — stopping a single
 * monitor keeps them.) An orphan here is not just untidy, it is harmful: a
 * scheduler left running keeps crawling and submitting forms on a site you no
 * longer track, burning quota and alerting about a client who isn't in the system.
 *
 * The cascade covers, per URL:
 *   - Form Watch + Site Watch schedules (their run history goes via FK cascade)
 *   - the durable per-URL results, daily uptime rollups, last manual test
 * and per HOST:
 *   - a RUNNING Change Monitor watch subprocess (+ its persisted resume entry)
 *   - change reports + change events
 *   - the snapshot FILES on disk
 *
 * NOTE: this policy lives in application code, not the database — projects are
 * linked to monitors by URL string, not a foreign key (deliberately: monitors
 * can exist without a project, which is what the Unassigned bucket is for). So
 * deleting a project row directly in the database will NOT run any of this.
 * Always delete through the app.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  // Deleting a project is the irreversible cascade — Admin+ only (FR-24). Members
  // and viewers (devs/QA) can add URLs and run tests, but not delete a client.
  const denied = await requireRole(request, 'admin');
  if (denied) return denied;

  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  let monitorsRemoved = 0;
  const hosts = new Set<string>();
  for (const url of project.urls) {
    const f = await findFormByUrl(url);
    if (f) {
      await removeFormSchedule(f.id);
      monitorsRemoved++;
    }
    const s = await findSiteByUrl(url);
    if (s) {
      await removeSiteSchedule(s.id);
      monitorsRemoved++;
    }
    // Clear every persisted result for this URL so nothing reappears as Unassigned.
    await removeRun(url); // manual Form Tester run
    await removeFormResult(url); // durable Form Watch result
    await removeSiteResult(url); // durable Site Watch result
    await removeDaily(url); // Site Watch daily rollups
    hosts.add(siteKey(url));
  }

  // Per-host Change Monitor teardown. Order matters: STOP the watch first, so it
  // cannot write new events/reports in between and resurrect what we delete.
  // Change tracking is host-level, so skip any host that ANOTHER project still
  // tracks — deleting this project must not wipe a host's history out from under
  // a sibling project that shares the same site.
  const hostsUsedElsewhere = await hostsUsedByOtherProjects(params.id);
  let watchesStopped = 0;
  for (const host of hosts) {
    if (host === 'unknown' || hostsUsedElsewhere.has(host)) continue; // another project keeps this host alive
    if (stopWatch(host)) watchesStopped++; // kill the running subprocess
    await removeActiveWatch(host); // and don't let it resume after a redeploy
    await removeReports(host);
    await removeChangeEvents(host);
    await removeAlertsForSite(host); // the alert delivery log
    await removeSnapshotsForHost(host); // the baseline files on disk
  }

  await projectStore.remove(params.id);
  return NextResponse.json({ ok: true, monitorsRemoved, watchesStopped });
}
