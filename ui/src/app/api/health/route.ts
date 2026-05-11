/**
 * Liveness probe — used by Railway / any orchestrator to verify the app is up.
 * Excluded from the basic-auth middleware so it always returns 200 OK.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'formping',
    ts: new Date().toISOString(),
  });
}
