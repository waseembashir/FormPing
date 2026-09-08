'use client';
import { useState } from 'react';
import type { SiteResult, SiteForm, FormOutcome } from '@/types';
import { runVerdict } from '@/lib/formWatch/verdict';
import { FormPanel } from './FormPanel';
import { DOT, isLeadForm, kindLabel, testedStatus, type FormStatus, type PreparedForm } from './formMeta';

/**
 * FR-75 — the Form Tester results log for a site with 2+ forms. A sibling of the
 * Content Changes report (CompareReportCard), using the SAME surfaces so both
 * read as one product: a summary card (site header + StatPills + a clickable
 * "Forms detected" index), Form 1 / Form 2 tabs, and the active form's panel. A
 * single-form result keeps the existing ResultCard.
 *
 * Honesty: the engine fills/submits only the ONE primary contact form per run;
 * the rest are a detection inventory. So exactly one form carries its real verdict
 * and every other form reads "Detected" — we never claim to have filled a form we
 * only found, and the summary says so plainly. (Decision recorded on FR-75.)
 */

function pathOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).pathname || '/'; } catch { return url; }
}
function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : `${ms}ms`;
}

/** Every OTHER lead form now carries a real fill outcome from the engine. */
function outcomeStatus(o?: FormOutcome): FormStatus {
  switch (o?.state) {
    case 'filled': return { label: 'Filled ✓', tone: 'ok' };
    case 'submitted': return { label: 'Submitted ✓', tone: 'ok' };
    case 'failed': return { label: 'Attention', tone: 'warn' };
    case 'skipped': return { label: 'Detected', tone: 'info' };
    default: return { label: 'Detected', tone: 'info' };
  }
}

/** Pick the site form we actually tested: the contact/other form on the resolved
 *  contact page. Falls back to the first contact form. -1 if nothing was tested. */
function findTestedIndex(forms: SiteForm[], result: SiteResult): number {
  if (!result.formFound) return -1;
  const testedPath = pathOf(result.resolvedContactPage || result.finalUrl || result.normalizedUrl);
  const onPage = forms.findIndex((f) => pathOf(f.url) === testedPath && (f.kind === 'contact' || f.kind === 'other'));
  if (onPage !== -1) return onPage;
  return forms.findIndex((f) => f.kind === 'contact');
}

/** Normalise + order the forms: the tested form first (it leads the report), then
 *  the other lead forms, then utility inputs (search / newsletter / login). */
function prepare(forms: SiteForm[], result: SiteResult): PreparedForm[] {
  const testedIdx = findTestedIndex(forms, result);
  const entries = forms.map((form, i) => {
    const tested = i === testedIdx;
    const lead = isLeadForm(form);
    const status: FormStatus = tested ? testedStatus(result) : outcomeStatus(form.outcome);
    const rail: PreparedForm['rail'] = status.tone === 'ok' ? 'ok' : lead ? 'accent' : 'info';
    const group = tested ? 0 : lead ? 1 : 2;
    const detail = tested ? runVerdict(result.reasonCode, result.formFound, result.finalStatus, result.formConfidenceLevel).label : undefined;
    // Only the tested form carries a confidence judgement — the others were
    // inventoried, not matched against "is this the contact form?". FR-73.
    const lowConfidence =
      tested && result.formConfidenceLevel === 'low' ? (result.lowConfidenceReason ?? '') : undefined;
    return { form, tested, status, rail, group, isMultiStep: tested ? result.isMultiStep : undefined, detail, lowConfidence };
  });
  entries.sort((a, b) => a.group - b.group);
  return entries.map(({ group, ...rest }, i) => ({ ...rest, n: i + 1 }));
}

/** The app's canonical summary stat — identical to the Content Changes report's
 *  StatPill, so both surfaces match exactly. */
function StatPill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${color}`}>
      <span className="font-mono text-base font-bold tabular-nums">{count}</span>
      <span className="uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

export function FormTesterReport({
  result,
  onSubmitLiveTest,
}: {
  result: SiteResult;
  /** Runs a real live submission for one form's URL (per-form "Submit a live test"). */
  onSubmitLiveTest?: (url: string) => Promise<SiteResult | null>;
}) {
  const forms = result.siteForms ?? [];
  const prepared = prepare(forms, result);
  const [active, setActive] = useState(0);

  const domain = getDomain(result.normalizedUrl);
  const leadForms = forms.filter(isLeadForm);
  const noUtmLeads = leadForms.filter((f) => (f.tracking?.utm.length ?? 0) === 0).length;
  const pagesWithForms = new Set(forms.map((f) => pathOf(f.url))).size;
  const filledCount = prepared.filter((p) => p.status.tone === 'ok').length;

  // A plain, honest line about what the run actually did.
  const modeLabel = result.mode === 'detect-only' ? 'Detect' : result.mode === 'live' ? 'Live' : 'Safe';
  const leadWord = (n: number) => `lead form${n === 1 ? '' : 's'}`;
  const summaryLine = (() => {
    if (result.mode === 'detect-only') return <>listed every form — nothing filled or submitted.</>;
    if (filledCount === 0) return <>detected {forms.length} forms — none could be auto-filled.</>;
    if (result.mode === 'live') {
      return (
        <>
          submitted the <b className="font-semibold text-ink-muted">contact form</b>; the other{' '}
          {leadWord(leadForms.length)} are filled — submit each from its panel with <b className="font-semibold text-ink-muted">Submit a live test</b>.
        </>
      );
    }
    return (
      <>
        filled <b className="font-semibold text-ink-muted">{filledCount} {leadWord(filledCount)}</b>, submitted nothing.
      </>
    );
  })();

  return (
    <div className="space-y-4 animate-slide-in">
      {/* ── Summary card ─────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-xl border border-line-strong bg-panel p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">{domain}</h3>
          <a href={result.normalizedUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate font-mono text-xs text-ink-faint hover:text-accent-soft">{result.normalizedUrl}</a>
        </div>

        {/* Stat pills — same component + colours as Content Changes */}
        <div className="flex flex-wrap items-center gap-2">
          <StatPill count={forms.length} label={forms.length === 1 ? 'form found' : 'forms found'} color="bg-accent/10 text-accent-soft" />
          <StatPill count={leadForms.length} label={leadForms.length === 1 ? 'lead form' : 'lead forms'} color="bg-ground text-ink-secondary" />
          {/* "pages WITH FORMS", not "pages crawled" — a bare "3 pages" beside a
              form badged "seen on 5 pages" reads as a contradiction when the two
              are simply counting different things. FR-81. */}
          <StatPill
            count={pagesWithForms}
            label={pagesWithForms === 1 ? 'page with forms' : 'pages with forms'}
            color="bg-ground text-ink-secondary"
          />
          {noUtmLeads > 0 && <StatPill count={noUtmLeads} label={noUtmLeads === 1 ? 'form without UTM' : 'forms without UTM'} color="bg-warn/10 text-warn" />}
        </div>

        {/* Forms-detected index — bordered box on bg-ground/30, matching the
            "PAGE CHANGES" box in the Content Changes report. Each row: click the
            label to open that form's tab; the URL is a real link to the page. */}
        <div className="rounded-lg border border-line bg-ground/40 p-2">
          <p className="px-1.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">Forms detected</p>
          <div className="space-y-0.5">
            {prepared.map((p, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${i === active ? 'bg-accent/10' : 'hover:bg-panel/60'}`}>
                <button type="button" onClick={() => setActive(i)} className="flex shrink-0 items-center gap-2.5 text-left" aria-label={`Show Form ${p.n}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.status.tone]}`} />
                  <span className="font-mono text-xs font-semibold text-ink-muted">Form {p.n}</span>
                  <span className="text-[13px] font-semibold text-ink">{kindLabel(p.form)}</span>
                </button>
                <a href={p.form.url} target="_blank" rel="noreferrer" title={p.form.url} className="min-w-0 flex-1 truncate font-mono text-xs text-accent-soft hover:underline">
                  {p.form.url}
                </a>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-faint">
                  {p.form.fieldCount} field{p.form.fieldCount === 1 ? '' : 's'} · {p.status.label.toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-faint">
          Scanned in <b className="font-mono text-ink-muted">{formatMs(result.durationMs)}</b> · {modeLabel} mode — {summaryLine}
        </p>
      </div>

      {/* ── Tabs — same style as the Content Changes "Page 1 / Page 2" tabs ─── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {prepared.map((p, i) => {
          const on = i === active;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(i)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-medium transition-colors ${on ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-line-strong bg-panel text-ink-muted hover:text-ink'}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${DOT[p.status.tone]}`} />
              <span>Form {p.n}</span>
              <span className={on ? 'text-accent-soft/70' : 'text-ink-faint'}>· {kindLabel(p.form)}</span>
            </button>
          );
        })}
      </div>

      {/* ── Active panel ─────────────────────────────────────────────────── */}
      {prepared[active] && (
        // key by the form so switching tabs mounts a FRESH panel — a per-form
        // submit's state never leaks onto another form's tab. FR-76.
        <FormPanel key={prepared[active].form.url + active} prepared={prepared[active]} mode={result.mode} onSubmitLiveTest={onSubmitLiveTest} />
      )}
    </div>
  );
}
