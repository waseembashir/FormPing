/**
 * A site that answers 200 with a crash, suspension or parking page is down,
 * whatever its status code says. These pin both halves: the known failure pages
 * are caught, and a working page that merely mentions one of the phrases is not.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isBrokenPage, MAX_ERROR_PAGE_CHARS } from '@/lib/siteWatch/brokenPage';
import { checkUptime } from '@/lib/siteWatch/checks';
import { describeFailure } from '@/lib/siteWatch/failures';

const WP_DB_ERROR =
  '<!DOCTYPE html><html><head><title>Database Error</title></head><body><h1>Error establishing a database connection</h1></body></html>';

describe('isBrokenPage', () => {
  it.each([
    ['WordPress database error', WP_DB_ERROR],
    ['WordPress critical error', '<p>There has been a critical error on this website.</p>'],
    ['PHP fatal error', '<br />\n<b>Fatal error</b>:  Uncaught Error: Call to undefined function'],
    ['cPanel suspension', '<h1>Account Suspended</h1><p>This Account has been suspended.</p>'],
    ['parked domain', '<h1>example.com</h1><p>This domain may be for sale!</p>'],
  ])('catches a %s page', (_name, body) => {
    expect(isBrokenPage(body)).toBe(true);
  });

  it('leaves an ordinary page alone', () => {
    expect(isBrokenPage('<html><body><h1>Welcome to Example Dental</h1></body></html>')).toBe(false);
    expect(isBrokenPage('')).toBe(false);
  });

  it('does not flag a full page that only quotes a marker', () => {
    const article =
      '<article><h1>How to fix "Error establishing a database connection"</h1>' +
      '<p>' + 'Real content. '.repeat(MAX_ERROR_PAGE_CHARS / 10) + '</p></article>';
    expect(article.length).toBeGreaterThan(MAX_ERROR_PAGE_CHARS);
    expect(isBrokenPage(article)).toBe(false);
  });
});

describe('checkUptime', () => {
  afterEach(() => vi.unstubAllGlobals());

  const serve = (body: string, status = 200) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));

  it('reports a 200 error page as down, with the reason', async () => {
    serve(WP_DB_ERROR);
    const r = await checkUptime('https://example.com');
    expect(r.classification).toBe('down');
    expect(r.statusCode).toBe(200);
    expect(r.failure).toBe('broken_page');
    expect(describeFailure('uptime', r.failure).tone).toBe('danger');
  });

  it('still reports a working page as up', async () => {
    serve('<html><body><h1>Welcome</h1></body></html>');
    const r = await checkUptime('https://example.com');
    expect(r.classification).toBe('up');
    expect(r.failure).toBeUndefined();
  });
});
