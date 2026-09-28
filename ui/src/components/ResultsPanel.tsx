'use client';
import { useEffect, useState } from 'react';
import type { SiteResult, RunProgress, SubmitMode } from '@/types';
import { ResultCard } from './ResultCard';
import { FormTesterReport } from './formTester/FormTesterReport';
import { RunLoaderShell } from './ui/RunLoader';
import { runVerdict } from '@/lib/formWatch/verdict';

// Plain, on-brand facts shown while a test runs — makes the wait feel purposeful
// and teaches what the tool is doing. Rotated in the loader. FR-63.
const RUN_FACTS = [
  'A broken contact form can quietly lose leads for weeks before anyone notices.',
  'Most forms fail silently — no error shows, the message just never arrives.',
  'We fill the form with realistic test data, so the run behaves like a real visitor.',
  'In Safe mode nothing is ever sent — we stop right before submitting.',
  'Multi-step forms are walked one step at a time, just like a person would.',
  'Embedded forms (Typeform, HubSpot, Calendly…) are detected even inside an iframe.',
  'A green thank-you page isn’t proof — we watch for the real success signal after submit.',
];

interface Props {
  results: SiteResult[];
  progress: RunProgress | null;
  logs: string[];
  running: boolean;
  /** Landing-page toggle for the in-flight run — drives the loader copy. */
  landingPage?: boolean;
  /** Mode for the in-flight run — drives the loader copy. */
  mode?: SubmitMode;
  /** Clear the on-screen view + URL input (not the server-stored result). */
  onClear?: () => void;
  /** Runs a real live submission for one detected form (per-form "Submit a live test"). */
  onSubmitLiveTest?: (url: string) => Promise<SiteResult | null>;
}

function StatPill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${color}`}>
      <span className="font-mono text-base font-bold tabular-nums">{count}</span>
      <span className="uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
}

// Map raw engine log lines to a friendly, user-facing phase. We NEVER show the
// raw logs (version strings, proxy state, byte counts, "Discovering contact
// page" — all internal); instead we surface a plain phrase tied to real
// progress. Scanned newest-first so the latest meaningful step wins. FR-64.
const PHASE_RULES: [RegExp, string][] = [
  [/submit|submitting|submitted/i, 'Submitting the form…'],
  [/\bfill(ing|ed)?\b/i, 'Filling the form…'],
  [/form found|contact form detected|form detected/i, 'Form found — checking it…'],
  [/contact page:/i, 'Found the page — looking for the form…'],
  [/discovering contact page|lightweight fetch|falling back to playwright|contact page loaded|reload/i, 'Finding the contact form…'],
  [/landing-page mode/i, 'Loading the page…'],
];
function friendlyPhase(logs: string[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i]!;
    for (const [re, phrase] of PHASE_RULES) if (re.test(line)) return phrase;
  }
  return null;
}

// Live multi-form narrative (FR-76). The engine emits one real log line as it
// finds and fills each lead form ("Site inventory: found a contact form on
// /contact-us", "…filled the contact form (7 fields)"). We parse that stream so
// the loader can honestly say "found 3 forms · filling the rental form" as it
// happens — coherent and backed by the engine, never guessed.
const FOUND_RE = /Site inventory: found a ([\w-]+) form on (\S+)/;
const FILLED_RE = /Site inventory: filled the ([\w-]+) form \((\d+)/;
interface InventoryProgress {
  found: { kind: string; path: string }[];
  filled: number;
  last: { verb: 'found' | 'filled'; kind: string; path?: string } | null;
}
function readInventory(logs: string[]): InventoryProgress {
  const found: { kind: string; path: string }[] = [];
  let filled = 0;
  let last: InventoryProgress['last'] = null;
  for (const line of logs) {
    const f = FOUND_RE.exec(line);
    if (f) {
      if (!found.some((x) => x.path === f[2] && x.kind === f[1])) found.push({ kind: f[1]!, path: f[2]! });
      last = { verb: 'found', kind: f[1]!, path: f[2]! };
      continue;
    }
    const fl = FILLED_RE.exec(line);
    if (fl) { filled += 1; last = { verb: 'filled', kind: fl[1]! }; }
  }
  return { found, filled, last };
}
function kindWord(k: string): string {
  return k === 'other' ? 'lead' : k.charAt(0).toUpperCase() + k.slice(1);
}

// Real progress only. The site crawl emits "Site inventory: page N/T" per page —
// the one point in a single-URL run where we genuinely know how far along we are.
// No signal → null, and the loader says "working" without inventing a percentage.
const CRAWL_PAGE_RE = /Site inventory: page (\d+)\/(\d+)/;
function crawlPct(logs: string[]): number | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = CRAWL_PAGE_RE.exec(logs[i]!);
    if (m) {
      const done = Number(m[1]);
      const total = Number(m[2]);
      if (total > 0) return Math.min(done / total, 1);
    }
  }
  return null;
}

/**
 * Landing-page progress (FR-73).
 *
 * A landing-page run never crawls, so it emits no "page N/T" and the cat used to
 * stand still for the whole run — on a slow site that reads as frozen.
 *
 * There IS real signal here, just not a percentage: the engine announces each
 * stage it reaches. Those become ANCHORS. Between them the cat creeps forward a
 * little every few seconds, so the track always shows life, and she can never
 * pass the last stage actually reached by more than a short lead. She never
 * arrives while the run is still going — finishing is the result's job to show,
 * not the loader's.
 */
const LANDING_STAGES: { re: RegExp; pct: number }[] = [
  { re: /Submit captured|POST \d{3}/i, pct: 0.86 },      // sending + watching the response
  { re: /Multi-step form: (step|completed)|Filled \d+ field/i, pct: 0.7 }, // filling it in
  { re: /Form found/i, pct: 0.5 },                        // we have the form
  { re: /Landing-page mode|▶ Running/i, pct: 0.15 },      // page loading
];

function landingStage(logs: string[]): number {
  for (let i = logs.length - 1; i >= 0; i--) {
    const hit = LANDING_STAGES.find((s) => s.re.test(logs[i]!));
    if (hit) return hit.pct;
  }
  return 0.08;
}

/** Anchor + a slow creep, so the track moves even while one stage runs long. */
function useLandingPct(logs: string[], active: boolean): number {
  const stage = landingStage(logs);
  const [drift, setDrift] = useState(0);

  // Each real stage resets the lead — the creep is a hint that we're alive, not
  // a second source of truth competing with the engine.
  useEffect(() => { setDrift(0); }, [stage]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setDrift((d) => Math.min(d + 0.02, 0.1)), 3000);
    return () => clearInterval(t);
  }, [active, stage]);

  // Capped below the end: only a finished run has finished.
  return Math.min(stage + drift, 0.94);
}

/** Contextual "we're testing…" loader. The copy tells the user exactly what the
 *  run is doing — a whole-site check vs a single landing page — so the wait is
 *  clear, not a blank spinner, and NEVER exposes raw engine logs. FR-64. */
function RunningLoader({
  progress,
  landingPage,
  mode,
  logs,
}: {
  progress: RunProgress | null;
  landingPage?: boolean;
  mode?: SubmitMode;
  logs: string[];
}) {
  const headline = landingPage ? 'Testing this page' : 'Testing the whole site';
  const finish =
    mode === 'live' ? 'find the form, fill it, and submit a test message'
    : mode === 'detect-only' ? 'find the contact form and confirm it'
    : 'find the contact form and fill it';
  const sub = landingPage
    ? `Landing-page mode — we test only the page you gave: ${finish}.`
    : 'Scanning your whole site for its forms, then testing the contact form.';
  const total = progress?.total ?? 0;
  // Landing-page runs have no crawl to measure, so they get the paced stage
  // progress above; a whole-site run uses the crawl's real page count. FR-73.
  const landingPct = useLandingPct(logs, Boolean(landingPage));
  const current = progress?.current ?? 0;
  const cur = progress?.currentUrl;
  const phase = friendlyPhase(logs);

  // Multi-form live narrative — only once the engine has actually reported 2+
  // forms on a whole-site run. Single-form / landing-page runs read as before.
  const inv = readInventory(logs);
  const multi = !landingPage && inv.found.length >= 2;
  const multiSub =
    mode === 'detect-only' ? 'We found multiple forms — noting each one and what it’s for.'
    : mode === 'live' ? 'We found multiple forms — filling each one; the contact form also gets a live submit.'
    : 'We found multiple forms — filling each one with test data. Nothing is submitted.';
  const multiAction = inv.last
    ? inv.last.verb === 'filled'
      ? `filled the ${kindWord(inv.last.kind)} form`
      : `found a ${kindWord(inv.last.kind)} form${inv.last.path ? ` on ${inv.last.path}` : ''}`
    : null;
  const middle = (
    <>
      {!landingPage && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-accent-soft/90">
          <svg viewBox="0 0 20 20" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 5.5V10l2.5 1.5M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z" />
          </svg>
          Bigger sites have more pages, so this can take a little while.
        </p>
      )}
      {multi ? (
        <p className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[13px]">
          <span className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="shrink-0 font-semibold text-ink-secondary">
            Found {inv.found.length} form{inv.found.length === 1 ? '' : 's'} so far
            {mode !== 'detect-only' && inv.filled > 0 ? ` · filled ${inv.filled}` : ''}
          </span>
          {multiAction && <span key={multiAction} className="fp-rise truncate text-ink-faint">· {multiAction}</span>}
        </p>
      ) : (
        (phase || cur) && (
          <p className="mt-2.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-faint">
            <span className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            {phase && <span className="shrink-0">{phase}</span>}
            {cur && <span className="truncate font-mono text-ink-faint/70">{phase ? '· ' : ''}{cur}</span>}
          </p>
        )
      )}
    </>
  );

  return (
    <RunLoaderShell
      glyph={
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <rect x="4" y="3" width="16" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      }
      headline={multi ? `Found ${inv.found.length} forms — testing them` : headline}
      sub={multi ? multiSub : sub}
      middle={middle}
      // A batch knows its own progress (N of M URLs). A whole-site run has the
      // crawl's real "page N/T". A landing-page run has neither, so it uses the
      // stage anchors — which move, but never claim to have finished. FR-73.
      pct={total > 1 ? current / total : landingPage ? landingPct : crawlPct(logs)}
      facts={RUN_FACTS}
    />
  );
}

export function ResultsPanel({ results, progress, logs, running, landingPage, mode, onClear, onSubmitLiveTest }: Props) {
  // Tally by mode-aware verdict (not raw status), so a healthy safe/detect run
  // counts as OK — never a misleading "WARN". Matches the per-result badge. FR-63.
  const levels = results.map((r) => runVerdict(r.reasonCode, r.formFound, r.finalStatus, r.formConfidenceLevel).level);
  const ok = levels.filter((l) => l === 'healthy').length;
  // A run we could not complete is counted with the detected ones: present,
  // not tested, nothing claimed against it. FR-97.
  const detected = levels.filter((l) => l === 'detected' || l === 'limited').length;
  const attention = levels.filter((l) => l === 'attention').length;
  const failed = levels.filter((l) => l === 'failing').length;

  // Inline "For developers" JSON view — the raw result(s) opened on the page (no
  // download needed). One result shows that object; a batch shows the array. FR-75.
  const [showJson, setShowJson] = useState(false);

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `formping-results-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isEmpty = results.length === 0 && !running;

  return (
    <div className="space-y-4">
      {/* Running loader — contextual copy (whole-site vs landing page) */}
      {running && <RunningLoader progress={progress} landingPage={landingPage} mode={mode} logs={logs} />}

      {/* Stats bar — only once there are results (no "0 TOTAL" mid-run) */}
      {results.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Count pills only summarise a BATCH — for a single result they read as
                a confusing "1 TOTAL / 1 OK". The per-result card/report already shows
                the verdict, so show the tally only when there are 2+ results. FR-75. */}
            {results.length > 1 && (
              <>
                <StatPill count={results.length} label="Total" color="bg-panel-raised text-ink-secondary" />
                {ok > 0 && <StatPill count={ok} label="OK" color="bg-ok/10 text-ok" />}
                {detected > 0 && <StatPill count={detected} label="Detected" color="bg-info/10 text-info" />}
                {attention > 0 && <StatPill count={attention} label="Attention" color="bg-warn/10 text-warn" />}
                {failed > 0 && <StatPill count={failed} label="Failed" color="bg-danger/10 text-danger" />}
              </>
            )}

            {results.length > 0 && (
              <>
                {/* Left: view/export the data. Right: the destructive clear action. */}
                <button
                  onClick={() => setShowJson((s) => !s)}
                  aria-expanded={showJson}
                  title="View the raw result JSON on this page — the exact data the engine returned."
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ring-1 transition-colors ${showJson ? 'bg-panel-raised text-ink ring-line-strong' : 'bg-panel-raised text-ink-muted ring-line-strong hover:text-ink'}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-3 3 3 3m8-6l3 3-3 3M13.5 6l-3 12" />
                  </svg>
                  For developers
                </button>
                <button
                  onClick={downloadJson}
                  className="flex items-center gap-1.5 rounded-lg bg-panel-raised px-3 py-1.5 text-xs text-ink-muted ring-1 ring-line-strong transition-colors hover:text-ink"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export JSON
                </button>
                {onClear && !running && (
                  <button
                    onClick={onClear}
                    title="Clear the results and URL from this tab. Does NOT delete the stored result Projects uses."
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger ring-1 ring-danger/30 transition-colors hover:bg-danger/20"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Clear results
                  </button>
                )}
              </>
            )}
          </div>

          {/* Inline raw JSON — the "For developers" view, opened on the page. */}
          {showJson && (
            <div className="fp-rise mt-3 rounded-lg border border-line bg-ground/50">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-ink-secondary">
                {JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Raw engine logs are intentionally NOT shown to users — they're internal
          diagnostics (version, proxy state, byte counts, discovery steps). The
          RunningLoader above surfaces a friendly, progress-tracking phase instead. FR-64 */}

      {/* Results list — a site with 2+ detected forms gets the multi-form report
          (summary + Form 1/Form 2 tabs); a single-form result keeps the detail
          card. FR-75. */}
      <div className="space-y-3">
        {results.map((r, i) =>
          (r.siteForms?.length ?? 0) >= 2 ? (
            <FormTesterReport key={`${r.normalizedUrl}-${i}`} result={r} onSubmitLiveTest={onSubmitLiveTest} />
          ) : (
            <ResultCard key={`${r.normalizedUrl}-${i}`} result={r} />
          ),
        )}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line bg-panel/40 px-8 py-16 text-center">
          <div className="relative mb-5 flex h-20 w-20 items-center justify-center">
            {/* animated "ping" rings — on-brand (form + ping) */}
            <span className="absolute inline-flex h-14 w-14 animate-ping rounded-full bg-accent/15 [animation-duration:2.2s] motion-reduce:animate-none" aria-hidden />
            <span className="absolute h-16 w-16 rounded-full border border-accent/15" aria-hidden />
            <span className="absolute h-20 w-20 rounded-full border border-accent/10" aria-hidden />
            {/* form glyph */}
            <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-panel-raised text-accent-soft shadow-lg shadow-accent-deep/20 ring-1 ring-line-strong">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden>
                <rect x="4" y="3" width="16" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <p className="text-[15px] font-semibold text-ink">Ready to test a contact form</p>
          <p className="mt-1.5 max-w-sm text-sm text-ink-muted">
            Enter a URL in the bar above and hit <strong className="text-ink-secondary">Run test</strong> — the health report shows up right here.
          </p>
        </div>
      )}
    </div>
  );
}
