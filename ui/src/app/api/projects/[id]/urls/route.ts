import { NextRequest, NextResponse } from 'next/server';
import { projectStore, urlKey } from '@/lib/projects/projectStore';
import { recordEvent } from '@/lib/projects/eventStore';
import { projectOwningUrl } from '@/lib/projects/urlOwnership';
import { removeDismissed } from '@/lib/projects/dismissedStore';
import { requireRole, currentUser } from '@/lib/auth/authorize';
import { getUserName } from '@/lib/auth/userStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The acting user's display name (falls back to email) for attribution (FR-30). */
async function actorName(request: NextRequest): Promise<string | null> {
  const actor = await currentUser(request).catch(() => null);
  if (!actor) return null;
  return (await getUserName(actor.email).catch(() => null)) ?? actor.email;
}

/**
 * POST /api/projects/[id]/urls — append a single URL to a project.
 * Body: { url: string }. Server-side dedup + idempotent (re-adding an existing
 * URL is a no-op), so it's safe to call from "Assign to project" without the
 * client needing to know the project's current URL list (avoids a read-modify
 * race vs sending the whole array to PATCH).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  // Adding a URL to a project is Member+ — viewers are read-only.
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

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

  // One page = one client: refuse a URL that already lives in ANOTHER project.
  const owner = await projectOwningUrl(url, params.id);
  if (owner) {
    return NextResponse.json(
      { error: `This URL is already in the project “${owner.name}”. A URL can only belong to one project — remove it there first.` },
      { status: 409 },
    );
  }

  // Dedup on the canonical key so re-adding the same URL in different casing is
  // still a no-op (a case-sensitive compare here silently created duplicates).
  const exists = project.urls.some((u) => urlKey(u) === urlKey(url));
  const actor = await actorName(request);
  const updated = exists
    ? project
    : await projectStore.update(params.id, { urls: [...project.urls, url] }, actor);
  // Only a real addition is an event — re-adding an existing URL is a no-op and
  // logging it would fill the history with actions nobody took. FR-66.
  if (!exists) await recordEvent(params.id, actor, 'url_added', url);

  // Adding a URL to a project is the opposite of "don't track" — so clear any
  // lingering dismissal for it. Without this a URL could be both in a project
  // AND dismissed (contradictory), and would vanish from Unassigned if later
  // removed from the project. Best-effort: a hiccup here must not fail the add.
  try {
    await removeDismissed(url);
  } catch (err) {
    console.warn(`[projects/urls] removeDismissed failed (add still succeeded): ${err}`);
  }

  return NextResponse.json({ project: updated });
}
