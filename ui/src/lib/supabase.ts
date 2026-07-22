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
 *   SUPABASE_SCHEMA              — which Postgres schema to use. OPTIONAL;
 *                                  defaults to 'public'.
 *
 * ENVIRONMENT SEPARATION (working agreement rule 6 — "Production data is
 * sacred"): prod and development share ONE Supabase project but are isolated by
 * SCHEMA, so they never share a table:
 *
 *   public  → PRODUCTION   (Railway leaves SUPABASE_SCHEMA unset)
 *   dev     → development  (local .env.local sets SUPABASE_SCHEMA=dev)
 *
 * This is the single choke point — every store inherits the schema from here,
 * so a destructive dev script physically cannot reach a production row.
 *
 * When URL/key are unset the app falls back to the JSON stores (see each store's
 * backend selection), so local dev works with or without Supabase configured.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The bare `SupabaseClient` type pins the schema to the literal 'public', which
 * no longer holds now that the schema is chosen at runtime (see supabaseSchema).
 * Widen the schema parameter to `string` so `dev` type-checks too.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, string, any, any>;

let cached: AdminClient | null = null;

/** True when Supabase credentials are configured (drives JSON ↔ Supabase selection). */
export function supabaseEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * The Postgres schema this process talks to — 'public' (production) unless
 * SUPABASE_SCHEMA says otherwise. Exported so tooling can assert which
 * environment it is about to touch before doing anything destructive.
 */
export function supabaseSchema(): string {
  return process.env.SUPABASE_SCHEMA?.trim() || 'public';
}

/** The privileged, server-only Supabase client (singleton). Throws if unconfigured. */
export function supabaseAdmin(): AdminClient {
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
    db: { schema: supabaseSchema() },
  });
  return cached;
}
