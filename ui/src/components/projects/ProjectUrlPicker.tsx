'use client';

import { useEffect, useRef, useState } from 'react';
import type { Project } from '@/lib/projects/types';

/**
 * A small "Use a project" dropdown for the tester tabs: pick a saved project,
 * expand it to its URLs, and click a URL to fill the field — no re-typing.
 * Loads from GET /api/projects (auth-gated like the rest of the app).
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    fetch('/api/projects', { cache: 'no-store' })
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

  function pick(url: string) {
    onPick(url);
    setOpen(false); // always close after selecting a URL (every tab)
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors"
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
          className={`absolute z-30 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40 p-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {!loaded && <p className="px-3 py-2 text-xs text-slate-500">Loading…</p>}
          {loaded && projects.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">
              No projects yet — add one in the Projects tab.
            </p>
          )}
          {loaded &&
            projects.map((p) => (
              <div key={p.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId((id) => (id === p.id ? null : p.id))}
                  className="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-200 hover:bg-slate-800 flex items-center justify-between gap-2"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {p.urls.length} URL{p.urls.length === 1 ? '' : 's'}
                  </span>
                </button>
                {expandedId === p.id && (
                  <div className="pl-2 pb-1">
                    {p.urls.length === 0 && (
                      <p className="px-2.5 py-1 text-[11px] text-slate-600">No URLs in this project.</p>
                    )}
                    {p.urls.map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => pick(u)}
                        className="w-full text-left px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-400 hover:bg-slate-800 hover:text-indigo-300 truncate"
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
                        className="w-full text-left px-2.5 py-1 rounded-md text-[11px] font-medium text-indigo-300 hover:bg-slate-800"
                      >
                        + Add all {p.urls.length}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
