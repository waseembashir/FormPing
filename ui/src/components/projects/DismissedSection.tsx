'use client';

import { useCallback, useEffect, useState } from 'react';
import { AssignToProject } from './AssignToProject';

/**
 * Collapsible "Dismissed from Projects" list. Surfaces URLs the user opted out
 * of Projects ("No, don't track") so the choice isn't a silent dead-end: each
 * can be un-dismissed (returns to Unassigned) or assigned straight to a project.
 * Renders nothing when there are none.
 */
export function DismissedSection({ onChanged }: { onChanged: () => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/projects/dismissed').then((r) => r.json());
      setUrls(Array.isArray(res?.urls) ? res.urls : []);
    } catch {
      setUrls([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const undismiss = useCallback(
    async (url: string) => {
      try {
        await fetch('/api/projects/dismissed', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      } catch {
        /* best-effort */
      }
      await load();
      onChanged();
    },
    [load, onChanged],
  );

  if (!loaded || urls.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-800/70 bg-slate-950/30">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-medium text-slate-400">
          Dismissed from Projects · {urls.length}
        </span>
        <span className="text-[11px] text-slate-600">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          <p className="text-[11px] text-slate-600">
            These monitored URLs were set to &ldquo;don&apos;t track in Projects&rdquo;. Un-dismiss to
            bring one back into Unassigned, or assign it straight to a project.
          </p>
          {urls.map((u) => (
            <div
              key={u}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/40 border border-slate-800 px-3 py-2"
            >
              <span className="font-mono text-[11px] text-slate-400 truncate" title={u}>
                {u}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <AssignToProject url={u} onAssigned={() => void undismiss(u)} />
                <button
                  type="button"
                  onClick={() => void undismiss(u)}
                  className="text-[11px] text-slate-500 hover:text-slate-300"
                >
                  Un-dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
