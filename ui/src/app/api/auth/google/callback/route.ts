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
  resolveOrigin,
  OAUTH_STATE_COOKIE,
} from '@/lib/googleOAuth';

export const runtime = 'nodejs';
// Must run per-request: reads OAuth code/state, cookies and request headers.
export const dynamic = 'force-dynamic';

/** Bounce back to /login with a short error code shown to the user. */
function loginError(request: NextRequest, code: string): NextResponse {
  // Build absolute URL from the PUBLIC origin (x-forwarded-host) — without
  // this, Railway's reverse proxy makes us redirect to the container's
  // internal http://localhost:8080 instead of the user's actual URL.
  const url = `${resolveOrigin(request)}/login?error=${encodeURIComponent(code)}`;
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
  let name: string | undefined;
  let picture: string | undefined;
  try {
    const accessToken = await exchangeCodeForToken(code, redirectUri(request));
    const info = await fetchUserInfo(accessToken);
    email = (info.email ?? '').toLowerCase();
    emailVerified = info.email_verified === true;
    name = info.name;
    picture = info.picture;
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

  // Success — mint the SAME signed session cookie the rest of the app trusts,
  // now carrying the Google display name + avatar so the UI can show them.
  const token = await signSession(email, { name, picture });
  const maxAge = sessionDurationDays() * 24 * 60 * 60;

  // Only redirect to safe, same-origin relative paths.
  const dest =
    storedRedirect.startsWith('/') && !storedRedirect.startsWith('//') ? storedRedirect : '/';
  // Build absolute URL from the PUBLIC origin (x-forwarded-host) — without
  // this, Railway's reverse proxy makes us redirect to the container's
  // internal http://localhost:8080 instead of the user's actual URL.
  const origin = resolveOrigin(request);
  const res = NextResponse.redirect(`${origin}${dest}`);
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  // Clear the one-time state cookie.
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}
