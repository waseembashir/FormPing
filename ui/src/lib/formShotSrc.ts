/**
 * Where a form screenshot is fetched from — always through the app, never
 * straight from storage.
 *
 * Screenshots are internal evidence. They are pictures of a client's page as an
 * anonymous visitor sees it, taken BEFORE anything is filled, so they never
 * contain test data — but a staging, unlisted or pre-launch URL that gets
 * tested has its screenshot sitting behind whatever protects the bucket. Every
 * other internal surface is auth-gated; the images were the one that was not.
 *
 * FR-73 made the filenames unguessable, which is a mitigation rather than
 * access control: anyone holding a link could fetch the object with no session.
 * This module is what replaces obscurity with a gate.
 *
 * ## Two shapes in, one shape out
 *
 * Results stored before this change hold a full public Storage URL. Results
 * stored after it hold the object path. Both have to keep working, because the
 * run rows are the record of what the app found and rewriting them would be a
 * data migration performed for cosmetics.
 *
 * So this reads either and returns the same thing: a path under the app's own
 * gated route. The moment it is in place, flipping the bucket to private breaks
 * nothing — which is the property that makes the flip safe to do separately,
 * and afterwards.
 *
 * ## This is not the security boundary
 *
 * It runs in the browser. The route it points at re-validates everything here
 * server-side, because a caller can ask for any path it likes regardless of
 * what this function would have produced. The checks exist here so a bad value
 * renders as a missing image instead of a broken request.
 */

/** The bucket holding form screenshots. Must match `formShots.ts`. */
const BUCKET = 'form-shots';

/**
 * How Supabase spells a public object URL, wherever the project is hosted.
 *
 * Matched loosely on purpose — on the path, not the host. A deployment moving
 * to another Supabase project or a custom storage domain would otherwise make
 * every previously stored screenshot unresolvable, and the failure would be a
 * page full of missing images with nothing explaining why.
 */
const PUBLIC_OBJECT = new RegExp(`/storage/v1/object/public/${BUCKET}/(.+)$`);

/**
 * Whether a storage key is one we are willing to ask for.
 *
 * Deliberately a strict allowlist rather than a search for bad patterns. These
 * keys are built by `formShots.ts` from a sanitised host, a sanitised page and
 * a random suffix, so the real shape is narrow and anything outside it is
 * either a bug or an attempt.
 *
 *   - `..` cannot appear, so no traversal out of the bucket
 *   - no leading slash, so no absolute path
 *   - no backslashes, no control characters, no NUL
 *   - no scheme, so a key can never name a different host
 *
 * The same function guards the route, so the browser and the server agree on
 * what a key may look like and neither has to trust the other.
 */
export function isSafeShotPath(path: string): boolean {
  if (!path || path.length > 512) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  // One expression, so a character can only be allowed by being listed.
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(path);
}

/**
 * The storage key behind a stored screenshot value, or null if there is none
 * we trust.
 *
 * Null rather than passing a value through unchanged. An unrecognised absolute
 * URL is the case that matters: rendering it would have the app fetch and
 * display whatever a stored row happens to point at, which is a worse outcome
 * than a missing picture. A screenshot is evidence, and evidence from an
 * unknown source is not evidence.
 */
export function shotPath(stored: string | undefined | null): string | null {
  const value = (stored ?? '').trim();
  if (!value) return null;

  // A `data:` URL means hosting was skipped or failed. The engine's inline
  // bytes must never reach the browser — that is the whole reason screenshots
  // are hosted at all — so this is dropped rather than rendered.
  if (/^data:/i.test(value)) return null;

  const legacy = value.match(PUBLIC_OBJECT);
  if (legacy) {
    // Stored URLs are percent-encoded; the key is not.
    const decoded = safeDecode(legacy[1]!.split('?')[0]!);
    return decoded && isSafeShotPath(decoded) ? decoded : null;
  }

  // Any other absolute URL is not ours.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;

  return isSafeShotPath(value) ? value : null;
}

/** Decode a percent-encoded segment, or null if it is malformed. */
function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * The URL to put in an `<img src>`, or undefined when there is nothing to show.
 *
 * Undefined rather than a placeholder: every caller already renders nothing
 * without a shot, because an empty frame implies we looked and saw nothing,
 * which is not what a missing screenshot means.
 */
export function shotSrc(stored: string | undefined | null): string | undefined {
  const path = shotPath(stored);
  if (!path) return undefined;
  // Encoded per segment — the separators are structure, the segments are data.
  return `/api/form-shot/${path.split('/').map(encodeURIComponent).join('/')}`;
}
