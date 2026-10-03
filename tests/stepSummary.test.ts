/**
 * FR-94 — what a card is allowed to say about a form's steps.
 *
 * "Multi-step" on its own raises more questions than it answers: how many
 * steps, how far did the run get, and does the field count beside it cover the
 * whole wizard? Each answer is different by mode, and inventing one is worse
 * than saying nothing.
 *
 * The line this draws: state what was observed, and never derive a number that
 * was not. A wizard seen in Detect mode is known to BE a wizard — its length is
 * not knowable without clicking through it.
 */

import { describe, it, expect } from 'vitest';
import { stepSummary } from '@/lib/stepSummary';

describe('saying nothing is a valid answer', () => {
  it('renders no chip when nothing measured step-ness', () => {
    // The whole of FR-94's first half. A missing measurement must not become
    // "Single-step", which is a claim about a form nobody examined.
    expect(stepSummary({})).toEqual({ chip: null, note: null });
    expect(stepSummary({ isMultiStep: undefined })).toEqual({ chip: null, note: null });
  });
});

describe('a form that is not a wizard', () => {
  it('says so plainly, with nothing to explain', () => {
    expect(stepSummary({ isMultiStep: false })).toEqual({ chip: 'Single-step', note: null });
  });
});

describe('a wizard nobody walked', () => {
  it('names it, and warns that the field count is partial', () => {
    // This is the "2 fields on a 3-step form" confusion. The count is true for
    // step one and misleading for the form, so the card says which.
    const s = stepSummary({ isMultiStep: true });
    expect(s.chip).toBe('Multi-step');
    expect(s.note).toMatch(/first step/i);
  });

  it('treats a one-step walk the same way — it proves nothing about the rest', () => {
    // stepsWalked === 1 means the walk never advanced, so the later steps are
    // exactly as unseen as if it had not run at all.
    expect(stepSummary({ isMultiStep: true, stepsWalked: 1 }).chip).toBe('Multi-step');
    expect(stepSummary({ isMultiStep: true, stepsWalked: 1 }).note).toMatch(/first step/i);
  });

  it('never invents a total from a wizard it did not walk', () => {
    const s = stepSummary({ isMultiStep: true });
    expect(s.chip).not.toMatch(/\d/);
  });
});

describe('a wizard walked to the submit control', () => {
  it('says what the walk did, not how many steps the form has', () => {
    // Reaching the submit control is the end of the FILLABLE sequence, not
    // necessarily the end of the form. A real wizard shows three tabs, ends its
    // second step in a submit control, and reveals the third only once sent — a
    // run that does not submit can never see it.
    //
    // "3 steps" there would state a total we never measured, on a screen that
    // visibly contradicts it. "walked 3 steps" is what we actually know.
    expect(stepSummary({ isMultiStep: true, stepsWalked: 3, reachedFinalStep: true })).toEqual({
      chip: 'Multi-step · walked 3 steps',
      note: null,
    });
  });

  it('adds no caveat — the fields listed do cover every step we walked', () => {
    expect(stepSummary({ isMultiStep: true, stepsWalked: 4, reachedFinalStep: true }).note).toBeNull();
  });
});

describe('a wizard that stopped part-way', () => {
  it('says where it got to, not how far it had to go', () => {
    // "reached step 2" is observed. "step 2 of 3" would be invented — the run
    // never saw step three, so it cannot know there is one.
    const s = stepSummary({ isMultiStep: true, stepsWalked: 2, reachedFinalStep: false });
    expect(s.chip).toBe('Multi-step · reached step 2');
    expect(s.chip).not.toMatch(/of \d/);
  });

  it('explains that later steps went unseen', () => {
    expect(stepSummary({ isMultiStep: true, stepsWalked: 2, reachedFinalStep: false }).note).toMatch(
      /stopped before the final step/i,
    );
  });
});

describe('an unwalked wizard explains its missing screenshots', () => {
  it('says there are none, rather than leaving the gap unexplained', () => {
    // Someone who knows this form has four steps sees one screenshot and
    // reasonably concludes something failed. Nothing failed — nothing was
    // attempted. An absence with no explanation reads as a defect.
    const s = stepSummary({ isMultiStep: true, stepsWalked: 1 });
    expect(s.note).toMatch(/screenshots?/i);
  });

  it('names the mode that would walk it, so the sentence ends in something to do', () => {
    // A note that only states a limitation leaves the reader stuck. This one
    // tells them which mode produces what they are looking for.
    const s = stepSummary({ isMultiStep: true, stepsWalked: 1 });
    expect(s.note).toMatch(/safe mode/i);
  });

  it('stays quiet once the walk actually happened', () => {
    // A completed walk HAS its sequence, so repeating the instruction would be
    // telling somebody to do what they just did.
    const done = stepSummary({ isMultiStep: true, stepsWalked: 3, reachedFinalStep: true });
    expect(done.note).toBeNull();
  });
});
