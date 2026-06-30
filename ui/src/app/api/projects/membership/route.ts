import { NextRequest, NextResponse } from 'next/server';
import { projectStore, normalizeUrl } from '@/lib/projects/projectStore';
import { isDismissed } from '@/lib/projects/dismissedStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/membership?url=... — is this URL already in a project, or
 * dismissed? The add-time popup uses this to decide whether to prompt at all
 * (skip if it's already grouped or the user previously said "don't track").
 */
export async function GET(request: NextRequest) {
  const url = (request.nextUrl.searchParams.get('url') ?? '').trim();
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  const [projects, dismissed] = await Promise.all([projectStore.list(), isDismissed(url)]);
  const target = normalizeUrl(url);
  const inProject = projects.some((p) => p.urls.some((u) => normalizeUrl(u) === target));

  return NextResponse.json({ inProject, dismissed });
}
