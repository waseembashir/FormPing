/**
 * Server-only Supabase client.
 *
 * Uses the SECRET (service-role) key — full privileged access that bypasses
 * Row Level Security — so it MUST only ever run on the server (API routes,
 * tickers, server components). The key has no `NEXT_PUBLIC_` prefix, so it is
 * never bundled into the browser; if this module is ever imported client-side,
 * the env vars are undefined and `supabaseAdmin()` throws.
 *
 * Config:
 *   SUPABASE_URL                 — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    — the project's secret key (sb_secret_… or the
 *                                  legacy service_role JWT)
 *
 * When these are unset the app falls back to the JSON stores (see each store's
 * backend selection), so local dev works with or without Supabase configured.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/** True when Supabase credentials are configured (drives JSON ↔ Supabase selection). */
export function supabaseEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** The privileged, server-only Supabase client (singleton). Throws if unconfigured. */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-only).',
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
