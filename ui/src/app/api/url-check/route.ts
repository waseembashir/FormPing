import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Add https:// if no scheme, then validate. Returns null if unparseable. */
function normalize(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    new URL(u);
    return u;
  } catch {
    return null;
  }
}

/**
 * GET /api/url-check?url=... — cheap pre-flight before launching a browser run.
 * Validates the URL format and does ONE lightweight HTTP GET (8s timeout) to
 * confirm the host actually responds. Returns:
 *   { ok, url, reachable, status?, error? }
 * `ok`        = valid URL format
 * `reachable` = the server answered (any status — even 404 means it's up)
 * Used by every tester tab so we don't spin up Playwright for a dead/typo'd URL.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url') ?? '';
  const url = normalize(raw);
  if (!url) {
    return NextResponse.json({ ok: false, url: raw, reachable: false, error: 'Invalid URL' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'FormPing-UrlCheck/1.0' },
    });
    clearTimeout(timer);
    return NextResponse.json({ ok: true, url, reachable: true, status: res.status });
  } catch (e) {
    clearTimeout(timer);
    const error =
      e instanceof Error ? (e.name === 'AbortError' ? 'Timed out (8s)' : e.message) : 'Unreachable';
    return NextResponse.json({ ok: true, url, reachable: false, error });
  }
}
