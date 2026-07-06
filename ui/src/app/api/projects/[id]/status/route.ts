import { NextRequest, NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
import { buildClientStatus } from '@/lib/status/build';
import type { InternalStatus } from '@/lib/status/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/status — the analytical status snapshot ENRICHED with
 * team-only technical detail (per-site `tech` + the project contact), keyed by
 * project id and AUTH-GATED. No share token needed — this never leaves the
 * login wall (it's under /api/projects, not the public /api/status/ allowlist),
 * so the extra detail is safe to include.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const base = await buildClientStatus(project, { internal: true });
  const data: InternalStatus = { ...base, contact: project.contact ?? null };
  return NextResponse.json(data);
}
