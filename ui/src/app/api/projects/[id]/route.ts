import { NextRequest, NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
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
import { removeReports } from '@/lib/reportStore';
import { removeChangeEvents } from '@/lib/changeEventStore';
import { siteKey, stopWatch } from '@/lib/watchRegistry';
import { removeActiveWatch } from '@/lib/activeWatchesStore';
import { removeSnapshotsForHost } from '@/lib/snapshotFiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function badUrl(u: string): boolean {
  return !/^https?:\/\//i.test(u);
}

/** GET /api/projects/[id] — the project plus per-URL health (form + uptime/SSL). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const health = await urlHealthFor(project.urls);
  return NextResponse.json({ project: { ...project, health } });
}

/** PATCH /api/projects/[id] — update name / urls / notes. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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
    patch.urls = urls;
  }
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (typeof body.contact === 'string') patch.contact = body.contact;

  const updated = await projectStore.update(params.id, patch);
  if (!updated) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
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
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
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
  let watchesStopped = 0;
  for (const host of hosts) {
    if (stopWatch(host)) watchesStopped++; // kill the running subprocess
    await removeActiveWatch(host); // and don't let it resume after a redeploy
    await removeReports(host);
    await removeChangeEvents(host);
    await removeSnapshotsForHost(host); // the baseline files on disk
  }

  await projectStore.remove(params.id);
  return NextResponse.json({ ok: true, monitorsRemoved, watchesStopped });
}
