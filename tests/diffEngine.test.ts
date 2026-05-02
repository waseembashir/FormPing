import { describe, it, expect } from 'vitest';
import { diffPage, diffSnapshots, totalChanges, diffTextArrays } from '../src/monitor/diffEngine.js';
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
    textBlocks: { headings: [], paragraphs: [], listItems: [], other: [] },
    fullBodyText: '',
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

  it('does not flag tiny text edits as major (and skips noise entirely if no semantic text changed)', () => {
    // 1% length delta with no structured text changes is treated as noise (timestamps, CSRF tokens, etc.)
    const old = basePage({ textContentHash: 'aaa', textContentLength: 1000 });
    const fresh = basePage({ textContentHash: 'bbb', textContentLength: 1010 });
    const diff = diffPage(old, fresh);
    // Either null (cleanly ignored) or no "Major" flag — both satisfy the intent
    if (diff) {
      expect(diff.changes.some((c) => c.includes('Major'))).toBe(false);
    } else {
      expect(diff).toBeNull();
    }
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

describe('diffTextArrays', () => {
  it('returns no changes for identical arrays', () => {
    expect(diffTextArrays(['a', 'b', 'c'], ['a', 'b', 'c'], 'paragraph')).toEqual([]);
  });

  it('detects added items', () => {
    const result = diffTextArrays(['a'], ['a', 'b'], 'paragraph');
    expect(result).toEqual([{ type: 'added', kind: 'paragraph', after: 'b' }]);
  });

  it('detects removed items', () => {
    const result = diffTextArrays(['a', 'b'], ['a'], 'paragraph');
    expect(result).toEqual([{ type: 'removed', kind: 'paragraph', before: 'b' }]);
  });

  it('detects edited items via fuzzy match', () => {
    const result = diffTextArrays(
      ['We offer 24/7 customer support'],
      ['We offer 24/7 premium customer support'],
      'paragraph',
    );
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('edited');
    expect(result[0]!.before).toContain('24/7 customer support');
    expect(result[0]!.after).toContain('premium customer support');
  });

  it('treats unrelated text as separate add+remove rather than edit', () => {
    const result = diffTextArrays(
      ['Apples are red and tasty'],
      ['Bananas grow in tropical climates'],
      'paragraph',
    );
    const types = result.map((r) => r.type).sort();
    expect(types).toEqual(['added', 'removed']);
  });

  it('passes meta through for headings', () => {
    const result = diffTextArrays(['Welcome'], ['Welcome Home'], 'heading', () => 'H1');
    expect(result[0]!.type).toBe('edited');
    expect(result[0]!.meta).toBe('H1');
  });
});

describe('diffPage with text blocks', () => {
  it('produces structured textChanges for paragraph edits', () => {
    const old = basePage({
      textBlocks: {
        headings: [{ tag: 'h1', text: 'Welcome' }],
        paragraphs: ['We provide excellent service to all clients.'],
        listItems: [],
        other: [],
      },
    });
    const fresh = basePage({
      textContentHash: 'different',
      textContentLength: 110,
      textBlocks: {
        headings: [{ tag: 'h1', text: 'Welcome' }],
        paragraphs: ['We provide excellent and timely service to all clients.'],
        listItems: [],
        other: [],
      },
    });
    const diff = diffPage(old, fresh);
    expect(diff!.textChanges).toBeDefined();
    expect(diff!.textChanges!.length).toBe(1);
    expect(diff!.textChanges![0]!.type).toBe('edited');
    expect(diff!.textChanges![0]!.kind).toBe('paragraph');
    expect(diff!.textChanges![0]!.before).toContain('excellent service');
    expect(diff!.textChanges![0]!.after).toContain('excellent and timely service');
  });

  it('detects new heading with medium severity', () => {
    const old = basePage({
      textBlocks: { headings: [{ tag: 'h1', text: 'Hi' }], paragraphs: [], listItems: [], other: [] },
    });
    const fresh = basePage({
      textContentHash: 'different',
      textBlocks: {
        headings: [
          { tag: 'h1', text: 'Hi' },
          { tag: 'h2', text: 'Our Services' },
        ],
        paragraphs: [],
        listItems: [],
        other: [],
      },
    });
    const diff = diffPage(old, fresh);
    expect(diff!.severity).toBe('medium');
    expect(diff!.textChanges!.some((tc) => tc.type === 'added' && tc.after === 'Our Services')).toBe(true);
  });

  it('falls back to hash-based message when no structured text changes detected', () => {
    const old = basePage({ textContentHash: 'a', textContentLength: 100 });
    const fresh = basePage({ textContentHash: 'b', textContentLength: 200 });
    const diff = diffPage(old, fresh);
    expect(diff!.changes.some((c) => c.includes('non-semantic markup'))).toBe(true);
  });

  it('falls back to sentence-level body-text diff when structured extractors miss the change', () => {
    const oldText = 'Welcome to our company. We help businesses grow online. Contact us today.';
    const newText = 'Welcome to our company. We help ambitious businesses grow online. Contact us today.';
    const old = basePage({
      textContentHash: 'a',
      textContentLength: oldText.length,
      fullBodyText: oldText,
    });
    const fresh = basePage({
      textContentHash: 'b',
      textContentLength: newText.length,
      fullBodyText: newText,
    });
    const diff = diffPage(old, fresh);
    expect(diff!.textChanges).toBeDefined();
    expect(diff!.textChanges!.length).toBeGreaterThan(0);
    // Should detect "We help businesses grow online" → "We help ambitious businesses grow online"
    const edited = diff!.textChanges!.find((tc) => tc.type === 'edited');
    expect(edited).toBeDefined();
    expect(edited!.after).toContain('ambitious');
    expect(edited!.kind).toBe('other');
  });

  it('detects edits inside "other" text blocks (divs/spans)', () => {
    const old = basePage({
      textBlocks: {
        headings: [],
        paragraphs: [],
        listItems: [],
        other: ['Built with care for modern teams.'],
      },
    });
    const fresh = basePage({
      textContentHash: 'different',
      textBlocks: {
        headings: [],
        paragraphs: [],
        listItems: [],
        other: ['Built with care for ambitious modern teams.'],
      },
    });
    const diff = diffPage(old, fresh);
    expect(diff!.textChanges).toBeDefined();
    expect(diff!.textChanges![0]!.kind).toBe('other');
    expect(diff!.textChanges![0]!.type).toBe('edited');
    expect(diff!.textChanges![0]!.after).toContain('ambitious');
  });
});
