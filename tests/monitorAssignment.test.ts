/**
 * Handing a monitor to somebody else.
 *
 * A URL is watched by one person, and only they can see or manage it — right
 * until they go on leave, or leave. Then a client's form is checked by somebody
 * unreachable, nobody else can pause or re-point it, and its alerts land in an
 * inbox nobody reads. That happened in miniature during a two-user test: the
 * only way to take a URL over was to ask the colleague to stop their monitor.
 *
 * The alternative — admins reading everyone's tabs — was rejected because it
 * makes isolation conditional for everybody, permanently, to solve something
 * that happens occasionally. These pin the rules of the narrower answer.
 */

import { describe, it, expect } from 'vitest';
import { canAssign, showsAssignedNotice, ASSIGNED_NOTICE_DAYS } from '@/lib/monitorAssignment';
import type { Role } from '@/lib/auth/roles';

const req = (over: Partial<Parameters<typeof canAssign>[0]> = {}) => ({
  actorRole: 'admin' as Role,
  actorEmail: 'admin@example.com',
  currentOwner: 'jordan@example.com',
  targetEmail: 'tajamul@example.com',
  targetRole: 'member' as Role,
  ...over,
});

describe('who may hand a monitor over', () => {
  it('lets an admin move somebody else’s', () => {
    // The case the feature exists for. It cannot depend on the current owner
    // acting, because being unable to reach them is the whole problem.
    expect(canAssign(req())).toEqual({ ok: true });
  });

  it('lets the owner of the app do the same', () => {
    expect(canAssign(req({ actorRole: 'owner' }))).toEqual({ ok: true });
  });

  it('lets a member hand over their own', () => {
    // The orderly version: handing work on before going away, rather than an
    // admin cleaning up after.
    const verdict = canAssign(req({ actorRole: 'member', actorEmail: 'jordan@example.com' }));
    expect(verdict).toEqual({ ok: true });
  });

  it('stops a member taking somebody else’s', () => {
    const verdict = canAssign(req({ actorRole: 'member', actorEmail: 'someone@example.com' }));
    expect(verdict.ok).toBe(false);
    // The refusal has to say what would work, or it is just a wall.
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/admin/i));
  });

  it('stops a member claiming an unowned one, and says who can', () => {
    const verdict = canAssign(req({ actorRole: 'member', actorEmail: 'a@example.com', currentOwner: undefined }));
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/admin can assign/i));
  });

  it('lets an admin assign a monitor nobody owns', () => {
    // Legacy monitors predate ownership. Somebody should be able to adopt one.
    expect(canAssign(req({ currentOwner: undefined }))).toEqual({ ok: true });
  });
});

describe('who may receive one', () => {
  it('refuses a viewer', () => {
    // They would start getting alerts for a form they cannot re-run, re-point
    // or stop. Being told about a problem you have no power to act on is worse
    // than not being told.
    const verdict = canAssign(req({ targetRole: 'viewer' }));
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/viewer/i));
  });

  it('refuses somebody who is not on the team', () => {
    const verdict = canAssign(req({ targetRole: undefined }));
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/not on the team/i));
  });

  it('accepts an admin as a recipient', () => {
    expect(canAssign(req({ targetRole: 'admin' }))).toEqual({ ok: true });
  });

  it('refuses the person who already has it', () => {
    // A no-op would still write a handover event and announce a change that
    // did not happen.
    const verdict = canAssign(req({ targetEmail: 'jordan@example.com' }));
    expect(verdict.ok).toBe(false);
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/already watches/i));
  });
});

describe('telling the new owner it is theirs', () => {
  const NOW = new Date('2026-10-06T12:00:00.000Z');
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
  const mine = { owner: 'jordan@example.com', assignedAt: ago(1) };

  it('shows the notice to the person who received it', () => {
    // A monitor appearing quietly among a dozen others is not the same as
    // knowing it is now yours.
    expect(showsAssignedNotice(mine, 'jordan@example.com', NOW)).toBe(true);
  });

  it('shows it to nobody else', () => {
    // Somebody else's handover is not this reader's business.
    expect(showsAssignedNotice(mine, 'tajamul@example.com', NOW)).toBe(false);
    expect(showsAssignedNotice(mine, undefined, NOW)).toBe(false);
  });

  it('retires on its own, so a settled monitor stops looking new', () => {
    const old = { owner: 'jordan@example.com', assignedAt: ago(ASSIGNED_NOTICE_DAYS + 1) };
    expect(showsAssignedNotice(old, 'jordan@example.com', NOW)).toBe(false);
  });

  it('still shows on the last day of the window', () => {
    const edge = { owner: 'jordan@example.com', assignedAt: ago(ASSIGNED_NOTICE_DAYS) };
    expect(showsAssignedNotice(edge, 'jordan@example.com', NOW)).toBe(true);
  });

  it('says nothing about a monitor that was never handed over', () => {
    expect(showsAssignedNotice({ owner: 'jordan@example.com' }, 'jordan@example.com', NOW)).toBe(false);
  });

  it('ignores a timestamp from the future', () => {
    // A clock problem, not a fresh handover — treating it as one would leave
    // the notice up for days.
    const future = { owner: 'jordan@example.com', assignedAt: ago(-2) };
    expect(showsAssignedNotice(future, 'jordan@example.com', NOW)).toBe(false);
  });

  it('ignores a timestamp that is not a date', () => {
    expect(showsAssignedNotice({ owner: 'jordan@example.com', assignedAt: 'soon' }, 'jordan@example.com', NOW)).toBe(false);
  });
});
