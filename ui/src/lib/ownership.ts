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
