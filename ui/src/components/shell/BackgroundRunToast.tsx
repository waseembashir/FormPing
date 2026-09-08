'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import * as tester from '@/lib/testerRun';
import * as monitor from '@/lib/monitorRun';

/**
 * FR-81 — tell the user their run is still going when they leave its tab.
 *
 * Both run stores live at MODULE scope precisely so a run survives navigation:
 * the stream keeps filling them while you're elsewhere, and the tab picks the
 * result back up when you return. That works, but silently — walk away mid-run
 * and there is nothing to say the work continued, so it reads as if leaving
 * cancelled it.
 *
 * This is deliberately a passing note, not a persistent banner: it appears on
 * the navigation that takes you away, says where the work is, and leaves. A
 * status bar that stayed would become furniture nobody reads.
 *
 * Top-right, where notifications live — in the eye's path as the new page
 * loads, without covering the content you just navigated to.
 */

/** Which tool owns which route, and what to call it in the sentence. */
const TOOLS = [
  { home: '/', label: 'Form Tester', back: 'Form Tester' },
  { home: '/monitor', label: 'Content Changes', back: 'Content Changes' },
] as const;

// Long enough to read two lines and decide whether to go back, short enough
// that it never becomes furniture. FR-81.
const VISIBLE_MS = 6500;

function domainOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function BackgroundRunToast() {
  const pathname = usePathname();

  const testerState = useSyncExternalStore(tester.subscribe, tester.getSnapshot, tester.getServerSnapshot);
  const monitorState = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getServerSnapshot);

  const [note, setNote] = useState<{ label: string; target: string | null; home: string; back: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The route we last reacted to, so the note fires on ARRIVING somewhere else
  // rather than re-firing on every render while a run continues.
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    const from = lastPath.current;
    lastPath.current = pathname;
    if (from === null) return; // first render — the user hasn't gone anywhere yet

    const running =
      tester.getSnapshot().running ? TOOLS[0]
      : monitor.getSnapshot().running ? TOOLS[1]
      : null;
    // Only when a run is going AND we have left the tab that owns it.
    if (!running || pathname === running.home) return;

    const target =
      running.home === '/' ? domainOf(tester.getSnapshot().progress?.currentUrl) : null;

    setNote({ label: running.label, target, home: running.home, back: running.back });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), VISIBLE_MS);
  }, [pathname, testerState.running, monitorState.running]);

  // Clear the moment the run finishes — a note about work that has ended is
  // worse than no note.
  useEffect(() => {
    if (!testerState.running && !monitorState.running) setNote(null);
  }, [testerState.running, monitorState.running]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!note) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-50 flex max-w-[calc(100vw-2rem)] justify-end sm:right-6 sm:top-6"
    >
      {/* One line and a way back — nothing else. An earlier version had a
          heading, a sentence of reassurance and a link; for a notice that shows
          for six seconds, that is more than anyone reads. FR-81. */}
      <div className="fp-notice-in pointer-events-auto flex items-center gap-3 rounded-xl border border-accent/40 bg-panel py-2.5 pl-4 pr-3 shadow-2xl shadow-ground/80">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75 [animation-duration:1.8s] motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>

        <p className="whitespace-nowrap text-[13px] text-ink-secondary">
          <span className="font-semibold text-ink">{note.label}</span> is running in the background
        </p>

        <Link
          href={note.home}
          onClick={() => setNote(null)}
          className="shrink-0 rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent-soft ring-1 ring-accent/30 transition-colors hover:bg-accent/25 hover:text-ink"
        >
          View
        </Link>
      </div>
    </div>
  );
}
