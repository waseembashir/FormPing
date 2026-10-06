'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

/**
 * Handing a URL's monitors to somebody else.
 *
 * Attached to the "Watched by" badge rather than added as another button,
 * because it is an action ON that fact: the badge says who is responsible, and
 * pressing it is how you change the answer. A fourth button beside Dashboard
 * and Remove would compete with them for an action most people never take.
 *
 * It moves every monitor the picker was opened for — one per request, so each
 * handover is its own decision on the server and its own line in the activity
 * log. Two monitors moving really is two things happening.
 */

export interface Handover {
  /** Which monitors this badge speaks for, and so which move together. */
  kinds: ('form' | 'uptime')[];
  /** Where to send them. */
  endpoint: string;
}

interface Person {
  email: string;
  name: string | null;
}

export function HandoverMenu({
  label,
  handover,
  onDone,
  compact = false,
}: {
  /** The badge's own content — the name currently shown. */
  label: string;
  handover: Handover;
  /** Reload the project once something actually moved. */
  onDone: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Fetched when the menu is first opened, not on every card render — a project
  // with twenty URLs would otherwise ask for the team twenty times to populate
  // menus nobody opened.
  useEffect(() => {
    if (!open || people) return;
    let live = true;
    void fetch('/api/users/assignable', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users?: Person[] }) => live && setPeople(d.users ?? []))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [open, people]);

  // Click-away and Escape, so the menu cannot be left open behind a card the
  // user has moved on from.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  async function assign(to: string) {
    setBusy(true);
    setError(null);
    try {
      // One request per monitor. The server decides each on its own merits, so
      // a refusal on one does not quietly carry the other with it.
      for (const kind of handover.kinds) {
        const res = await fetch(handover.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, to }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? 'That handover could not be completed.');
        }
      }
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That handover could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className="relative inline-flex min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Watched by ${label} — press to hand it over`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          'inline-flex min-w-0 items-center gap-1.5 rounded-full bg-ok/10 text-[11px] ring-1 ring-ok/25 transition-colors hover:ring-ok/50',
          compact ? 'px-2 py-0.5' : 'px-2.5 py-1',
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok animate-pulse motion-reduce:animate-none" />
        <span className="shrink-0 text-ink-faint">Watched by</span>
        <span className="truncate font-medium text-ink-secondary">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1.5 w-60 rounded-lg border border-line-strong bg-panel p-1.5 shadow-xl"
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] text-ink-faint">
            Hand {handover.kinds.length > 1 ? 'these monitors' : 'this monitor'} to
          </p>

          {people === null && <p className="px-2 py-1.5 text-[11px] text-ink-faint">Loading the team…</p>}

          {people?.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-ink-faint">Nobody else can take this on yet.</p>
          )}

          {people?.map((p) => (
            <button
              key={p.email}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void assign(p.email)}
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-panel-raised hover:text-ink disabled:opacity-40"
              title={p.email}
            >
              {p.name ?? p.email}
            </button>
          ))}

          {error && (
            <p className="mt-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-accent-soft">
              {error}
            </p>
          )}

          <p className="border-t border-line px-2 pb-1 pt-1.5 text-[10px] leading-relaxed text-ink-faint">
            Its alerts go to them from then on. Past checks stay recorded against whoever ran them.
          </p>
        </div>
      )}
    </div>
  );
}
