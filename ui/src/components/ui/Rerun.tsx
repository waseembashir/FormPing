'use client';

import { cx } from './cx';

/**
 * FR-82 — "Re-run": check a monitored URL right now, without disturbing the
 * schedule watching it.
 *
 * Shared by the Form Scheduler and the Uptime & SSL monitor so the action looks
 * and reads identically wherever it appears.
 *
 * COLOUR: the accent indigo, never a status colour. Green/amber/rose in this app
 * always answer "is this okay?"; a re-run marker answers "who started this?".
 * Those are different questions, and giving them the same palette would make a
 * perfectly healthy re-run look like a verdict.
 */

/** The circular-arrow mark. Spins while a run is in flight (and holds still for
 *  anyone who asked for reduced motion). */
function RerunIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cx('h-3.5 w-3.5', spinning && 'animate-spin motion-reduce:animate-none')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* An arc, not a full ring — the gap is what reads as "goes round again". */}
      <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
      <path d="M13.5 2.2v3.1h-3.1" />
    </svg>
  );
}

export function RerunButton({
  onClick,
  running,
  disabled,
  /** What the button is checking — used in the tooltip so the promise is explicit. */
  what,
  /**
   * True when pressing this button will SUBMIT a real message — a Form Scheduler
   * monitor set to Live. The button then names the mode and takes the danger
   * colour, because the accident this guards against happens before any dialog
   * opens: someone clicking an ordinary-looking button without thinking. The
   * confirm is the second line of defence, not the first. FR-85.
   */
  live,
}: {
  onClick: () => void;
  running: boolean;
  disabled?: boolean;
  what: 'form' | 'site';
  live?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running || disabled}
      title={
        running
          ? 'Running now — the result appears in the history below when it finishes'
          : live
            ? 'This monitor is set to Live, so running it now SUBMITS a real message to the form. You’ll be asked to confirm first. Your schedule is not affected.'
            : what === 'form'
              ? 'Test this form right now, in this monitor’s mode. Your schedule is not affected — the next scheduled run stays exactly where it is.'
              : 'Check this site right now. Your schedule is not affected — the next scheduled check stays exactly where it is.'
      }
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
        live
          ? 'border-danger/45 text-danger hover:bg-danger/10'
          : 'border-accent/40 text-accent-soft hover:bg-accent/10',
        'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      <RerunIcon spinning={running} />
      {running ? 'Running…' : live ? 'Re-run · Live' : 'Re-run'}
    </button>
  );
}

/** Marks a history row as started by hand rather than by the schedule. */
export function RerunTag() {
  return (
    <span
      title="You ran this one by hand — it isn’t part of the schedule"
      className="inline-flex shrink-0 items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft ring-1 ring-accent/30"
    >
      <RerunIcon />
      Re-run
    </span>
  );
}
