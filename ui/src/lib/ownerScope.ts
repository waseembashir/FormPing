/**
 * Whose view a request is, for the tool tabs that show only your own work.
 *
 * Kept apart from `ownership.ts` on purpose: that module is pure and is
 * imported by tests that must not drag in Next, the session layer or the
 * database. This one needs the request, so it lives here.
 */

import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/authorize';
import { perUserIsolationEnabled } from '@/lib/featureFlags';

/**
 * The signed-in user's email when the tool tabs should be scoped to them, or
 * `undefined` when they should not be scoped at all.
 *
 * Undefined in two cases, and both have to mean "show everything":
 *
 *   - the feature is off, which is the default everywhere
 *   - nobody is signed in, which is how local development runs, because the
 *     auth gate is open when Google credentials are not configured
 *
 * The second is the one worth stating. Without it, turning the flag on with an
 * open gate would filter every tab against a user who does not exist, and each
 * one would go empty — the app would look broken in exactly the configuration
 * it is developed in.
 */
export async function ownerScope(request: NextRequest): Promise<string | undefined> {
  if (!perUserIsolationEnabled()) return undefined;
  return (await currentUser(request))?.email || undefined;
}
