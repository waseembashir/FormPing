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
import { removeReports } from '@/lib/reportStore';
import { siteKey } from '@/lib/watchRegistry';

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
 * DELETE /api/projects/[id] — remove a project AND cascade everything tied to
 * its URLs: the Form Watch / Site Watch monitors, their durable per-URL results,
 * the last manual Form Tester run, and the per-host Change Monitor reports.
 * Deleting a project = a COMPLETE delete (rule: only a project delete clears
 * results — stopping a single monitor keeps them). Nothing lingers in the
 * Unassigned bucket afterwards; no orphaned schedules, results, or reports.
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
    hosts.add(siteKey(url));
  }
  // Change Monitor reports are per-host — clear each distinct host once.
  for (const host of hosts) await removeReports(host);

  await projectStore.remove(params.id);
  return NextResponse.json({ ok: true, monitorsRemoved });
}
