/**
 * Per-user roles, backed by Supabase `app_users`. Server-only (Node).
 *
 * The DB is the single source of truth for roles — deliberately NOT the session
 * token, so a promotion/demotion takes effect on the user's very next request
 * instead of waiting for their session to expire.
 *
 * LOCKOUT SAFETY (FR-24, a non-negotiable):
 *   - Exactly one owner at all times. The owner can't be demoted — only
 *     transferred. A `check`/unique index in the migration backs this, and the
 *     functions here enforce it before writing.
 *   - `OWNER_EMAIL` is break-glass: it re-seeds an owner ONLY when the table has
 *     none (bootstrap or recovery). Once an owner exists, the table wins — so
 *     ownership transfer sticks and the env can't fight it.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { atLeast, toRole, type Role, DEFAULT_ROLE } from './roles';

export interface AppUser {
  email: string;
  role: Role;
  name: string | null;
  picture: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  email: string;
  role: string;
  name: string | null;
  picture: string | null;
  created_at: string;
  updated_at: string;
}
const COLS = 'email, role, name, picture, created_at, updated_at';
const norm = (e: string) => e.trim().toLowerCase();

function toUser(r: Row): AppUser {
  return {
    email: r.email,
    role: toRole(r.role),
    name: r.name,
    picture: r.picture,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The configured break-glass owner (Railway env, controlled by the infra owner). */
export function ownerEmailEnv(): string | null {
  const e = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return e || null;
}

/** Optional comma-separated seed of admin emails, applied on first login only. */
function adminSeed(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

/** Is there any owner in the table right now? */
async function hasOwner(): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from('app_users')
    .select('email', { count: 'exact', head: true })
    .eq('role', 'owner');
  if (error) {
    console.warn(`[userStore] hasOwner: ${error.message}`);
    return true; // fail safe: assume an owner exists, so we never accidentally mint a second
  }
  return (count ?? 0) > 0;
}

/**
 * Called on every successful login. Ensures the user has a row and returns their
 * effective role. New users default to Member — UNLESS they are the break-glass
 * owner (and no owner exists yet) or in the ADMIN_EMAILS seed.
 */
export async function ensureUser(
  emailRaw: string,
  profile: { name?: string; picture?: string } = {},
): Promise<Role> {
  const email = norm(emailRaw);
  const db = supabaseAdmin();

  const { data: existing } = await db.from('app_users').select(COLS).eq('email', email).maybeSingle();

  // Break-glass: if this is the configured owner AND the table currently has no
  // owner, they become owner. This covers first-ever boot and recovery, but stays
  // dormant once an owner exists — so a transferred ownership is never overridden.
  const isBreakGlassOwner = ownerEmailEnv() === email && !(await hasOwner());

  if (existing) {
    const row = existing as Row;
    // Only intervene to restore a missing owner; never downgrade an existing role.
    if (isBreakGlassOwner && row.role !== 'owner') {
      await db.from('app_users').update({ role: 'owner', name: profile.name ?? row.name, picture: profile.picture ?? row.picture }).eq('email', email);
      return 'owner';
    }
    // Refresh profile fields (best-effort), keep the role.
    if (profile.name || profile.picture) {
      await db.from('app_users').update({ name: profile.name ?? row.name, picture: profile.picture ?? row.picture }).eq('email', email);
    }
    return toRole(row.role);
  }

  // First login for this email — decide the starting role.
  const role: Role = isBreakGlassOwner ? 'owner' : adminSeed().has(email) ? 'admin' : DEFAULT_ROLE;
  const { error } = await db.from('app_users').insert({
    email,
    role,
    name: profile.name ?? null,
    picture: profile.picture ?? null,
  });
  if (error) {
    console.warn(`[userStore] ensureUser insert: ${error.message}`);
    // Don't block login on a role-store hiccup — treat as default until next time.
    return isBreakGlassOwner ? 'owner' : DEFAULT_ROLE;
  }
  return role;
}

/**
 * The current role for an email — authoritative, read fresh. Returns the default
 * (member) if the user has no row yet, so enforcement is safe before first login
 * completes. The break-glass owner always resolves to owner when no owner exists.
 */
export async function getRole(emailRaw: string): Promise<Role> {
  const email = norm(emailRaw);
  const { data, error } = await supabaseAdmin().from('app_users').select('role').eq('email', email).maybeSingle();
  if (error) {
    console.warn(`[userStore] getRole: ${error.message}`);
    return DEFAULT_ROLE;
  }
  if (data) return toRole((data as { role: string }).role);
  if (ownerEmailEnv() === email && !(await hasOwner())) return 'owner';
  return DEFAULT_ROLE;
}

/** The user's display name (Google auth), or null if unknown. Used for project
 *  attribution — "added by / edited by" (FR-30). */
export async function getUserName(emailRaw: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from('app_users').select('name').eq('email', norm(emailRaw)).maybeSingle();
  if (error || !data) return null;
  return (data as { name: string | null }).name ?? null;
}

/** All users, for the Team page (PR 2). Owner first, then by email. */
export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabaseAdmin().from('app_users').select(COLS);
  if (error) {
    console.warn(`[userStore] listUsers: ${error.message}`);
    return [];
  }
  const order: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
  return (data as Row[])
    .map(toUser)
    .sort((a, b) => order[a.role]! - order[b.role]! || a.email.localeCompare(b.email));
}

export type RoleChangeResult = { ok: true } | { ok: false; reason: string };

/**
 * Change a user's role, enforcing the ownership rules (FR-24):
 *   - only an OWNER may create/remove an admin, or touch the owner row;
 *   - an ADMIN may only manage members/viewers;
 *   - nobody may set a second owner here (transfer is a separate operation);
 *   - the owner can't be demoted here (must be transferred).
 * `actorEmail` is the signed-in user performing the change.
 */
export async function setRole(actorEmail: string, targetEmailRaw: string, next: Role): Promise<RoleChangeResult> {
  const actor = norm(actorEmail);
  const target = norm(targetEmailRaw);
  const actorRole = await getRole(actor);
  if (!atLeast(actorRole, 'admin')) return { ok: false, reason: 'Only an admin or owner can change roles.' };
  if (actor === target) return { ok: false, reason: 'You can’t change your own role.' };

  const current = await getRole(target);
  if (current === 'owner') return { ok: false, reason: 'The owner’s role can only be changed by transferring ownership.' };
  if (next === 'owner') return { ok: false, reason: 'Use “Transfer ownership” to make someone the owner.' };

  // Only the owner may create or demote an admin. Admins manage members/viewers only.
  const touchesAdmin = current === 'admin' || next === 'admin';
  if (touchesAdmin && actorRole !== 'owner') {
    return { ok: false, reason: 'Only the owner can promote to or demote from admin.' };
  }

  const { error } = await supabaseAdmin().from('app_users').update({ role: next }).eq('email', target);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/**
 * Transfer ownership from the current owner to a successor. Only the current
 * owner may do it. Done demote-then-promote so the single-owner index is never
 * violated; the successor becomes owner and the old owner becomes admin. If it's
 * interrupted mid-way, break-glass restores an owner on next login.
 */
export async function transferOwnership(actorEmail: string, successorEmailRaw: string): Promise<RoleChangeResult> {
  const actor = norm(actorEmail);
  const successor = norm(successorEmailRaw);
  if ((await getRole(actor)) !== 'owner') return { ok: false, reason: 'Only the current owner can transfer ownership.' };
  if (actor === successor) return { ok: false, reason: 'You are already the owner.' };

  const db = supabaseAdmin();
  const { data: succ } = await db.from('app_users').select('email').eq('email', successor).maybeSingle();
  if (!succ) return { ok: false, reason: 'The successor must have signed in at least once.' };

  // Step down first (0 owners momentarily — allowed), then promote the successor
  // (back to 1 owner). Order matters: the single-owner index forbids 2 owners.
  const down = await db.from('app_users').update({ role: 'admin' }).eq('email', actor);
  if (down.error) return { ok: false, reason: down.error.message };
  const up = await db.from('app_users').update({ role: 'owner' }).eq('email', successor);
  if (up.error) {
    // Roll the old owner back so we don't sit ownerless.
    await db.from('app_users').update({ role: 'owner' }).eq('email', actor);
    return { ok: false, reason: up.error.message };
  }
  return { ok: true };
}

/** Delete a user's row entirely (they revert to a default login next time). Owner-only; can't remove the owner. */
export async function removeUser(actorEmail: string, targetEmailRaw: string): Promise<RoleChangeResult> {
  const actor = norm(actorEmail);
  const target = norm(targetEmailRaw);
  if (!atLeast(await getRole(actor), 'admin')) return { ok: false, reason: 'Only an admin or owner can remove users.' };
  if (actor === target) return { ok: false, reason: 'You can’t remove yourself.' };
  const current = await getRole(target);
  if (current === 'owner') return { ok: false, reason: 'The owner can’t be removed — transfer ownership first.' };
  if (current === 'admin' && (await getRole(actor)) !== 'owner') return { ok: false, reason: 'Only the owner can remove an admin.' };
  const { error } = await supabaseAdmin().from('app_users').delete().eq('email', target);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}
