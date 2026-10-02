/**
 * FR-74 — who may see which row, once the tool tabs show only your own work.
 *
 * Two rules, kept pure so they can be tested without a request, a session or a
 * database. Both have a failure mode that is silent rather than loud, which is
 * why they are pinned here rather than left to the routes that call them:
 *
 *   - too strict, and someone's own work disappears from their tab
 *   - too loose, and nothing is actually private
 *
 * Neither announces itself in logs or in an error.
 */

import { describe, it, expect } from 'vitest';
import { visibleTo, ownerFilterExpression } from '@/lib/ownership';

const ME = 'owner@example.com';
const SOMEONE_ELSE = 'other@example.com';

describe('what a person may see', () => {
  it('shows everything when no scope applies', () => {
    // The flag is off, or nobody is signed in. Both must behave exactly as the
    // app did before any of this existed — including in local development,
    // which runs with an open auth gate and therefore never has a scope.
    expect(visibleTo(undefined, ME)).toBe(true);
    expect(visibleTo(undefined, SOMEONE_ELSE)).toBe(true);
    expect(visibleTo(undefined, undefined)).toBe(true);
  });

  it('shows me my own rows', () => {
    expect(visibleTo(ME, ME)).toBe(true);
  });

  it('hides other people from me', () => {
    expect(visibleTo(ME, SOMEONE_ELSE)).toBe(false);
  });

  it('keeps ownerless rows visible to everyone', () => {
    // These predate per-user isolation and nothing can say now who made them.
    // Hiding them would make work vanish for everybody at once, on the deploy
    // that switched the feature on — which reads as data loss, not as privacy.
    expect(visibleTo(ME, undefined)).toBe(true);
    expect(visibleTo(SOMEONE_ELSE, undefined)).toBe(true);
  });

  it('is exact, not a prefix or case-insensitive match', () => {
    // Two real addresses can share a prefix, and a loose comparison here would
    // show one person another's work without anything looking wrong.
    expect(visibleTo(ME, 'owner@example.com.attacker.test')).toBe(false);
    expect(visibleTo('a@example.com', 'ab@example.com')).toBe(false);
  });
});

describe('the database filter that narrows the query', () => {
  it('selects my rows and the ownerless ones', () => {
    expect(ownerFilterExpression(ME)).toBe('owner.is.null,owner.eq.owner@example.com');
  });

  it('declines to narrow when there is no scope', () => {
    expect(ownerFilterExpression(undefined)).toBeNull();
  });

  it('refuses an address that would change what the filter means', () => {
    // PostgREST reads this expression as a comma-separated list, so a comma or
    // parenthesis in the value would not be matched literally — it would alter
    // the filter itself and silently select the wrong rows. Returning null
    // makes the caller fall back to filtering in memory, which is always
    // correct. A filter that cannot run beats one that quietly lies.
    expect(ownerFilterExpression('a,b@example.com')).toBeNull();
    expect(ownerFilterExpression('a(b)@example.com')).toBeNull();
    expect(ownerFilterExpression('a"b@example.com')).toBeNull();
    expect(ownerFilterExpression('a\\b@example.com')).toBeNull();
  });
});

describe('the shared Projects view is never scoped', () => {
  it('reads the tool-tab stores without passing an owner', async () => {
    // Projects is the common tab: it exists so everyone can see which URLs are
    // already covered and by whom, which is what stops two people monitoring
    // the same site. Pushing the owner filter down into the stores would empty
    // it, and the symptom would appear on a tab nobody had touched.
    //
    // Asserted against the source so that a later refactor which "tidies up"
    // by scoping those calls fails here instead of in production.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const health = readFileSync(
      fileURLToPath(new URL('../ui/src/lib/projects/health.ts', import.meta.url)),
      'utf8',
    );

    for (const call of ['loadRuns(', 'loadFormResults(', 'loadSiteResults(', 'listTrackedUrls(']) {
      const at = health.indexOf(call);
      expect(at, `${call} should still be called by Projects`).toBeGreaterThan(-1);
      expect(
        health.slice(at + call.length, at + call.length + 1),
        `${call} in Projects must take no owner argument`,
      ).toBe(')');
    }
  });
});
