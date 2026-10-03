'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectRollup, ProjectWithRollup } from '@/lib/projects/types';
import { readTab, writeTab, TAB_KEYS } from '@/lib/tabCache';
import { ProjectsTable } from '@/components/projects/ProjectsTable';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { UnassignedRow } from '@/components/projects/UnassignedRow';
import { fromProjectRollup } from '@/lib/design/status';
import { useMe, canRole } from '@/lib/auth/useMe';
import { ReadOnlyBanner } from '@/components/ReadOnlyBanner';
import { PageHeader, Button, Input, Tabs, Modal, EmptyState, Skeleton, type TabItem } from '@/components/ui';

interface Unassigned {
  urls: string[];
  rollup: ProjectRollup;
}

type ViewKey = 'all' | 'monitoring' | 'not' | 'attention' | 'mine' | 'unassigned';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'all', label: 'All projects' },
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'not', label: 'Not monitoring' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
];

/** Does a project belong in the given saved view? */
function matchesView(p: ProjectWithRollup, view: ViewKey, meName: string | null): boolean {
  const { level } = fromProjectRollup(p.rollup);
  switch (view) {
    case 'monitoring':
      return p.rollup.monitored;
    case 'not':
      return !p.rollup.monitored;
    case 'attention':
      return level === 'warn' || level === 'danger';
    case 'mine':
      return Boolean(meName) && (p.createdBy === meName || p.updatedBy === meName);
    default:
      return true;
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectWithRollup[]>([]);
  const [unassigned, setUnassigned] = useState<Unassigned | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewKey>('all');
  const [showAdd, setShowAdd] = useState(false);
  const me = useMe();
  const canManage = canRole(me.role, 'member'); // viewers are read-only
  const meName = me.name ?? null;

  const load = useCallback(async (q: string) => {
    // Render what this tab showed last time, immediately, then refresh behind
    // it. A revisit used to blank the page for a full round trip. FR-105.
    const remembered = readTab<{ projects: ProjectWithRollup[]; unassigned: Unassigned | null }>(TAB_KEYS.projects(q));
    if (remembered) {
      setProjects(remembered.projects);
      setUnassigned(remembered.unassigned);
      setLoading(false);
    }
    try {
      const res = await fetch(`/api/projects?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json());
      const next = {
        projects: Array.isArray(res?.projects) ? res.projects : [],
        unassigned: res?.unassigned && Array.isArray(res.unassigned.urls) ? res.unassigned : null,
      };
      setProjects(next.projects);
      setUnassigned(next.unassigned);
      writeTab(TAB_KEYS.projects(q), next);
    } catch {
      // Keep whatever is on screen when a refresh fails: replacing a good list
      // with an empty one turns a transient blip into "you have no projects".
      if (!remembered) {
        setProjects([]);
        setUnassigned(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(query), 200);
    return () => clearTimeout(t);
  }, [query, load]);

  const unassignedCount = unassigned?.urls.length ?? 0;

  // Counts per saved view (drive the tab badges).
  const counts = useMemo<Record<ViewKey, number>>(() => {
    const c: Record<ViewKey, number> = { all: projects.length, monitoring: 0, not: 0, attention: 0, mine: 0, unassigned: unassignedCount };
    for (const p of projects) {
      const { level } = fromProjectRollup(p.rollup);
      if (p.rollup.monitored) c.monitoring++;
      else c.not++;
      if (level === 'warn' || level === 'danger') c.attention++;
      if (meName && (p.createdBy === meName || p.updatedBy === meName)) c.mine++;
    }
    return c;
  }, [projects, unassignedCount, meName]);

  const filtered = useMemo(() => projects.filter((p) => matchesView(p, view, meName)), [projects, view, meName]);

  const tabItems: TabItem<ViewKey>[] = VIEWS.map((v) => ({ value: v.key, label: v.label, badge: counts[v.key] }));

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
      <PageHeader
        title="Projects"
        description="Every client and its monitors in one place. Open a project for its full health, dashboard and shareable status page."
        actions={
          canManage && (
            <Button variant="primary" onClick={() => setShowAdd(true)}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden><path d="M10 5a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 0110 5z" /></svg>
              New project
            </Button>
          )
        }
      />

      <div className="mt-4">
        <ReadOnlyBanner />
      </div>

      {/* Toolbar — saved views + search */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black,black_calc(100%_-_28px),transparent)] [-webkit-mask-image:linear-gradient(to_right,black,black_calc(100%_-_28px),transparent)] sm:[mask-image:none] sm:[-webkit-mask-image:none]">
          <Tabs items={tabItems} value={view} onChange={setView} />
        </div>
        {view !== 'unassigned' && (
          <div className="relative shrink-0 sm:w-64">
            <Input className="pl-9" placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
            <svg viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden>
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="mt-4">
        {loading ? (
          <div className="overflow-hidden rounded-xl border border-line bg-panel/40">
            <div className="h-10 border-b border-line bg-panel/60" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-t border-line px-4 py-3.5">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-2.5 w-24" /></div>
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
        ) : view === 'unassigned' ? (
          unassignedCount > 0 ? (
            <UnassignedRow urls={unassigned!.urls} rollup={unassigned!.rollup} onChanged={() => void load(query)} />
          ) : (
            <EmptyState title="No unassigned URLs" description="URLs that aren't part of any project show up here. Everything's assigned right now." />
          )
        ) : filtered.length > 0 ? (
          <ProjectsTable projects={filtered} />
        ) : (
          <EmptyState
            title={query ? 'No projects match your search' : view === 'all' ? 'No projects yet' : 'Nothing in this view'}
            description={
              query
                ? 'Try a different name or URL.'
                : view === 'all'
                  ? canManage
                    ? 'Create your first project to group a client’s URLs and start monitoring.'
                    : 'No projects have been added yet.'
                  : 'No projects match this view right now.'
            }
            action={view === 'all' && !query && canManage ? <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>New project</Button> : undefined}
          />
        )}
      </div>

      {/* Add project */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New project" subtitle="Group a client’s URLs so you can monitor them together." size="xl">
        <ProjectForm onSaved={() => { setShowAdd(false); void load(query); }} onCancel={() => setShowAdd(false)} />
      </Modal>
    </main>
  );
}
