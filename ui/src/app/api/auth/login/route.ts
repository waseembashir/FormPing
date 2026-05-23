import { NextRequest, NextResponse } from 'next/server';
import {
  authEnabled,
  authUser,
  authPassword,
  signSession,
  constantTimeEqual,
  sessionDurationDays,
  SESSION_COOKIE_NAME,
} from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * Returns: 200 + session cookie set, or 401 on failed login.
 *
 * Constant-time comparison + identical 401 for unknown-user vs wrong-pass
 * cases to avoid user-enumeration timing leaks.
 */
export async function POST(request: NextRequest) {
  // If auth is disabled (no AUTH_USER/AUTH_PASSWORD set), accept any login
  // and don't bother minting a cookie. This matches the middleware which
  // also opens the gate when auth env vars are missing.
  if (!authEnabled()) {
    return NextResponse.json({ ok: true, authEnabled: false });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (username.length === 0 || password.length === 0) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const expectedUser = authUser();
  const expectedPass = authPassword();

  // Constant-time compare both, always — even if username is wrong, still
  // run the password comparison to keep response time uniform.
  const userOk = constantTimeEqual(username, expectedUser);
  const passOk = constantTimeEqual(password, expectedPass);

  if (!userOk || !passOk) {
    // Single generic error to avoid leaking which field was wrong.
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const token = await signSession(expectedUser);
  const maxAge = sessionDurationDays() * 24 * 60 * 60;
  const isHttps = request.nextUrl.protocol === 'https:';

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return res;
}
