/**
 * FR-91 — "See the full detail in FormPing" must open a page that exists.
 *
 * It returned `/projects/{id}/status`, a route that has never existed in this
 * app, so every alert about a URL inside a project — form, site and change
 * alike — linked to a 404. The fallbacks were fine, which is why it survived:
 * a URL not yet in a project linked correctly, and those are the ones you click
 * while setting a monitor up.
 *
 * This test is deliberately shaped around the ACTUAL route files. A link builder
 * can only be verified against the router, and comparing it to a list written
 * from memory is how the original bug passed review.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeUrlKey, decodeUrlKey } from '@/lib/projects/urlKeyRoute';

const APP_DIR = fileURLToPath(new URL('../ui/src/app', import.meta.url));

/** Turn an app-relative path into the route file Next.js would resolve. */
function routeExists(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  let dir = APP_DIR;
  for (const segment of segments) {
    if (!existsSync(dir)) return false;
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const exact = entries.find((e) => e.name === segment);
    // A dynamic segment ([id], [key]) matches any single path segment.
    const dynamic = entries.find((e) => /^\[.+\]$/.test(e.name));
    const next = exact ?? dynamic;
    if (!next) return false;
    dir = join(dir, next.name);
  }
  return existsSync(join(dir, 'page.tsx'));
}

describe('the route checker itself', () => {
  it('recognises routes this app really has', () => {
    expect(routeExists('/form-watch')).toBe(true);
    expect(routeExists('/site-watch')).toBe(true);
    expect(routeExists('/monitor')).toBe(true);
    expect(routeExists('/projects')).toBe(true);
  });

  it('rejects the route that caused this bug', () => {
    // The exact path detailPathFor used to return.
    expect(routeExists('/projects/abc123/status')).toBe(false);
  });
});

describe('every path an alert link can produce', () => {
  it('the per-URL dashboard resolves', () => {
    const segment = encodeUrlKey('hutch.example/contact');
    expect(routeExists(`/projects/p1/url/${segment}`)).toBe(true);
  });

  it('the project page resolves — the fallback when a key cannot be built', () => {
    expect(routeExists('/projects/p1')).toBe(true);
  });

  it('every per-kind fallback tab resolves', () => {
    // Mirrors FALLBACK in lib/alerts/link.ts.
    for (const path of ['/monitor', '/form-watch', '/site-watch']) {
      expect(routeExists(path), path).toBe(true);
    }
  });
});

describe('the URL key survives the round trip into a route segment', () => {
  it('encodes and decodes back to the same key', () => {
    for (const key of [
      'hutch.example/contact',
      'example.com',
      'example.com/a/deep/path',
      'exämple.com/café',
      'example.com/path?with=query&more=1',
    ]) {
      expect(decodeUrlKey(encodeUrlKey(key)), key).toBe(key);
    }
  });

  it('produces a segment with no slashes, so it cannot break the path', () => {
    const segment = encodeUrlKey('example.com/a/deep/path');
    expect(segment).not.toContain('/');
    expect(segment).not.toContain('+');
    expect(segment).not.toContain('=');
  });
});
