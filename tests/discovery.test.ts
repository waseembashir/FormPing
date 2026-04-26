import { describe, it, expect } from 'vitest';
import { scoreContactLinks } from '../src/discovery/scoreContactLinks.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const BASE = 'https://example.com';

describe('scoreContactLinks', () => {
  it('ranks /contact path highly', () => {
    const links = [
      { href: '/contact', text: 'Contact Us' },
      { href: '/about', text: 'About' },
    ];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.url).toBe('https://example.com/contact');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('gives positive score to /contact-us', () => {
    const links = [{ href: '/contact-us', text: 'Get in touch' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('excludes login pages', () => {
    const links = [
      { href: '/login', text: 'Login' },
      { href: '/contact', text: 'Contact' },
    ];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    const urls = results.map((r) => r.url);
    expect(urls.some((u) => u.includes('/login'))).toBe(false);
    expect(urls.some((u) => u.includes('/contact'))).toBe(true);
  });

  it('excludes /privacy pages', () => {
    const links = [{ href: '/privacy', text: 'Privacy Policy' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBe(0);
  });

  it('excludes /cart page', () => {
    const links = [{ href: '/cart', text: 'Shopping Cart' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBe(0);
  });

  it('scores anchor text "get in touch" positively', () => {
    const links = [{ href: '/reach', text: 'Get in Touch' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    // anchor text matches contactTextPatterns but path doesn't match contactPathPatterns
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.signals.some((s) => s.includes('anchor text'))).toBe(true);
  });

  it('deduplicates the same path', () => {
    const links = [
      { href: '/contact', text: 'Contact' },
      { href: '/contact/', text: 'Contact Us' },
      { href: '/contact?ref=nav', text: 'Contact' },
    ];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    // /contact and /contact/ resolve to same dedupeKey
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('ignores external links', () => {
    const links = [{ href: 'https://other.com/contact', text: 'Contact' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBe(0);
  });

  it('ignores mailto: links', () => {
    const links = [{ href: 'mailto:hello@example.com', text: 'Email us' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBe(0);
  });

  it('ranks /support/contact as a positive candidate', () => {
    const links = [{ href: '/support/contact', text: 'Support' }];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('returns results sorted by descending score', () => {
    const links = [
      { href: '/about', text: 'About us' },
      { href: '/contact', text: 'Contact Us' },
      { href: '/get-in-touch', text: 'Get in touch' },
    ];
    const results = scoreContactLinks(links, BASE, DEFAULT_CONFIG);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});
