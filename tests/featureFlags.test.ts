/**
 * FR-74 — the switch that decides whether per-user isolation is live.
 *
 * The flag's job is to make a risky change reversible without a deploy, so the
 * behaviour that matters is what happens when it is NOT set correctly. A flag
 * that only works when configured perfectly has not reduced any risk.
 *
 * The asymmetry is deliberate and is the whole point: off means today's
 * behaviour, which is safe; on means every tool tab starts hiding rows. So
 * anything ambiguous must read as off.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { perUserIsolationEnabled } from '@/lib/featureFlags';

const KEY = 'FEATURE_PER_USER_ISOLATION';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

const withFlag = (value: string | undefined) => {
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  return perUserIsolationEnabled();
};

describe('the flag is off unless it is deliberately on', () => {
  it('is off when nothing is set at all', () => {
    // The state every environment is in until someone decides otherwise,
    // including production on the deploy that first ships this.
    expect(withFlag(undefined)).toBe(false);
  });

  it('is off for an empty or whitespace value', () => {
    // `FEATURE_PER_USER_ISOLATION=` in an env file is a common way to write
    // "not set", and must not read as a yes.
    expect(withFlag('')).toBe(false);
    expect(withFlag('   ')).toBe(false);
  });

  it('is off for anything it does not recognise', () => {
    // A typo must fail towards today's behaviour. If an unrecognised value
    // turned the filter ON, a misspelling would hide people's own work from
    // them -- a silent failure dressed as a feature.
    expect(withFlag('enabled')).toBe(false);
    expect(withFlag('off')).toBe(false);
    expect(withFlag('false')).toBe(false);
    expect(withFlag('0')).toBe(false);
  });
});

describe('the flag turns on for a plain yes', () => {
  it('accepts the spellings a person actually types', () => {
    // Several, because the value gets set by hand in a Railway variables tab
    // and in a local env file, and being strict about which synonym is correct
    // buys nothing -- a failed switch-on looks like the feature not working.
    for (const yes of ['1', 'on', 'true', 'yes']) {
      expect(withFlag(yes)).toBe(true);
    }
  });

  it('ignores case and surrounding whitespace', () => {
    // Copy-paste from a doc or a chat message brings both along.
    expect(withFlag('ON')).toBe(true);
    expect(withFlag(' True ')).toBe(true);
  });
});

describe('the flag is readable at any moment, not frozen at boot', () => {
  it('reflects a change without the module being reloaded', () => {
    // Caching the value at module load would mean the only way to flip it is a
    // restart, which removes most of the reason to have a flag at all.
    expect(withFlag('on')).toBe(true);
    expect(withFlag('off')).toBe(false);
    expect(withFlag('on')).toBe(true);
  });
});
