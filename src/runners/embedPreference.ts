/**
 * When a hosted embed is the better answer than the native form we matched.
 *
 * A site whose contact form is a HubSpot, Typeform or Jotform embed was being
 * reported as having NO contact form — while the Form Tester listed the embed
 * on screen for the very same run. `hutch.agency` is the case: the contact form
 * sits on `/contact-us` as a HubSpot iframe, and a person opening the page sees
 * it immediately.
 *
 * The cause was not, as first assumed, that discovery cannot find an embed-only
 * page. Discovery picks `/contact-us` correctly and the embed IS detected on it.
 * What happened is narrower: the site's **footer newsletter sign-up** appears on
 * every page, including `/contact-us`. That newsletter becomes the page's best
 * native form, and the honesty guard — "the only form here is a newsletter, so
 * this is not a contact form" — fires on its kind alone, without ever consulting
 * the embed beside it.
 *
 * That guard is right about the newsletter and wrong about the page. A footer
 * sign-up is not evidence that a contact form is absent; it is evidence that a
 * footer exists. Almost every agency site has one, which is why this is common
 * rather than exotic.
 *
 * So the question this answers is deliberately narrow: given that the best
 * native form is a utility form, does the page hold something better? FR-95.
 */

/** Form kinds that are never a contact form, however they score. */
const UTILITY_KINDS = new Set(['search', 'newsletter', 'login']);

/**
 * True when the matched native form is a utility form AND a hosted embed is
 * present on the same page — in which case the embed is what the page is really
 * offering, and the verdict should describe it instead.
 *
 * Deliberately NOT a scoring contest. An embed cannot be scored the way a native
 * form is (its fields live cross-origin and cannot be read), so this asks only
 * whether the native answer is one we already know to be wrong.
 */
export function embedBeatsNativeForm(nativeFormKind: string | undefined, embedCount: number): boolean {
  if (embedCount <= 0) return false;
  return UTILITY_KINDS.has(nativeFormKind ?? '');
}

/**
 * Why the page was reported as an embed when a native form was also present.
 *
 * Stated plainly, because the alternative reads as a contradiction: the run
 * found a form, and is reporting a different one. Naming the utility form is
 * what makes the choice legible instead of arbitrary.
 */
export function embedOverUtilityNote(nativeFormKind: string | undefined, providers: string): string {
  const what =
    nativeFormKind === 'search'
      ? 'a search box'
      : nativeFormKind === 'login'
        ? 'a login form'
        : 'a newsletter sign-up';
  return `The only native form on this page is ${what}, but a ${providers} form is embedded here — that is the contact form, so it is what we report.`;
}
