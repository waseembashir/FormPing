/**
 * Liveness probe — used by Railway / any orchestrator to verify the app is up.
 * Excluded from the basic-auth middleware so it always returns 200 OK.
 */
import { supabaseEnabled } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'formping',
    // Which persistence backend the server is actually using right now.
    storage: supabaseEnabled() ? 'supabase' : 'json',
    ts: new Date().toISOString(),
  });
}
