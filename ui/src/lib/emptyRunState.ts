/**
 * What an empty results panel should say.
 *
 * Both the Form Tester and Content Changes kept a URL across visits — which is
 * right, it is what you would press Run with — while their empty states said
 * "Enter a URL above". The screen then asked for something already on it, and
 * offered a Run button that would have worked. A person reading that reasonably
 * concludes the app has lost their input.
 *
 * The rule is one line: if there is a URL, name it; if there is not, ask for
 * one. It lives here rather than in each panel so the two tabs cannot drift
 * into saying different things about the same situation.
 */

/**
 * The site an empty state should name, or null when there is nothing to name.
 *
 * Returns the hostname rather than the whole URL: the sentence reads better and
 * a long path adds nothing to "we have no results for this site yet". An
 * unparseable value still counts as something the user typed, so it is returned
 * trimmed rather than discarded — telling somebody to enter a URL while their
 * typo sits in the box is the same contradiction in a smaller form.
 */
const MAX_LABEL = 60;

export function emptyStateSite(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;

  let label = raw;
  try {
    label = new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    /* not parseable — show back what they typed, bounded below */
  }

  // Bounded on EVERY path, not only the unparseable one. A long enough string
  // parses perfectly well as a hostname, so a paste can produce a valid 500
  // character "site" that breaks the line it is rendered in. The limit belongs
  // to the sentence, not to whether the value happened to parse.
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}
