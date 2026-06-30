/**
 * Client helper for the pre-flight URL check (/api/url-check). Used by the
 * tester tabs to validate + probe a URL before launching the (expensive)
 * browser run, so a typo or a dead host fails fast instead of spinning up
 * Playwright for nothing.
 */

export interface UrlCheckResult {
  /** The URL exactly as the user entered it (for messages). */
  input: string;
  /** Valid URL format. */
  ok: boolean;
  /** Normalized URL (https:// prepended) — use THIS for the run. */
  url: string;
  /** The host responded (any HTTP status). */
  reachable: boolean;
  status?: number;
  error?: string;
}

export async function checkUrl(input: string): Promise<UrlCheckResult> {
  try {
    const res = await fetch(`/api/url-check?url=${encodeURIComponent(input)}`).then((r) => r.json());
    return {
      input,
      ok: Boolean(res?.ok),
      url: typeof res?.url === 'string' ? res.url : input,
      reachable: Boolean(res?.reachable),
      status: typeof res?.status === 'number' ? res.status : undefined,
      error: typeof res?.error === 'string' ? res.error : undefined,
    };
  } catch (e) {
    return {
      input,
      ok: false,
      url: input,
      reachable: false,
      error: e instanceof Error ? e.message : 'check failed',
    };
  }
}
