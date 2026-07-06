'use client';

import { useState } from 'react';

/**
 * Manage a project's PUBLIC status-page share link (generate / copy / revoke).
 * Lives in the project's expanded detail. The link opens /status/<token> with
 * no login required — safe to hand to the client.
 */
export function ShareStatusControl({
  projectId,
  initialToken,
}: {
  projectId: string;
  initialToken?: string | null;
}) {
  const [token, setToken] = useState<string | null>(initialToken ?? null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = token && typeof window !== 'undefined' ? `${window.location.origin}/status/${token}` : '';

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.shareToken) setToken(data.shareToken as string);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('Turn off the public status page? The current link will stop working immediately.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, { method: 'DELETE' });
      if (res.ok) setToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  }

  if (!token) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-300">Public status page</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Share a live, client-safe health page — no login needed.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="shrink-0 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            {busy ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-semibold text-emerald-300">● Public status page is live</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="text-[11px] text-slate-500 hover:text-slate-300 disabled:opacity-40"
            title="Generate a new link and invalidate the old one"
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={revoke}
            disabled={busy}
            className="text-[11px] text-slate-500 hover:text-rose-300 disabled:opacity-40"
          >
            Turn off
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-[11px] font-mono text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md border border-slate-700 hover:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-300"
        >
          Open
        </a>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-md bg-slate-700 hover:bg-slate-600 px-2.5 py-1.5 text-[11px] font-semibold text-white"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
