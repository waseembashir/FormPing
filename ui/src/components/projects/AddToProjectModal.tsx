'use client';

import { useEffect, useState } from 'react';
import { ProjectChooser } from './ProjectChooser';

/**
 * Popup shown after a monitor is added in Form/Site Watch: "Add this URL to a
 * project?". Choosing/creating a project = yes. "No, don't track in Projects"
 * records a dismissal so the URL stays out of the Unassigned bucket (the monitor
 * keeps running). "Decide later" just closes — it remains in Unassigned.
 *
 * Self-gating: on open it checks membership and silently closes if the URL is
 * already in a project or was previously dismissed (no flash, no nagging).
 */
export function AddToProjectModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [phase, setPhase] = useState<'checking' | 'ask'>('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/membership?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.inProject || d?.dismissed) onClose();
        else setPhase('ask');
      })
      .catch(() => {
        if (alive) setPhase('ask');
      });
    return () => {
      alive = false;
    };
  }, [url, onClose]);

  async function dismiss() {
    setBusy(true);
    try {
      await fetch('/api/projects/dismissed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    } catch {
      /* best-effort — closing anyway */
    } finally {
      setBusy(false);
      onClose();
    }
  }

  if (phase === 'checking') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-100">Add this URL to a project?</h3>
        <p className="mt-1 text-xs text-slate-400">
          Group <span className="font-mono text-slate-300 break-all">{url}</span> under a client so it
          shows in Projects and its alerts route correctly.
        </p>
        <p className="mt-1.5 text-[11px] text-slate-500">
          <strong className="text-slate-400">Decide later</strong> keeps it in{' '}
          <strong className="text-slate-400">Unassigned</strong> (assign or dismiss it there anytime).{' '}
          <strong className="text-slate-400">No, don&apos;t track</strong> hides it from Projects.
        </p>

        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-1.5">
          <ProjectChooser url={url} onAssigned={onClose} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void dismiss()}
            className="text-xs text-slate-400 hover:text-red-300 disabled:opacity-40"
          >
            No, don&apos;t track in Projects
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}
