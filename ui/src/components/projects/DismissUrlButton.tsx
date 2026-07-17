'use client';

import { useState } from 'react';

/**
 * "Delete" — remove a URL from the Unassigned bucket. Records a dismissal (POST
 * /api/projects/dismissed) so the URL leaves Projects and stops being prompted.
 * Labelled "Delete" because that's what it does from the Projects user's point
 * of view (the URL is gone from here). It is intentionally NON-destructive to
 * any live monitor — a Form/Site Watch schedule keeps running and is managed in
 * its own tab; this only removes the URL's presence in Projects. Re-testing the
 * URL, or adding a monitor, un-dismisses it.
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
      title="Remove this URL from Projects. Any monitor for it keeps running (manage that in its Forms/Site tab)."
      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/50 px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-rose-300 hover:border-rose-800/60 transition-colors disabled:opacity-40"
    >
      {busy ? 'Removing…' : 'Delete'}
    </button>
  );
}
