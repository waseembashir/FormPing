'use client';

import { useCallback, useState } from 'react';
import type { Project } from '@/lib/projects/types';
import { urlKey } from '@/lib/projects/projectStore';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/**
 * Add / edit a project. ONE form for both (DRY): pass `project` to edit, omit to
 * add. Owns the FR-17 "you removed URLs" warning so removing a URL on save can't
 * silently drop its monitor. Calls `onSaved` after a successful write.
 */
export function ProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project?: Project | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? '');
  const [urlsText, setUrlsText] = useState((project?.urls ?? []).join('\n'));
  const [notes, setNotes] = useState(project?.notes ?? '');
  const [contact, setContact] = useState(project?.contact ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const originalUrls = project?.urls ?? [];

  const parsedUrls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean);
  const removedUrls = editing
    ? originalUrls.filter((o) => !parsedUrls.some((n) => urlKey(n) === urlKey(o)))
    : [];

  const doSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/projects/${project!.id}` : '/api/projects', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          urls: parsedUrls,
          notes: notes.trim() || undefined,
          contact: contact.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || (editing ? 'Could not save changes' : 'Could not create project'));
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSaving(false);
      setConfirmEdit(false);
    }
  }, [editing, project, name, parsedUrls, notes, contact, onSaved]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Enter a project name');
      return;
    }
    if (editing && removedUrls.length > 0) {
      setConfirmEdit(true);
      return;
    }
    void doSave();
  }

  const input =
    'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40';
  const label = 'block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5';
  const urlCount = parsedUrls.length;

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className={label}>Client / project name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." disabled={saving} className={input} autoFocus />
        <label className={`${label} mt-3`}>Notes <span className="normal-case text-slate-600">(optional)</span></label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth noting" disabled={saving} className={input} />
        <label className={`${label} mt-3`}>Contact <span className="normal-case text-slate-600">(optional — email / Slack / name)</span></label>
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="who to notify — e.g. dev@client.com" disabled={saving} className={input} />
      </div>
      <div>
        <label className={label}>URLs to track</label>
        <textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          rows={5}
          placeholder={'https://acme.com\nhttps://acme.com/contact\nhttps://acme.com/pricing'}
          disabled={saving}
          className={`${input} font-mono`}
        />
        <p className="mt-1 text-[11px] text-slate-600">
          One per line — every page or site for this client (homepage, contact page, landing pages…).
          {urlCount > 0 ? ` ${urlCount} URL${urlCount === 1 ? '' : 's'}.` : ''}
        </p>
      </div>
      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300 sm:col-span-2">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={saving || name.trim().length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add project'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>

      <ConfirmDialog
        open={confirmEdit}
        variant="edit"
        title={`Remove ${removedUrls.length} URL${removedUrls.length === 1 ? '' : 's'} from this project?`}
        confirmLabel="Save changes"
        message={
          <>
            <p>These leave <strong className="text-slate-300">{name.trim()}</strong>:</p>
            <ul className="mt-1.5 space-y-0.5">
              {removedUrls.map((u) => (
                <li key={u} className="break-all font-mono text-[11px] text-amber-200/80">{u}</li>
              ))}
            </ul>
            <p className="mt-2">
              Nothing is deleted — their monitors keep running and results are kept. The URLs move to{' '}
              <strong className="text-slate-300">Unassigned</strong>, where you can reassign or dismiss them.
            </p>
          </>
        }
        onConfirm={doSave}
        onCancel={() => setConfirmEdit(false)}
      />
    </form>
  );
}
