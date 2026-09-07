/**
 * FR-73 — host the form screenshots the engine captures, server-side.
 *
 * WHY THIS EXISTS — it is a performance boundary, not a storage convenience.
 * The engine returns each screenshot as a `data:` URL. Those bytes must never
 * reach the browser: the tester caches its results in localStorage and rewrites
 * that cache on every streamed log line, so a few hundred KB of base64 in the
 * result would re-serialize on every log event during a run, and re-parse
 * synchronously on every visit to the tester tab. The run, the load and the
 * navigation would all get slower to show one picture.
 *
 * So the run route pipes every result through `hostFormShots` first: the images
 * go to Supabase Storage and the result keeps a short URL. The client downloads
 * a shot only when the form's tab is actually opened (lazy `<img>`), and never
 * stores one.
 *
 * If Supabase isn't configured, the shots are DROPPED rather than inlined —
 * showing evidence is not worth making the app slow, and a missing screenshot is
 * an honest absence.
 *
 * ACCESS: the bucket is public-read, and each object's FILENAME carries a random
 * suffix — the same unguessable-URL model the public status pages use. The
 * folder is derived from the URL (so evidence can be found and swept), but the
 * leaf is not, so knowing a client's URL is not enough to fetch their
 * screenshots. Shots are never rendered on `/status/*`, so nothing here changes
 * what a client can see. Putting them behind an auth-gated route instead is the
 * stronger end state, tracked separately.
 *
 * The bucket creates itself on first use, so there is no setup step and no
 * migration — the service-role key the app already holds is enough.
 */

// Bare specifier, not `node:crypto` — the rest of the app imports node builtins
// this way, and webpack's `node:` protocol handling breaks the moment a module
// is reachable from more than one entry point (this file is now pulled in by the
// Form Watch ticker as well as /api/run). FR-67.
import { createHash, randomUUID } from 'crypto';
import { supabaseAdmin, supabaseEnabled, supabaseSchema } from './supabase';
import { urlKey } from './projects/projectStore';

const BUCKET = 'form-shots';
/** Total time a whole run's uploads may take before we give up and ship the
 *  result without them. Evidence never delays a verdict by more than this. */
const UPLOAD_BUDGET_MS = 5000;
const DATA_URL = /^data:image\/jpeg;base64,/;

let bucketReady: Promise<boolean> | null = null;

/** Create the bucket on first use so there's no manual setup step. Cached for
 *  the life of the process — one round trip per boot, not per run. */
function ensureBucket(): Promise<boolean> {
  bucketReady ??= (async () => {
    try {
      const storage = supabaseAdmin().storage;
      const { error } = await storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: '1MB',
        allowedMimeTypes: ['image/jpeg'],
      });
      // "already exists" is the normal path on every boot after the first.
      if (error && !/exist/i.test(error.message)) {
        console.warn(`[formShots] could not create bucket: ${error.message}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[formShots] storage unavailable: ${String(err)}`);
      return false;
    }
  })();
  return bucketReady;
}

/**
 * Which environment wrote this. Storage has no schemas — unlike every table in
 * this app, dev and production share one bucket — so the path carries the
 * boundary instead. Named `prod`, not `public`: inside a bucket that is itself
 * marked PUBLIC, a folder called "public" reads as "the public ones" rather than
 * "production", and someone clearing out test data should never have to work
 * that out.
 */
function envFolder(): string {
  const schema = supabaseSchema();
  return schema === 'public' ? 'prod' : schema;
}

/** Filesystem-safe fragment of a URL — lowercase, no separators, bounded. */
function safe(part: string, max: number): string {
  return part.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'x';
}

/** A short, stable fingerprint of a URL — disambiguates two pages whose last
 *  path segment is the same (`/uk/contact` vs `/us/contact`). */
function fingerprint(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 8);
}

/**
 * The folder holding every screenshot for ONE tested URL:
 * `<env>/<host>/<page>-<fingerprint>`.
 *
 * DETERMINISTIC ON PURPOSE — the FOLDER, not the filenames in it. Fully random
 * paths meant a URL tested ten times left ten sets of images, nine of them
 * referenced by nothing (the run row is upserted per URL, so only the newest set
 * is ever shown). A folder per URL makes the old set findable, so each run can
 * clear it first and storage stays proportional to the URLs you test rather than
 * to how often you test them.
 *
 * It also gives deletion something to aim at: one prefix per URL, which is
 * exactly the granularity `removeRun` works at. The filenames inside stay random
 * so the path can't be derived from a client's URL — see `objectName`.
 *
 * Built from the same `urlKey` the runs table uses, so both agree on what "the
 * same URL" means (protocol, www and trailing slash all normalised away).
 */
export function shotFolder(url: string): string {
  const key = urlKey(url);
  let host = 'unknown-site';
  let page = 'home';
  try {
    const u = new URL(key);
    host = safe(u.hostname, 60);
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last) page = safe(last, 40);
  } catch {
    /* unparseable — the shot is still worth keeping, just less findable */
  }
  return `${envFolder()}/${host}/${page}-${fingerprint(key)}`;
}

/**
 * Name one screenshot inside its URL's folder: the page it shows, its slot in
 * the run, and a RANDOM suffix.
 *
 * The random part is the point. The folder is deterministic so a URL's evidence
 * can be found and swept, but a fully derivable filename would mean anyone who
 * knows a client's URL could compute the object path and fetch the image out of
 * a public bucket without logging in — obscurity masquerading as access control.
 * Randomising the leaf restores that, and `clearFolder` (called before each
 * run's uploads) is what keeps storage from growing instead of `upsert`. FR-73.
 */
function objectName(folder: string, sourceUrl: string | undefined, index: number): string {
  let page = 'form';
  try {
    const last = new URL(sourceUrl ?? '').pathname.split('/').filter(Boolean).pop();
    if (last) page = safe(last, 40);
    else page = 'home';
  } catch {
    /* keep the default */
  }
  return `${folder}/${index}-${page}-${randomUUID().slice(0, 12)}.jpg`;
}

/**
 * Empty a URL's folder before that run's screenshots go in.
 *
 * With random filenames a re-run can no longer overwrite its own images, so this
 * is what stops a URL tested ten times leaving ten sets behind. One list+remove
 * per run, inside the existing upload budget.
 */
async function clearFolder(folder: string): Promise<void> {
  try {
    const storage = supabaseAdmin().storage.from(BUCKET);
    const { data, error } = await storage.list(folder, { limit: 100 });
    if (error || !data?.length) return;
    await storage.remove(data.map((f) => `${folder}/${f.name}`));
  } catch (err) {
    console.warn(`[formShots] could not clear ${folder}: ${String(err)}`);
  }
}

/** Upload one `data:` URL, returning its public URL (or null — always optional). */
async function upload(
  dataUrl: string,
  folder: string,
  sourceUrl: string | undefined,
  index: number,
): Promise<string | null> {
  if (!DATA_URL.test(dataUrl)) return null;
  try {
    const bytes = Buffer.from(dataUrl.replace(DATA_URL, ''), 'base64');
    if (!bytes.byteLength) return null;
    const name = objectName(folder, sourceUrl, index);
    const storage = supabaseAdmin().storage.from(BUCKET);
    const { error } = await storage.upload(name, bytes, {
      contentType: 'image/jpeg',
      // Names are unique per run now, so there is nothing to overwrite.
      upsert: false,
      cacheControl: '300',
    });
    if (error) {
      console.warn(`[formShots] upload failed: ${error.message}`);
      return null;
    }
    // Each run writes a new name, so the CDN can't serve a previous run's image
    // and no cache-busting stamp is needed.
    return storage.getPublicUrl(name).data.publicUrl;
  } catch (err) {
    console.warn(`[formShots] upload error: ${String(err)}`);
    return null;
  }
}

/**
 * Delete every screenshot belonging to a URL. Called when the URL is removed
 * from a project or the whole project is deleted — the evidence goes with the
 * result it belonged to, rather than lingering as an orphan nobody can trace.
 * Best-effort: a failed sweep must never block the deletion itself.
 */
export async function removeShots(url: string): Promise<void> {
  if (!supabaseEnabled()) return;
  // Same sweep a re-run does before uploading — one implementation, so the two
  // can never disagree about what "this URL's screenshots" means.
  await clearFolder(shotFolder(url));
}

/** The shot-carrying shape of a result, as far as this module cares. */
interface ShotBearing {
  formShot?: unknown;
  /** The URL this run was ABOUT — keys the folder, and matches the runs table. */
  normalizedUrl?: unknown;
  inputUrl?: unknown;
  /** Where the tested form was found — names its screenshot inside that folder. */
  resolvedContactPage?: unknown;
  finalUrl?: unknown;
  siteForms?: { shot?: unknown; url?: unknown }[];
}

/**
 * Replace every `data:` screenshot in a raw engine result with a hosted URL,
 * dropping any we can't host. Returns the same object (mutated in place) so the
 * caller can hand it straight to the stream.
 *
 * Never throws, and never takes longer than the upload budget.
 */
export async function hostFormShots<T>(raw: T): Promise<T> {
  if (!raw || typeof raw !== 'object') return raw;
  const result = raw as ShotBearing;

  // Gather every slot holding a data: URL, so one pass covers the tested form
  // and each site form. Each carries the page it came from, which is what names
  // the file in Storage.
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const testedPage = str(result.resolvedContactPage) ?? str(result.finalUrl) ?? str(result.normalizedUrl);

  const slots: { get: () => string; set: (v: string | undefined) => void; page?: string }[] = [];
  if (typeof result.formShot === 'string' && DATA_URL.test(result.formShot)) {
    slots.push({ get: () => result.formShot as string, set: (v) => { result.formShot = v; }, page: testedPage });
  }
  if (Array.isArray(result.siteForms)) {
    for (const form of result.siteForms) {
      if (form && typeof form.shot === 'string' && DATA_URL.test(form.shot)) {
        slots.push({ get: () => form.shot as string, set: (v) => { form.shot = v; }, page: str(form.url) ?? testedPage });
      }
    }
  }
  if (!slots.length) return raw;

  // No storage → no evidence. Strip, so heavy base64 can never reach the client.
  if (!supabaseEnabled() || !(await ensureBucket())) {
    for (const slot of slots) slot.set(undefined);
    return raw;
  }

  // Everything this run captures lands in the folder for the URL it tested, and
  // the previous run's images are cleared first — so a URL tested ten times
  // holds one set, even though each file now has a random name.
  const folder = shotFolder(str(result.normalizedUrl) ?? str(result.inputUrl) ?? testedPage ?? '');
  await clearFolder(folder);

  const hosted = await Promise.race([
    Promise.all(slots.map((slot, i) => upload(slot.get(), folder, slot.page, i))),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), UPLOAD_BUDGET_MS)),
  ]);

  slots.forEach((slot, i) => slot.set(hosted?.[i] ?? undefined));
  return raw;
}
