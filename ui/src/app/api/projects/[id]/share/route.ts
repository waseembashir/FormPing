import { NextRequest, NextResponse } from 'next/server';
import { projectStore } from '@/lib/projects/projectStore';
import { requireRole, currentUser } from '@/lib/auth/authorize';
import { getUserName } from '@/lib/auth/userStore';
import { recordEvent } from '@/lib/projects/eventStore';

/** Display name of whoever is acting, or null when nobody is signed in. */
async function actorName(request: NextRequest): Promise<string | null> {
  const actor = await currentUser(request).catch(() => null);
  if (!actor) return null;
  return (await getUserName(actor.email).catch(() => null)) ?? actor.email;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manage a project's public status-page share token. Auth-gated (only the
 * generate/revoke controls need a session; the resulting /status/<token> page
 * itself is public).
 *
 * POST   → generate (or regenerate) the token, returns { shareToken }.
 * DELETE → revoke the token (status page goes 404 immediately).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Creating a public share link is Member+ — viewers are read-only.
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  const actor = await actorName(request);
  const project = await projectStore.enableShare(params.id, actor);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  await recordEvent(project.id, actor, 'share_enabled');
  return NextResponse.json({ shareToken: project.shareToken });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  // Revoking a public share link is Member+ — viewers are read-only.
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  const actor = await actorName(request);
  const project = await projectStore.disableShare(params.id, actor);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  await recordEvent(project.id, actor, 'share_disabled');
  return NextResponse.json({ ok: true });
}
