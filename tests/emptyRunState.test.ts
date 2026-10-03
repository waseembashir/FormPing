/**
 * What an empty results panel should say.
 *
 * Both the Form Tester and Content Changes keep the URL you typed across
 * visits — which is right, it is what you would press Run with — while their
 * empty states said "Enter a URL above". The screen then asked for something
 * already on it, beside a Run button that would have worked.
 *
 * That is not a wording nit. A person reading it reasonably concludes the app
 * lost their input, and the obvious response is to retype what is already
 * there. One rule, used by both panels, so the two tabs cannot drift into
 * saying different things about the same situation.
 */

import { describe, it, expect } from 'vitest';
import { emptyStateSite } from '@/lib/emptyRunState';

describe('when there is nothing in the box', () => {
  it('has nothing to name, so the panel asks for a URL', () => {
    expect(emptyStateSite(undefined)).toBeNull();
    expect(emptyStateSite(null)).toBeNull();
    expect(emptyStateSite('')).toBeNull();
  });

  it('treats whitespace as nothing', () => {
    // A box holding only spaces looks empty, so it must read as empty.
    expect(emptyStateSite('   ')).toBeNull();
  });
});

describe('when a URL is there', () => {
  it('names the site rather than the whole URL', () => {
    // The sentence reads better and a long path adds nothing to "we have no
    // results for this site yet".
    expect(emptyStateSite('https://example.com/contact/sales?utm=x')).toBe('example.com');
  });

  it('folds www away, as every other surface does', () => {
    expect(emptyStateSite('https://www.example.com/contact')).toBe('example.com');
  });

  it('copes with a URL typed without a scheme', () => {
    // People type "example.com". That is a URL to them, and the panel should
    // not fall back to asking for one.
    expect(emptyStateSite('example.com/contact')).toBe('example.com');
  });

  it('still names something when the value is nonsense', () => {
    // A typo is still something the user typed. Telling them to enter a URL
    // while their mistake sits in the box is the same contradiction in a
    // smaller form, so the panel names whatever it can rather than falling
    // back to "enter a URL".
    const named = emptyStateSite('ht!tp://not a url');
    expect(named).toBeTruthy();
    expect(named!.length).toBeGreaterThan(0);
  });

  it('bounds what it shows, so a pasted monster cannot break the sentence', () => {
    const long = 'x'.repeat(500);
    expect(emptyStateSite(long)!.length).toBeLessThanOrEqual(60);
  });
});
