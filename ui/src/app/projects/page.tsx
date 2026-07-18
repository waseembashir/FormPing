'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectRollup, ProjectWithRollup } from '@/lib/projects/types';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { UnassignedRow } from '@/components/projects/UnassignedRow';
import { overallStatus } from '@/components/projects/uiKit';

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

  const load = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/projects?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json());
      setProjects(Array.isArray(res?.projects) ? res.projects : []);
      setUnassigned(res?.unassigned && Array.isArray(res.unassigned.urls) ? res.unassigned : null);
    } catch {
      setProjects([]);
      setUnassigned(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(query), 200);
    return () => clearTimeout(t);
  }, [query, load]);

  // Fleet summary — counts by overall status + soonest SSL.
  const fleet = useMemo(() => {
    let healthy = 0, attention = 0, failing = 0, idle = 0;
    let soonestSsl: number | null = null;
    for (const p of projects) {
      const tone = overallStatus(p.rollup).tone;
      if (tone === 'emerald') healthy++;
      else if (tone === 'amber') attention++;
      else if (tone === 'red') failing++;
      else idle++;
      if (p.rollup.sslSoonest != null) soonestSsl = soonestSsl == null ? p.rollup.sslSoonest : Math.min(soonestSsl, p.rollup.sslSoonest);
    }
    return { healthy, attention, failing, idle, soonestSsl, total: projects.length };
  }, [projects]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
      {/* Heading + toolbar */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">One card per client — click to open its full health view, dashboard &amp; shareable status page.</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or URL…"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-56"
            />
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
          </div>
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M10 5a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 0110 5z" /></svg>
            Add client
          </button>
        </div>
      </div>

      {/* Fleet summary */}
      {!loading && fleet.total > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Chip><b>{fleet.total}</b> {fleet.total === 1 ? 'client' : 'clients'}</Chip>
          {fleet.healthy > 0 && <Chip dot="bg-emerald-400"><b>{fleet.healthy}</b> healthy</Chip>}
          {fleet.attention > 0 && <Chip dot="bg-amber-400"><b>{fleet.attention}</b> need attention</Chip>}
          {fleet.failing > 0 && <Chip dot="bg-red-400"><b>{fleet.failing}</b> failing</Chip>}
          {fleet.idle > 0 && <Chip dot="bg-slate-500"><b>{fleet.idle}</b> not monitored</Chip>}
          {fleet.soonestSsl != null && <Chip>Soonest SSL <b className={fleet.soonestSsl <= 30 ? 'text-amber-300' : ''}>{fleet.soonestSsl}d</b></Chip>}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Add a client</h3>
          <ProjectForm onSaved={() => { setShowAdd(false); void load(query); }} onCancel={() => setShowAdd(false)} />
        </div>
      )}

      {/* Card grid */}
      {loading && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
              <div className="flex items-center gap-3 px-4 pb-3 pt-4">
                <div className="fp-skeleton h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2"><div className="fp-skeleton h-3 w-1/2 rounded" /><div className="fp-skeleton h-2.5 w-2/3 rounded" /></div>
              </div>
              <div className="grid grid-cols-3 border-t border-slate-800/70">
                {[0, 1, 2].map((c) => (
                  <div key={c} className={`px-3.5 py-3 ${c < 2 ? 'border-r border-slate-800/70' : ''}`}><div className="fp-skeleton h-2 w-8 rounded" /><div className="fp-skeleton mt-2 h-3 w-12 rounded" /></div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-800/70 bg-slate-950/40 px-4 py-3"><div className="fp-skeleton h-4 w-20 rounded-full" /><div className="fp-skeleton h-3 w-10 rounded" /></div>
            </div>
          ))}
        </div>
      )}

      {!loading && projects.length === 0 && !(unassigned && unassigned.urls.length > 0) && (
        <div className="rounded-xl border border-dashed border-slate-800 px-4 py-16 text-center">
          <p className="text-sm text-slate-400">{query ? 'No projects match your search.' : 'No clients yet.'}</p>
          <p className="mt-1 text-xs text-slate-600">{query ? 'Try a different name or URL.' : 'Click “Add client” to add your first one.'}</p>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => <ProjectCard key={p.id} project={p} index={i} />)}
          <button
            onClick={() => setShowAdd(true)}
            className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-slate-800 text-slate-500 transition-colors hover:border-indigo-500 hover:text-indigo-300"
          >
            <span className="text-center"><span className="text-xl">+</span><span className="mt-1 block text-xs font-semibold">Add a client</span></span>
          </button>
        </div>
      )}

      {/* Unassigned — its own distinct, card-based section */}
      {!loading && unassigned && unassigned.urls.length > 0 && (
        <UnassignedRow urls={unassigned.urls} rollup={unassigned.rollup} onChanged={() => void load(query)} />
      )}

      <p className="mt-4 text-[11px] text-slate-600">
        Cards are ordered worst-first. The colored edge and pill show the single most important thing about each client without opening it.
      </p>
    </main>
  );
}

function Chip({ children, dot }: { children: React.ReactNode; dot?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-[12.5px] text-slate-400 [&_b]:font-bold [&_b]:text-slate-200">
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}
