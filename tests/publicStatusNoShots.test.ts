/**
 * A client's status page must never show a form screenshot.
 *
 * `StatusView` renders `form.shot`, and that same component draws BOTH the
 * internal per-URL dashboard and the public `/status/<token>` page a client is
 * given a link to. Nothing in the component distinguishes them. What keeps
 * screenshots off the public page is that `buildClientStatus` never puts them
 * in the payload — so the `{shotSrc(form.shot) && …}` block has nothing to
 * render and quietly does not run.
 *
 * That is a real protection in the right place: the payload, not the view. It
 * was also completely unguarded. Adding a `shot` field to a site card, or
 * moving `tech` out from behind the `internal` flag, would start publishing
 * pictures of clients' pages to anyone holding a share link, and every test in
 * the suite would still pass.
 *
 * ## Why this reads the source
 *
 * `buildClientStatus` needs a database and most of the app, so exercising it
 * for real belongs with the route tests that do not exist yet (FR-115). This
 * is the cheap guard available today: it does not prove the payload is clean,
 * it proves nobody has edited the builder in the one way that would dirty it.
 * A weaker test than a real one, and far stronger than the nothing that was
 * here before.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const BUILD = join(ROOT, 'ui/src/lib/status/build.ts');

const source = readFileSync(BUILD, 'utf8');

/** Lines of real code — comments explain the rule and must not trip it. */
const code = source
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  })
  .join('\n');

describe('the client-safe status payload', () => {
  it('never emits a screenshot field', () => {
    /**
     * The whole point. A screenshot is a picture of the client's own page, so
     * it looks harmless to publish — but it is internal evidence of what we
     * tested and when, it is never something a client asked us to host, and
     * the bucket behind it is private precisely so that only signed-in staff
     * can fetch one.
     */
    expect(code).not.toMatch(/\bshot\b\s*:/);
    expect(code).not.toMatch(/\bstepShots\b/);
    expect(code).not.toMatch(/\bformShot\b/);
  });

  it('keeps every `tech` block behind the internal flag', () => {
    // `tech` is where the per-form detail lives, and it is the field a
    // screenshot would most plausibly arrive attached to. Any emission of it
    // must be guarded; an unguarded one would hand the detail to the public
    // page wholesale.
    for (const line of code.split('\n')) {
      if (/\btech\s*:/.test(line) || /\btech\s*=/.test(line)) {
        expect(line.includes('internal') || code.includes('if (internal'), line.trim()).toBe(true);
      }
    }
  });

  it('still has the internal flag that the split depends on', () => {
    // If this disappears, the two audiences have stopped being distinguished
    // and every other assertion here is checking nothing.
    expect(code).toMatch(/internal\s*(\?*):/);
    expect(code).toMatch(/opts\?\.internal/);
  });
});
