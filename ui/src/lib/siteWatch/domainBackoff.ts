/**
 * How soon to ask a domain registry again after it failed to answer. FR-86.
 *
 * The success throttle is twelve hours, and rightly so — an expiry date changes
 * once a year and public RDAP endpoints rate-limit. But that same twelve hours
 * was being applied to failures, so a one-second network blip left `fetch
 * failed` on a dashboard until the following day.
 *
 * The two cases are not the same:
 *
 *   PERMANENT (this TLD is not in RDAP, the registry publishes no expiry) —
 *     keep the long throttle. Asking again in half an hour cannot help, and
 *     hammering a public service for a field it does not have is rude.
 *   TEMPORARY (unreachable, rate-limited, registry having a bad day) —
 *     try again soon. The answer is likely there; we just could not get it.
 *
 * Temporary retries are held here rather than in the schedule row. The minimum
 * monitor interval is 60 seconds, so without a hold a temporary failure would
 * mean one RDAP request per domain per minute for as long as it lasted — which
 * is exactly the hammering the original throttle existed to prevent.
 *
 * In memory, on globalThis, for the same reasons as FR-87's save-failure
 * registry: no migration, and Next.js bundles this module separately per route
 * so a plain module-level Map would give each bundle its own copy. It resets on
 * restart, which costs at most one extra RDAP lookup per domain per deploy.
 */

/** How long to wait after a failure that waiting can actually fix. */
export const DOMAIN_RETRY_MS = 30 * 60 * 1000;

const retryAt: Map<string, number> =
  ((globalThis as Record<string, unknown>).__fpDomainBackoff as Map<string, number> | undefined) ??
  new Map<string, number>();
(globalThis as Record<string, unknown>).__fpDomainBackoff = retryAt;

/** True while this host is inside its post-failure cooling-off period. */
export function domainRetryHeld(host: string, now: number): boolean {
  const at = retryAt.get(host);
  if (at === undefined) return false;
  if (now >= at) {
    retryAt.delete(host);
    return false;
  }
  return true;
}

/** Hold off on this host for DOMAIN_RETRY_MS after a temporary failure. */
export function holdDomainRetry(host: string, now: number): void {
  retryAt.set(host, now + DOMAIN_RETRY_MS);
}

/** Forget any hold — the lookup worked, or the failure turned out permanent. */
export function clearDomainRetry(host: string): void {
  retryAt.delete(host);
}

/** Test seam. */
export function resetDomainRetries(): void {
  retryAt.clear();
}
