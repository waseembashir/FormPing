/**
 * Shared safety guard for FormPing database scripts.
 *
 * Rule 6 ("Production data is sacred"): any script that WRITES or DELETES must
 * run only against the `dev` schema, never production's `public`. This module
 * is the single enforcement point — a destructive script calls `devClient()`
 * and physically cannot proceed unless it is pointed at `dev`.
 *
 * Usage:
 *   import { devClient } from './guard.mjs';
 *   const { db, schema } = devClient();      // throws unless schema === 'dev'
 *
 * Read-only scripts that legitimately need to look at production may call
 * `readOnlyClient('public')` instead — it never returns a client that can be
 * used for a mutation without the caller opting in explicitly.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(HERE, '..', '..'); // ui/
const require = createRequire(path.join(UI_ROOT, 'package.json'));
const { createClient } = require('@supabase/supabase-js');

/** Parse a KEY=VALUE env file (no export of secrets — values stay in memory). */
export function loadEnv(envPath = path.join(UI_ROOT, '.env.local')) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`env file not found: ${envPath}`);
  }
  const text = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function build(env, schema) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from env file.');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
  });
}

/**
 * A client bound to `dev`, for scripts that mutate data. REFUSES to run unless
 * the resolved schema is exactly 'dev'. The schema comes from SUPABASE_SCHEMA in
 * the env file — the same value the app uses — so a script and the app can never
 * disagree about which environment they are on.
 */
export function devClient(envPath) {
  const env = loadEnv(envPath);
  const schema = env.SUPABASE_SCHEMA?.trim() || 'public';
  if (schema !== 'dev') {
    throw new Error(
      `REFUSING TO RUN — a destructive DB script must target the 'dev' schema, ` +
        `but SUPABASE_SCHEMA resolves to '${schema}'. This guard exists so a smoke ` +
        `test can never touch production ('public'). Set SUPABASE_SCHEMA=dev in ` +
        `ui/.env.local (it already is for normal local dev).`,
    );
  }
  return { db: build(env, schema), schema, env };
}

/**
 * A read-only client for a named schema (default 'dev'). Use for audits/reports.
 * The caller must pass 'public' EXPLICITLY to look at production, so it never
 * happens by accident. This does not stop writes at the driver level — it is a
 * convention for read scripts; anything that mutates must use devClient().
 */
export function readOnlyClient(schema = 'dev', envPath) {
  const env = loadEnv(envPath);
  return { db: build(env, schema), schema, env };
}
