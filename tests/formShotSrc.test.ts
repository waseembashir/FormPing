/**
 * Where a form screenshot is allowed to be fetched from.
 *
 * Screenshots are internal evidence: pictures of a client's page as an
 * anonymous visitor sees it, taken before anything is filled. They lived in a
 * public-read bucket behind an unguessable filename, which is a mitigation and
 * not access control — anyone holding a link could fetch one with no session.
 * Now they are served by an auth-gated route, and this is the function that
 * decides what that route is asked for.
 *
 * Two jobs, and the second is the one with teeth.
 *
 * **Keep old rows working.** Results stored before the change hold a full
 * public Storage URL; results stored after hold the object key. Both must
 * resolve, or flipping the bucket to private turns every historical screenshot
 * into a broken image. That property is what lets the flip happen separately
 * from the deploy, and safely.
 *
 * **Refuse everything else.** This builds a path that a server-side route then
 * hands to storage using the service-role key. A value that escapes the
 * screenshot prefix, or names somewhere else entirely, must not survive. The
 * route re-validates with the same allowlist — neither side trusts the other —
 * but this is where the rule is written down and tested.
 */

import { describe, it, expect } from 'vitest';
import { shotPath, shotSrc, isSafeShotPath } from '@/lib/formShotSrc';

const KEY = 'prod/acme.example.com/contact-1a2b3c4d/0-contact-9f8e7d6c5b4a.jpg';
const PUBLIC_URL = `https://abcdefgh.supabase.co/storage/v1/object/public/form-shots/${KEY}`;

describe('a key stored by a recent run', () => {
  it('is served through the app, never straight from storage', () => {
    expect(shotSrc(KEY)).toBe(`/api/form-shot/${KEY}`);
  });

  it('is returned as the key itself', () => {
    expect(shotPath(KEY)).toBe(KEY);
  });
});

describe('a public URL stored before the gate existed', () => {
  it('still resolves, so old evidence does not vanish', () => {
    // The property that makes flipping the bucket private safe to do as its
    // own step: every historical row keeps working the moment this ships.
    expect(shotPath(PUBLIC_URL)).toBe(KEY);
    expect(shotSrc(PUBLIC_URL)).toBe(`/api/form-shot/${KEY}`);
  });

  it('is recognised on any host, not just the one we use today', () => {
    // Matched on the path rather than the host. A move to another Supabase
    // project or a custom storage domain would otherwise make every stored
    // screenshot unresolvable at once, and the symptom would be a page of
    // missing images with nothing explaining it.
    expect(shotPath(`https://storage.example.net/storage/v1/object/public/form-shots/${KEY}`)).toBe(KEY);
  });

  it('drops a query string', () => {
    expect(shotPath(`${PUBLIC_URL}?t=12345`)).toBe(KEY);
  });

  it('decodes a percent-encoded key', () => {
    const encoded = PUBLIC_URL.replace('0-contact', '0%2Dcontact');
    expect(shotPath(encoded)).toBe(KEY);
  });
});

describe('what it refuses', () => {
  it('refuses a path that climbs out of the bucket', () => {
    /**
     * The one that matters. The route hands this path to storage with the
     * service-role key, which can read far more than screenshots — so a key
     * that walks upwards must not get that far. Rejected here and again in
     * the route, because this function runs in the browser and a caller can
     * ask for whatever it likes regardless.
     */
    for (const evil of [
      '../secrets/key.json',
      'prod/../../private/x.jpg',
      'prod/acme/..%2F..%2Fetc',
      '..',
      'a/../../b',
    ]) {
      expect(shotPath(evil), evil).toBeNull();
      expect(shotSrc(evil), evil).toBeUndefined();
    }
  });

  it('refuses an absolute path', () => {
    expect(shotPath('/etc/passwd')).toBeNull();
    expect(shotPath('//evil.example.com/x.jpg')).toBeNull();
  });

  it('refuses a URL that is not ours', () => {
    // Rendering an unrecognised URL would have the app fetch and display
    // whatever a stored row points at. A missing picture is the better
    // outcome: evidence from an unknown source is not evidence.
    for (const foreign of [
      'https://evil.example.com/x.jpg',
      'http://evil.example.com/storage/v1/object/public/other-bucket/x.jpg',
      'https://abcdefgh.supabase.co/storage/v1/object/public/snapshots/x.jpg',
    ]) {
      expect(shotPath(foreign), foreign).toBeNull();
    }
  });

  it('refuses a data: URL rather than inlining it', () => {
    // Hosting was skipped or failed. The engine's inline bytes must never
    // reach the browser — that is the entire reason screenshots are hosted —
    // so this is dropped rather than rendered.
    expect(shotPath('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBeNull();
    expect(shotSrc('DATA:image/jpeg;base64,abc')).toBeUndefined();
  });

  it('refuses anything with a scheme', () => {
    for (const scheme of ['javascript:alert(1)', 'file:///etc/passwd', 'blob:abc', 'vbscript:x']) {
      expect(shotPath(scheme), scheme).toBeNull();
    }
  });

  it('refuses nothing, empty and whitespace', () => {
    for (const empty of [undefined, null, '', '   ']) {
      expect(shotPath(empty)).toBeNull();
      expect(shotSrc(empty)).toBeUndefined();
    }
  });

  it('refuses control characters and a NUL', () => {
    expect(shotPath('prod/acme/x\u0000.jpg')).toBeNull();
    expect(shotPath('prod/acme/x\n.jpg')).toBeNull();
    expect(shotPath('prod/acme/x\\y.jpg')).toBeNull();
  });

  it('refuses an absurdly long key', () => {
    expect(shotPath(`prod/${'a'.repeat(600)}.jpg`)).toBeNull();
  });
});

describe('the allowlist itself', () => {
  it('accepts exactly the shape real keys have', () => {
    // Built from a sanitised host, a sanitised page and a random suffix, so
    // the real shape is narrow. Spelled out here so widening it later is a
    // deliberate act with a failing test attached.
    expect(isSafeShotPath(KEY)).toBe(true);
    expect(isSafeShotPath('dev/x.example.com/home-abc12345-tester/2-step-1-0a1b2c3d4e5f.jpg')).toBe(true);
  });

  it('is an allowlist, not a blocklist', () => {
    // A character is permitted only by being listed, so a form of attack
    // nobody thought of is refused by default rather than by being enumerated.
    for (const ch of [' ', '?', '#', '%', '&', ':', '@', '<', '>', '"', "'", '\t']) {
      expect(isSafeShotPath(`prod/acme/x${ch}y.jpg`), JSON.stringify(ch)).toBe(false);
    }
  });
});

describe('building the src', () => {
  it('encodes each segment but keeps the separators', () => {
    // The slashes are structure and the segments are data. Encoding the whole
    // thing would turn the path into one segment the route could not match.
    const src = shotSrc('prod/acme.example.com/contact-1a2b/0-x.jpg');
    expect(src).toBe('/api/form-shot/prod/acme.example.com/contact-1a2b/0-x.jpg');
    expect(src!.startsWith('/api/form-shot/')).toBe(true);
  });

  it('never produces an absolute URL', () => {
    // Whatever goes in, what comes out points at this app and nowhere else.
    for (const input of [KEY, PUBLIC_URL]) {
      expect(shotSrc(input)!.startsWith('/api/form-shot/')).toBe(true);
    }
  });
});
