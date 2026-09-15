/**
 * FR-86 — what a failed check says to a person, and how soon we ask again.
 *
 * The bug: `fetch failed` — Node's own words for a network-level failure —
 * rendered in amber on the Certificates panel beneath a certificate that had
 * resolved perfectly well. It reached the dashboard, the monitor card and Slack
 * untouched, and it gave a user no way to tell "the registry was briefly
 * unreachable" from "this registry never publishes an expiry date", which are
 * the same sentence and opposite situations.
 *
 * These import the real copy table rather than restating it, so a kind added
 * without copy, or copy that leaks developer vocabulary, fails here.
 */

import { describe, it, expect } from 'vitest';
import {
  describeFailure,
  failureForStatus,
  isPermanent,
  type CheckFailure,
  type CheckSubject,
} from '@/lib/siteWatch/failures';

const KINDS: CheckFailure[] = [
  'unreachable',
  'rate_limited',
  'registry_error',
  'not_published',
  'unreadable',
  'no_certificate',
  'challenged',
];
const SUBJECTS: CheckSubject[] = ['domain', 'ssl', 'uptime'];

/** Vocabulary that must never reach a person. */
const DEVELOPER_WORDS = [
  'fetch failed',
  'RDAP',
  'err.message',
  'undefined',
  'null',
  'ECONN',
  'ETIMEDOUT',
  'TLS',
  'socket',
  'exception',
  'stack',
];

describe('every failure has copy, for every subject', () => {
  it('covers the whole matrix — no kind falls through', () => {
    for (const subject of SUBJECTS) {
      for (const kind of KINDS) {
        const copy = describeFailure(subject, kind);
        expect(copy, `${subject}/${kind}`).toBeDefined();
        expect(copy.text.length, `${subject}/${kind}`).toBeGreaterThan(10);
      }
    }
  });

  it('never speaks to the user in developer vocabulary', () => {
    for (const subject of SUBJECTS) {
      for (const kind of KINDS) {
        const text = describeFailure(subject, kind).text;
        for (const word of DEVELOPER_WORDS) {
          expect(text.toLowerCase(), `${subject}/${kind} leaked "${word}"`).not.toContain(
            word.toLowerCase(),
          );
        }
      }
    }
  });

  it('writes whole sentences, not labels', () => {
    for (const subject of SUBJECTS) {
      for (const kind of KINDS) {
        const text = describeFailure(subject, kind).text;
        expect(text[0], `${subject}/${kind}`).toBe(text[0]!.toUpperCase());
        expect(text.endsWith('.'), `${subject}/${kind}`).toBe(true);
      }
    }
  });
});

describe('temporary and permanent are told apart', () => {
  it('a registry that publishes no expiry is permanent — and not alarming', () => {
    const copy = describeFailure('domain', 'not_published');
    expect(copy.permanent).toBe(true);
    // The whole complaint behind this issue: amber under a healthy certificate.
    // This is a fact about the registry, not a fault, so it must not shout.
    expect(copy.tone).toBe('info');
    expect(copy.text).toMatch(/does not publish/i);
  });

  it('an unreachable registry is temporary, and says it will retry', () => {
    const copy = describeFailure('domain', 'unreachable');
    expect(copy.permanent).toBe(false);
    expect(copy.tone).toBe('info');
    expect(copy.text).toMatch(/check again/i);
    // It must also reassure: nothing is wrong with the domain itself.
    expect(copy.text).toMatch(/nothing is wrong/i);
  });

  it('a site with no certificate is a real problem, and is toned like one', () => {
    const copy = describeFailure('ssl', 'no_certificate');
    expect(copy.tone).toBe('danger');
    expect(copy.permanent).toBe(false);
  });

  it('isPermanent agrees with the copy table', () => {
    expect(isPermanent('domain', 'not_published')).toBe(true);
    expect(isPermanent('domain', 'unreadable')).toBe(true);
    expect(isPermanent('domain', 'unreachable')).toBe(false);
    expect(isPermanent('domain', 'rate_limited')).toBe(false);
    expect(isPermanent('domain', 'registry_error')).toBe(false);
  });
});

describe('registry HTTP statuses map to the right kind', () => {
  it('404 means this TLD is not in RDAP — permanent, not a fault', () => {
    expect(failureForStatus(404)).toBe('not_published');
    expect(isPermanent('domain', failureForStatus(404))).toBe(true);
  });

  it('429 and 5xx are the registry having a bad day — temporary', () => {
    expect(failureForStatus(429)).toBe('rate_limited');
    expect(failureForStatus(500)).toBe('registry_error');
    expect(failureForStatus(503)).toBe('registry_error');
    expect(isPermanent('domain', failureForStatus(429))).toBe(false);
    expect(isPermanent('domain', failureForStatus(503))).toBe(false);
  });

  it('401/403 are a refusal, not an absence', () => {
    expect(failureForStatus(403)).toBe('challenged');
    expect(failureForStatus(401)).toBe('challenged');
  });
});

describe('results stored before this change', () => {
  it('a missing kind gets a truthful generic line, never a raw string', () => {
    const copy = describeFailure('domain', undefined);
    expect(copy.text).toMatch(/could not be checked/i);
    expect(copy.permanent).toBe(false);
  });

  it('a kind this build has never heard of does not crash the page', () => {
    // Stored JSON is only as trustworthy as the build that wrote it.
    const unknown = 'quantum_flux' as CheckFailure;
    const copy = describeFailure('ssl', unknown);
    expect(copy).toBeDefined();
    expect(copy.text.length).toBeGreaterThan(10);
  });
});
