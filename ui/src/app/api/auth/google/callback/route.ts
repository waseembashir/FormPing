import { NextRequest, NextResponse } from 'next/server';
import {
  googleAuthEnabled,
  isEmailDomainAllowed,
  signSession,
  sessionDurationDays,
  SESSION_COOKIE_NAME,
} from '@/lib/session';
import {
  exchangeCodeForToken,
  fetchUserInfo,
  redirectUri,
  OAUTH_STATE_COOKIE,
} from '@/lib/googleOAuth';

export const runtime = 'nodejs';
// Must run per-request: reads OAuth code/state, cookies and request headers.
export const dynamic = 'force-dynamic';

/** Bounce back to /login with a short error code shown to the user. */
function loginError(request: NextRequest, code: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?error=${encodeURIComponent(code)}`;
  const res = NextResponse.redirect(url);
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}

/**
 * GET /api/auth/google/callback
 *
 * Google redirects here with `code` + `state`. We verify the CSRF state,
 * exchange the code for the user's email, enforce the domain allow-list,
 * and — only if everything checks out — mint the standard signed session
 * cookie and send the user to their original destination.
 */
export async function GET(request: NextRequest) {
  if (!googleAuthEnabled()) {
    return NextResponse.json({ error: 'Google auth is not configured' }, { status: 404 });
  }

  const params = request.nextUrl.searchParams;

  // Google reports user-cancel / config errors via ?error=...
  if (params.get('error')) {
    return loginError(request, 'google_denied');
  }

  const code = params.get('code');
  const returnedState = params.get('state');
  if (!code || !returnedState) {
    return loginError(request, 'missing_code');
  }

  // ── CSRF: the state echoed by Google must match the one we stored ──
  const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? '';
  const [storedState, storedRedirect = '/'] = stateCookie.split('|');
  if (!storedState || storedState !== returnedState) {
    return loginError(request, 'state_mismatch');
  }

  let email: string;
  let emailVerified: boolean;
  try {
    const accessToken = await exchangeCodeForToken(code, redirectUri(request));
    const info = await fetchUserInfo(accessToken);
    email = (info.email ?? '').toLowerCase();
    emailVerified = info.email_verified === true;
  } catch {
    return loginError(request, 'google_error');
  }

  if (!email || !emailVerified) {
    return loginError(request, 'email_unverified');
  }

  // ── The core requirement: only allow-listed domains get in ──
  if (!isEmailDomainAllowed(email)) {
    return loginError(request, 'domain_not_allowed');
  }

  // Success — mint the SAME signed session cookie the rest of the app trusts.
  const token = await signSession(email);
  const maxAge = sessionDurationDays() * 24 * 60 * 60;

  // Only redirect to safe, same-origin relative paths.
  const dest =
    storedRedirect.startsWith('/') && !storedRedirect.startsWith('//') ? storedRedirect : '/';
  const url = request.nextUrl.clone();
  url.pathname = dest;
  url.search = '';

  const res = NextResponse.redirect(url);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  // Clear the one-time state cookie.
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
