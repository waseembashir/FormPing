/**
 * FR-86 — a one-second blip must not hide the answer for twelve hours.
 *
 * `DOMAIN_RECHECK_MS` is 12 hours and should be: an expiry date changes once a
 * year and public RDAP endpoints rate-limit. The bug was applying that same 12
 * hours to a lookup that produced nothing, so a transient network failure left
 * an error on the dashboard until the next day.
 *
 * The hold below is the other half of the fix — it exists so that NOT consuming
 * the long throttle doesn't turn into an RDAP request every 60 seconds, which is
 * the minimum monitor interval.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DOMAIN_RETRY_MS,
  clearDomainRetry,
  domainRetryHeld,
  holdDomainRetry,
  resetDomainRetries,
} from '@/lib/siteWatch/domainBackoff';

const T0 = 1_757_000_000_000; // a fixed "now"; the module takes time as an argument

beforeEach(() => resetDomainRetries());

describe('the retry hold', () => {
  it('is not held for a host that has never failed', () => {
    expect(domainRetryHeld('example.com', T0)).toBe(false);
  });

  it('holds a failing host, then lets it go once the wait is over', () => {
    holdDomainRetry('example.com', T0);

    expect(domainRetryHeld('example.com', T0 + 60_000)).toBe(true);
    expect(domainRetryHeld('example.com', T0 + DOMAIN_RETRY_MS - 1)).toBe(true);
    expect(domainRetryHeld('example.com', T0 + DOMAIN_RETRY_MS)).toBe(false);
  });

  it('retries far sooner than the 12-hour success throttle', () => {
    // The point of the whole exercise: half an hour, not half a day.
    expect(DOMAIN_RETRY_MS).toBeLessThan(12 * 60 * 60 * 1000);
    expect(DOMAIN_RETRY_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('holds each host separately — one bad registry does not stall the rest', () => {
    holdDomainRetry('slow.example', T0);
    expect(domainRetryHeld('slow.example', T0 + 1000)).toBe(true);
    expect(domainRetryHeld('fine.example', T0 + 1000)).toBe(false);
  });

  it('is released when a lookup finally succeeds', () => {
    holdDomainRetry('example.com', T0);
    clearDomainRetry('example.com');
    expect(domainRetryHeld('example.com', T0 + 1000)).toBe(false);
  });

  it('forgets an expired hold rather than accumulating hosts forever', () => {
    holdDomainRetry('example.com', T0);
    expect(domainRetryHeld('example.com', T0 + DOMAIN_RETRY_MS)).toBe(false);
    // Asking again after expiry is still false, from a now-empty map.
    expect(domainRetryHeld('example.com', T0 + DOMAIN_RETRY_MS + 1)).toBe(false);
  });
});
