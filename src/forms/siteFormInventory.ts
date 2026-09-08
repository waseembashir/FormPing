import type { Browser, Page } from 'playwright';
import type { AppConfig, DetectedFormField, FormCandidate, FormKind, FormOutcome, SiteForm, TrackingParams } from '../types.js';
import { extractForms, formAbout, type FormInfo } from './findContactForm.js';
import { detectEmbeds } from './detectEmbeds.js';
import { fillForm } from './fillForm.js';
import { captureFormShot, captureEmbedShot } from './captureFormShot.js';
import { classifyFormKind, meaningfulFields, ownFields, detectTrackingParams, isLeadForm, isMarketingParam } from '../runners/formFacts.js';
import { fetchHtml } from '../browser/playwrightClient.js';
import { loadHtml, extractLinks } from '../utils/dom.js';
import { resolveHref, isSameOrigin } from '../utils/url.js';
import { fetchSitemapUrls } from '../discovery/sitemap.js';
import { logger } from '../utils/logger.js';

/**
 * Site-level form inventory (FR-68 + FR-76).
 *
 * The single-page flow discovers ONE contact page and tests it. This crawls the
 * site's reachable pages (nav/footer links + sitemap, bounded) and inventories
 * EVERY form on each — so a site whose forms live on different pages (contact on
 * /contact-us, rental on /rental, demo on /book-a-demo) is fully reported.
 *
 * FR-76: it no longer just detects. In safe/live mode it also FILLS every lead
 * form it finds (contact / a real multi-field "other" — never search / newsletter
 * / login), recording a per-form `outcome` so the report can honestly say
 * "Filled ✓" on each. It never submits — a live submit stays the primary form's
 * job (runSingleSite) and the per-form opt-in button; detect-only never fills.
 */

// Slugs most likely to hold a lead form — crawled first so the budget is spent well.
const FORM_SLUG = /(contact|rental|demo|quote|evaluation|book|get-in-touch|request|trial|support|pricing|enquir|apply|career|subscribe|sign-?up)/i;
const POOL_CAP = 12;
const RENDER_TIMEOUT = 12_000;
const SETTLE_TIMEOUT = 2_500;

function toFields(f: FormInfo): DetectedFormField[] {
  return f.fields.map((x) => ({ label: x.label || x.placeholder || x.name, type: x.type, name: x.name }));
}

/** "What it's about": nearest heading, else a short submit-button label. */
// Naming a form is shared with the single-page flow (findContactForm), so the
// two surfaces can never call the same form different things. FR-73.
const aboutOf = formAbout;

/** Build the FormCandidate fillForm needs (it only reads `index`; the rest keeps
 *  the shape valid + carries fields/kind for logging). */
function toCandidate(f: FormInfo, kind: FormKind): FormCandidate {
  return {
    index: f.index,
    identifier: { id: f.id, name: f.name, action: f.action, method: f.method },
    score: 0,
    signals: [],
    negativeSignals: [],
    kind,
    location: (f.location.landmark || f.location.heading || f.location.anchorId)
      ? {
          ...(f.location.landmark ? { landmark: f.location.landmark } : {}),
          ...(f.location.heading ? { heading: f.location.heading } : {}),
          ...(f.location.anchorId ? { anchorId: f.location.anchorId } : {}),
        }
      : undefined,
    fields: toFields(f),
  };
}

function shortErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n')[0]!.replace(/^[a-z]+:\s*/i, '').slice(0, 120);
}

function shortPath(u: string): string {
  try { return new URL(u).pathname || '/'; } catch { return u; }
}

/** Canonical page URL — drop hash + a trailing slash so "/x/" and "/x" are the
 *  SAME page and never crawled (and counted) twice. FR-76. */
function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    x.pathname = x.pathname.replace(/\/+$/, '') || '/';
    return x.toString();
  } catch {
    return u;
  }
}

/** Same page, ignoring a trailing slash — used to spot the contact form the main
 *  flow will test, so the inventory doesn't fill it a second time. */
function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.host === ub.host && ua.pathname.replace(/\/+$/, '') === ub.pathname.replace(/\/+$/, '');
  } catch {
    return a === b;
  }
}

/** Fill one lead form on an open page, translating the fill result into a plain
 *  per-form outcome. Never submits. Best-effort — a throw becomes `failed`. */
async function fillLeadForm(page: Page, f: FormInfo, kind: FormKind, config: AppConfig): Promise<FormOutcome> {
  // A hidden / multi-step form can't be blind-filled reliably from the inventory
  // crawl — report it detected rather than attempting a flaky fill.
  if (!f.visible) return { state: 'skipped', note: 'hidden or multi-step form' };
  try {
    // fillForm never submits — it only enters values — so this is safe in any
    // mode; a live submit stays the primary form's job + the per-form button.
    //
    // Skip the per-form AI honeypot check here (FR-76 perf): honeypots only bite
    // at SUBMISSION (a filled trap field makes the submit silently fail), and the
    // inventory never submits — so the AI round-trip per form is pure cost with no
    // benefit. The primary contact form (the one that IS submitted in live mode)
    // still gets the AI check on its own fill path in runSingleSite.
    const fillConfig: AppConfig = config.aiProvider === 'off' ? config : { ...config, aiProvider: 'off' };
    const fr = await fillForm(page, toCandidate(f, kind), fillConfig);
    if (fr.filledFields.length > 0) {
      const multi = fr.stepsTraversed > 1 || fr.wizardContainerUsed;
      return { state: 'filled', filledCount: fr.filledFields.length, ...(multi ? { note: 'multi-step' } : {}) };
    }
    return { state: 'skipped', note: 'no fillable fields reached' };
  } catch (err) {
    return { state: 'failed', note: shortErr(err) };
  }
}

/** Lead forms first, then marketing, then utility — for a sensible report order. */
const KIND_RANK: Record<string, number> = { contact: 0, other: 1, newsletter: 2, login: 3, search: 4, 'third-party': 5 };

/**
 * How many forms we photograph per run — lead forms and real embeds share this
 * budget. Evidence for the forms a user actually reads, without turning a
 * whole-site scan into a screenshot job. FR-73.
 *
 * Raised from 4: a site with four lead forms left every embed unphotographed,
 * so the report showed "no screenshot" beside forms that genuinely exist. Six
 * covers the great majority of sites outright, at roughly a second more per run.
 * FR-81.
 */
const SHOT_CAP = 6;

interface NativeRec {
  type: 'native';
  url: string;
  /** A CAPTCHA widget on THIS form — not merely on the page. FR-73. */
  captcha: boolean;
  /** Bot-protection markup somewhere on the page this form lives on. FR-73. */
  pageProtection: boolean;
  about: string;
  kind: FormKind;
  action: string;
  anchorId: string;
  shot: string | null;
  meaningful: DetectedFormField[];
  hiddenFields: { name: string; value: string }[];
  tracking: TrackingParams;
  outcome: FormOutcome;
}
interface EmbedRec {
  type: 'embed';
  url: string;
  pageProtection: boolean;
  provider: string;
  /** A real embed can be photographed too — it is just not a <form>. FR-81. */
  shot: string | null;
}

export async function inventorySiteForms(
  inputUrl: string,
  browser: Browser,
  config: AppConfig,
  /** The contact page the MAIN flow will test + fill. The inventory detects that
   *  page's contact form but doesn't fill it — the primary path fills it once,
   *  authoritatively — so we never fill the same form twice. FR-76. */
  primaryContactUrl: string | null = null,
): Promise<SiteForm[]> {
  let start: string;
  try {
    start = new URL(inputUrl).toString();
  } catch {
    return [];
  }

  // ── 1. Candidate page pool: homepage links (same-origin) + sitemap, form-likely first.
  const homeHtml = await fetchHtml(start, config.timeout);
  const startNorm = normUrl(start);
  const sameOrigin = new Set<string>();
  if (homeHtml) {
    for (const { href } of extractLinks(loadHtml(homeHtml))) {
      const resolved = resolveHref(start, href);
      if (resolved && isSameOrigin(resolved, start)) sameOrigin.add(normUrl(resolved));
    }
  }
  for (const u of await fetchSitemapUrls(start, config.timeout)) {
    if (isSameOrigin(u, start)) sameOrigin.add(normUrl(u));
  }
  sameOrigin.delete(startNorm); // start is added first below
  const others = Array.from(sameOrigin);
  const pool = Array.from(
    new Set([startNorm, ...others.filter((u) => FORM_SLUG.test(u)), ...others.filter((u) => !FORM_SLUG.test(u))]),
  ).slice(0, POOL_CAP);
  const willFill = config.mode !== 'detect-only';
  logger.info(`Site inventory: crawling ${pool.length} page(s) for forms${willFill ? ' (filling lead forms)' : ''}`);

  // ── 2. Render each page, extract its native forms + embeds, and (safe/live)
  //       fill each lead form while the page is open.
  const records: NativeRec[] = [];
  const embedRecords: EmbedRec[] = [];
  let filledCount = 0;
  let shots = 0;
  /** Identities of forms already handled this run — a header/footer form is the
   *  same form on every page, and doing the work again teaches us nothing. FR-81. */
  const seenSignatures = new Set<string>();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  ctx.setDefaultNavigationTimeout(RENDER_TIMEOUT);
  try {
    for (const [pageIndex, url] of pool.entries()) {
      // "page N/T" is the real progress signal the UI loader reads to place the
      // cat on its track — we only emit it because the total is genuinely known.
      logger.info(`Site inventory: page ${pageIndex + 1}/${pool.length}`);
      let page: Page | null = null;
      try {
        page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT });
        await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT }).catch(() => { /* bounded */ });
        const forms = await extractForms(page);
        const allEmbeds = await detectEmbeds(page);

        // Drop any "embed" that is really a native form we have already counted.
        //
        // Not every provider uses an iframe. Mailchimp's signup, Gravity Forms
        // and Marketo render ORDINARY HTML into the page, so extractForms picks
        // them up as native forms with real fields — and then detectEmbeds
        // reported the same thing again as a third-party embed with 0 fields, no
        // location and nothing to point at. That fieldless shadow was the
        // "Mailchimp form" nobody could find on the page.
        //
        // If a provider's container IS a <form>, contains one, or sits inside
        // one, the real entry already exists; reporting it twice is a duplicate,
        // and the second copy is strictly worse than the first. FR-81.
        const embeds = [];
        for (const e of allEmbeds) {
          if (!e.selectors?.length) { embeds.push(e); continue; }
          const shadowsNative = await page
            .evaluate((sels: string[]) => sels.some((sel) => {
              const el = document.querySelector(sel);
              if (!el) return false;
              return el.tagName === 'FORM' || !!el.querySelector('form') || !!el.closest('form');
            }), e.selectors)
            .catch(() => false);
          if (!shadowsNative) embeds.push(e);
        }
        // Page-level bot protection. Until FR-73 this single page-wide regex was
        // stamped onto EVERY form on the page, so a search box came back "CAPTCHA
        // protected". It is now kept as what it is — a fact about the page — while
        // each form carries its own widget check from extractForms.
        const pageProtection = /recaptcha|hcaptcha|turnstile|g-recaptcha/i.test(await page.content());

        for (const form of forms) {
          // A form nobody can see is not a form we can report.
          //
          // The inventory used to record every <form> element on the page,
          // filtering only at FILL time. So a hidden modal or duplicate copy was
          // listed beside the real one — the same page appearing twice with
          // different field counts, and a URL that shows no form (or the same
          // form) when you open it. It also cannot be screenshotted, pointed at
          // or verified, which is everything the report is supposed to offer.
          //
          // The primary flow still handles hidden multi-step forms; that lives
          // in findContactForm and is untouched. FR-81.
          if (!form.visible) continue;

          const allFields = toFields(form);
          const kind = classifyFormKind({ fields: allFields, submitText: form.submitText, allText: form.allText });
          const meaningful = meaningfulFields(allFields);
          // Hidden MARKETING inputs only — utm_*, gclid, fbclid… (not framework nonces
          // /ids, which are noise). Shown as name=value in the disclosure; deduped. FR-76.
          const seenHidden = new Set<string>();
          const hiddenFields = form.fields
            .filter((x) => x.type === 'hidden' && x.name && isMarketingParam(x.name) && !seenHidden.has(x.name) && seenHidden.add(x.name))
            .map((x) => ({ name: x.name, value: x.value ?? '' }));
          const lead = isLeadForm(kind, ownFields(meaningful, kind).length);

          // The contact form on the page the main flow will test is filled there,
          // once — so detect it here but don't re-fill it.
          const isPrimaryContact = kind === 'contact' && primaryContactUrl !== null && samePage(url, primaryContactUrl);

          // The form's identity, computed HERE rather than only at dedupe time.
          //
          // A form in the site header or footer appears on every page, and we
          // were filling it again on each one — 14 fills for 4 distinct forms on
          // a real site. That is wasted time and, worse, repeated test data typed
          // into one client's form for no extra information. It also made the
          // loader ("found 15 forms · filled 14") contradict the report ("4 forms
          // · filled 3"), because one counted page instances and the other
          // counted forms. Recognise a repeat before doing the work. FR-81.
          const sig = `${kind}|${meaningful.length}|${meaningful
            .map((f) => (f.name || f.label || f.type).toLowerCase())
            .sort()
            .join(',')}`;
          const alreadySeen = seenSignatures.has(sig);
          seenSignatures.add(sig);

          // Evidence for the forms a user will actually read — lead forms only,
          // capped per run, best-effort. A utility search box needs no portrait. FR-73.
          let shot: string | null = null;
          if (lead && !alreadySeen && shots < SHOT_CAP) {
            shot = await captureFormShot(page, form.index);
            if (shot) shots += 1;
          }

          let outcome: FormOutcome = { state: 'detected' };
          if (lead && alreadySeen) {
            // Same form, another page. Already filled where we first met it; the
            // dedupe below folds this record into that entry and counts the page.
            outcome = { state: 'detected', note: 'same form, already filled on another page' };
          } else if (lead) {
            // Per-form progress the UI streams into a live narrative ("found a
            // rental form… filled it") — real events, one per DISTINCT lead form,
            // so the running count matches the report that follows it.
            logger.info(`Site inventory: found a ${kind} form on ${shortPath(url)}`);
            if (willFill && !isPrimaryContact) {
              outcome = await fillLeadForm(page, form, kind, config);
              if (outcome.state === 'filled') {
                filledCount += 1;
                logger.info(`Site inventory: filled the ${kind} form (${outcome.filledCount} fields)`);
              }
            } else if (isPrimaryContact) {
              outcome = { state: 'detected', note: 'tested as the primary contact form' };
            }
          }

          records.push({
            type: 'native',
            url,
            captcha: form.captcha,
            pageProtection,
            about: aboutOf(form),
            kind,
            action: (form.action ?? '').trim(),
            anchorId: form.location.anchorId,
            shot,
            meaningful,
            hiddenFields,
            tracking: detectTrackingParams(allFields),
            outcome,
          });
        }
        for (const embed of embeds) {
          // An embed is the one case where a user CANNOT inspect the form
          // themselves — it is cross-origin — so evidence matters most here. It
          // shares the per-run shot budget with the native forms. FR-81.
          let embedShot: string | null = null;
          if (embed.selectors?.length && shots < SHOT_CAP) {
            embedShot = await captureEmbedShot(page, embed.selectors);
            if (embedShot) shots += 1;
          }
          embedRecords.push({ type: 'embed', url, pageProtection, provider: embed.provider, shot: embedShot });
        }
      } catch (err) {
        logger.debug(`Site inventory: skipped ${url}: ${err}`);
      } finally {
        if (page) await page.close().catch(() => { /* ignore */ });
      }
    }
  } finally {
    await ctx.close().catch(() => { /* ignore */ });
  }
  if (willFill) logger.info(`Site inventory: filled ${filledCount} lead form(s)`);

  // ── 3. Build SiteForm[] + dedupe site-wide forms.
  // Identity = a stable cross-page `action` (collapses the search/newsletter that
  // sit on every page into one entry); forms with no shared action stay distinct
  // per page (so Contact / Rental / Demo remain separate). Seen on 3+ pages = site-wide.
  const byKey = new Map<string, SiteForm>();
  // DISTINCT pages a form was seen on — not how many records matched it.
  //
  // `seenOn` used to be a counter bumped per matching record, so a page carrying
  // the same form twice inflated it. A real run reported a form as "GLOBAL · ON
  // ALL 17 PAGES" while having crawled 2 pages, out of a maximum of 12 — a
  // number that could not describe anything. `siteWide` is derived from it, so
  // the Global badge was wrong for the same reason. FR-81.
  const pagesFor = new Map<string, Set<string>>();
  const bump = (key: string, sf: SiteForm, pageUrl: string) => {
    const pages = pagesFor.get(key) ?? new Set<string>();
    pages.add(normUrl(pageUrl));
    pagesFor.set(key, pages);
    sf.seenOn = pages.size;
    // "Global" means genuinely repeated across the site — a header search, a
    // footer newsletter — so it needs several DISTINCT pages, and can never
    // exceed the number crawled.
    sf.siteWide = pages.size >= 3;
  };

  for (const rec of embedRecords) {
    const key = `embed:${rec.provider.toLowerCase()}`;
    const found = byKey.get(key);
    if (found) {
      bump(key, found, rec.url);
      if (!found.shot && rec.shot) found.shot = rec.shot;
      continue;
    }
    byKey.set(key, {
      url: rec.url, kind: 'third-party', about: rec.provider, formType: 'third-party',
      // We can't see inside a cross-origin embed, so we never claim a CAPTCHA on
      // one — only that the page it sits on carries bot protection. FR-73.
      provider: rec.provider, fieldCount: 0, fields: [], security: { captcha: false, pageProtection: rec.pageProtection },
      tracking: { utm: [], other: [] }, siteWide: false, seenOn: 1,
      outcome: { state: 'detected', note: 'third-party embed — can’t auto-fill' },
      ...(rec.shot ? { shot: rec.shot } : {}),
    });
    pagesFor.set(key, new Set([normUrl(rec.url)]));
  }

  for (const rec of records) {
    // Identity is the form's CONTENT — its kind + field signature (names/count) —
    // not its page or action. So the same form appearing on many pages (a header
    // search, a footer newsletter, a reused contact form) collapses into ONE entry
    // marked site-wide, instead of a duplicate per page. FR-76.
    const sig = rec.meaningful.map((f) => (f.name || f.label || f.type).toLowerCase()).sort().join(',');
    const key = `${rec.kind}|${rec.meaningful.length}|${sig}`;
    const found = byKey.get(key);
    if (found) {
      bump(key, found, rec.url);
      // Prefer a real fill outcome if a later copy of the same form was filled.
      if (found.outcome?.state !== 'filled' && rec.outcome.state === 'filled') found.outcome = rec.outcome;
      // Keep whatever evidence we have: the first copy of a site-wide form may
      // have been off-screen or over budget while a later one photographed fine. FR-73.
      if (!found.shot && rec.shot) found.shot = rec.shot;
      if (!found.anchorId && rec.anchorId) found.anchorId = rec.anchorId;
      // A CAPTCHA on any copy is a CAPTCHA on this form.
      if (rec.captcha) found.security.captcha = true;
      // Prefer the primary contact page as the canonical URL, so the UI's "tested"
      // mapping (which matches by page) still lands on this entry.
      if (primaryContactUrl && rec.kind === 'contact' && samePage(rec.url, primaryContactUrl)) found.url = rec.url;
      continue;
    }
    byKey.set(key, {
      url: rec.url, kind: rec.kind, about: rec.about, formType: 'native',
      // Count the form's own fields; a site-wide search input is listed but
      // never counted, so the number matches the form on screen. FR-73.
      fieldCount: ownFields(rec.meaningful, rec.kind).length, fields: rec.meaningful,
      security: { captcha: rec.captcha, pageProtection: rec.pageProtection },
      tracking: rec.tracking, siteWide: false, seenOn: 1, outcome: rec.outcome,
      hiddenFields: rec.hiddenFields,
      ...(rec.anchorId ? { anchorId: rec.anchorId } : {}),
      ...(rec.shot ? { shot: rec.shot } : {}),
    });
    pagesFor.set(key, new Set([normUrl(rec.url)]));
  }

  return Array.from(byKey.values()).sort(
    (a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || b.fieldCount - a.fieldCount,
  );
}
