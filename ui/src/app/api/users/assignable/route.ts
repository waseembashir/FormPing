import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/authorize';
import { listUsers } from '@/lib/auth/userStore';
import { atLeast } from '@/lib/auth/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/users/assignable — who a monitor may be handed to.
 *
 * Exists because `/api/users` is admin-only and the people who need this are
 * not all admins: a member may hand over their OWN monitor, which means picking
 * a colleague, which means knowing who the colleagues are.
 *
 * Rather than widen the team endpoint, this is a separate read with a single
 * purpose and the narrowest answer that serves it:
 *
 *   * **member and above only.** A viewer cannot receive a monitor — they would
 *     get its alerts with no power to re-run, re-point or stop it — so offering
 *     them in the picker would present a choice the server then refuses.
 *   * **name and email only.** No roles, no avatars, no timestamps. A picker
 *     needs a label and the address to send; everything else about a teammate
 *     is the Team page's business, which is admin-gated.
 *
 * The email is the address a handover is sent to and the key a person is
 * identified by, so it cannot be withheld. It is not much of a disclosure in
 * context: everyone who can read this screen already sees colleagues' names on
 * the "Watched by" badges, and these are work addresses on an internal tool.
 *
 * FR-116.
 */
export async function GET(request: NextRequest) {
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  const users = (await listUsers())
    .filter((u) => atLeast(u.role, 'member'))
    .map((u) => ({ email: u.email, name: u.name }));

  return NextResponse.json({ users });
}
