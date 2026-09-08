import type { Page } from 'playwright';

/**
 * Third-party embed form detection (FR-28).
 *
 * Many sites don't hand-code a native <form>; they drop in a hosted form from
 * Typeform / HubSpot / Calendly / Jotform / Tally / Google Forms / etc. Those
 * render inside a cross-origin <iframe> (or are injected by a provider script),
 * so `document.querySelectorAll('form')` finds nothing and the form-tester would
 * report "No contact form found" — even though a working form is right there.
 *
 * We can't auto-FILL a cross-origin embed (same-origin policy blocks reaching
 * into the iframe), but we can DETECT it from the parent page — the <iframe src>,
 * the provider's embed <script src>, or the container element the provider hooks
 * into are all visible to us. Reporting "Found a Typeform embed — the form
 * exists, not auto-testable" is far more useful than a blank miss.
 */

export interface EmbedDetection {
  /** Human provider name, e.g. "Typeform". */
  provider: string;
  /** CSS selectors that should match the rendered embed on the page — what to
   *  screenshot and what to point the user at. An embed is not a <form>, so the
   *  usual by-index capture cannot find it. FR-81. */
  selectors?: string[];
  /** How we spotted it. */
  kind: 'iframe' | 'script' | 'container';
  /** The matched src / selector (trimmed) — for the note + debugging. */
  detail: string;
}

interface ProviderRule {
  name: string;
  /** Matched against iframe/script src URLs. */
  url?: RegExp[];
  /** CSS selectors the provider's embed injects into the parent DOM. */
  containers?: string[];
}

// Order matters only for readability; each provider is reported at most once.
const PROVIDERS: ProviderRule[] = [
  { name: 'Typeform', url: [/typeform\.com/i], containers: ['[data-tf-widget]', '[data-tf-live]', '[data-typeform-id]'] },
  { name: 'HubSpot', url: [/hsforms\.(net|com)/i, /js\.hsforms/i, /hubspotusercontent/i], containers: ['.hs-form', '.hbspt-form', '[data-hs-forms-root]'] },
  // GoHighLevel / LeadConnector — its form, survey and booking widgets embed at
  // `/widget/(form|survey|booking)/<id>`, very often on a WHITE-LABELED domain
  // (e.g. links.trusteddds.com), so we match the path, not just the host.
  { name: 'HighLevel', url: [/leadconnectorhq\.com/i, /msgsndr\.com/i, /\/widget\/(form|survey|booking|appointment)s?\//i] },
  { name: 'Calendly', url: [/calendly\.com/i], containers: ['.calendly-inline-widget', '[data-url*="calendly.com"]'] },
  { name: 'Jotform', url: [/jotform\.(com|co)/i], containers: ['.jotform-form', '[id^="JotFormIFrame"]'] },
  { name: 'Tally', url: [/tally\.so/i], containers: ['[data-tally-src]', 'iframe[src*="tally.so"]'] },
  { name: 'Google Forms', url: [/docs\.google\.com\/forms/i] },
  { name: 'Wufoo', url: [/wufoo\.com/i] },
  { name: 'Gravity Forms', url: [/gravityforms/i], containers: ['.gform_wrapper'] },
  { name: 'Formstack', url: [/formstack\.com/i, /formstack\.io/i] },
  { name: 'Marketo', url: [/marketo\.(net|com)/i], containers: ['form[id^="mktoForm"]', '.mktoForm'] },
  { name: 'Paperform', url: [/paperform\.co/i] },
  { name: 'Mailchimp', url: [/list-manage\.com/i], containers: ['#mc_embed_signup'] },
];

/** Scan the loaded page for known third-party embed form providers. */
export async function detectEmbeds(page: Page): Promise<EmbedDetection[]> {
  // Pull raw signals out of the DOM in one pass; keep the provider matching in
  // Node (the page context can't see our regex table cleanly).
  const raw = await page.evaluate(() => {
    const srcs: { kind: 'iframe' | 'script'; value: string }[] = [];
    document.querySelectorAll('iframe[src]').forEach((el) => {
      const v = el.getAttribute('src');
      if (v) srcs.push({ kind: 'iframe', value: v });
    });
    document.querySelectorAll('script[src]').forEach((el) => {
      const v = el.getAttribute('src');
      if (v) srcs.push({ kind: 'script', value: v });
    });
    return srcs;
  });

  const found: EmbedDetection[] = [];
  const seen = new Set<string>();
  const claimed = new Set<string>(); // srcs already matched to a named provider

  const add = (provider: string, kind: EmbedDetection['kind'], detail: string, selectors?: string[]) => {
    if (seen.has(provider)) return;
    seen.add(provider);
    found.push({ provider, kind, detail: detail.slice(0, 200), ...(selectors?.length ? { selectors } : {}) });
  };

  // ── 1. An IFRAME from a form provider is a form. ────────────────────────────
  // The iframe IS the embedded form — there is something on the page to point
  // at, screenshot and open.
  //
  // A SCRIPT is not. Nearly every marketing site loads HubSpot or Mailchimp JS
  // for tracking, and matching on that reported "there is a HubSpot form here"
  // for a page with no form on it — 0 fields, no screenshot, nothing to see when
  // you go and look. A script tag is evidence the site USES a vendor, not that a
  // form is embedded. So script matches are only a hint, confirmed below by
  // actually finding the provider's container in the DOM. FR-81.
  const scriptHints = new Map<string, string>();
  for (const item of raw) {
    for (const p of PROVIDERS) {
      if (!p.url?.some((re) => re.test(item.value))) continue;
      claimed.add(item.value);
      if (item.kind === 'iframe') {
        // The iframe IS the form — point straight at it.
        const esc = item.value.replace(/"/g, '\\"');
        add(p.name, 'iframe', item.value, [`iframe[src="${esc}"]`, ...(p.containers ?? [])]);
      }
      else if (!scriptHints.has(p.name)) scriptHints.set(p.name, item.value);
      break;
    }
  }

  // Generic fallback: an <iframe> whose path looks like a form / survey / quiz /
  // booking widget, from a provider we don't have a named rule for. Reported by
  // host so an unknown builder still surfaces as "there's an embedded form here"
  // instead of a false "no form found". Scoped to form-ish path segments ONLY —
  // deliberately NOT "embed" (YouTube `/embed/…`, Google Maps `/maps/embed`,
  // Spotify, etc. all use it and would false-positive as forms).
  const GENERIC_FORM_PATH = /\/(forms?|survey|quiz|assessment|poll|booking|appointments?|scheduling)\b/i;
  for (const item of raw) {
    if (item.kind !== 'iframe' || claimed.has(item.value)) continue;
    if (GENERIC_FORM_PATH.test(item.value)) {
      let host = item.value;
      try { host = new URL(item.value).host; } catch { /* keep raw */ }
      const escGeneric = item.value.replace(/"/g, '\\"');
      add(host, 'iframe', item.value, [`iframe[src="${escGeneric}"]`]);
    }
  }

  // ── 2. Container pass — the proof a script-loaded form actually rendered. ───
  // Some providers inject a target div without a same-page iframe (HubSpot's
  // createForm target, Marketo's <form id="mktoForm_1">, Mailchimp's
  // #mc_embed_signup). Finding one of those means the form is really on the
  // page. This now runs for script-hinted providers too — it is what promotes a
  // hint into a reported form.
  const containerRules = PROVIDERS.filter((p) => !seen.has(p.name) && p.containers?.length);
  if (containerRules.length) {
    const hits = await page.evaluate(
      (rules: { name: string; containers: string[] }[]) =>
        rules
          .filter((r) => r.containers.some((sel) => document.querySelector(sel)))
          .map((r) => r.name),
      containerRules.map((p) => ({ name: p.name, containers: p.containers! })),
    );
    for (const name of hits) {
      const rule = PROVIDERS.find((p) => p.name === name)!;
      add(name, 'container', rule.containers!.join(', '), rule.containers);
    }
  }

  // Anything still only script-hinted is deliberately NOT reported. The vendor's
  // code is on the page; a form is not. Saying nothing is the honest answer —
  // claiming a form the user cannot find is what this fixes.
  return found;
}
