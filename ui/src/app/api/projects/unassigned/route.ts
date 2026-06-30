import { NextResponse } from 'next/server';
import { listUnassignedUrls, urlHealthFor } from '@/lib/projects/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/unassigned — per-URL health for monitored URLs that aren't
 * in any project yet. Powers the "Unassigned" bucket's expanded detail.
 */
export async function GET() {
  const urls = await listUnassignedUrls();
  const health = await urlHealthFor(urls);
  return NextResponse.json({ urls, health });
}
