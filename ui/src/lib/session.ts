/**
 * Signed cookie session.
 *
 * Tiny stateless auth: when the user logs in, we mint an HMAC-signed
 * token containing `{ user, exp }`. We send it as an httpOnly cookie.
 * On every request, middleware verifies the signature + expiry. No DB,
 * no Redis — just signed bytes the client carries.
 *
 * Env vars consumed:
 *   AUTH_USER          (required to enable auth)
 *   AUTH_PASSWORD      (required to enable auth)
 *   AUTH_SESSION_SECRET (required when AUTH_USER is set — long random string)
 *   AUTH_SESSION_DAYS  (optional, default 7 — how long a session lasts)
 *
 * Backward compatibility: BASIC_AUTH_USER / BASIC_AUTH_PASSWORD are still
 * read if the new names aren't set. Lets the deployed Railway env vars
 * keep working without renaming during rollout.
 */

// NOTE: we use Web Crypto (subtle.importKey + sign) rather than Node's
// 'crypto' module so this file is usable from Next.js middleware (Edge
// runtime). The trade-off is async sign/verify.

export interface SessionPayload {
  user: string;
  /** Display name from the Google profile (optional — password logins omit it). */
  name?: string;
  /** Avatar URL from the Google profile (optional). */
  picture?: string;
  /** Unix seconds when the token expires. */
  exp: number;
}

export function authEnabled(): boolean {
  return Boolean(authUser()) && Boolean(authPassword());
}

export function authUser(): string {
  return process.env.AUTH_USER ?? process.env.BASIC_AUTH_USER ?? '';
}

export function authPassword(): string {
  return process.env.AUTH_PASSWORD ?? process.env.BASIC_AUTH_PASSWORD ?? '';
}

/**
 * Email domains permitted to sign in via Google. Comma-separated env var,
 * defaults to apexure.com. Leading "@" and surrounding whitespace are
 * tolerated, and matching is case-insensitive.
 *
 *   ALLOWED_AUTH_DOMAINS="apexure.com, client.com"
 */
export function allowedAuthDomains(): string[] {
  const raw = process.env.ALLOWED_AUTH_DOMAINS ?? 'apexure.com';
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** True when a verified email's domain is in the allow-list. */
export function isEmailDomainAllowed(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowedAuthDomains().includes(domain);
}

/** True when Google OAuth credentials are configured. */
export function googleAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The app gate is active when EITHER the legacy password auth OR Google
 * auth is configured. When neither is set the gate stays open (local dev),
 * exactly as before.
 */
export function gateEnabled(): boolean {
  return authEnabled() || googleAuthEnabled();
}

export function sessionDurationDays(): number {
  const raw = process.env.AUTH_SESSION_DAYS;
  if (!raw) return 7;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function sessionSecret(): string {
  // Fall back to the password as the signing key if AUTH_SESSION_SECRET
  // isn't set — keeps single-env-var setups simple, but log a soft warning
  // so users can upgrade to a dedicated secret if they want stronger isolation.
  const explicit = process.env.AUTH_SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const fallback = authPassword();
  if (fallback.length === 0) {
    // Google-only mode has no password to derive from, so a dedicated secret
    // is mandatory there. Make the requirement explicit in the error.
    throw new Error(
      'Cannot derive session secret: set AUTH_SESSION_SECRET (required when using Google auth without a password)',
    );
  }
  return `fp-derived-${fallback}`;
}

export const SESSION_COOKIE_NAME = 'fp_session';

// ─── HMAC-based signing ──────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  // Edge-compatible base64url
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(sessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Mint a signed token for the given user, optionally with profile fields. */
export async function signSession(
  user: string,
  profile?: { name?: string; picture?: string },
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + sessionDurationDays() * 24 * 60 * 60;
  const payload: SessionPayload = { user, exp };
  if (profile?.name) payload.name = profile.name;
  if (profile?.picture) payload.picture = profile.picture;
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = b64urlEncode(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

/** Verify a token. Returns the payload if valid + unexpired, else null. */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts as [string, string];
  let sig: Uint8Array;
  try {
    sig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  const key = await hmacKey();
  // Slice to a fresh ArrayBuffer — TS strict mode rejects Uint8Array's
  // ArrayBufferLike against subtle.verify's stricter BufferSource type.
  // The runtime value is always a plain ArrayBuffer (b64urlDecode creates
  // a fresh Uint8Array via `new Uint8Array(length)`), so the cast is safe.
  const sigBuffer = sig.buffer.slice(
    sig.byteOffset,
    sig.byteOffset + sig.byteLength,
  ) as ArrayBuffer;
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBuffer,
    new TextEncoder().encode(payloadB64),
  );
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  if (typeof payload.user !== 'string' || payload.user.length === 0) return null;
  return payload;
}

/** Compare two strings in constant time to avoid timing leaks during login. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
