import { describe, it, expect } from 'vitest';
import { extractLocs } from '../src/discovery/sitemap.js';

describe('extractLocs', () => {
  it('extracts URLs from a flat urlset sitemap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-04-01</lastmod>
  </url>
  <url>
    <loc>https://example.com/about/</loc>
  </url>
  <url>
    <loc>https://example.com/contact/</loc>
  </url>
</urlset>`;
    expect(extractLocs(xml)).toEqual([
      'https://example.com/',
      'https://example.com/about/',
      'https://example.com/contact/',
    ]);
  });

  it('extracts child sitemap URLs from a sitemap index', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-pages.xml</loc>
    <lastmod>2026-04-01</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-posts.xml</loc>
  </sitemap>
</sitemapindex>`;
    expect(extractLocs(xml)).toEqual([
      'https://example.com/sitemap-pages.xml',
      'https://example.com/sitemap-posts.xml',
    ]);
  });

  it('decodes XML entities in URLs', () => {
    const xml = `<urlset><url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>`;
    expect(extractLocs(xml)).toEqual(['https://example.com/?a=1&b=2']);
  });

  it('trims whitespace around URLs', () => {
    const xml = `<urlset>
      <url>
        <loc>
          https://example.com/contact/
        </loc>
      </url>
    </urlset>`;
    expect(extractLocs(xml)).toEqual(['https://example.com/contact/']);
  });

  it('handles XML with mixed-case loc tags', () => {
    const xml = `<urlset><url><LOC>https://example.com/a</LOC></url></urlset>`;
    expect(extractLocs(xml)).toEqual(['https://example.com/a']);
  });

  it('ignores empty <loc/> tags', () => {
    const xml = `<urlset>
      <url><loc>https://example.com/real</loc></url>
      <url><loc></loc></url>
    </urlset>`;
    expect(extractLocs(xml)).toEqual(['https://example.com/real']);
  });

  it('returns empty array for non-sitemap XML', () => {
    expect(extractLocs('<html><body>not a sitemap</body></html>')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(extractLocs('')).toEqual([]);
  });

  it('handles a WordPress-style sitemap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>https://example.com/</loc><lastmod>2026-04-26T18:00:00+00:00</lastmod></url>
<url><loc>https://example.com/about/</loc></url>
<url><loc>https://example.com/contact/</loc></url>
<url><loc>https://example.com/services/</loc></url>
</urlset>`;
    expect(extractLocs(xml)).toHaveLength(4);
    expect(extractLocs(xml)).toContain('https://example.com/contact/');
  });
});
