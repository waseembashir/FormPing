'use client';

import { useEffect, useState } from 'react';
import { RELEASES, type ReleaseChangeType } from '@/lib/releases';
import { isUnread, lastSeenVersion, markSeen } from '@/lib/releasesSeen';

/**
 * The release list — collapsed by default, every card the same height on
 * arrival.
 *
 * Expanding is opt-in rather than "newest open", so the page looks identical
 * however many releases accumulate and whichever one is newest. What you see
 * without clicking is the version, when it shipped, its name and one line of
 * summary: enough to decide whether to open it.
 */

/** How each change type reads. Colours come from the app's own status tokens. */
const TYPE_STYLE: Record<ReleaseChangeType, { label: string; className: string }> = {
  feature: { label: 'Feature', className: 'bg-accent/12 text-accent-soft ring-accent/25' },
  enhancement: { label: 'Enhancement', className: 'bg-info/12 text-info ring-info/25' },
  fix: { label: 'Fix', className: 'bg-ok/12 text-ok ring-ok/25' },
};

/** The order labels appear in, so two releases never disagree about it. */
const TYPE_ORDER: ReleaseChangeType[] = ['feature', 'enhancement', 'fix'];

/**
 * What kinds of change a release contains, counted.
 *
 * DERIVED rather than stored: a release is rarely one kind, and a hand-set
 * label would be a second place to keep the truth — one that quietly goes wrong
 * the moment somebody adds a change and forgets to revisit it.
 */
function typeCounts(changes: { type: ReleaseChangeType }[]): Array<[ReleaseChangeType, number]> {
  const counts = new Map<ReleaseChangeType, number>();
  for (const c of changes) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  return TYPE_ORDER.filter((k) => counts.has(k)).map((k) => [k, counts.get(k)!]);
}

export function ReleaseList() {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  /**
   * What this browser had seen when the page LOADED, held still for the whole
   * visit. Read once and never re-read, so the "New" markers do not vanish from
   * under the reader the moment the marker is written below.
   */
  const [seenOnArrival, setSeenOnArrival] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setSeenOnArrival(lastSeenVersion());
    // Opening the page counts as having read it. Marking on arrival rather than
    // on expand is the honest reading of "what's new to you": the summaries are
    // on screen, and a reader who chose not to expand a release has still been
    // shown it.
    if (RELEASES[0]) markSeen(RELEASES[0].version);
  }, []);

  return (
    <div className="mt-8 space-y-4">
      {RELEASES.map((r, idx) => {
        const isOpen = open[r.version] ?? false;
        // `undefined` means the first render, before the browser has been read.
        // Nothing is marked then, so the server and client agree and the badges
        // do not flash in and then out.
        const unread = seenOnArrival === undefined ? false : isUnread(r.version, seenOnArrival);

        return (
          <article
            key={r.version}
            className={`overflow-hidden rounded-2xl border bg-panel/50 shadow-sm shadow-black/20 ${
              unread ? 'border-accent/40' : 'border-line'
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [r.version]: !isOpen }))}
              aria-expanded={isOpen}
              className="w-full text-left transition-colors hover:bg-panel/70"
            >
              {/* Header band — version, badges, date */}
              <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-panel/40 px-5 py-4 sm:px-6">
                <span className="rounded-full bg-gradient-to-b from-accent to-accent-strong px-2.5 py-1 text-xs font-bold text-white ring-1 ring-accent-soft/20">
                  v{r.version}
                </span>
                {idx === 0 && (
                  <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ok ring-1 ring-ok/25">
                    Latest
                  </span>
                )}
                {r.major && (
                  <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft ring-1 ring-accent/25">
                    Major update
                  </span>
                )}
                {unread && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    New to you
                  </span>
                )}
                {/* What kind of release this was, without opening it. */}
                {typeCounts(r.changes).map(([kind, n]) => (
                  <span
                    key={kind}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${TYPE_STYLE[kind].className}`}
                  >
                    {n} {TYPE_STYLE[kind].label}
                    {n > 1 && kind !== 'fix' ? 's' : ''}
                    {n > 1 && kind === 'fix' ? 'es' : ''}
                  </span>
                ))}
                <span className="ml-auto text-xs font-medium text-ink-faint">{r.date}</span>
              </div>

              {/* Always visible — enough to decide whether to open it */}
              <div className="flex items-start gap-3 px-5 py-5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold tracking-tight text-ink">{r.name}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{r.summary}</p>
                </div>
                <span className="mt-1 shrink-0 text-ink-faint" aria-hidden>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="M5 7.5 10 12.5 15 7.5" />
                  </svg>
                </span>
              </div>
            </button>

            {isOpen && (
              <div className="px-5 pb-6 sm:px-6">
                <ul className="space-y-5 border-t border-line pt-5">
                  {r.changes.map((c, i) => {
                    const style = TYPE_STYLE[c.type];
                    return (
                      <li key={i} className="flex items-start gap-3">
                        {/* Fixed width and self-start on purpose: a flex child
                            with no height stretches to the row, and a stretched
                            pill is a circle. The fixed width also keeps every
                            title on the same left edge rather than each one
                            starting wherever its label happened to end. */}
                        <span
                          className={`mt-0.5 w-[92px] shrink-0 self-start rounded-md px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide ring-1 ${style.className}`}
                        >
                          {style.label}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{c.title}</p>
                          <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{c.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
