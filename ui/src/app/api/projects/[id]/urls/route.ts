import { NextRequest, NextResponse } from 'next/server';
import { projectStore, urlKey } from '@/lib/projects/projectStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/[id]/urls — append a single URL to a project.
 * Body: { url: string }. Server-side dedup + idempotent (re-adding an existing
 * URL is a no-op), so it's safe to call from "Assign to project" without the
 * client needing to know the project's current URL list (avoids a read-modify
 * race vs sending the whole array to PATCH).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: 'A valid http(s) URL is required' },
      { status: 400 },
    );
  }

  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Dedup on the canonical key so re-adding the same URL in different casing is
  // still a no-op (a case-sensitive compare here silently created duplicates).
  const exists = project.urls.some((u) => urlKey(u) === urlKey(url));
  const updated = exists
    ? project
    : await projectStore.update(params.id, { urls: [...project.urls, url] });

  return NextResponse.json({ project: updated });
}
