/**
 * FR-97 — when a finished run is worth interrupting someone for.
 *
 * Form Watch fired on every run, so a monitor whose verdict never changed sent
 * the same alert every cycle. Two things had to hold at once for the fix to be
 * safe, and they pull in opposite directions:
 *
 *   - a repeated, unchanged verdict must go quiet, however bad it is; and
 *   - NOTHING that carries news may be swallowed — not a change, not a
 *     recovery, not a first observation, not a form that changed underneath an
 *     unchanged verdict.
 *
 * A suppression bug is invisible by nature: the failure mode is an alert that
 * never arrives, which nobody sees until a real outage goes unreported. So the
 * quiet path is tested as carefully as the noisy one.
 */

import { describe, it, expect } from 'vitest';
import { shouldNotify, verdictIdentity, type GateInput } from '@/lib/formWatch/alertGate';

/** A settled, healthy monitor: same verdict as last time, nothing changed. */
function steady(over: Partial<GateInput> = {}): GateInput {
  return {
    current: verdictIdentity('healthy', 'PASS'),
    previous: verdictIdentity('healthy', 'PASS'),
    level: 'healthy',
    changeCount: 0,
    renotifyDue: false,
    ...over,
  };
}

describe('a repeated verdict goes quiet', () => {
  it('says nothing when a healthy monitor stays healthy', () => {
    expect(shouldNotify(steady())).toEqual({ send: false, reason: 'unchanged' });
  });

  it('says nothing when a standing fact about the site repeats', () => {
    // The case this issue was filed for: a site with no native contact form
    // reported "needs attention" on every single check, forever.
    const noContactForm = verdictIdentity('limited', 'NON_CONTACT_FORM_FOUND');
    expect(
      shouldNotify(steady({ current: noContactForm, previous: noContactForm, level: 'limited' })),
    ).toEqual({ send: false, reason: 'unchanged' });
  });

  it('says nothing when a multi-step form is found again', () => {
    const multiStep = verdictIdentity('limited', 'MULTI_STEP_FORM_DETECTED');
    expect(shouldNotify(steady({ current: multiStep, previous: multiStep, level: 'limited' })).send).toBe(false);
  });

  it('holds a failing monitor quiet until its reminder is due', () => {
    const failing = verdictIdentity('failing', 'SERVER_ERROR');
    expect(
      shouldNotify(steady({ current: failing, previous: failing, level: 'failing', renotifyDue: false })),
    ).toEqual({ send: false, reason: 'unchanged' });
  });
});

describe('news is never swallowed', () => {
  it('announces the first run of a schedule, even when it is good news', () => {
    // The only message that proves monitoring actually started.
    expect(shouldNotify(steady({ previous: null }))).toEqual({ send: true, reason: 'first-run' });
  });

  it('announces a break', () => {
    const d = shouldNotify(
      steady({ current: verdictIdentity('failing', 'SERVER_ERROR'), level: 'failing' }),
    );
    expect(d).toEqual({ send: true, reason: 'verdict-changed' });
  });

  it('announces a recovery', () => {
    const d = shouldNotify(steady({ previous: verdictIdentity('failing', 'SERVER_ERROR') }));
    expect(d).toEqual({ send: true, reason: 'verdict-changed' });
  });

  it('announces a slide between two bad states, which a level alone would miss', () => {
    // Both are failing, so comparing levels would call this "unchanged" — but a
    // site going from "a form exists, just not a contact one" to "no form at
    // all" is exactly what a monitor is for.
    const d = shouldNotify({
      current: verdictIdentity('failing', 'FORM_NOT_FOUND'),
      previous: verdictIdentity('failing', 'SUBMIT_FAILED'),
      level: 'failing',
      changeCount: 0,
      renotifyDue: false,
    });
    expect(d).toEqual({ send: true, reason: 'verdict-changed' });
  });

  it('announces a form that changed underneath an unchanged verdict', () => {
    // A field added, a CAPTCHA appearing, an action URL rewritten: the verdict
    // can stay healthy through all of them.
    expect(shouldNotify(steady({ changeCount: 2 }))).toEqual({ send: true, reason: 'form-changed' });
  });

  it('re-announces a form that is still broken once the reminder is due', () => {
    const failing = verdictIdentity('failing', 'SERVER_ERROR');
    expect(
      shouldNotify(steady({ current: failing, previous: failing, level: 'failing', renotifyDue: true })),
    ).toEqual({ send: true, reason: 'still-failing' });
  });
});

describe('the heartbeat is only for what is genuinely broken', () => {
  it('does not re-announce a standing limitation, however much time passes', () => {
    // `renotifyDue` is true here, and it still stays quiet: a form we cannot
    // test is a standing fact for the monitor card, not a recurring interruption.
    const limited = verdictIdentity('limited', 'CAPTCHA_DETECTED');
    expect(
      shouldNotify(steady({ current: limited, previous: limited, level: 'limited', renotifyDue: true })),
    ).toEqual({ send: false, reason: 'unchanged' });
  });

  it('does not re-announce an unchanged attention verdict', () => {
    const attention = verdictIdentity('attention', 'NO_REDIRECT_NO_SUCCESS');
    expect(
      shouldNotify(steady({ current: attention, previous: attention, level: 'attention', renotifyDue: true })),
    ).toEqual({ send: false, reason: 'unchanged' });
  });
});

describe('change always beats repetition', () => {
  it('reports a change as a change even when a reminder was also due', () => {
    // Ordering matters: the reason given must be the informative one, because
    // it is what the server log will show when someone asks why an alert fired.
    const d = shouldNotify(
      steady({ current: verdictIdentity('failing', 'SERVER_ERROR'), level: 'failing', renotifyDue: true }),
    );
    expect(d.reason).toBe('verdict-changed');
  });

  it('prefers the verdict change over the form change', () => {
    const d = shouldNotify(
      steady({ current: verdictIdentity('failing', 'FORM_NOT_FOUND'), level: 'failing', changeCount: 3 }),
    );
    expect(d.reason).toBe('verdict-changed');
  });
});

describe('verdict identity', () => {
  it('separates two codes that share a level', () => {
    expect(verdictIdentity('limited', 'CAPTCHA_DETECTED')).not.toBe(
      verdictIdentity('limited', 'MULTI_STEP_FORM_DETECTED'),
    );
  });

  it('separates one code that changed level', () => {
    // The same code can land on different levels depending on what the run found,
    // and that move is a real change.
    expect(verdictIdentity('healthy', 'DETECT_ONLY')).not.toBe(verdictIdentity('failing', 'DETECT_ONLY'));
  });
});
