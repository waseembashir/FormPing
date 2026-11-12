/**
 * Where an uptime check landed, and whether that is still the same site.
 *
 * Housekeeping redirects (https, www, a trailing slash, a subdomain of the same
 * main domain) are the same site. A redirect that leaves the main domain is
 * what a lapsed or hijacked domain looks like while uptime still reads green.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mainDomain, redirectVerdict } from '@/lib/siteWatch/redirect';
import { checkUptime } from '@/lib/siteWatch/checks';

describe('mainDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['shop.eu.example.com', 'example.com'],
    ['example.co.uk', 'example.co.uk'],
    ['www.example.co.uk', 'example.co.uk'],
    ['shop.example.com.au', 'example.com.au'],
    ['WWW.Example.COM.', 'example.com'],
    ['example.io', 'example.io'],
    ['app.example.io', 'example.io'],
    ['203.0.113.7', '203.0.113.7'],
  ])('%s → %s', (host, main) => {
    expect(mainDomain(host)).toBe(main);
  });
});

describe('redirectVerdict', () => {
  it('is null when the check did not redirect', () => {
    expect(redirectVerdict('https://example.com/', undefined)).toBeNull();
    expect(redirectVerdict('https://example.com/', 'https://example.com/')).toBeNull();
  });

  it.each([
    ['http to https', 'http://example.com/', 'https://example.com/'],
    ['adding www', 'https://example.com/', 'https://www.example.com/'],
    ['dropping www', 'https://www.example.com/', 'https://example.com/'],
    ['a trailing path', 'https://example.com', 'https://example.com/en/'],
    ['a subdomain of the same site', 'https://example.com/', 'https://shop.example.com/'],
    ['a country domain with www', 'https://example.co.uk/', 'https://www.example.co.uk/home'],
  ])('treats %s as the same site', (_name, from, to) => {
    expect(redirectVerdict(from, to)?.kind).toBe('same-site');
  });

  it.each([
    ['another domain', 'https://example.com/', 'https://other-site.com/', 'other-site.com'],
    ['a parking page', 'https://example.com/', 'https://www.parked-domains.example/lander', 'parked-domains.example'],
    ['a look-alike', 'https://example.com/', 'https://example.com.evil.example/', 'evil.example'],
    ['a sibling under the same country suffix', 'https://example.co.uk/', 'https://other.co.uk/', 'other.co.uk'],
  ])('flags %s as off-site, naming where it went', (_name, from, to, domain) => {
    const v = redirectVerdict(from, to);
    expect(v?.kind).toBe('off-site');
    expect(v?.finalDomain).toBe(domain);
  });

  it('is null rather than guessing when an address cannot be read', () => {
    expect(redirectVerdict('not a url', 'https://example.com/')).toBeNull();
  });
});

describe('checkUptime records where it landed', () => {
  afterEach(() => vi.unstubAllGlobals());

  const serve = (redirected: boolean, url: string) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 200, redirected, url, text: async () => '<h1>Welcome</h1>' })),
    );

  it('keeps the final address when the request was redirected', async () => {
    serve(true, 'https://www.example.com/');
    const r = await checkUptime('http://example.com/');
    expect(r.classification).toBe('up');
    expect(r.finalUrl).toBe('https://www.example.com/');
  });

  it('records nothing when there was no redirect', async () => {
    serve(false, 'https://example.com/');
    const r = await checkUptime('https://example.com/');
    expect(r.finalUrl).toBeUndefined();
  });
});
