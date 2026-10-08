'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProjectListItem } from '@/lib/projects/projectList';

/**
 * A small "Use a project" dropdown for the tester tabs: pick a saved project,
 * expand it to its URLs, and click a URL to fill the field — no re-typing.
 *
 * Loads from GET /api/projects/list, not /api/projects: the latter builds the
 * Projects page — eight store reads, a health rollup per project and the whole
 * Unassigned bucket — and this menu used three fields of it, on every open.
 * Auth-gated like the rest of the app, by the middleware.
 */
export function ProjectUrlPicker({
  onPick,
  onPickMany,
  keepOpen = false,
  align = 'left',
}: {
  /** Called with each chosen URL. */
  onPick: (url: string) => void;
  /**
   * Called with ALL of a project's URLs at once ("Add all"). Required for
   * batched adds: looping onPick in one tick hits a stale-state closure and
   * only the last URL sticks. When provided, "Add all" uses this instead.
   */
  onPickMany?: (urls: string[]) => void;
  /** Keep the menu open after a pick (for multi-add fields like a textarea). */
  keepOpen?: boolean;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    fetch('/api/projects/list', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d?.projects) ? d.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Reset the search + expansion whenever the menu closes.
  useEffect(() => {
    if (!open) { setQuery(''); setExpandedId(null); }
  }, [open]);

  function pick(url: string) {
    onPick(url);
    setOpen(false); // always close after selecting a URL (every tab)
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.urls.some((u) => u.toLowerCase().includes(q)))
    : projects;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-panel-raised px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-panel hover:text-ink"
      >
        Use a project
        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute z-30 mt-1 w-72 overflow-hidden rounded-lg border border-line-strong bg-panel-raised shadow-xl shadow-black/40 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {loaded && projects.length > 1 && (
            <div className="border-b border-line p-1.5">
              <div className="flex items-center gap-2 rounded-md bg-ground px-2.5 py-1.5 ring-1 ring-line-strong focus-within:ring-2 focus-within:ring-accent/40">
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden>
                  <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.33 3.33a.75.75 0 11-1.06 1.06l-3.33-3.33A7 7 0 012 9z" clipRule="evenodd" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects…"
                  autoFocus
                  className="w-full bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto p-1">
          {!loaded && <p className="px-3 py-2 text-xs text-ink-faint">Loading…</p>}
          {loaded && projects.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink-faint">No projects yet — add one in the Projects tab.</p>
          )}
          {loaded && projects.length > 0 && filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink-faint">No projects match “{query.trim()}”.</p>
          )}
          {loaded &&
            filtered.map((p) => (
              <div key={p.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId((id) => (id === p.id ? null : p.id))}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-ink-secondary hover:bg-panel"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">
                    {p.urls.length} URL{p.urls.length === 1 ? '' : 's'}
                  </span>
                </button>
                {expandedId === p.id && (
                  <div className="pb-1 pl-2">
                    {p.urls.length === 0 && <p className="px-2.5 py-1 text-[11px] text-ink-faint">No URLs in this project.</p>}
                    {p.urls.map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => pick(u)}
                        className="w-full truncate rounded-md px-2.5 py-1 text-left font-mono text-[11px] text-ink-muted hover:bg-panel hover:text-accent-soft"
                        title={u}
                      >
                        {u}
                      </button>
                    ))}
                    {keepOpen && p.urls.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (onPickMany) onPickMany(p.urls);
                          else p.urls.forEach(onPick);
                          setOpen(false);
                        }}
                        className="w-full rounded-md px-2.5 py-1 text-left text-[11px] font-medium text-accent-soft hover:bg-panel"
                      >
                        + Add all {p.urls.length}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
