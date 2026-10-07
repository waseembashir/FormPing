/**
 * Client-side gate for the "add this URL to a project?" prompt.
 *
 * THE INVARIANT (FR-23): the prompt is shown ONLY on positive confirmation that
 * the URL is neither already in a project nor dismissed. Anything else — a failed
 * check, a transient error, an unreachable API — means "do not prompt".
 *
 * This inverts the old behaviour, which prompted unless it got confirmation to
 * suppress: the membership `fetch` fails-open there, so a hiccup (common while the
 * Change-tracking SSE stream is hammering the page) produced an "add to project?"
 * popup for a URL that was already assigned — the exact bug this kept causing.
 *
 * Fails CLOSED: if we can't confirm the URL is unassigned we stay silent. The
 * cost of a false negative is tiny — the URL still sits in the Unassigned bucket,
 * where it can be assigned any time. The cost of a false positive is the nagging
 * we're removing.
 */
export async function shouldPromptForProject(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`/api/projects/membership?url=${encodeURIComponent(url)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`membership ${res.status}`);
      const d = (await res.json()) as { inProject?: boolean; dismissed?: boolean };
      // Positive confirmation ONLY: both must be explicitly false.
      return d.inProject === false && d.dismissed === false;
    } catch {
      // One quiet retry absorbs a transient blip during heavy streaming.
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false; // fail closed — never nag when we cannot confirm
}

/** Filter a list of URLs down to the ones that should be prompted for. */
export async function filterPromptable(urls: string[]): Promise<string[]> {
  const results = await Promise.all(urls.map((u) => shouldPromptForProject(u).then((ok) => (ok ? u : null))));
  return results.filter((u): u is string => u !== null);
}
