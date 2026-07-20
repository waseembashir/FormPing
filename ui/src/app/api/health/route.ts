/**
 * Liveness probe — used by Railway / any orchestrator to verify the app is up.
 * Excluded from the basic-auth middleware so it always returns 200 OK.
 */
import { supabaseEnabled, supabaseSchema } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const onSupabase = supabaseEnabled();
  const schema = onSupabase ? supabaseSchema() : null;
  return Response.json({
    ok: true,
    service: 'formping',
    // Which persistence backend the server is actually using right now.
    storage: onSupabase ? 'supabase' : 'json',
    // WHICH SCHEMA — the environment separation (rule 6). `public` is
    // production; local dev must report `dev`. Names only, never credentials.
    schema,
    environment: schema === null ? 'json-fallback' : schema === 'public' ? 'production' : 'development',
    ts: new Date().toISOString(),
  });
}
