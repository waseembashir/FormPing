/**
 * Handing a monitor to somebody else.
 *
 * A URL is watched by one person, and only that person can see or manage their
 * monitors — which is right until they go on leave, or leave. Then a client's
 * form is being checked by somebody unreachable, nobody else can pause it,
 * re-point it or stop it, and the alerts go to an inbox nobody is reading.
 *
 * The alternative considered was letting admins read everyone's tool tabs. That
 * was rejected: it makes isolation conditional for everybody, permanently, to
 * solve a problem that happens occasionally. Reassignment keeps the exception
 * an explicit act somebody chose, on one monitor, at one moment — and it leaves
 * an admin's own tabs free of other people's work.
 *
 * Pure: it answers "may this person move this monitor, to that person?" from
 * facts the caller has already looked up, so every rule is testable without a
 * session or a database.
 */

import { atLeast, type Role } from '@/lib/auth/roles';

export interface AssignRequest {
  /** The role of whoever is asking. */
  actorRole: Role;
  /** Their email, to tell "my own monitor" from "somebody else's". */
  actorEmail: string | undefined;
  /** Who holds the monitor now. Absent on one created before ownership. */
  currentOwner: string | undefined;
  /** The email it would move to. */
  targetEmail: string;
  /** The target's role, or undefined if they are not on the team at all. */
  targetRole: Role | undefined;
}

export type AssignVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Whether this handover may go ahead.
 *
 * The refusals are worded for the person reading them, because each one is
 * something they might reasonably have expected to work.
 */
export function canAssign(req: AssignRequest): AssignVerdict {
  const { actorRole, actorEmail, currentOwner, targetEmail, targetRole } = req;

  /**
   * Admins and the owner may move any monitor; everybody else may move only
   * their own. This is the whole point of the feature — the case it exists for
   * is somebody being unavailable, so it cannot depend on them acting.
   */
  const isAdmin = atLeast(actorRole, 'admin');
  const isMine = Boolean(actorEmail && currentOwner && actorEmail === currentOwner);
  if (!isAdmin && !isMine) {
    return {
      ok: false,
      reason: currentOwner
        ? 'This monitor belongs to somebody else. An admin can hand it over.'
        : 'This monitor has no recorded owner. An admin can assign it.',
    };
  }

  /**
   * Never to a viewer. They would start receiving alerts for a form they have
   * no power to re-run, re-point or stop — a notification about a problem they
   * cannot act on, which is worse than not being told.
   */
  if (!targetRole) {
    return { ok: false, reason: 'That person is not on the team.' };
  }
  if (!atLeast(targetRole, 'member')) {
    return {
      ok: false,
      reason: 'Viewers cannot be given a monitor — they would get its alerts without being able to act on them.',
    };
  }

  /**
   * Moving a monitor to whoever already holds it would write a handover event
   * and send a notification for a change that did not happen.
   */
  if (currentOwner && currentOwner === targetEmail) {
    return { ok: false, reason: 'That person already watches this URL.' };
  }

  return { ok: true };
}

/**
 * How long a freshly handed-over monitor announces itself to its new owner.
 *
 * A monitor appearing quietly among a dozen others is not the same as knowing
 * it is now yours. The card says so — but "until it has been seen" would mean
 * writing to the database every time somebody loads a page, which is a write on
 * a read, and racy with the polling the tab already does.
 *
 * A window does the same job with the one write that actually happened. Seven
 * days covers a normal absence, and the marker retiring on its own is correct:
 * by then the monitor is simply theirs.
 */
export const ASSIGNED_NOTICE_DAYS = 7;

/**
 * Whether to tell this viewer the monitor was handed to them.
 *
 * Only the new owner, and only while it is recent. Showing it to anybody else
 * would be announcing somebody else's business, and showing it forever would
 * make a settled monitor look permanently new.
 */
export function showsAssignedNotice(
  monitor: { owner?: string; assignedAt?: string },
  viewerEmail: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!monitor.assignedAt || !monitor.owner) return false;
  if (!viewerEmail || viewerEmail !== monitor.owner) return false;

  const at = new Date(monitor.assignedAt).getTime();
  if (Number.isNaN(at)) return false;

  const age = now.getTime() - at;
  // A timestamp in the future is a clock problem, not a fresh handover; showing
  // the notice for it would mean showing it for days.
  if (age < 0) return false;

  return age <= ASSIGNED_NOTICE_DAYS * 24 * 60 * 60 * 1000;
}
