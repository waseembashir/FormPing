/**
 * Lightweight Google OAuth 2.0 (Authorization Code) helpers.
 *
 * Deliberately dependency-free: we hand-roll the three OAuth steps (build
 * consent URL → exchange code for token → fetch userinfo) with `fetch`, then
 * hand the verified email back to the EXISTING signed-cookie session system
 * (see ./session). Nothing about the app's session model changes — Google is
 * just a new way to populate the same `fp_session` cookie.
 *
 * Only the route handlers under /api/auth/google import this file, so it is
 * free to assume the Node.js runtime (not Edge).
 *
 * Required env vars (gate stays closed until both are present):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 * Optional:
 *   GOOGLE_REDIRECT_URI   — exact callback URL registered in Google Cloud.
 *                           If unset, derived from the incoming request origin.
 *   ALLOWED_AUTH_DOMAINS  — comma-separated allow-list (see ./session).
 */
import type { NextRequest } from 'next/server';
import { allowedAuthDomains } from './session';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Name of the short-lived cookie that carries the CSRF state + redirect target. */
export const OAUTH_STATE_COOKIE = 'fp_oauth_state';

export interface GoogleUserInfo {
  email: string;
  email_verified: boolean;
  /** Hosted-domain claim (set for Google Workspace accounts). */
  hd?: string;
  name?: string;
  picture?: string;
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set');
  return id;
}

function clientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET is not set');
  return secret;
}

/**
 * Resolve the public origin of the app for building the OAuth redirect URI.
 * Honors reverse-proxy headers (Railway terminates TLS upstream, so the
 * request that reaches Next.js is plain HTTP — we must trust x-forwarded-*).
 */
export function resolveOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

/**
 * The redirect URI handed to Google. Must match EXACTLY one of the
 * "Authorized redirect URIs" configured on the OAuth client in Google Cloud.
 * Prefer the explicit env var in production to avoid proxy-header surprises.
 */
export function redirectUri(req: NextRequest): string {
  return process.env.GOOGLE_REDIRECT_URI ?? `${resolveOrigin(req)}/api/auth/google/callback`;
}

/** Build the Google consent-screen URL the user is redirected to. */
export function buildAuthUrl(redirect: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the account chooser so switching accounts is easy.
    prompt: 'select_account',
    access_type: 'online',
  });

  // If exactly one domain is allowed, pass it as a hint (`hd`) so Google
  // pre-filters the account chooser. This is a UX hint only — the real
  // enforcement is the server-side domain check after token exchange.
  const domains = allowedAuthDomains();
  if (domains.length === 1) params.set('hd', domains[0]!);

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange an authorization code for an access token. */
export async function exchangeCodeForToken(code: string, redirect: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: ${res.status} ${detail}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('Token exchange returned no access_token');
  return data.access_token;
}

/** Fetch the signed-in user's profile (email + verification status). */
export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Userinfo fetch failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
