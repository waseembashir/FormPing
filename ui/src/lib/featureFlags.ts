/**
 * Flags that decide whether a finished change is actually switched on.
 *
 * There is one, and it exists because per-user isolation changes every read
 * path behind the four tool tabs at once, from "everything" to "mine". Both
 * ways of getting that wrong are quiet:
 *
 *   - too strict, and a user's own work vanishes from their tab, which reads
 *     as data loss to the person it happens to
 *   - too loose, and nothing appears to have changed, so the feature looks
 *     shipped while everyone still sees everyone
 *
 * Neither announces itself, and both are found by a person rather than by a
 * test. So the filtering ships dark, is switched on deliberately, and can be
 * switched back by changing one variable rather than by shipping a revert.
 *
 * DEFAULT OFF, and the default is the safe one on purpose. Off is exactly
 * today's behaviour, so a missing or misspelt value leaves the app working as
 * it always has. Defaulting to on would mean a typo in an environment variable
 * silently hides people's work from them.
 */

/** Values that count as "yes". Anything else, including nothing, is no. */
const TRUTHY = new Set(['1', 'on', 'true', 'yes']);

/**
 * Whether the four tool tabs show only the signed-in user's own work.
 *
 * Read from the environment on every call rather than cached at module load:
 * the cost is a string comparison, and caching would mean the only way to
 * change it is a restart -- which is most of what makes a flag worth having.
 *
 * Server-only. There is deliberately no `NEXT_PUBLIC_` variant: the filtering
 * is applied where the rows are read, and a client that could see the flag
 * could not do anything with it except disagree with the server.
 */
export function perUserIsolationEnabled(): boolean {
  return TRUTHY.has((process.env.FEATURE_PER_USER_ISOLATION ?? '').trim().toLowerCase());
}
