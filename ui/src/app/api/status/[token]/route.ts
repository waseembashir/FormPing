import { NextRequest, NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
import { buildClientStatus, parseWindow } from '@/lib/status/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/status/[token] — PUBLIC (auth-gate-exempt via middleware).
 *
 * Returns the client-safe status snapshot for the project that owns this share
 * token. A missing / unknown / revoked token yields a plain 404 with no detail,
 * so tokens can't be enumerated and nothing leaks. Only client-safe fields are
 * ever emitted (see lib/status/build.ts).
 */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token?.trim();
  if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const project = await projectStore.findByToken(token);
  if (!project || !project.shareToken) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const windowDays = parseWindow(request.nextUrl.searchParams.get('window'));
  const data = await buildClientStatus(project, { windowDays });
  return NextResponse.json(data);
}
