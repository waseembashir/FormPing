/**
 * Each kind of run owns its own screenshot folder.
 *
 * Uploading a run's screenshots CLEARS the folder first — that is what stops a
 * URL tested ten times leaving ten sets behind. The consequence is that two
 * kinds of run sharing a folder destroy each other's evidence: whichever ran
 * last deletes the images the other one's stored result still points at.
 *
 * That is not hypothetical. The Form Tester and the Scheduler shared a folder,
 * so every scheduled check wiped the Tester's screenshots for any URL that was
 * also monitored. The Tester's stored URLs answered HTTP 400 while the
 * Scheduler's, in the identical folder, answered 200 — and a URL with no
 * schedule on it was fine, which made it look intermittent rather than
 * systematic.
 *
 * Nothing caught it because every piece was individually correct: the upload
 * worked, the URL was stored, the bucket was public, the markup was right. Only
 * the relationship between two callers was wrong.
 */

import { describe, it, expect, vi } from 'vitest';

// Folder naming is pure, but it lives beside the upload code that talks to
// Supabase. The engine test suite runs with the ROOT package installed only, so
// the database client is stubbed rather than reached — see tests/importBoundary.
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: () => ({}),
  supabaseEnabled: () => false,
  supabaseSchema: () => 'dev',
}));

import { shotFolder } from '@/lib/formShots';

const URL_A = 'https://example.com/contact';

describe('the three kinds of run never share a folder', () => {
  it('gives the scheduler, a re-run and the tester different folders', () => {
    const scheduled = shotFolder(URL_A);
    const rerun = shotFolder(URL_A, 'manual');
    const tester = shotFolder(URL_A, 'tester');

    expect(new Set([scheduled, rerun, tester]).size).toBe(3);
  });

  it('keeps them siblings, so a URL stays one prefix to sweep', () => {
    // They must differ, but not by so much that deleting a URL has to hunt for
    // them. Same host and page, different leaf.
    const scheduled = shotFolder(URL_A);
    expect(shotFolder(URL_A, 'manual')).toContain(scheduled);
    expect(shotFolder(URL_A, 'tester')).toContain(scheduled);
  });
});

describe('a folder identifies the URL, not the run', () => {
  it('is stable across runs, so each run can clear the last one', () => {
    expect(shotFolder(URL_A)).toBe(shotFolder(URL_A));
  });

  it('normalises the same way the runs table does', () => {
    // Both must agree on what "the same URL" means, or a run clears a folder
    // its own result does not point at. Case, `www.` and a trailing slash all
    // fold together.
    expect(shotFolder('https://www.example.com/contact/')).toBe(shotFolder(URL_A));
    expect(shotFolder('https://EXAMPLE.com/contact')).toBe(shotFolder(URL_A));
  });

  it('keeps http and https apart, because the stored key does', () => {
    // Not an oversight to correct here. `urlKey`'s format is written into
    // `url_key` columns across five tables, so changing what it folds together
    // would orphan every existing row. The folder follows the key rather than
    // inventing a second opinion about identity.
    expect(shotFolder('http://example.com/contact')).not.toBe(shotFolder(URL_A));
  });

  it('separates different URLs on the same host', () => {
    expect(shotFolder('https://example.com/about')).not.toBe(shotFolder(URL_A));
  });
});
