/**
 * FR-103 — our outage is announced as ours, once, and keeps being announced.
 *
 * When the outbound proxy refuses to forward a submission the request never
 * reaches the client's site, so nothing is known about their form. The alert
 * nevertheless read "Contact form failing — clientsite.com".
 *
 * Three properties have to hold together, and they pull against each other:
 *
 *   - the message must not accuse the monitored site;
 *   - it must be LOUD, because while it lasts every Live submission check is
 *     testing nothing — a silent wrong all-clear is worse than a noisy wrong
 *     accusation; and
 *   - it must arrive once per outage, not once per monitor, or forty schedules
 *     produce forty identical messages and the channel gets muted.
 *
 * The third rests entirely on the dedupe key being stable within a window, so
 * that is asserted directly rather than inferred from a count of sends.
 */

import { describe, it, expect } from 'vitest';
// Imported from the policy module, not the dispatching one: pulling in the
// dispatcher would drag the database client into this test's module graph, and
// that package is installed only for the web app — so the engine's CI job,
// which installs the root package alone, could not resolve it.
import { outageWindow, outageDedupeKey } from '@/lib/alerts/outageWindow';
import { runVerdict } from '@/lib/formWatch/verdict';

const HOUR = 3_600_000;

describe('a proxy refusal is not a verdict against the client', () => {
  it('is limited, not failing — nothing was learned about the form', () => {
    // The request never arrived. "Failing" would state a finding we do not have.
    expect(runVerdict('PROXY_REJECTED_POST', true, undefined).level).toBe('limited');
  });

  it('says what happened without naming the site as the cause', () => {
    const { label } = runVerdict('PROXY_REJECTED_POST', true, undefined);
    expect(label).toBe('Blocked before it reached the site');
    expect(label).not.toMatch(/PROXY_REJECTED_POST/);
  });
});

describe('one outage, one alert', () => {
  it('gives every monitor in the same window the same key', () => {
    // Forty schedules tripping over one proxy must produce one message. The
    // dispatcher refuses a duplicate key, so agreeing on the key IS the
    // suppression — no counter, no lock, no new table.
    const t = Date.parse('2026-09-29T09:00:00.000Z');
    expect(outageDedupeKey(t)).toBe(outageDedupeKey(t + 60_000));
    expect(outageDedupeKey(t)).toBe(outageDedupeKey(t + 2 * HOUR));
  });

  it('changes key once the window rolls over, so it speaks again', () => {
    // The other half: an outage that persists must not fall silent after one
    // message. A new window is a new occurrence.
    const t = Date.parse('2026-09-29T09:00:00.000Z');
    expect(outageDedupeKey(t)).not.toBe(outageDedupeKey(t + 7 * HOUR));
  });

  it('uses the shared re-notify spacing rather than a second cadence', () => {
    // Six hours by default, the same window Site Watch uses for an ongoing
    // outage. Two cadences in one product is how they drift apart.
    const t = Date.parse('2026-09-29T00:00:00.000Z');
    expect(outageWindow(t + 5 * HOUR)).toBe(outageWindow(t));
    expect(outageWindow(t + 6 * HOUR)).toBe(outageWindow(t) + 1);
  });

  it('keys on the moment the run happened, not the moment we send', () => {
    // Two monitors hitting the outage minutes apart must still agree, and a
    // delayed dispatch must not land in the wrong window.
    const a = Date.parse('2026-09-29T09:05:00.000Z');
    const b = Date.parse('2026-09-29T09:47:00.000Z');
    expect(outageDedupeKey(a)).toBe(outageDedupeKey(b));
  });
});
