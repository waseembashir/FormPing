'use client';
import { useState } from 'react';
import type { DetectedFormField, SiteResult, SubmitMode } from '@/types';
import { runVerdict } from '@/lib/formWatch/verdict';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { aboutIsTitle, displayName, DOT, KindIcon, type PreparedForm, type Tone } from './formMeta';
import { formHref, FormShot, LowConfidenceNote, PageProtectionNote } from './FormEvidence';

/**
 * FR-75 — one form's detail block inside the multi-form results log: a category
 * head with status pill, then the form title · source · type/fields/security
 * chips · a field-name preview · tracking. Newsletter/Search get a highlighted
 * category chip. Site-wide forms say so. In Live mode an untested lead form shows
 * an opt-in "Submit a live test" button that sends a real submission (confirmed
 * first); the tested contact form is submitted by the main run. FR-76.
 */

const RAIL: Record<PreparedForm['rail'], string> = {
  ok: 'bg-ok',
  accent: 'bg-accent',
  info: 'bg-info',
};

const STATUS_PILL: Record<Tone, string> = {
  ok: 'text-ok bg-ok/12 ring-ok/30',
  info: 'text-info bg-info/12 ring-info/30',
  warn: 'text-warn bg-warn/12 ring-warn/30',
  danger: 'text-danger bg-danger/12 ring-danger/30',
  idle: 'text-ink-muted bg-idle/12 ring-line-strong',
};

// A field that belongs to the site chrome (a header/footer search box), not to
// this form — it gets pulled in because it lives near the form in the DOM. We
// flag it so the count + list read honestly. FR-75.
//
// Must stay in step with `isGlobalField` in src/runners/formFacts.ts, which is
// what EXCLUDES these from `fieldCount`. If the two disagree, the count and the
// list disagree — the bug this pair exists to prevent. `\bsearch\b`, so a real
// field like "Research budget" is never mistaken for a search box. FR-73.
function isGlobalField(f: DetectedFormField): boolean {
  if (f.type === 'search') return true;
  return /\bsearch\b/i.test(`${f.name ?? ''} ${f.label ?? ''}`);
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 opacity-80" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16h9a1.5 1.5 0 001.5-1.5V13M12 4h4v4M16 4l-7 7" />
    </svg>
  );
}

/** The "We detected a Newsletter/Searchbar form" highlighted chip. */
function CategoryChip({ text }: { text: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-info/30 bg-info/12 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-info">
      <svg viewBox="0 0 20 20" className="h-2.5 w-2.5" fill="currentColor" aria-hidden><circle cx="10" cy="10" r="8" /></svg>
      {text}
    </span>
  );
}

/** Small uppercase row label ("FORM TITLE", "FIELDS", "TRACKING"). */
function RowLabel({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-ink-faint">{children}</span>;
}

export function FormPanel({
  prepared,
  mode,
  onSubmitLiveTest,
}: {
  prepared: PreparedForm;
  mode: SubmitMode;
  /** Runs a real live submission for this form's URL; resolves the outcome. */
  onSubmitLiveTest?: (url: string) => Promise<SiteResult | null>;
}) {
  const { form, tested, status, rail, isMultiStep, detail, lowConfidence } = prepared;
  const lead = rail !== 'info';

  // Per-form live submit (FR-76): confirm → submit → show the real outcome here.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submit, setSubmit] = useState<{ phase: 'idle' | 'running' | 'done'; result?: SiteResult | null }>({ phase: 'idle' });
  const canLiveSubmit = mode === 'live' && lead && !tested && Boolean(onSubmitLiveTest);

  async function runLiveSubmit() {
    if (!onSubmitLiveTest) return;
    setConfirmOpen(false);
    setSubmit({ phase: 'running' });
    const result = await onSubmitLiveTest(form.url);
    setSubmit({ phase: 'done', result });
  }
  const showTitle = Boolean(form.about) && !aboutIsTitle(form);
  const categoryChip =
    form.kind === 'newsletter' ? 'We detected a Newsletter form'
    : form.kind === 'search' ? 'We detected a Searchbar input form'
    : null;

  const utm = form.tracking?.utm ?? [];
  const other = form.tracking?.other ?? [];
  const hasTracking = utm.length > 0 || other.length > 0;
  // Tracking only makes sense for a lead form (a search box captures nothing).
  const showTracking = lead;

  const fields = form.fields.filter((f) => f.label || f.name || f.type);
  // A search form's own search input is its field, not site chrome — tagging it
  // "global" there would be wrong, and would contradict its own field count. FR-73.
  const globalCount = form.kind === 'search' ? 0 : fields.filter(isGlobalField).length;
  const hasGlobal = globalCount > 0;
  const FIELD_CAP = 10;

  // Normalise hidden fields to {name,value}. Results persist in localStorage, so a
  // result cached before hiddenFields carried values may still be a string[] — tolerate
  // both so a stale cached run can never crash the panel. FR-76.
  const hidden = ((form.hiddenFields ?? []) as ({ name: string; value: string } | string)[]).map((f) =>
    typeof f === 'string' ? { name: f, value: '' } : f,
  );

  return (
    <div className="fp-rise relative overflow-hidden rounded-xl border border-line bg-panel p-5">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${RAIL[rail]}`} aria-hidden />

      {/* Head: icon + category name, status pill top-aligned with the heading */}
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${rail === 'ok' ? 'border-ok/30 bg-ok/12 text-ok' : rail === 'accent' ? 'border-accent/30 bg-accent/12 text-accent-soft' : 'border-info/30 bg-info/12 text-info'}`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <KindIcon kind={form.kind} />
          </svg>
        </span>
        <h4 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-ink">{displayName(form)}</h4>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${STATUS_PILL[status.tone]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[status.tone]}`} />
          {status.label}
        </span>
      </div>

      {/* Body — indented to align under the heading (icon width + gap) */}
      <div className="mt-4 flex flex-col gap-3.5 sm:pl-[52px]">
        {/* Live mode — the action/status sits at the TOP so it's seen without
            scrolling. The primary contact form is auto-submitted by the run (a
            clear note, no button); every other lead form gets an opt-in button. */}
        {/* Said before anything else on the tested form: if we are not sure we
            matched the right form, every fact below is about a form that may not
            be yours. FR-73. */}
        {lowConfidence !== undefined && <LowConfidenceNote reason={lowConfidence} />}
        {tested && mode === 'live' && <AutoSubmitNote detail={detail} tone={status.tone} />}
        {canLiveSubmit && (
          <div>
            {submit.phase === 'idle' && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="inline-flex w-fit items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3.5 py-2 text-[13px] font-semibold text-accent-soft transition-colors hover:bg-accent/15"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M5 4l11 6-11 6V4z" /></svg>
                Submit a live test
              </button>
            )}
            {submit.phase === 'running' && (
              <span className="inline-flex w-fit items-center gap-2 rounded-lg border border-line-strong bg-panel-raised px-3.5 py-2 text-[13px] font-semibold text-ink-muted">
                <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><path strokeLinecap="round" d="M10 3a7 7 0 017 7" /><circle cx="10" cy="10" r="7" className="opacity-25" /></svg>
                Submitting a live test…
              </span>
            )}
            {submit.phase === 'done' && <SubmitOutcome result={submit.result} onRetry={() => setSubmit({ phase: 'idle' })} />}
          </div>
        )}

        {/* Site-wide forms (a header/footer search or newsletter that sits on every
            page) announce that up front, so it's clear this isn't a page-specific form. */}
        {form.siteWide && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line-strong bg-panel-raised px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
              <circle cx="10" cy="10" r="7.5" /><path strokeLinecap="round" d="M2.5 10h15M10 2.5c2.2 2.6 2.2 12.4 0 15M10 2.5c-2.2 2.6-2.2 12.4 0 15" />
            </svg>
            {/* "seen on N pages" — we crawl a bounded sample of the site, so we
                can say where we FOUND it, never that it is on every page. FR-81. */}
            Global{form.seenOn > 1 ? ` · seen on ${form.seenOn} pages` : ''} · site header / footer
          </span>
        )}
        {categoryChip && <CategoryChip text={categoryChip} />}

        {showTitle && (
          <div className="flex flex-wrap items-baseline gap-2 leading-normal">
            <RowLabel>Form title</RowLabel>
            <span className="text-[15px] font-semibold text-accent-soft">&ldquo;{form.about}&rdquo;</span>
          </div>
        )}

        {/* One link to the form. The anchor rides in the href — so the click
            lands on the form rather than the top of the page — but it is NOT
            shown: "#forminator-module-653" is a machine id, and putting it in
            the middle of an address someone has to read is pure noise. The
            tooltip says where the link goes. FR-73. */}
        <a
          href={formHref(form.url, form.anchorId)}
          target="_blank"
          rel="noreferrer"
          title={form.anchorId ? `Opens this page scrolled to the form (#${form.anchorId})` : form.url}
          className="inline-flex w-fit max-w-full items-center gap-1.5 font-mono text-[13px] text-accent-soft transition-colors hover:underline"
        >
          <ExternalLinkIcon />
          <span className="truncate">{form.url}</span>
        </a>

        {/* Evidence (FR-73): a picture of this exact form, so "we found your
            form" is checkable rather than a claim you have to take on trust. */}
        <FormShot src={form.shot} alt={`Screenshot of the ${displayName(form)} on ${form.url}`} />

        {/* Type · fields · structure · security chips */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{form.formType === 'third-party' ? `Third-party${form.provider ? ` · ${form.provider}` : ''}` : 'Native form'}</Chip>
          {tested && typeof isMultiStep === 'boolean' && <Chip>{isMultiStep ? 'Multi-step' : 'Single-step'}</Chip>}
          <Chip><b className="font-mono font-bold text-ink">{form.fieldCount}</b> field{form.fieldCount === 1 ? '' : 's'}</Chip>
          {/* Only claim CAPTCHA when the widget is on THIS form. Page-wide
              protection is reported separately below — stamping it here is how a
              search box came back "CAPTCHA protected" (FR-73). We can't see an
              invisible reCAPTCHA either, so we never say "No CAPTCHA". FR-76. */}
          {form.security?.captcha && (
            <Chip tone="captcha">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M6 9V6.5a4 4 0 018 0V9M5 9h10a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6a1 1 0 011-1z" /></svg>
              CAPTCHA
            </Chip>
          )}
        </div>

        {/* Protection on the page, but not on this form — said as its own fact. FR-73. */}
        {!form.security?.captcha && form.security?.pageProtection && <PageProtectionNote />}

        {/* Field-name preview — each field a chip, aligned next to the label;
            global (site header/footer) fields are marked so they're not mistaken
            for part of this form. FR-75. */}
        {fields.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-x-2 gap-y-2">
              <span className="mt-1"><RowLabel>Fields</RowLabel></span>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {fields.slice(0, FIELD_CAP).map((f, i) => {
                  const g = form.kind !== 'search' && isGlobalField(f);
                  return (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[13px] ${g ? 'border-info/30 bg-info/10 text-info' : 'border-line-strong bg-panel-raised text-ink-secondary'}`}
                    >
                      {f.label || f.name || f.type}
                      {g && <span className="rounded bg-info/20 px-1 py-px font-sans text-[10px] font-semibold uppercase tracking-wide">global</span>}
                    </span>
                  );
                })}
                {fields.length > FIELD_CAP && <span className="self-center text-xs text-ink-faint">+{fields.length - FIELD_CAP} more</span>}
              </div>
            </div>
            {hasGlobal && (
              <p className="text-xs leading-relaxed text-ink-faint">
                <span className="font-semibold text-info">Global</span> fields are site-wide inputs (a header or footer
                search box) that appear on every page. {globalCount === 1 ? 'One is' : `${globalCount} are`} listed here
                because {globalCount === 1 ? 'it sits' : 'they sit'} inside this form in the page&rsquo;s code, but{' '}
                {globalCount === 1 ? "it isn't" : "they aren't"} counted in the{' '}
                <b className="font-mono text-ink-secondary">{form.fieldCount}</b> above.
              </p>
            )}
          </div>
        )}

        {/* Hidden MARKETING fields — utm_*, gclid, fbclid… captured invisibly by the
            form. Framework nonces/ids are filtered out as noise. Shown as name=value. FR-76. */}
        {hidden.length > 0 && (
          <details className="group [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex w-fit cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-faint transition-colors hover:text-ink-secondary">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M7.21 5.23a.75.75 0 011.06.02l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 11-1.08-1.04L10.92 10 7.23 6.31a.75.75 0 01-.02-1.08z" clipRule="evenodd" /></svg>
              Hidden marketing fields ({hidden.length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hidden.map((f, i) => (
                <span key={i} className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-line-strong bg-panel-raised/60 px-2 py-0.5 font-mono text-[11px]" title={f.value ? `${f.name}=${f.value}` : f.name}>
                  <span className="shrink-0 text-ink-secondary">{f.name}</span>
                  {f.value && (
                    <>
                      <span className="shrink-0 text-line-strong">=</span>
                      <span className="max-w-[160px] truncate text-ink-faint">{f.value}</span>
                    </>
                  )}
                </span>
              ))}
            </div>
          </details>
        )}

        {/* Tracking / UTM */}
        {showTracking && (
          <div className="flex flex-wrap items-center gap-2">
            <RowLabel>Tracking</RowLabel>
            {hasTracking ? (
              <>
                {utm.map((p) => (
                  <span key={p} className="rounded-md border border-ok/28 bg-ok/12 px-2 py-0.5 font-mono text-xs text-ok">{p}</span>
                ))}
                {other.map((p) => (
                  <span key={p} className="rounded-md border border-line-strong bg-panel-raised px-2 py-0.5 font-mono text-xs text-ink-secondary">{p}</span>
                ))}
              </>
            ) : (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-warn/30 bg-warn/12 px-3 py-1 text-xs font-medium text-warn">
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M10 13.5v-4M10 6.8v.1M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z" /></svg>
                No UTM params — leads won&rsquo;t carry a campaign source
              </span>
            )}
          </div>
        )}

      </div>

      {canLiveSubmit && (
        <ConfirmDialog
          open={confirmOpen}
          variant="edit"
          title="Send a real test submission?"
          confirmLabel="Submit live test"
          message={
            <>
              This fills and <b className="text-ink">submits</b> the form at{' '}
              <span className="break-all font-mono text-ink-secondary">{form.url}</span> — a real message is sent to
              the site owner. Only do this on a site you own or are authorized to test.
            </>
          }
          onConfirm={runLiveSubmit}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

/** Explains, clearly + distinctly, that Live mode auto-submitted THIS form (the
 *  primary contact form) — so it reads differently from the opt-in "Submit a live
 *  test" forms below it, and users understand why it has no button. FR-76. */
function AutoSubmitNote({ detail, tone }: { detail?: string; tone: Tone }) {
  const styles =
    tone === 'ok' ? { wrap: 'border-ok/25 bg-ok/8', head: 'text-ok' }
    : tone === 'danger' ? { wrap: 'border-danger/25 bg-danger/8', head: 'text-danger' }
    : { wrap: 'border-warn/25 bg-warn/8', head: 'text-warn' };
  const headline =
    tone === 'ok' ? 'Submitted automatically by Live mode'
    : tone === 'danger' ? 'Live mode tried to submit this form'
    : 'Submitted automatically — couldn’t confirm it landed';
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 ${styles.wrap}`}>
      <svg viewBox="0 0 20 20" className={`mt-0.5 h-4 w-4 shrink-0 ${styles.head}`} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 13.5v-4M10 6.8v.1M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z" />
      </svg>
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold ${styles.head}`}>{headline}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          This is the contact form we found and tested — Live mode filled and submitted it for you{detail ? <> (<span className="text-ink-secondary">{detail}</span>)</> : ''}. The other lead forms below are filled but <b className="text-ink-secondary">not sent</b> — send each yourself with its <b className="text-ink-secondary">Submit a live test</b> button.
        </p>
      </div>
    </div>
  );
}

// A submission blocked by a protection (CAPTCHA, anti-bot, host/anti-spam block)
// will NEVER go through by retrying — so we say "Can't submit" and hide "Try again".
const CANT_SUBMIT = new Set([
  'CAPTCHA_DETECTED',
  'ANTI_BOT_DETECTED',
  'BLOCKED_BY_HOST',
  'SUBMISSION_BLOCKED_BY_ANTISPAM',
  'PROXY_REJECTED_POST',
]);

/** The real outcome of a per-form live submit, in the panel's own vocabulary. */
function SubmitOutcome({ result, onRetry }: { result?: SiteResult | null; onRetry: () => void }) {
  if (!result) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${STATUS_PILL.danger}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT.danger}`} />Didn&rsquo;t run
        </span>
        <button type="button" onClick={onRetry} className="text-ink-muted underline-offset-2 hover:text-ink hover:underline">Try again</button>
      </div>
    );
  }
  const { level, label } = runVerdict(result.reasonCode, result.formFound, result.finalStatus, result.formConfidenceLevel);
  const blocked = CANT_SUBMIT.has(result.reasonCode);

  // Protected → "Can't submit", no retry (it can't succeed).
  if (blocked) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${STATUS_PILL.warn}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT.warn}`} />Can&rsquo;t submit
        </span>
        <span className="text-ink-muted">{label} — this form is protected, so a live submit can&rsquo;t get through.</span>
      </div>
    );
  }

  const tone: Tone = level === 'healthy' ? 'ok' : level === 'failing' ? 'danger' : level === 'detected' ? 'info' : 'warn';
  const short = level === 'healthy' ? 'Submitted ✓' : level === 'failing' ? 'Failed' : level === 'detected' ? 'Detected' : 'Attention';
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${STATUS_PILL[tone]}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />{short}
      </span>
      <span className="text-ink-muted">{label}</span>
      {tone !== 'ok' && (
        <button type="button" onClick={onRetry} className="text-ink-muted underline-offset-2 hover:text-ink hover:underline">Try again</button>
      )}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'captcha' }) {
  const cls = tone === 'captcha'
    ? 'border-warn/30 bg-warn/10 text-warn'
    : 'border-line-strong bg-panel-raised text-ink-secondary';
  return <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-medium ${cls}`}>{children}</span>;
}
