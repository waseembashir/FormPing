'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProjectRollup, ProjectWithRollup } from '@/lib/projects/types';
import { ProjectRow } from '@/components/projects/ProjectRow';
import { UnassignedRow } from '@/components/projects/UnassignedRow';

interface Unassigned {
  urls: string[];
  rollup: ProjectRollup;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectWithRollup[]>([]);
  const [unassigned, setUnassigned] = useState<Unassigned | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  // Add-a-project form
  const [name, setName] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/projects?q=${encodeURIComponent(q)}`).then((r) => r.json());
      setProjects(Array.isArray(res?.projects) ? res.projects : []);
      setUnassigned(
        res?.unassigned && Array.isArray(res.unassigned.urls) ? res.unassigned : null,
      );
    } catch {
      setProjects([]);
      setUnassigned(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search + light polling so health stays fresh.
  useEffect(() => {
    const t = setTimeout(() => void load(query), 200);
    return () => clearTimeout(t);
  }, [query, load]);

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!name.trim()) {
        setError('Enter a project name');
        return;
      }
      const urls = urlsText
        .split('\n')
        .map((u) => u.trim())
        .filter(Boolean);
      setAdding(true);
      try {
        const res = await fetch(editingId ? `/api/projects/${editingId}` : '/api/projects', {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), urls, notes: notes.trim() || undefined }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data?.error || (editingId ? 'Could not save changes' : 'Could not create project'));
          return;
        }
        setName('');
        setUrlsText('');
        setNotes('');
        setEditingId(null);
        setShowAdd(false);
        await load(query);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        setAdding(false);
      }
    },
    [editingId, name, urlsText, notes, query, load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      await load(query);
    },
    [query, load],
  );

  const startEdit = useCallback((p: ProjectWithRollup) => {
    setEditingId(p.id);
    setName(p.name);
    setUrlsText(p.urls.join('\n'));
    setNotes(p.notes ?? '');
    setError(null);
    setShowAdd(true);
  }, []);

  const urlCount = urlsText
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean).length;
  const inputCls =
    'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40';
  const labelCls =
    'block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5';

  return (
    <main className="max-w-7xl mx-auto px-4 pb-16 pt-8">
      {/* Heading + toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Projects</h2>
          <p className="text-sm text-slate-400 mt-1">
            Each client&apos;s website health at a glance — sorted worst-first.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or URL…"
              className="w-full sm:w-56 bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <svg
              className="absolute left-3 top-2.5 w-4 h-4 text-slate-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setName('');
              setUrlsText('');
              setNotes('');
              setError(null);
              setShowAdd((s) => !s);
            }}
            className="shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-sm font-semibold text-white inline-flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M10 5a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 0110 5z" />
            </svg>
            Add project
          </button>
        </div>
      </div>

      {/* Collapsible add form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="rounded-xl border border-slate-800 bg-slate-900 p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <h3 className="sm:col-span-2 text-sm font-semibold text-slate-200">
            {editingId ? 'Edit project' : 'Add a project'}
          </h3>
          <div>
            <label className={labelCls}>Client / project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              disabled={adding}
              className={inputCls}
            />
            <label className={`${labelCls} mt-3`}>
              Notes <span className="text-slate-600 normal-case">(optional)</span>
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth noting"
              disabled={adding}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>URLs to track</label>
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={5}
              placeholder={'https://acme.com\nhttps://acme.com/contact\nhttps://acme.com/pricing'}
              disabled={adding}
              className={`${inputCls} font-mono`}
            />
            <p className="mt-1 text-[11px] text-slate-600">
              One per line — add every page or site for this client (homepage, contact page, landing
              pages…).{urlCount > 0 ? ` ${urlCount} URL${urlCount === 1 ? '' : 's'} added.` : ''}
            </p>
          </div>
          {error && (
            <div className="sm:col-span-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={adding || name.trim().length === 0}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white"
            >
              {adding ? 'Saving…' : editingId ? 'Save changes' : 'Add project'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setEditingId(null);
              }}
              className="rounded-lg border border-slate-700 hover:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Health table */}
      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2.5 bg-slate-900/70 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <div className="col-span-4">Project</div>
          <div className="col-span-3">Contact form</div>
          <div className="col-span-2">Uptime</div>
          <div className="col-span-2">SSL expiry</div>
          <div className="col-span-1 text-right">Checked</div>
        </div>

        <div className="divide-y divide-slate-800">
          {loading && <p className="text-sm text-slate-500 px-4 py-6">Loading…</p>}

          {!loading && projects.length === 0 && !(unassigned && unassigned.urls.length > 0) && (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-slate-400">
                {query ? 'No projects match your search.' : 'No projects yet.'}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {query
                  ? 'Try a different name or URL.'
                  : 'Click “Add project” to add your first client.'}
              </p>
            </div>
          )}

          {!loading &&
            projects.map((p) => (
              <ProjectRow key={p.id} project={p} onDelete={handleDelete} onEdit={startEdit} />
            ))}

          {!loading && unassigned && unassigned.urls.length > 0 && (
            <UnassignedRow
              urls={unassigned.urls}
              rollup={unassigned.rollup}
              onChanged={() => void load(query)}
            />
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-600 mt-3">
        Rollup = the worst status across a client&apos;s URLs. Click a row to see each URL&apos;s
        form, uptime &amp; SSL — and add a monitor.
      </p>
    </main>
  );
}
