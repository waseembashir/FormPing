import { NextRequest } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
// Path resolution + the traversal guard + deletion live in ONE place so this
// route and the project-delete cascade cannot drift apart (FR-21).
import {
  snapshotsRoot,
  hostnameOf,
  safeHostDir,
  dirSize,
  removeSnapshotsForHost,
} from '@/lib/snapshotFiles';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return Response.json({ error: 'url query param required' }, { status: 400 });
  }
  const host = hostnameOf(url);
  if (!host) return Response.json({ error: 'invalid url' }, { status: 400 });

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
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url) {
    return Response.json({ error: 'url required' }, { status: 400 });
  }
  const host = hostnameOf(body.url);
  if (!host) return Response.json({ error: 'invalid url' }, { status: 400 });

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
