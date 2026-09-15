/**
 * Shown on a monitor whose latest check ran but could not be stored. FR-87.
 *
 * Before this existed, that situation looked identical to a healthy monitor:
 * the card kept its summary line and simply had nothing behind it. A result we
 * could not save is still a result readout, so it gets one — plain language,
 * what it means for what you are looking at, and what happens next.
 */

/** A small disc-with-slash — "not written". Animated so it reads as live. */
function UnsavedIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <ellipse cx="8" cy="4" rx="5.25" ry="2.25" />
      <path d="M2.75 4v8c0 1.24 2.35 2.25 5.25 2.25 .53 0 1.05-.03 1.53-.1" />
      <path d="M13.25 4v4.1" />
      <path d="M3.5 13 12.5 3">
        <animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

export function UnsavedResultNotice({ at, compact = false }: { at?: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/10 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
      role="status"
    >
      <UnsavedIcon />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-warn">The last check could not be saved</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
          It ran, but we could not store what it found, so the details below are from the last check we
          did save. We will try again at the next one.
          {at ? <span className="text-ink-faint"> Last attempt {new Date(at).toLocaleString()}.</span> : null}
        </p>
      </div>
    </div>
  );
}
