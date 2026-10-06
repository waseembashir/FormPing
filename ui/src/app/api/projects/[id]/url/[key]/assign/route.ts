import { NextRequest, NextResponse } from 'next/server';
import { projectStore, projectForUrlKey } from '@/lib/projects/projectStore';
import { decodeUrlKey } from '@/lib/projects/urlKeyRoute';
import { requireRole, currentUser } from '@/lib/auth/authorize';
import { getRole, getUserName, listUsers } from '@/lib/auth/userStore';
import { recordEvent } from '@/lib/projects/eventStore';
import { canAssign } from '@/lib/monitorAssignment';
import { ownerLabel } from '@/lib/monitorCollision';
import {
  findScheduleByUrl as findFormByUrl,
  upsertSchedule as upsertFormSchedule,
} from '@/lib/formWatch/scheduleStore';
import {
  findScheduleByUrl as findSiteByUrl,
  upsertSchedule as upsertSiteSchedule,
} from '@/lib/siteWatch/scheduleStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Which of a URL's monitors is being handed over. */
type Kind = 'form' | 'uptime';
const KINDS: Kind[] = ['form', 'uptime'];

/**
 * POST /api/projects/[id]/url/[key]/assign — hand a monitor to somebody else.
 * Body: { kind: 'form' | 'uptime', to: string }
 *
 * A URL is watched by one person, and since per-user isolation only they can
 * see or manage their monitors. That is right until they go on leave, or leave:
 * a client's form is then checked by somebody unreachable, nobody else can
 * pause or re-point it, and its alerts land in an inbox nobody reads.
 *
 * The alternative — letting admins read everyone's tool tabs — was rejected on
 * 2026-10-05. It makes isolation conditional for everybody, permanently, to
 * solve something that happens occasionally. This keeps the exception an
 * explicit act somebody chose, on one monitor, at one moment.
 *
 * **The handover is one write.** `owner` moves, and that is all: alert routing
 * already reads that column, so notifications follow without being told to. No
 * run or result row is touched — a run records who was responsible when it
 * happened, and rewriting that would make the log claim somebody performed
 * checks they never did. The new owner still sees the whole history, because
 * access to it follows the schedule rather than the run rows.
 *
 * Lives under /api/projects because that is where it is done from: the tool
 * tabs are each person's own workspace, and the point of this is reaching a
 * monitor that is not in yours.
 *
 * Content-change tracking is deliberately absent. It has no schedule row — its
 * owner is a property of each run — so there is nothing to hand over.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string; key: string } }) {
  // Member+ to attempt it at all; `canAssign` decides whether this particular
  // handover is theirs to make.
  const denied = await requireRole(request, 'member');
  if (denied) return denied;

  let body: { kind?: unknown; to?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : null;
  const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  if (!kind) return NextResponse.json({ error: 'kind must be "form" or "uptime"' }, { status: 400 });
  if (!to) return NextResponse.json({ error: 'to is required' }, { status: 400 });

  const project = await projectStore.get(params.id);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const urlKey = decodeUrlKey(params.key);
  const subset = projectForUrlKey(project, urlKey);
  if (!subset) return NextResponse.json({ error: 'URL not in this project' }, { status: 404 });
  const url = subset.urls[0]!;

  const schedule = kind === 'form' ? await findFormByUrl(url) : await findSiteByUrl(url);
  if (!schedule) {
    return NextResponse.json({ error: 'There is no monitor of that kind on this URL.' }, { status: 404 });
  }

  const actor = await currentUser(request);
  const verdict = canAssign({
    actorRole: actor?.role ?? 'viewer',
    actorEmail: actor?.email,
    currentOwner: schedule.owner,
    targetEmail: to,
    targetRole: await getRole(to).catch(() => undefined),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 403 });

  /**
   * `getRole` answers for an address that has never signed in by falling back
   * to the default role, so it cannot tell a teammate from a typo. The team
   * list can, and this is a handover — pointing a client's alerts at an address
   * nobody reads is exactly the failure the feature exists to prevent.
   */
  const onTheTeam = (await listUsers()).some((u) => u.email === to);
  if (!onTheTeam) return NextResponse.json({ error: 'That person is not on the team.' }, { status: 403 });

  const at = new Date().toISOString();
  const moved = { ...schedule, owner: to, assignedAt: at, assignedBy: actor?.email ?? undefined };
  if (kind === 'form') await upsertFormSchedule(moved as never);
  else await upsertSiteSchedule(moved as never);

  // The activity log is where a change of responsibility belongs, and its actor
  // is stored as text precisely so it survives somebody leaving the team.
  // Best-effort, like every other event: a failed log write must not undo a
  // handover that has already happened.
  const actorLabel = actor ? ownerLabel(await getUserName(actor.email).catch(() => null), actor.email) : null;
  const toLabel = ownerLabel(await getUserName(to).catch(() => null), to) ?? to;
  void recordEvent(
    project.id,
    actorLabel,
    'monitor_assigned',
    `${kind === 'form' ? 'form' : 'uptime'} monitor on ${url} → ${toLabel}`,
  );

  return NextResponse.json({ ok: true, owner: toLabel, assignedAt: at });
}
