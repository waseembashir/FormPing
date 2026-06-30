'use client';

import { useState } from 'react';
import type { ProjectRollup, UrlHealth } from '@/lib/projects/types';
import { StatusDot, overallStatus, TONE_TEXT, UrlDetailRow } from './ProjectRow';
import { AssignToProject } from './AssignToProject';

/**
 * The synthetic "Unassigned" bucket: monitored URLs not in any project. Mirrors
 * a ProjectRow visually (so the list reads consistently) but is dashed/muted to
 * signal it's a catch-all, and each URL gets an Assign-to-project action. The
 * guarantee that makes Projects a complete inventory — no monitor is invisible.
 */
export function UnassignedRow({
  urls,
  rollup,
  onChanged,
}: {
  urls: string[];
  rollup: ProjectRollup;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [health, setHealth] = useState<UrlHealth[] | null>(null);
  const [loading, setLoading] = useState(false);
  const st = overallStatus(rollup);

  async function loadDetail() {
    setLoading(true);
    try {
      const res = await fetch('/api/projects/unassigned').then((x) => x.json());
      setHealth(Array.isArray(res?.health) ? res.health : []);
    } catch {
      setHealth([]);
    } finally {
      setLoading(false);
    }
  }
  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !health) void loadDetail();
  }

  return (
    <div className="bg-slate-950/20">
      <button
        type="button"
        onClick={toggle}
        className="w-full text-left grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-slate-900/40 transition-colors"
      >
        <div className="col-span-12 sm:col-span-4 flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-lg ring-1 ring-dashed ring-slate-600/60 bg-slate-800/40 text-slate-400 text-base flex items-center justify-center shrink-0">
            ⋯
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-200 truncate">Unassigned</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StatusDot tone={st.tone} pulse={st.pulse} />
              <span className={`text-[11px] font-medium ${TONE_TEXT[st.tone]}`}>{st.word}</span>
              <span className="text-[11px] text-slate-600">
                · {urls.length} monitored URL{urls.length === 1 ? '' : 's'} not in a project
              </span>
            </div>
          </div>
        </div>
        <div className="hidden sm:block sm:col-span-7 text-xs text-slate-500">
          Assign these to a client project so they show up — and so their alerts route correctly.
        </div>
        <div className="col-span-12 sm:col-span-1 text-right text-[11px] text-slate-500">
          {expanded ? 'Hide' : 'Review'}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-slate-950/30 border-t border-slate-800/60 space-y-2">
          {loading && <p className="text-xs text-slate-500 py-2">Loading…</p>}
          {!loading &&
            health &&
            health.map((h) => (
              <div key={h.url}>
                <UrlDetailRow h={h} />
                <div className="mt-1 flex justify-end">
                  <AssignToProject url={h.url} onAssigned={onChanged} />
                </div>
              </div>
            ))}
          {!loading && health && health.length === 0 && (
            <p className="text-xs text-slate-500">
              Nothing unassigned — every monitored URL is in a project. 🎉
            </p>
          )}
        </div>
      )}
    </div>
  );
}
