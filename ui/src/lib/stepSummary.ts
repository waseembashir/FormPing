/**
 * What to say about a form's steps, in one place.
 *
 * A wizard used to be described by a single pill reading "Multi-step", which
 * raises more questions than it answers: how many steps, how far did we get,
 * and does the field count cover all of them? The honest answers differ by
 * mode, and getting them wrong is worse than saying nothing.
 *
 * The rules, in the order they matter:
 *
 *   - **Nothing measured it → say nothing.** Not "Single-step", which is a
 *     claim about a form nobody examined for steps.
 *   - **Detect mode sees the door, not the rooms.** A Next control proves a
 *     wizard exists; it cannot reveal how many steps follow without clicking
 *     through. So Detect says "Multi-step" and explicitly says the steps were
 *     not walked — because the field count on screen is then the FIRST step's
 *     only, and a reader has no other way to know that.
 *   - **A completed walk knows the total.** Reaching the submit control means
 *     the steps traversed ARE the steps.
 *   - **An interrupted walk knows only where it stopped.** "Reached step 2" is
 *     true; "step 2 of 3" would be invented.
 *
 * FR-94.
 */

export interface StepFacts {
  /** Three-valued: true, false, or nothing measured it. */
  isMultiStep?: boolean;
  /** Steps the walk actually traversed. Absent when nothing was filled. */
  stepsWalked?: number;
  /** Whether the walk reached the submit control — i.e. saw the last step. */
  reachedFinalStep?: boolean;
}

export interface StepSummary {
  /** Short label for the chip row, or null to render no chip at all. */
  chip: string | null;
  /** A sentence that prevents a misreading, or null when none is needed. */
  note: string | null;
}

export function stepSummary(facts: StepFacts): StepSummary {
  const { isMultiStep, stepsWalked, reachedFinalStep } = facts;

  if (typeof isMultiStep !== 'boolean') return { chip: null, note: null };
  if (!isMultiStep) return { chip: 'Single-step', note: null };

  // A wizard, but nothing walked it: the count on screen is step one's, and
  // there is no sequence of pictures either. Saying so matters because the
  // absence is otherwise unexplained — a reader who knows this form has four
  // steps sees one screenshot and reasonably assumes something failed, when in
  // fact nothing was attempted. Naming the mode that WOULD walk it turns a
  // dead end into an instruction.
  if (!stepsWalked || stepsWalked <= 1) {
    return {
      chip: 'Multi-step',
      note:
        'Its steps were not walked on this run, so the fields listed are the first step’s only ' +
        'and there are no per-step screenshots. Run it in Safe mode to step through the form.',
    };
  }

  if (reachedFinalStep) {
    // "walked N steps", never "N steps": the first describes our run, the
    // second claims a property of the form that we cannot know without
    // submitting it.
    return { chip: `Multi-step · walked ${stepsWalked} steps`, note: null };
  }

  return {
    chip: `Multi-step · reached step ${stepsWalked}`,
    note: 'The walk stopped before the final step, so later steps were not seen.',
  };
}
