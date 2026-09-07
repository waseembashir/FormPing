'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ProjectWithHealth, UrlHealth } from '@/lib/projects/types';
import { rollupFromHealth } from '@/lib/projects/rollup';
import { matchKey } from '@/lib/projects/projectStore';
import { encodeUrlKey } from '@/lib/projects/urlKeyRoute';
import {
  SectionHeader,
  Tile,
  UrlHealthDetail,
  FORM_TONE,
  UP_TONE,
  UP_LABEL,
  monogram,
  type Tone,
} from '@/components/projects/uiKit';
import { ShareStatusControl } from '@/components/projects/ShareStatusControl';
import { Attribution } from '@/components/projects/Attribution';
import { ProjectForm } from '@/components/projects/ProjectForm';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button, StatusPill, Modal, cx } from '@/components/ui';
import { fromProjectRollup, STATUS } from '@/lib/design/status';
import { useMe, canRole } from '@/lib/auth/useMe';

const FORM_WORD: Record<string, string> = { healthy: 'Healthy', detected: 'Detected', attention: 'Attention', failing: 'Failing', pending: 'Pending' };
function expiryTone(days: number | null): Tone | undefined {
  if (days == null) return undefined;
  if (days <= 14) return 'red';
  if (days <= 30) return 'amber';
  return 'emerald';
}
/** One-line "needs attention" reasons for a URL, from its derived health — the
 *  at-a-glance triage that used to live on the (now-removed) global dashboard. */
function urlAttention(h: UrlHealth): string[] {
  const reasons: string[] = [];
  if (h.site.upState === 'down') reasons.push('site is down');
  if (h.form.level === 'attention' || h.form.level === 'failing') reasons.push('contact form needs attention');
  else if (h.lastRun?.finalStatus === 'fail') reasons.push('form test failed');
  if (h.site.sslDaysRemaining != null && h.site.sslDaysRemaining <= 14)
    reasons.push(h.site.sslDaysRemaining <= 0 ? 'SSL expired' : `SSL renews in ${h.site.sslDaysRemaining}d`);
  if (h.change?.severity === 'high' && (h.change.changesFound ?? 0) > 0) reasons.push('major content change');
  return reasons;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const [project, setProject] = useState<ProjectWithHealth | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteUrl, setDeleteUrl] = useState<string | null>(null);
  const [deleteUrlError, setDeleteUrlError] = useState<string | null>(null);
  const [removeUrl, setRemoveUrl] = useState<string | null>(null);
  const [removeUrlError, setRemoveUrlError] = useState<string | null>(null);
  const me = useMe();
  const canEdit = canRole(me.role, 'member'); // rename / add URLs / notes
  const canDelete = canRole(me.role, 'admin'); // delete project, remove/delete URLs — admin+ only (FR-37)

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { cache: 'no-store' });
      if (!res.ok) return setState('notfound');
      const data = await res.json();
      setProject(data?.project ?? null);
      setState(data?.project ? 'ready' : 'notfound');
    } catch {
      setState('notfound');
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000); // keep health fresh
    return () => clearInterval(t);
  }, [load]);

  async function doDelete() {
    // Check the response — a 403 (not admin) or any error must NOT silently
    // navigate away as if it worked. Only a real success leaves the page.
    setDeleteError(null);
    let res: Response;
    try {
      res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    } catch {
      setDeleteError('Couldn’t reach FormPing — check your connection and try again.');
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? 'Could not delete this project. Please try again.');
      return; // keep the dialog open so the reason is visible
    }
    router.push('/projects');
  }

  // Destructive per-URL delete (Admin+): purge one URL + all its data, then
  // reload. Distinct from Edit→remove (which is non-destructive).
  async function doDeleteUrl() {
    if (!deleteUrl || !project) return;
    setDeleteUrlError(null);
    const keyParam = encodeUrlKey(matchKey(deleteUrl));
    let res: Response;
    try {
      res = await fetch(`/api/projects/${project.id}/url/${keyParam}`, { method: 'DELETE' });
    } catch {
      setDeleteUrlError('Network error — please try again.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDeleteUrlError(body.error ?? 'Could not delete this URL. Please try again.');
      return;
    }
    setDeleteUrl(null);
    // If that was the only URL, the project was removed too — go back to the grid.
    if (body.projectDeleted) router.push('/projects');
    else void load();
  }

  // Non-destructive per-URL remove (Member+): take the URL out of the project
  // (its data is kept → Unassigned) via PATCH. If it was the last URL, the API
  // deletes the now-empty project.
  async function doRemoveUrl() {
    if (!removeUrl || !project) return;
    setRemoveUrlError(null);
    const nextUrls = project.urls.filter((u) => u !== removeUrl);
    let res: Response;
    try {
      res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: nextUrls }),
      });
    } catch {
      setRemoveUrlError('Network error — please try again.');
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRemoveUrlError(body.error ?? 'Could not remove this URL. Please try again.');
      return;
    }
    setRemoveUrl(null);
    if (body.projectDeleted) router.push('/projects');
    else void load();
  }

  if (state === 'loading') {
    return (
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-8">
        <div className="fp-skeleton mb-4 h-3 w-28 rounded" />
        <div className="flex items-center gap-4 border-b border-line pb-6">
          <div className="fp-skeleton h-11 w-11 rounded-xl" />
          <div className="flex-1 space-y-2"><div className="fp-skeleton h-5 w-52 rounded" /><div className="fp-skeleton h-3 w-40 rounded" /></div>
          <div className="hidden gap-2 sm:flex"><div className="fp-skeleton h-9 w-32 rounded-lg" /><div className="fp-skeleton h-9 w-16 rounded-lg" /></div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="fp-skeleton h-[74px] rounded-lg" />)}
        </div>
        <div className="mt-7 space-y-2.5">
          {[0, 1].map((i) => <div key={i} className="fp-skeleton h-24 rounded-lg" />)}
        </div>
      </main>
    );
  }
  if (state === 'notfound' || !project) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/projects" className="text-xs font-medium text-ink-muted hover:text-ink">← Back to Projects</Link>
        <div className="py-20 text-center">
          <h1 className="text-lg font-semibold text-ink">Project not found</h1>
          <p className="mt-2 text-sm text-ink-muted">It may have been deleted.</p>
        </div>
      </main>
    );
  }

  const rollup = rollupFromHealth(project.health);
  const { level, label } = fromProjectRollup(rollup);
  const count = project.urls.length;

  // At-a-glance triage + the searchable URL list.
  const attention = project.health.map((h) => ({ url: h.url, reasons: urlAttention(h) })).filter((a) => a.reasons.length > 0);
  const q = filter.trim().toLowerCase();
  const shownHealth = q ? project.health.filter((h) => h.url.toLowerCase().includes(q)) : project.health;

  // Does the URL being removed have any data worth keeping? A removed URL only
  // lands in Unassigned if it has real activity (a monitor, a result, a manual
  // run, or change-tracking); with none, "remove" just drops it. We know this
  // per-URL from its health, so the confirm can state the exact outcome (FR-37).
  const removeHealth = removeUrl ? project.health.find((h) => h.url === removeUrl) : null;
  const removeHasActivity = Boolean(
    removeHealth &&
      (removeHealth.form.monitored ||
        removeHealth.form.stopped ||
        removeHealth.site.monitored ||
        removeHealth.site.stopped ||
        removeHealth.change?.tracked ||
        removeHealth.lastRun),
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <button onClick={() => router.push('/projects')} className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-accent-soft">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M12.7 5.3a1 1 0 00-1.4 0l-4 4a1 1 0 000 1.4l4 4a1 1 0 001.4-1.4L9.4 10l3.3-3.3a1 1 0 000-1.4z" /></svg>
        Back to Projects
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold ring-1 ring-inset ring-white/10', STATUS[level].soft)}>
            {monogram(project.name)}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-ink">{project.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusPill level={level}>{label}</StatusPill>
              <span className="text-xs text-ink-faint">{count} URL{count === 1 ? '' : 's'}{project.contact ? ` · ${project.contact}` : ''}</span>
            </div>
            {project.notes && <p className="mt-2 max-w-[60ch] text-xs italic text-ink-faint">{project.notes}</p>}
            <Attribution project={project} variant="chips" className="mt-3" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          {/* Owners and admins only — the log records what colleagues have done
              on this project, so it sits with team administration. FR-66. */}
          {canRole(me.role, 'admin') && (
            <Link href={`/projects/${project.id}/log`}>
              <Button variant="secondary">Log</Button>
            </Link>
          )}
          {canDelete && (
            <Button variant="secondary" onClick={() => setConfirmDelete(true)} className="hover:border-danger/60 hover:text-danger">Delete</Button>
          )}
        </div>
      </div>

      {/* Overview */}
      <section className="mt-6">
        <SectionHeader title="Overview" help="The worst signal across all of this client's URLs." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile k="Contact form" tone={rollup.formLevel ? FORM_TONE[rollup.formLevel] : undefined}
            v={rollup.formLevel ? FORM_WORD[rollup.formLevel] : '—'} s={rollup.monitored ? 'monitored' : 'from last result'} />
          <Tile k="Uptime" tone={rollup.upState ? UP_TONE[rollup.upState] : undefined}
            v={rollup.upState ? UP_LABEL[rollup.upState] : '—'} />
          <Tile k="SSL expiry" tone={expiryTone(rollup.sslSoonest)}
            v={rollup.sslSoonest != null ? `${rollup.sslSoonest}d` : '—'} s={rollup.sslSoonest != null && rollup.sslSoonest <= 30 ? 'renew soon' : undefined} />
          <Tile k="Domain expiry" tone={expiryTone(rollup.domainSoonest)}
            v={rollup.domainSoonest != null ? `${rollup.domainSoonest}d` : '—'} />
        </div>

        {attention.length > 0 && (
          <div className="mt-3 rounded-xl bg-warn/10 p-3.5 ring-1 ring-warn/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-warn">Needs attention</p>
            <ul className="mt-2 space-y-1">
              {attention.map((a) => (
                <li key={a.url} className="text-[13px] text-ink-secondary">
                  <span className="font-medium text-ink">{a.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span> — {a.reasons.join(' · ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* URLs & monitors */}
      <section className="mt-7">
        <SectionHeader title="URLs & monitors" help="Every page we watch for this client, and what each tool found." />
        {project.health.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
            No URLs in this project yet — use <strong className="text-ink-secondary">Edit</strong> to add some.
          </p>
        ) : (
          <>
            {project.health.length > 3 && (
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search URLs…"
                aria-label="Search URLs"
                className="mb-3 w-full rounded-lg border border-line bg-panel/50 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/30 sm:max-w-sm"
              />
            )}
            {shownHealth.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
                No URLs match “{filter.trim()}”.
              </p>
            ) : (
              <div className="space-y-2.5">
                {shownHealth.map((h) => (
                  <UrlHealthDetail
                    key={h.url}
                    h={h}
                    dashboardHref={`/projects/${project.id}/url/${encodeUrlKey(matchKey(h.url))}`}
                    onRemove={canDelete ? () => { setRemoveUrlError(null); setRemoveUrl(h.url); } : undefined}
                    onDelete={canDelete ? () => { setDeleteUrlError(null); setDeleteUrl(h.url); } : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Global share link — one public page covering ALL the client's URLs */}
      <section id="share" className="mt-7 scroll-mt-6">
        <SectionHeader title="Global share link" help="One live, non-technical page covering ALL of this client's URLs — no login needed. To share a single URL instead, use its own dashboard's share link." />
        <ShareStatusControl projectId={project.id} initialToken={project.shareToken} canManage={canEdit} />
      </section>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit project" size="lg">
        <ProjectForm project={project} canRemoveUrls={canDelete} onSaved={(r) => { setEditing(false); if (r?.projectDeleted) router.push('/projects'); else void load(); }} onCancel={() => setEditing(false)} />
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        variant="danger"
        title={`Delete “${project.name}”?`}
        confirmLabel="Delete project"
        message={
          <>
            Deletes <strong className="text-ink-secondary">{project.name}</strong> and everything for its {count} URL
            {count === 1 ? '' : 's'}:
            <ul className="mt-2 space-y-1 list-disc pl-5 text-ink-muted">
              <li>
                <strong className="text-ink-secondary">Stops</strong> its Form Watch, Site Watch and any running change watch
              </li>
              <li>Deletes their run history, last results and uptime history</li>
              <li>Deletes change tracking — reports, timeline and saved snapshots</li>
            </ul>
            <span className="mt-2 block">
              Unlike stopping a single test, this{' '}
              <strong className="text-ink-secondary">does remove the results from Projects</strong>.{' '}
              <strong className="text-danger">Can&apos;t be undone.</strong>
            </span>
            {deleteError && (
              <span className="mt-3 block rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                {deleteError}
              </span>
            )}
          </>
        }
        onConfirm={doDelete}
        onCancel={() => { setConfirmDelete(false); setDeleteError(null); }}
      />

      <ConfirmDialog
        open={deleteUrl !== null}
        variant="danger"
        title="Delete this URL and all its data?"
        confirmLabel="Delete URL"
        message={
          <>
            <p className="break-all font-mono text-[11px] text-ink-secondary">{deleteUrl}</p>
            <p className="mt-2">Permanently deletes everything for this one URL:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
              <li><strong className="text-ink-secondary">Stops</strong> its Form Watch &amp; Site Watch and clears their history</li>
              <li>Deletes its last results and uptime history</li>
              <li>Deletes its change tracking — reports, timeline and snapshots (unless another URL shares the same site)</li>
              <li>Turns off any client share link for this URL</li>
            </ul>
            {project && project.urls.length <= 1 && (
              <span className="mt-2 block rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                This is the <strong>only URL</strong> in this project — deleting it will remove the
                whole project too.
              </span>
            )}
            <span className="mt-2 block">
              This is <strong className="text-ink-secondary">not</strong> the same as removing it via Edit
              (which just moves it to Unassigned and keeps the data).{' '}
              <strong className="text-danger">Can&apos;t be undone.</strong>
            </span>
            {deleteUrlError && (
              <span className="mt-3 block rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                {deleteUrlError}
              </span>
            )}
          </>
        }
        onConfirm={doDeleteUrl}
        onCancel={() => { setDeleteUrl(null); setDeleteUrlError(null); }}
      />

      <ConfirmDialog
        open={removeUrl !== null}
        variant="edit"
        title="Remove this URL from the project?"
        confirmLabel="Remove URL"
        message={
          <>
            <p className="break-all font-mono text-[11px] text-ink-secondary">{removeUrl}</p>
            {removeHasActivity ? (
              <p className="mt-2">
                This URL has test/monitor activity, so removing it{' '}
                <strong className="text-ink-secondary">keeps all its data</strong> — its monitors keep running and it
                moves to <strong className="text-ok">Unassigned</strong> (on the Projects page), where you
                can reassign it to another project later.
              </p>
            ) : (
              <p className="mt-2">
                This URL has <strong className="text-ink-secondary">no test or monitor activity yet</strong>, so removing
                it simply takes it out of the project. There&apos;s nothing to keep, so it{' '}
                <strong className="text-ink-secondary">won&apos;t appear in Unassigned</strong> — you&apos;d just add it
                again if you need it.
              </p>
            )}
            {project && project.urls.length <= 1 && (
              <span className="mt-2 block rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                This is the <strong>only URL</strong> — removing it will delete the (now-empty) project.
                {removeHasActivity ? ' Its data is still kept.' : ''}
              </span>
            )}
            {removeUrlError && (
              <span className="mt-3 block rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                {removeUrlError}
              </span>
            )}
          </>
        }
        onConfirm={doRemoveUrl}
        onCancel={() => { setRemoveUrl(null); setRemoveUrlError(null); }}
      />
    </main>
  );
}
