import type { SiteForm, SiteResult } from '@/types';
import { runVerdict } from '@/lib/formWatch/verdict';

/**
 * FR-75 — shared vocabulary for the multi-form results log, so the summary index,
 * the Form 1/Form 2 tabs and the per-form panel all name + colour a form the same
 * way. Kept separate from FormFactChips (which is the single-form card's sentence
 * builder) because the report needs per-kind icons + a display name, not a prose line.
 */

export type FormKindLike = SiteForm['kind'];

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'idle';

/** A form's outcome pill: the tested form carries its real verdict; every other
 *  detected form is just "Detected". */
export interface FormStatus {
  label: string;
  tone: Tone;
}

/** One form, normalised for the report so the tab, index row and panel agree. */
export interface PreparedForm {
  form: SiteForm;
  /** 1-based position — "Form 1", "Form 2"… */
  n: number;
  /** The single form we actually filled/submitted this run (verdict is real). */
  tested: boolean;
  status: FormStatus;
  /** Left accent rail: the tested form (ok), an untested lead form (accent), or a
   *  utility input like search/newsletter (info). */
  rail: 'ok' | 'accent' | 'info';
  /** Known only for the tested form (the inventory doesn't walk each form's steps). */
  isMultiStep?: boolean;
  /** The tested form's full verdict sentence (e.g. "Submitted — no confirmation seen"). */
  detail?: string;
  /** Set on the tested form when the detector settled for a weak match: the
   *  plain reason, so the panel can say we are not sure rather than show a
   *  confident pass. Absent on a confident match. FR-73. */
  lowConfidence?: string;
}

/** Status-dot background class per tone — for tabs + index rows. */
export const DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  info: 'bg-info',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-idle',
};

/** Lead-capture forms we'd actually fill (contact / a real "other" like rental).
 *  Newsletter / search / login are utility inputs — never lead forms. */
export function isLeadForm(f: Pick<SiteForm, 'kind' | 'fieldCount'>): boolean {
  if (f.kind === 'contact') return true;
  // A rental/demo form, not a 1-box widget. An unknown count can't clear that
  // bar — but it never reaches here anyway: only hosted embeds lack a count, and
  // those are kind 'third-party'. Written out rather than coerced so the
  // reasoning is visible if that ever changes. FR-84.
  if (f.kind === 'other') return typeof f.fieldCount === 'number' && f.fieldCount > 1;
  return false; // newsletter / search / login
}

/** Short category label for the tabs + index rows ("Contact", "Newsletter"…). */
export function kindLabel(f: Pick<SiteForm, 'kind' | 'provider'>): string {
  switch (f.kind) {
    case 'contact': return 'Contact';
    case 'newsletter': return 'Newsletter';
    case 'search': return 'Search';
    case 'login': return 'Login';
    case 'third-party': return f.provider ? f.provider : 'Third-party';
    default: return 'Form';
  }
}

/** Truncate an about/heading string to a clean, single-line display length. */
function trim(s: string, max = 48): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The panel heading. For a generic "other" form the nearest heading (`about`) is
 *  the most descriptive thing we have, so use it; everything else gets its category
 *  name and shows `about` on the About row instead. */
export function displayName(f: Pick<SiteForm, 'kind' | 'about' | 'provider'>): string {
  switch (f.kind) {
    case 'contact': return 'Contact form';
    case 'newsletter': return 'Newsletter';
    case 'search': return 'Search';
    case 'login': return 'Login form';
    case 'third-party': return f.provider ? `${f.provider} form` : 'Embedded form';
    default: return f.about ? trim(f.about) : 'Form';
  }
}

/** Whether the About row would just repeat the heading (true for an "other" form
 *  whose heading we already promoted into the title). */
export function aboutIsTitle(f: Pick<SiteForm, 'kind'>): boolean {
  return f.kind === 'other';
}

/**
 * The verdict pill for the form the run actually tested. In live mode the run
 * auto-submits, so lead with "Submitted" (green when a thank-you was confirmed,
 * amber when it wasn't) rather than a bare "Attention".
 *
 * Lives here rather than in the report because BOTH surfaces need it now: the
 * multi-form report and the single-form card render the same panel. FR-73.
 */
export function testedStatus(result: SiteResult): FormStatus {
  const { level } = runVerdict(result.reasonCode, result.formFound, result.finalStatus, result.formConfidenceLevel);
  if (result.mode === 'live' && result.submissionAttempted) {
    if (level === 'healthy') return { label: 'Submitted ✓', tone: 'ok' };
    if (level === 'attention') return { label: 'Submitted', tone: 'warn' }; // e.g. no confirmation seen
    if (level === 'failing') return { label: 'Failed', tone: 'danger' };
    return { label: 'Detected', tone: 'info' };
  }
  if (level === 'failing') return { label: 'Failed', tone: 'danger' };
  if (level === 'attention') return { label: 'Attention', tone: 'warn' };
  if (level === 'detected') return { label: 'Detected', tone: 'info' };
  if (result.mode === 'safe') return { label: 'Filled ✓', tone: 'ok' };
  return { label: 'Detected', tone: 'info' };
}

/**
 * Turn a single-form run into the same `PreparedForm` the multi-form report
 * uses, so one page of a site renders through the SAME panel as a whole-site
 * run — identical heading, chips, field list, evidence and copy.
 *
 * Before this, a single-form result went through an older card with its own
 * layout and its own wording, so the two halves of the same feature looked and
 * read like different products. FR-73.
 *
 * Returns null when the run found no form at all — there is nothing to draw.
 */
export function singleFormPrepared(result: SiteResult): PreparedForm | null {
  const isEmbed = result.formType === 'third-party';
  // Render whenever the run has ANY facts about a form it matched.
  //
  // This used to hinge on `fieldCount`, which broke the moment field counts
  // started excluding site-wide inputs: a search box's ONE field is a global
  // search input, so its count is legitimately 0 — and the card fell back to
  // "No form found" under a banner that had just said a form was found. Never
  // infer "no form" from a count. FR-73.
  const hasForm = result.formFound || isEmbed || Boolean(result.formType) || Boolean(result.formKind);
  if (!hasForm) return null;

  const url = result.resolvedContactPage || result.finalUrl || result.normalizedUrl;
  // What the run believed it was looking at. The engine now says so outright;
  // the rest are fallbacks for results recorded before it did.
  const kind: FormKindLike =
    isEmbed ? 'third-party'
    : result.formKind
      ?? result.formsOnPage?.tested?.kind
      ?? (result.formFound ? 'contact' : 'other');

  const form: SiteForm = {
    url,
    kind,
    // What the page calls it ("Request a Rental"). Without this the panel could
    // only print its category — "Contact form" — directly above a screenshot
    // showing a different name. FR-73.
    about: result.formAbout ?? '',
    formType: isEmbed ? 'third-party' : 'native',
    ...(result.embedProvider ? { provider: result.embedProvider } : {}),
    fieldCount: result.fieldCount ?? 0,
    fields: result.fields ?? [],
    security: { captcha: result.captchaDetected, pageProtection: result.pageProtection },
    tracking: result.tracking ?? { utm: [], other: [] },
    siteWide: false,
    seenOn: 1,
    ...(result.formAnchorId ? { anchorId: result.formAnchorId } : {}),
    ...(result.formShot ? { shot: result.formShot } : {}),
  };

  const status = testedStatus(result);
  return {
    form,
    n: 1,
    tested: true,
    status,
    rail: status.tone === 'ok' ? 'ok' : status.tone === 'info' ? 'info' : 'accent',
    isMultiStep: result.isMultiStep,
    detail: runVerdict(result.reasonCode, result.formFound, result.finalStatus, result.formConfidenceLevel).label,
    ...(result.formConfidenceLevel === 'low' ? { lowConfidence: result.lowConfidenceReason ?? '' } : {}),
  };
}

/** A per-kind glyph — real SVGs (house rule: no emoji). Sized by the caller. */
export function KindIcon({ kind }: { kind: FormKindLike }) {
  switch (kind) {
    case 'search':
      return <path strokeLinecap="round" strokeLinejoin="round" d="M11 4a7 7 0 105.2 11.7L20 19.5M11 4a7 7 0 014.9 12" />;
    case 'login':
      return <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V6.5a4 4 0 018 0V9M5 9h10a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6a1 1 0 011-1z" />;
    case 'newsletter':
      return <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5A1.5 1.5 0 015.5 6h13A1.5 1.5 0 0120 7.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 16.5zM4.5 8l7.5 5 7.5-5" />;
    case 'third-party':
      return <path strokeLinecap="round" strokeLinejoin="round" d="M10 4H6.5A1.5 1.5 0 005 5.5v13A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V9m-5-5h5v5m0-5l-7 7" />;
    case 'other':
      return <path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5A1.5 1.5 0 016.5 4h11A1.5 1.5 0 0119 5.5v13a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 18.5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4" />;
    case 'contact':
    default:
      return <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5v11a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5zM4 7l8 5 8-5" />;
  }
}
