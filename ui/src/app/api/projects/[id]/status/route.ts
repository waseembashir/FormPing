import { NextRequest, NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
import { buildClientStatus, parseWindow } from '@/lib/status/build';
import { loadChangeEvents } from '@/lib/changeEventStore';
import { siteKey } from '@/lib/watchRegistry';
import type { ChangePoint, InternalStatus } from '@/lib/status/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

/**
 * GET /api/projects/[id]/status — the analytical status snapshot ENRICHED with
 * team-only technical detail (per-site `tech`, the project contact, and the
 * change-tracking timeline), keyed by project id and AUTH-GATED. No share token
 * needed — this never leaves the login wall (it's under /api/projects, not the
 * public /api/status/ allowlist), so the extra detail is safe to include.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const windowDays = parseWindow(request.nextUrl.searchParams.get('window'));
  const base = await buildClientStatus(project, { internal: true, windowDays });

  // Change-tracking timeline for every distinct host in the project. Tracking is
  // host-level (the crawler walks a whole site from its homepage), so URLs
  // sharing a host collapse to one series. Windowed by the same ?window= filter
  // as the rest of the page. Internal-only — never added to the public payload.
  const hosts = Array.from(new Set(project.urls.map(siteKey))).filter((h) => h && h !== 'unknown');
  const sinceIso = windowDays == null ? null : new Date(Date.now() - (windowDays - 1) * DAY).toISOString();
  const perHost = await Promise.all(hosts.map((h) => loadChangeEvents(h, { sinceIso, limit: 500 })));
  const changes: ChangePoint[] = perHost
    .flat()
    .map((e) => ({
      site: e.site,
      mode: e.mode,
      checkedAt: e.checkedAt,
      changesFound: e.changesFound,
      pagesChanged: e.pagesChanged,
      severity: e.severity,
      summary: e.summary,
    }))
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1)); // newest first

  const data: InternalStatus = { ...base, contact: project.contact ?? null, changes };
  return NextResponse.json(data);
}
