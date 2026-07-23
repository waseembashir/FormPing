import { NextRequest, NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
import { loadReports } from '@/lib/reportStore';
import { siteKey } from '@/lib/watchRegistry';
import type { ChangeReport, PageChange } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/changes?site=<host>&at=<iso>
 *
 * The DRILL-IN behind a change-tracking timeline row: returns the full per-page
 * detail for one run, so the dashboard can answer "what actually changed?"
 * without leaving the project.
 *
 * AUTH-GATED (it lives under /api/projects, not the public /api/status/
 * allowlist) — change detail is internal-only and must never reach a client.
 *
 * Only the most recent runs keep their heavy `details` payload (see
 * KEEP_REPORTS_PER_SITE in reportStore); older timeline rows resolve to
 * `found: false` and the UI says the detail is no longer kept. The slim event
 * itself lives on in `change_events`, so the timeline stays complete.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const site = request.nextUrl.searchParams.get('site')?.trim() ?? '';
  const at = request.nextUrl.searchParams.get('at')?.trim() ?? '';
  if (!site || !at) {
    return NextResponse.json({ error: 'site and at query params are required' }, { status: 400 });
  }

  // Only serve hosts this project actually owns.
  const owned = new Set(project.urls.map(siteKey));
  if (!owned.has(site)) {
    return NextResponse.json({ error: 'Site does not belong to this project' }, { status: 403 });
  }

  const wanted = Date.parse(at);
  if (Number.isNaN(wanted)) {
    return NextResponse.json({ error: 'Invalid "at" timestamp' }, { status: 400 });
  }

  // Match on the INSTANT, not the string: the event's `checked_at` comes back
  // from Postgres as a timestamptz (…+00:00) while the report key is the raw ISO
  // string (…Z). Same moment, different text.
  const reports = await loadReports(site, 50);
  const hit = reports.find((r) => Date.parse(r.timestamp) === wanted);
  if (!hit) {
    return NextResponse.json({ found: false, details: [] });
  }

  const report = hit.report as Partial<ChangeReport> | null;
  const details: PageChange[] = Array.isArray(report?.details) ? (report!.details as PageChange[]) : [];

  return NextResponse.json({
    found: true,
    checkedAt: hit.timestamp,
    pagesScanned: typeof report?.pagesScanned === 'number' ? report.pagesScanned : null,
    summary: typeof report?.summary === 'string' ? report.summary : null,
    details,
  });
}
