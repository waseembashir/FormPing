'use client';

import { useCallback, useState } from 'react';
import type { Project } from '@/lib/projects/types';
import { urlKey, matchKey } from '@/lib/projects/projectStore';
import { checkUrl } from '@/lib/urlCheck';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/** Format check: a parseable http(s) URL with a real (dotted) hostname. */
function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return /^https?:$/.test(u.protocol) && u.hostname.includes('.');
  } catch {
    return false;
  }
}

interface DupWarning {
  /** URLs that didn't respond — a soft "add anyway" (a live site can be briefly down). */
  unreachable: string[];
}

/**
 * Add / edit a project. ONE form for both (DRY): pass `project` to edit, omit to
 * add. URLs are entered as individual fields (add/remove rows) with inline format
 * validation. On save it warns about URLs already in another project or that
 * don't respond (soft — "Add anyway"), and about removed URLs on edit (FR-17).
 */
export function ProjectForm({
  project,
  onSaved,
  onCancel,
  canRemoveUrls = true,
}: {
  project?: Project | null;
  onSaved: (result?: { projectDeleted?: boolean }) => void;
  onCancel: () => void;
  /** Whether the user may remove EXISTING URLs (Admin+ only, FR-37). When false,
   *  original URL rows are locked (read-only, no remove) but new URLs can be added. */
  canRemoveUrls?: boolean;
}) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? '');
  const [urls, setUrls] = useState<string[]>(() => {
    const initial = project?.urls ?? [];
    return initial.length ? [...initial] : [''];
  });
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false); // reveal inline format errors after a save attempt
  const [confirmEdit, setConfirmEdit] = useState(false);
  const [warning, setWarning] = useState<DupWarning | null>(null);

  const originalUrls = project?.urls ?? [];
  const originalKeys = new Set(originalUrls.map(urlKey));
  // When the user can't remove URLs (Member/viewer), original rows are locked so
  // they can add but not take existing ones out (the server also enforces this).
  const lockRemovals = editing && !canRemoveUrls;
  const filledUrls = urls.map((u) => u.trim()).filter(Boolean);
  const removedUrls = editing
    ? originalUrls.filter((o) => !filledUrls.some((n) => urlKey(n) === urlKey(o)))
    : [];
  const invalidCount = urls.filter((u) => u.trim() && !isValidUrl(u)).length;

  const setUrlAt = (i: number, val: string) => setUrls((prev) => prev.map((u, idx) => (idx === i ? val : u)));
  const addRow = () => setUrls((prev) => [...prev, '']);
  const removeRow = (i: number) =>
    setUrls((prev) => (prev.length === 1 ? [''] : prev.filter((_, idx) => idx !== i)));

  const doSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/projects/${project!.id}` : '/api/projects', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          urls: filledUrls,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || (editing ? 'Could not save changes' : 'Could not create project'));
        return;
      }
      // Editing a project down to zero URLs deletes it (FR-27) — signal the parent.
      onSaved(data?.projectDeleted ? { projectDeleted: true } : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSaving(false);
      setConfirmEdit(false);
    }
  }, [editing, project, name, filledUrls, notes, onSaved]);

  // Save, after any warnings are resolved. On edit, still confirm removed URLs (FR-17).
  const proceed = useCallback(() => {
    if (editing && removedUrls.length > 0) {
      setConfirmEdit(true);
      return;
    }
    void doSave();
  }, [editing, removedUrls.length, doSave]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Enter a project name');
      return;
    }
    if (invalidCount > 0) {
      setShowErrors(true);
      setError(`Fix the highlighted URL${invalidCount === 1 ? '' : 's'} first.`);
      return;
    }
    // The same page can't be listed twice in one project.
    const seenKeys = new Set<string>();
    for (const u of filledUrls) {
      const k = matchKey(u);
      if (seenKeys.has(k)) {
        setError(`“${u}” is already in this project — the same URL can’t be added twice.`);
        return;
      }
      seenKeys.add(k);
    }
    if (filledUrls.length === 0) {
      proceed();
      return;
    }

    // Only the NEW URLs need the network checks — the ones already in this project
    // were validated when they were added, and (being in this project) can't clash
    // with another one. Skipping the unchanged URLs makes saving an edit fast, and
    // an edit that adds no URLs (renamed, edited notes, removed a URL) saves instantly.
    const newUrls = filledUrls.filter((u) => !originalUrls.some((o) => matchKey(o) === matchKey(u)));
    if (newUrls.length === 0) {
      proceed();
      return;
    }

    // Two checks on the new URLs: one already in ANOTHER project (matchKey-aware)
    // is a HARD block — one page belongs to one client. One that doesn't respond
    // is a SOFT warning (a live site can be briefly down) — "add anyway".
    setChecking(true);
    try {
      const qs = new URLSearchParams();
      newUrls.forEach((u) => qs.append('url', u));
      if (editing && project) qs.set('exclude', project.id);
      const [dupData, checks] = await Promise.all([
        fetch(`/api/projects/url-owners?${qs.toString()}`, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => ({ duplicates: [] })),
        Promise.all(newUrls.map((u) => checkUrl(u))),
      ]);
      const dups = Array.isArray(dupData?.duplicates) ? dupData.duplicates : [];
      const unreachable = checks.filter((c) => c.ok && !c.reachable).map((c) => c.input);
      if (dups.length > 0) {
        const d = dups[0];
        const owner = d?.projects?.[0]?.name ?? 'another project';
        setError(
          `“${d.url}” is already in “${owner}”. A URL can only be in one project — remove it there first, or edit that project.`,
        );
        return;
      }
      if (unreachable.length > 0) {
        setWarning({ unreachable });
        return;
      }
    } catch {
      /* checks failed — proceed anyway */
    } finally {
      setChecking(false);
    }
    proceed();
  }

  const input =
    'w-full bg-ground border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-40';
  const label = 'block text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5';

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 items-start gap-x-6 gap-y-4 md:grid-cols-5">
      <div className="md:col-span-2">
        <label className={label}>Client / project name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." disabled={saving} className={input} autoFocus />
        {/* The one thing about this field that is not obvious from it: the name
            is the heading on any status page shared with this client, so it is
            read by them and not only by us. Worth knowing BEFORE typing an
            internal nickname, which is why it sits under the input rather than
            being discovered later. */}
        <p className="mt-1.5 text-xs text-ink-faint">Shown to the client on any status page you share.</p>
        <label className={`${label} mt-4`}>Notes <span className="normal-case text-ink-faint">(optional)</span></label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth noting" disabled={saving} className={input} />
        <p className="mt-1.5 text-xs text-ink-faint">For your team. Never shown to the client.</p>
      </div>
      <div className="md:col-span-3">
        <label className={label}>
          URLs to track <span className="normal-case text-ink-faint">(this is what gets monitored)</span>
        </label>
        <div className="space-y-2">
          {urls.map((u, i) => {
            const invalid = showErrors && u.trim().length > 0 && !isValidUrl(u);
            const locked = lockRemovals && u.trim().length > 0 && originalKeys.has(urlKey(u.trim()));
            return (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <input
                    value={u}
                    onChange={(e) => setUrlAt(i, e.target.value)}
                    placeholder="https://acme.com/page"
                    disabled={saving || locked}
                    readOnly={locked}
                    aria-invalid={invalid}
                    title={locked ? 'Only an admin or owner can remove or change an existing URL' : undefined}
                    className={`${input} font-mono ${invalid ? 'border-danger focus:ring-danger' : ''}`}
                  />
                  {locked ? (
                    <span
                      title="Only an admin or owner can remove a URL"
                      aria-label="Locked — admins only"
                      className="flex shrink-0 items-center rounded-lg border border-line-strong px-2.5 py-2 text-ink-faint"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                        <path fillRule="evenodd" d="M10 1a3.5 3.5 0 00-3.5 3.5V7H6a2 2 0 00-2 2v6a2 2 0 002 2h8a2 2 0 002-2V9a2 2 0 00-2-2h-.5V4.5A3.5 3.5 0 0010 1zm2 6V4.5a2 2 0 10-4 0V7h4z" clipRule="evenodd" />
                      </svg>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={saving}
                      title="Remove this URL"
                      aria-label="Remove this URL"
                      className="shrink-0 rounded-lg border border-line-strong px-2.5 py-2 text-ink-faint hover:border-danger/60 hover:text-danger disabled:opacity-40"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                      </svg>
                    </button>
                  )}
                </div>
                {invalid && (
                  <p className="mt-1 text-[11px] text-danger">Not a valid URL — use https://domain.com</p>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={saving}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-soft disabled:opacity-40"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden><path d="M10 5a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 0110 5z" /></svg>
          Add URL
        </button>
        <p className="mt-2 text-[11px] text-ink-faint">
          One field per page or site for this client (homepage, contact page, landing pages…).
          {filledUrls.length > 0 ? ` ${filledUrls.length} URL${filledUrls.length === 1 ? '' : 's'}.` : ''}
        </p>
        {lockRemovals && (
          <p className="mt-1 text-[11px] text-warn/70">
            You can add URLs; removing an existing URL is restricted to admins &amp; owners.
          </p>
        )}
      </div>
      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger md:col-span-5">
          {error}
        </div>
      )}
      {/* A footer, not a row that happens to be last. Spanning the grid with a
          rule above it separates "what you are filling in" from "what you do
          next", and stops the buttons floating under whichever column happens
          to be taller — which, with one URL and three text fields, left them
          stranded beside a large empty space. */}
      <div className="flex items-center gap-2 border-t border-line pt-4 md:col-span-5">
        <button
          type="submit"
          disabled={saving || checking || name.trim().length === 0}
          className="rounded-lg bg-gradient-to-b from-accent to-accent-strong px-4 py-2 text-sm font-semibold text-white ring-1 ring-accent-soft/20 hover:brightness-110 disabled:opacity-40"
        >
          {checking ? 'Checking…' : saving ? 'Saving…' : editing ? 'Save changes' : 'Add project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-panel"
        >
          Cancel
        </button>
      </div>

      {/* Soft warning: unreachable URLs — Okay / Add anyway. (Duplicates are a hard
          block, handled inline above — a URL belongs to exactly one project.) */}
      <ConfirmDialog
        open={warning !== null}
        variant="edit"
        title="Some sites didn't respond"
        cancelLabel="Go back"
        confirmLabel="Add anyway"
        message={
          <>
            {warning && warning.unreachable.length > 0 && (
              <>
                <p>Couldn&apos;t reach (may be down or blocking automated checks):</p>
                <ul className="mt-1.5 space-y-1">
                  {warning.unreachable.map((u) => (
                    <li key={u} className="break-all font-mono text-[11px] text-warn/80">{u}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-2">A live site can be briefly down. Add anyway, or go back and check.</p>
          </>
        }
        onConfirm={() => {
          setWarning(null);
          proceed();
        }}
        onCancel={() => setWarning(null)}
      />

      <ConfirmDialog
        open={confirmEdit}
        variant="edit"
        title={`Remove ${removedUrls.length} URL${removedUrls.length === 1 ? '' : 's'} from this project?`}
        confirmLabel="Save changes"
        message={
          <>
            <p>These leave <strong className="text-ink-secondary">{name.trim()}</strong>:</p>
            <ul className="mt-1.5 space-y-0.5">
              {removedUrls.map((u) => (
                <li key={u} className="break-all font-mono text-[11px] text-warn/80">{u}</li>
              ))}
            </ul>
            <p className="mt-2">Nothing is deleted. What happens to each depends on whether it has activity:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-muted">
              <li>
                <strong className="text-ink-secondary">Tested or monitored</strong> → keeps all its data and its monitors
                keep running; it moves to <strong className="text-ok">Unassigned</strong> (on the Projects
                page) to reassign or dismiss.
              </li>
              <li>
                <strong className="text-ink-secondary">No activity yet</strong> → simply drops off — there&apos;s nothing to
                keep, so it won&apos;t appear in Unassigned.
              </li>
            </ul>
            {filledUrls.length === 0 && (
              <p className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                This removes <strong>every URL</strong> — the now-empty project will be deleted (its
                URLs still keep their data).
              </p>
            )}
          </>
        }
        onConfirm={doSave}
        onCancel={() => setConfirmEdit(false)}
      />
    </form>
  );
}
