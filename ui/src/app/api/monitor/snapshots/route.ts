import { NextRequest } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
// Path resolution + the traversal guard + deletion live in ONE place so this
// route and the project-delete cascade cannot drift apart (FR-21).
import {
  hostnameOf,
  safeHostDir,
  dirSize,
  removeSnapshotsForHost,
} from '@/lib/snapshotFiles';
import { requireRole } from '@/lib/auth/authorize';
import { ownerScope } from '@/lib/ownerScope';
import { siteVisibleTo } from '@/lib/changeEventStore';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return Response.json({ error: 'url query param required' }, { status: 400 });
  }
  const host = hostnameOf(url);
  if (!host) return Response.json({ error: 'invalid url' }, { status: 400 });

  // Snapshots are files keyed by host with no owner on disk, so visibility is
  // answered by the change events each snapshot writes as it is taken. Without
  // this, someone else's monitoring is announced by a count: "2 snapshots for
  // example.com, last 7m ago, 46 KB" tells you a colleague is watching that
  // site and roughly how much they have captured. No content leaks, but the
  // fact of the work does, which is what per-user isolation is meant to stop.
  //
  // Answered as "none" rather than as a refusal, because the honest response to
  // "how many snapshots do I have here" is zero.
  const scope = await ownerScope(request);
  if (!(await siteVisibleTo(host, scope))) {
    return Response.json({ host, count: 0, latest: null, totalBytes: 0 });
  }

  const dir = safeHostDir(host);
  if (!dir || !existsSync(dir)) {
    return Response.json({ host, count: 0, latest: null, totalBytes: 0 });
  }

  let count = 0;
  let latestMtime = 0;
  try {
    const entries = await readdir(dir);
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      count++;
      const s = await stat(path.join(dir, f));
      if (s.mtimeMs > latestMtime) latestMtime = s.mtimeMs;
    }
  } catch { /* ignore */ }

  const totalBytes = await dirSize(dir);

  return Response.json({
    host,
    count,
    latest: latestMtime > 0 ? new Date(latestMtime).toISOString() : null,
    totalBytes,
  });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url) {
    return Response.json({ error: 'url required' }, { status: 400 });
  }
  const host = hostnameOf(body.url);
  if (!host) return Response.json({ error: 'invalid url' }, { status: 400 });

  // The read side only leaks a count; this one DESTROYS files, so it matters
  // more. Without the same check a member could clear snapshots belonging to
  // someone whose work they cannot even see -- and the owner would find their
  // baselines gone with nothing to explain it, which is worse than any leak.
  if (!(await siteVisibleTo(host, await ownerScope(request)))) {
    return Response.json({ error: 'no snapshots to clear' }, { status: 404 });
  }

  const dir = safeHostDir(host);
  if (!dir) return Response.json({ error: 'invalid host' }, { status: 400 });

  if (!existsSync(dir)) {
    return Response.json({ host, deleted: false, message: 'no snapshots to clear' });
  }

  // removeSnapshotsForHost re-applies the traversal guard before deleting.
  const deleted = await removeSnapshotsForHost(host);
  if (!deleted) {
    return Response.json({ error: 'refusing to delete outside snapshots root' }, { status: 400 });
  }

  return Response.json({
    host,
    deleted: true,
    message: `Cleared all snapshots for ${host}`,
  });
}
