'use client';

import { useCallback, useEffect, useState } from 'react';
import { readTab, writeTab, TAB_KEYS } from '@/lib/tabCache';
import { ROLE_LABEL, type Role } from '@/lib/auth/roles';
import { refreshMe } from '@/lib/auth/useMe';
import { BugInbox } from '@/components/team/BugInbox';
import { Button, ConfirmDialog, PageHeader, Tabs } from '@/components/ui';

interface TeamUser {
  email: string;
  role: Role;
  name: string | null;
  picture: string | null;
}
interface Me {
  email: string;
  role: Role;
}

const ROLE_HELP: Record<Role, string> = {
  owner: 'Full control, plus manages admins and can hand over ownership.',
  admin: 'Full app, including deleting projects and managing members and viewers.',
  member: 'Add URLs, run and edit monitors, view everything. No delete, no managing people.',
  viewer: 'Read-only.',
};

export default function TeamPage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<TeamUser | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState<TeamUser | null>(null);
  const [tab, setTab] = useState<'members' | 'bugs'>('members');

  const load = useCallback(async () => {
    // Render the roster this tab last held, then refresh behind it. FR-105.
    const remembered = readTab<{ users: TeamUser[]; me: Me | null }>(TAB_KEYS.team);
    if (remembered) {
      setUsers(remembered.users);
      setMe(remembered.me);
      setState('ready');
    }
    try {
      const res = await fetch('/api/users', { cache: 'no-store' });
      // A refused request is never softened by the cache: losing access must
      // show as losing access, not as the roster someone saw a minute ago.
      if (res.status === 401 || res.status === 403) return setState('forbidden');
      if (!res.ok) return setState(remembered ? 'ready' : 'error');
      const data = await res.json();
      const next = { users: Array.isArray(data?.users) ? data.users : [], me: data?.me ?? null };
      setUsers(next.users);
      setMe(next.me);
      writeTab(TAB_KEYS.team, next);
      setState('ready');
    } catch {
      if (!remembered) setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const meOwner = me?.role === 'owner';

  /** Roles this actor may assign to a given row (owner is never in the list — that's transfer). */
  function assignableRoles(target: TeamUser): Role[] {
    const base: Role[] = ['viewer', 'member'];
    if (meOwner) base.push('admin');
    // Ensure the row's current role is shown even if it's admin and we're an admin
    // (we can't change it, but the select shouldn't hide the truth).
    if (!base.includes(target.role) && target.role !== 'owner') base.push(target.role);
    return base;
  }

  function canEditRow(u: TeamUser): boolean {
    if (!me) return false;
    if (u.email === me.email) return false; // never your own role
    if (u.role === 'owner') return false; // owner is transfer-only
    if (meOwner) return true;
    // an admin may only manage members/viewers
    return me.role === 'admin' && (u.role === 'member' || u.role === 'viewer');
  }

  async function changeRole(u: TeamUser, next: Role) {
    setBusyEmail(u.email);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, role: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? 'Could not change that role.');
      await load();
    } finally {
      setBusyEmail(null);
    }
  }

  async function doRemove(u: TeamUser) {
    setBusyEmail(u.email);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? 'Could not remove that user.');
      await load();
    } finally {
      setBusyEmail(null);
      setConfirmRemove(null);
    }
  }

  async function doTransfer(u: TeamUser) {
    setBusyEmail(u.email);
    setError(null);
    try {
      const res = await fetch('/api/users/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? 'Could not transfer ownership.');
      } else {
        // Ownership changed — the header's cached role is now stale.
        await refreshMe();
      }
      await load();
    } finally {
      setBusyEmail(null);
      setConfirmTransfer(null);
    }
  }

  if (state === 'loading') {
    return (
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-8">
        <div className="fp-skeleton h-6 w-40 rounded" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="fp-skeleton h-16 rounded-lg" />)}
        </div>
      </main>
    );
  }

  if (state === 'forbidden') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h1 className="text-lg font-semibold text-ink">Admins only</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Managing team &amp; access is available to admins and the owner. If you need a role
          change, ask an admin or the owner.
        </p>
      </main>
    );
  }

  if (state === 'error') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h1 className="text-lg font-semibold text-ink">Couldn’t load the team</h1>
        <Button variant="secondary" size="sm" onClick={() => { setState('loading'); void load(); }} className="mt-3">
          Try again
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-20 pt-8">
      <PageHeader
        title="Team & access"
        description="Who can do what in FormPing, plus bug reports sent from the app."
      />
      <div className="mt-4 border-b border-line pb-4">
        <Tabs
          items={[
            { value: 'members', label: 'Members & roles' },
            { value: 'bugs', label: 'Bug reports' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'members' && (
      <>
      <p className="mt-4 text-sm text-ink-muted">
        New sign-ins from an allowed domain start as{' '}
        <strong className="text-ink-secondary">Member</strong>. Only the owner manages admins or
        hands over ownership.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-panel/60">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.email === me?.email;
              const editable = canEditRow(u);
              const busy = busyEmail === u.email;
              return (
                <tr key={u.email} className="border-t border-line/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {u.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-accent to-accent-strong text-[11px] font-semibold text-white">
                          {(u.name || u.email).charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-ink">
                          {u.name || u.email}
                          {isSelf && <span className="ml-1.5 text-[11px] text-ink-faint">(you)</span>}
                        </div>
                        {u.name && <div className="truncate text-xs text-ink-faint">{u.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'owner' ? (
                      <span title={ROLE_HELP.owner} className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent ring-1 ring-accent/25">
                        Owner
                      </span>
                    ) : editable ? (
                      <select
                        value={u.role}
                        disabled={busy}
                        onChange={(e) => void changeRole(u, e.target.value as Role)}
                        title={ROLE_HELP[u.role]}
                        className="rounded-md border border-line-strong bg-ground px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                      >
                        {assignableRoles(u).map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span title={ROLE_HELP[u.role]} className="text-xs font-medium text-ink-secondary">{ROLE_LABEL[u.role]}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {meOwner && !isSelf && u.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => setConfirmTransfer(u)}
                          disabled={busy}
                          className="inline-flex items-center rounded-md border border-line-strong bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-secondary transition-colors hover:border-accent/60 hover:text-accent disabled:opacity-40"
                          title="Make this person the owner (you become an admin)"
                        >
                          Make owner
                        </button>
                      )}
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(u)}
                          disabled={busy}
                          className="inline-flex items-center rounded-md border border-line-strong bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-secondary transition-colors hover:border-danger/60 hover:text-danger disabled:opacity-40"
                          title="Remove this user (they revert to Member on next sign-in)"
                        >
                          Remove
                        </button>
                      )}
                      {!editable && !(meOwner && !isSelf && u.role !== 'owner') && (
                        <span className="text-[11px] text-ink-faint">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        Removing a user only clears their saved role — they can still sign in (as a Member) if their
        email domain is allowed. To block sign-in entirely, change the allowed domains.
      </p>
      </>
      )}

      {tab === 'bugs' && <BugInbox />}

      <ConfirmDialog
        open={!!confirmRemove}
        variant="danger"
        title={confirmRemove ? `Remove ${confirmRemove.name || confirmRemove.email}?` : ''}
        confirmLabel="Remove user"
        message={<>Clears their saved role. They revert to <strong className="text-ink-secondary">Member</strong> if they sign in again (assuming their domain is allowed). No projects or data are affected.</>}
        onConfirm={() => { if (confirmRemove) return doRemove(confirmRemove); }}
        onCancel={() => setConfirmRemove(null)}
      />

      <ConfirmDialog
        open={!!confirmTransfer}
        variant="edit"
        title={confirmTransfer ? `Make ${confirmTransfer.name || confirmTransfer.email} the owner?` : ''}
        confirmLabel="Transfer ownership"
        message={
          <>
            <strong className="text-ink-secondary">{confirmTransfer?.name || confirmTransfer?.email}</strong>{' '}
            becomes the owner and <strong className="text-ink-secondary">you become an admin</strong>. This
            changes only roles — it never touches projects or data. The new owner can hand it back to
            you. Continue?
          </>
        }
        onConfirm={() => { if (confirmTransfer) return doTransfer(confirmTransfer); }}
        onCancel={() => setConfirmTransfer(null)}
      />
    </main>
  );
}
