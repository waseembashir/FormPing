import { describe, it, expect } from 'vitest';
import { diffPage, diffSnapshots, totalChanges } from '../src/monitor/diffEngine.js';
import type { PageSnapshot, SiteSnapshot } from '../src/monitor/types.js';

function basePage(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: 'https://example.com/',
    title: 'Example',
    metaDescription: 'Example description',
    metaRobots: 'index,follow',
    canonical: 'https://example.com/',
    h1: 'Welcome',
    textContentHash: 'abc123',
    textContentLength: 100,
    formFields: [],
    buttons: [],
    links: [],
    scripts: [],
    loadTime: 500,
    screenshotPath: null,
    timestamp: '2026-04-26T18:00:00Z',
    fetchedVia: 'fetch',
    ...overrides,
  };
}

describe('diffPage', () => {
  it('returns null when nothing changed', () => {
    const p = basePage();
    expect(diffPage(p, p)).toBeNull();
  });

  it('detects title change with medium severity', () => {
    const old = basePage({ title: 'Old Title' });
    const fresh = basePage({ title: 'New Title' });
    const diff = diffPage(old, fresh);
    expect(diff).not.toBeNull();
    expect(diff!.changes.some((c) => c.includes('Title changed'))).toBe(true);
    expect(diff!.severity).toBe('medium');
  });

  it('detects H1 change with medium severity', () => {
    const diff = diffPage(basePage({ h1: 'Old H1' }), basePage({ h1: 'New H1' }));
    expect(diff!.changes.some((c) => c.includes('H1 changed'))).toBe(true);
  });

  it('detects new required form field with high severity', () => {
    const old = basePage({ formFields: [{ name: 'email', type: 'email', required: true, label: 'Email' }] });
    const fresh = basePage({
      formFields: [
        { name: 'email', type: 'email', required: true, label: 'Email' },
        { name: 'phone', type: 'tel', required: true, label: 'Phone' },
      ],
    });
    const diff = diffPage(old, fresh);
    expect(diff!.severity).toBe('high');
    expect(diff!.changes.some((c) => c.includes('phone'))).toBe(true);
    expect(diff!.changes.some((c) => c.includes('required'))).toBe(true);
  });

  it('detects field becoming required with medium severity', () => {
    const old = basePage({ formFields: [{ name: 'phone', type: 'tel', required: false, label: '' }] });
    const fresh = basePage({ formFields: [{ name: 'phone', type: 'tel', required: true, label: '' }] });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('now required'))).toBe(true);
  });

  it('detects removed form field with high severity', () => {
    const old = basePage({ formFields: [{ name: 'phone', type: 'tel', required: false, label: '' }] });
    const fresh = basePage({ formFields: [] });
    const diff = diffPage(old, fresh);
    expect(diff!.severity).toBe('high');
    expect(diff!.changes.some((c) => c.includes('removed'))).toBe(true);
  });

  it('detects button text change', () => {
    const old = basePage({ buttons: ['Send'] });
    const fresh = basePage({ buttons: ['Get Quote'] });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('Send'))).toBe(true);
    expect(diff!.changes.some((c) => c.includes('Get Quote'))).toBe(true);
  });

  it('detects new tracking script', () => {
    const old = basePage({ scripts: ['/main.js'] });
    const fresh = basePage({ scripts: ['/main.js', 'https://www.googletagmanager.com/gtm.js'] });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('gtm.js'))).toBe(true);
  });

  it('detects canonical URL change with medium severity', () => {
    const old = basePage({ canonical: 'https://example.com/' });
    const fresh = basePage({ canonical: 'https://example.com/new/' });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('Canonical'))).toBe(true);
    expect(diff!.severity).toBe('medium');
  });

  it('detects robots meta change with high severity', () => {
    const old = basePage({ metaRobots: 'index,follow' });
    const fresh = basePage({ metaRobots: 'noindex,nofollow' });
    const diff = diffPage(old, fresh);
    expect(diff!.severity).toBe('high');
  });

  it('detects major text content change', () => {
    const old = basePage({ textContentHash: 'aaa', textContentLength: 100 });
    const fresh = basePage({ textContentHash: 'bbb', textContentLength: 200 });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('Major text content'))).toBe(true);
  });

  it('does not flag tiny text edits as major', () => {
    const old = basePage({ textContentHash: 'aaa', textContentLength: 1000 });
    const fresh = basePage({ textContentHash: 'bbb', textContentLength: 1010 });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('Major'))).toBe(false);
  });
});

describe('diffSnapshots', () => {
  function makeSnap(pages: PageSnapshot[]): SiteSnapshot {
    return {
      site: 'example.com',
      rootUrl: 'https://example.com/',
      timestamp: '2026-04-26T18:00:00Z',
      pagesScanned: pages.length,
      pages,
    };
  }

  it('returns empty when both snapshots are identical', () => {
    const snap = makeSnap([basePage()]);
    expect(diffSnapshots(snap, snap)).toEqual([]);
  });

  it('flags new page as medium', () => {
    const old = makeSnap([basePage()]);
    const fresh = makeSnap([basePage(), basePage({ url: 'https://example.com/about' })]);
    const result = diffSnapshots(old, fresh);
    expect(result.length).toBe(1);
    expect(result[0]!.severity).toBe('medium');
    expect(result[0]!.changes[0]).toMatch(/new/i);
  });

  it('flags removed page as high', () => {
    const old = makeSnap([basePage(), basePage({ url: 'https://example.com/old' })]);
    const fresh = makeSnap([basePage()]);
    const result = diffSnapshots(old, fresh);
    expect(result.length).toBe(1);
    expect(result[0]!.severity).toBe('high');
  });
});

describe('totalChanges', () => {
  it('counts changes across pages', () => {
    expect(
      totalChanges([
        { url: '/a', changes: ['x', 'y'], severity: 'low' },
        { url: '/b', changes: ['z'], severity: 'high' },
      ]),
    ).toBe(3);
  });

  it('returns 0 for empty input', () => {
    expect(totalChanges([])).toBe(0);
  });
});
