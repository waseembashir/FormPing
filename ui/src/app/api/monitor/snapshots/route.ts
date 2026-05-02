import { NextRequest } from 'next/server';
import { readdir, stat, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function snapshotsRoot(): string {
  // ui dev server runs from formping/ui — snapshots live at formping/data/snapshots
  return path.resolve(process.cwd(), '..', 'data', 'snapshots');
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Resolve the host directory and verify it stays inside the snapshots root. */
function safeHostDir(host: string): string | null {
  if (!/^[a-z0-9.-]+$/i.test(host)) return null; // strict allow-list
  const root = snapshotsRoot();
  const dir = path.resolve(root, host);
  if (dir !== root && !dir.startsWith(root + path.sep)) return null;
  return dir;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(full);
      else total += (await stat(full)).size;
    }
  } catch { /* ignore */ }
  return total;
}

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

  // Hard safety: assert resolved path is still within snapshots root before rm
  const root = snapshotsRoot();
  if (dir === root || !dir.startsWith(root + path.sep)) {
    return Response.json({ error: 'refusing to delete outside snapshots root' }, { status: 400 });
  }

  await rm(dir, { recursive: true, force: true });

  return Response.json({
    host,
    deleted: true,
    message: `Cleared all snapshots for ${host}`,
  });
}
