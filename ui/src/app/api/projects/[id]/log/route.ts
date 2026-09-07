import { NextRequest, NextResponse } from 'next/server';
import { listEvents } from '@/lib/projects/eventStore';
import { requireRole } from '@/lib/auth/authorize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/[id]/log — a project's activity log, newest first.
 *
 * OWNER/ADMIN ONLY. The log says who on the team opened, edited and shared a
 * client's project. That is a record of colleagues' activity, so it sits behind
 * the same bar as the rest of team administration — a Member can act on a
 * project without being able to audit who else has. FR-66.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole(request, 'admin');
  if (denied) return denied;

  const events = await listEvents(params.id);
  return NextResponse.json({ events });
}
