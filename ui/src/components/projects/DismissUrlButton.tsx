'use client';

import { useState } from 'react';

/**
 * "Don't track" — dismiss a URL from Projects. Records a dismissal (POST
 * /api/projects/dismissed) so the URL leaves the Unassigned bucket and stops
 * being prompted, WITHOUT deleting anything server-side (the monitor / last run
 * still exists; it just won't clutter Projects). Un-dismiss from the
 * "Dismissed from Projects" list.
 */
export function DismissUrlButton({ url, onDone }: { url: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      await fetch('/api/projects/dismissed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      onDone();
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void dismiss()}
      disabled={busy}
      title="Don't track this URL in Projects (moves it to the Dismissed list)"
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/50 px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-rose-300 hover:border-rose-800/60 transition-colors disabled:opacity-40"
    >
      {busy ? 'Dismissing…' : "Don't track"}
    </button>
  );
}
