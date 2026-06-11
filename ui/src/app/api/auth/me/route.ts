import { NextRequest, NextResponse } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME } from '@/lib/session';

export const runtime = 'nodejs';
// Reads the per-request session cookie — never cache.
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 *
 * Returns the signed-in user's profile (email + Google name/avatar) for the
 * header to display. Returns `{ user: null }` when not signed in, so the
 * client can handle both states without treating "logged out" as an error.
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);

  if (!session) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: session.user,
    name: session.name ?? null,
    picture: session.picture ?? null,
  });
}
