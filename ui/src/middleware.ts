/**
 * Cookie-based auth gate for the entire app.
 *
 * - If password auth (AUTH_USER + AUTH_PASSWORD) OR Google auth
 *   (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) is configured, the app is
 *   gated: any request without a valid session cookie is redirected to /login.
 * - If neither is configured, the gate is OPEN (useful for local dev).
 *
 * Backward compat: BASIC_AUTH_USER / BASIC_AUTH_PASSWORD are still read
 * if the new names aren't present, so existing Railway env vars keep
 * working without renaming.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { gateEnabled, verifySession, SESSION_COOKIE_NAME } from '@/lib/session';

// Next.js metadata file-convention routes that must stay publicly reachable
// (see the PUBLIC_ASSETS check below). Kept in sync with the icon/image files
// in src/app: icon.svg, apple-icon.png, opengraph-image.png, twitter-image.png.
const PUBLIC_ASSETS = new Set([
  '/icon.svg',
  '/apple-icon.png',
  '/opengraph-image.png',
  '/twitter-image.png',
]);

export async function middleware(req: NextRequest) {
  // Open gate when neither password nor Google auth is configured (local dev).
  if (!gateEnabled()) return NextResponse.next();

  const { pathname, search } = req.nextUrl;

  // Always allow the login page and login/logout API routes through without
  // a session cookie — otherwise users could never log in.
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Public per-client status pages (opt-in share tokens). Both the page and its
  // data API are intentionally reachable WITHOUT a session so a client can open
  // the link. They only ever return client-safe data for a valid, un-revoked
  // token — an unknown/revoked token yields a 404 (see /api/status/[token]).
  if (pathname.startsWith('/status/') || pathname.startsWith('/api/status/')) {
    return NextResponse.next();
  }

  // Public SEO/brand assets (favicon + social share images). These must be
  // reachable WITHOUT a session so external crawlers (Slackbot, Twitter,
  // Google) can fetch the Open Graph image and favicon to render link
  // unfurls. They contain only public brand artwork — no app data.
  if (PUBLIC_ASSETS.has(pathname)) {
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
