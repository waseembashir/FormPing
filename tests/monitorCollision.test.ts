/**
 * What to say when the URL you are trying to monitor is already somebody's.
 *
 * A URL has one monitor and one person responsible for it. Per-user isolation
 * then made that rule unanswerable: the monitor in your way belongs to a
 * colleague, so it is not in your tab and not named anywhere. The app said "A
 * schedule already exists for this URL" — true, and a dead end. The only route
 * to the answer was guessing which colleague to ask.
 *
 * That happened for real: a monitor was blocked by one a teammate had created,
 * and the only available fix was asking her to stop hers.
 *
 * So these pin the three things a reader can be looking at, and that the
 * message has to tell them apart.
 */

import { describe, it, expect } from 'vitest';
import { collisionMessage, ownerLabel } from '@/lib/monitorCollision';

describe('when the monitor in the way is a colleague’s', () => {
  const theirs = { ownerLabel: 'Priya Sharma', mine: false };

  it('names them, because they are who you have to speak to', () => {
    // Without the name there is nowhere to go: the monitor is invisible to the
    // reader by design, so no amount of looking will find it.
    expect(collisionMessage('form', theirs)).toContain('Priya Sharma');
  });

  it('states the rule, not just the obstacle', () => {
    // "Already exists" reads like a duplicate to be avoided, and sends somebody
    // looking for a way to add a second. One-monitor-per-URL is a decision, and
    // a reader who knows that stops looking.
    expect(collisionMessage('form', theirs)).toMatch(/one person/i);
  });

  it('says which kind of monitor, so the sentence fits the tab it appears on', () => {
    expect(collisionMessage('form', theirs)).toContain('form monitor');
    expect(collisionMessage('uptime', theirs)).toContain('uptime monitor');
  });
});

describe('when it is your own monitor', () => {
  const mine = { ownerLabel: 'Priya Sharma', mine: true };

  it('does not name the reader back to themselves', () => {
    // Being told "Priya Sharma already monitors this" while signed in as Priya
    // reads like a system that has not noticed who is using it.
    expect(collisionMessage('form', mine)).not.toContain('Priya Sharma');
    expect(collisionMessage('form', mine)).toMatch(/^You already/);
  });

  it('points at the monitor rather than at a person to go and find', () => {
    // There is nobody to contact. The useful next step is the card already on
    // their screen.
    expect(collisionMessage('uptime', mine)).toMatch(/stop it|open it/i);
  });
});

describe('when the monitor predates ownership', () => {
  const orphan = { ownerLabel: null, mine: false };

  it('admits there is no owner rather than inventing one', () => {
    const msg = collisionMessage('form', orphan);
    expect(msg).toMatch(/before FormPing recorded who owns/i);
  });

  it('still tells the reader what to do', () => {
    // "No owner" on its own is another dead end. Asking the team is a worse
    // answer than a name and a better one than silence.
    expect(collisionMessage('form', orphan)).toMatch(/ask the team/i);
  });
});

describe('how an owner is referred to', () => {
  it('prefers the name we have', () => {
    expect(ownerLabel('Priya Sharma', 'priya@example.com')).toBe('Priya Sharma');
  });

  it('falls back to the email, which is on the Team page anyway', () => {
    // Deliberate, not a leak. The point of naming an owner is that a colleague
    // can reach them, and an unnamed obstacle helps nobody. What must never
    // travel is the monitor itself — its interval, mode, verdict and id.
    expect(ownerLabel(null, 'priya@example.com')).toBe('priya@example.com');
    expect(ownerLabel('   ', 'priya@example.com')).toBe('priya@example.com');
  });

  it('has nothing to say when the row has no owner at all', () => {
    expect(ownerLabel(null, null)).toBeNull();
    expect(ownerLabel(undefined, undefined)).toBeNull();
    expect(ownerLabel('', '  ')).toBeNull();
  });
});
