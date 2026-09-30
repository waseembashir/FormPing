'use client';

import { useEffect, useState } from 'react';
import type { Project } from '@/lib/projects/types';
import { monogram } from './uiKit';

/**
 * The shared "pick an existing project or create a new one, and add this URL to
 * it" body (FR-38 redesign). Rendered by AssignToProject (dropdown) and
 * AddToProjectModal (popup) so the assign logic lives in ONE place. Create-first,
 * with a search box once there's more than one project, and monogram rows.
 */
function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

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
  const [query, setQuery] = useState('');

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
    if (!name) { setError('Enter a project name'); return; }
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

  const q = query.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.urls.some((u) => u.toLowerCase().includes(q)))
    : projects;

  return (
    <div>
      {loaded && projects.length > 1 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-line-strong bg-ground px-3 py-2 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden>
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.45 4.39l3.33 3.33a.75.75 0 11-1.06 1.06l-3.33-3.33A7 7 0 012 9z" clipRule="evenodd" />
          </svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none" />
        </div>
      )}

      <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
        {/* Create — first */}
        {creating ? (
          <div className="space-y-2 rounded-lg border border-accent/30 bg-accent/[0.06] p-2.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createAndAssign(); }}
              placeholder="New project name"
              disabled={busy}
              className="w-full rounded-md border border-line-strong bg-ground px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-40"
            />
            <div className="flex gap-2">
              <button type="button" disabled={busy || !newName.trim()} onClick={() => void createAndAssign()} className="flex-1 rounded-md bg-gradient-to-b from-accent to-accent-strong px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-accent-soft/20 transition hover:brightness-110 disabled:opacity-40">
                {busy ? 'Creating…' : 'Create & add'}
              </button>
              <button type="button" onClick={() => { setCreating(false); setNewName(''); setError(null); }} className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-panel">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setCreating(true); setError(null); }} className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-left text-sm font-semibold text-accent-soft transition hover:border-accent hover:bg-accent/[0.06]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden><path d="M10 5a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 0110 5z" /></svg>
            </span>
            Create a new project
          </button>
        )}

        {!loaded && <p className="px-3 py-2 text-xs text-ink-faint">Loading…</p>}
        {loaded && projects.length === 0 && !creating && <p className="px-3 py-2 text-xs text-ink-faint">No projects yet — create one above.</p>}
        {loaded && projects.length > 0 && filtered.length === 0 && <p className="px-3 py-2 text-xs text-ink-faint">No projects match “{query.trim()}”.</p>}
        {loaded &&
          filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => void assignTo(p.id)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-panel disabled:opacity-40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-[11px] font-bold text-accent-soft ring-1 ring-inset ring-white/10">{monogram(p.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {hostOf(p.urls[0])}
                  {p.urls[0] ? ' · ' : ''}{p.urls.length} URL{p.urls.length === 1 ? '' : 's'}
                </span>
              </span>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-ink-faint opacity-0 transition group-hover:translate-x-0 group-hover:text-accent-soft group-hover:opacity-100 -translate-x-1" aria-hidden><path d="M7.3 5.3a1 1 0 011.4 0l4 4a1 1 0 010 1.4l-4 4a1 1 0 11-1.4-1.4L10.6 10 7.3 6.7a1 1 0 010-1.4z" /></svg>
            </button>
          ))}
      </div>

      {error && <p className="mt-1.5 px-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
