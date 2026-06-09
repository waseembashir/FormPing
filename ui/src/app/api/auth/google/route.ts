import { NextRequest, NextResponse } from 'next/server';
import { googleAuthEnabled } from '@/lib/session';
import { buildAuthUrl, redirectUri, OAUTH_STATE_COOKIE } from '@/lib/googleOAuth';

export const runtime = 'nodejs';
// Must run per-request: mints fresh CSRF state and reads request headers.
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google
 *
 * Kicks off the Google OAuth flow: mints a CSRF `state`, stashes it (plus the
 * post-login redirect target) in a short-lived httpOnly cookie, and redirects
 * the browser to Google's consent screen.
 */
export async function GET(request: NextRequest) {
  if (!googleAuthEnabled()) {
    return NextResponse.json({ error: 'Google auth is not configured' }, { status: 404 });
  }

  // Only allow relative, same-origin redirect targets — never an absolute URL.
  // Prevents this endpoint from being abused as an open redirector.
  const requested = request.nextUrl.searchParams.get('redirect') ?? '/';
  const safeRedirect = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const state = crypto.randomUUID();
  const authUrl = buildAuthUrl(redirectUri(request), state);

  const res = NextResponse.redirect(authUrl);
  // Carry both the CSRF state and where to land after login. Verified in the
  // callback. SameSite=Lax so the cookie survives the top-level GET redirect
  // back from Google.
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: `${state}|${safeRedirect}`,
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes to complete the round-trip
  });
  return res;
}
