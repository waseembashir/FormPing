/**
 * Cookie-based auth gate for the entire app.
 *
 * - If AUTH_USER + AUTH_PASSWORD env vars are set, the app is gated:
 *   any request without a valid session cookie gets redirected to /login.
 * - If those env vars are NOT set, the gate is OPEN (useful for local dev).
 *
 * Backward compat: BASIC_AUTH_USER / BASIC_AUTH_PASSWORD are still read
 * if the new names aren't present, so existing Railway env vars keep
 * working without renaming.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { authEnabled, verifySession, SESSION_COOKIE_NAME } from '@/lib/session';

export async function middleware(req: NextRequest) {
  // Open gate when auth env vars aren't configured (local dev).
  if (!authEnabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;

  // Always allow the login page and login/logout API routes through without
  // a session cookie — otherwise users could never log in.
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  if (session) return NextResponse.next();

  // Not authenticated. For API routes, return 401 JSON so client code can
  // detect it cleanly. For page navigations, redirect to /login with the
  // current path as ?redirect=... so we can bounce them back after login.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  // Preserve where they were trying to go so we can redirect back after login.
  loginUrl.search = `?redirect=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

// Apply to everything except Next.js internals, static assets, and the
// health check (Railway / Docker orchestrators need to hit /api/health
// without supplying credentials).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
