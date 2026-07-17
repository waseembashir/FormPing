'use client';

import { useEffect, useState } from 'react';
import type { Project } from '@/lib/projects/types';

/**
 * The shared "pick an existing project or create a new one, and add this URL to
 * it" body. Rendered inline by both AssignToProject (in a dropdown) and
 * AddToProjectModal (in a popup) so the assign logic lives in ONE place.
 */
export function ProjectChooser({
  url,
  onAssigned,
}: {
  url: string;
  /** Called after the URL is successfully added to a project. */
  onAssigned: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/projects', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d?.projects) ? d.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setLoaded(true));
  }, []);

  async function assignTo(projectId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error || 'Could not assign');
        return;
      }
      onAssigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) {
      setError('Enter a project name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, urls: [url] }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error || 'Could not create project');
        return;
      }
      onAssigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="max-h-56 overflow-y-auto">
        {!loaded && <p className="px-3 py-2 text-xs text-slate-500">Loading…</p>}
        {loaded && projects.length === 0 && !creating && (
          <p className="px-3 py-2 text-xs text-slate-500">No projects yet — create one below.</p>
        )}
        {loaded &&
          projects.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => void assignTo(p.id)}
              className="w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 flex items-center justify-between gap-2"
            >
              <span className="truncate">{p.name}</span>
              <span className="text-[10px] text-slate-500 shrink-0">
                {p.urls.length} URL{p.urls.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
      </div>

      <div className="border-t border-slate-800 mt-1 pt-1">
        {creating ? (
          <div className="px-1.5 py-1 space-y-1.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createAndAssign();
              }}
              placeholder="New project name"
              disabled={busy}
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={busy || !newName.trim()}
                onClick={() => void createAndAssign()}
                className="flex-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-2 py-1 text-[11px] font-semibold text-white"
              >
                {busy ? 'Creating…' : 'Create & assign'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                  setError(null);
                }}
                className="rounded border border-slate-700 hover:bg-slate-800 px-2 py-1 text-[11px] text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] font-medium text-indigo-300 hover:bg-slate-800"
          >
            + New project…
          </button>
        )}
      </div>

      {error && <p className="px-3 py-1 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
