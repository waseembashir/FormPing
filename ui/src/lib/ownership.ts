/**
 * Who a derived row belongs to.
 *
 * Most rows in this app are not created by a person pressing a button. A
 * scheduled run, its per-URL result, the daily rollup and a change report are
 * all written by a ticker or a background watch — on a timer, with no request
 * and nobody to ask. They can only inherit.
 *
 * That makes inheritance the quiet half of per-user isolation, and the half
 * that fails invisibly: a monitor created through the app looks perfectly
 * owned, while every scheduled result it produces lands ownerless. An ownerless
 * row reads as legacy/shared, so once filtering is on those results stay
 * visible to everyone — which looks like the feature not working rather than
 * like a bug, and gets found by a user rather than a test.
 *
 * So the rule is named here instead of being repeated inline at each call site,
 * where the fourth one written would be the one that forgets. FR-74.
 */

/** Anything that already knows whose it is. */
export interface Owned {
  owner?: string;
}

/**
 * The owner fields to spread onto a row derived from `source`.
 *
 * Returns an empty object rather than `{ owner: undefined }` so the key is
 * absent on the record, which is what "nobody knows" means — the stores then
 * translate that absence into an explicit NULL when they write.
 */
export function inheritedOwner(source: Owned | null | undefined): Owned {
  return source?.owner ? { owner: source.owner } : {};
}

/**
 * Whether a row is visible to the person asking.
 *
 * `scope` is whose view this is, or `undefined` when the question does not
 * apply — the feature is off, or nobody is signed in. Both of those mean "show
 * everything", which is what the app did before any of this existed.
 *
 * A row with no owner is visible to everyone. Those rows predate per-user
 * isolation and nothing can say now who made them, so they stay shared until
 * someone re-runs or claims them. Hiding them would make work disappear for
 * everybody at once, on the deploy that switched the feature on.
 */
export function visibleTo(scope: string | undefined, owner: string | undefined): boolean {
  if (!scope) return true;
  if (!owner) return true;
  return owner === scope;
}

/**
 * The PostgREST `or=` expression that selects what `scope` may see, or null
 * when the query should not be narrowed at all.
 *
 * Returns null for an address containing a comma, parenthesis, quote or
 * backslash. PostgREST parses that expression as a comma-separated list, so
 * such a character would change the filter's MEANING rather than be matched
 * literally — a filter that silently selects the wrong rows is far worse than
 * one that does not run. Google-verified addresses on an allow-listed domain
 * cannot contain them, so this should never trigger; the caller falls back to
 * filtering in memory with `visibleTo`, which is always correct.
 */
export function ownerFilterExpression(scope: string | undefined): string | null {
  if (!scope || /[,()"\\]/.test(scope)) return null;
  return `owner.is.null,owner.eq.${scope}`;
}
