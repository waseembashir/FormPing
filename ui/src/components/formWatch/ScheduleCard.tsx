'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormSchedule, FormRunRecord } from '@/lib/formWatch/types';
import { runVerdict, type VerdictLevel } from '@/lib/formWatch/verdict';
import { TrendBar, type TrendTone } from '@/components/TrendBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cx, KeptNotice, RerunButton, RerunTag } from '@/components/ui';
import { friendlyNotes } from '@/lib/friendlyNotes';
import { FormSummary, FormsOnPageLine, TrackingParamsLine } from '@/components/FormFactChips';

const LEVEL_STYLE: Record<VerdictLevel | 'pending', { dot: string; text: string; label: string }> = {
  healthy: { dot: 'bg-ok', text: 'text-ok', label: 'Healthy' },
  detected: { dot: 'bg-info', text: 'text-info', label: 'Third-party form detected' },
  attention: { dot: 'bg-warn', text: 'text-warn', label: 'Needs attention' },
  failing: { dot: 'bg-danger', text: 'text-danger', label: 'Failing' },
  pending: { dot: 'bg-idle', text: 'text-ink-muted', label: 'Pending first run' },
};

const MODE_LABEL: Record<string, string> = { 'detect-only': 'Detect', safe: 'Safe', live: 'Live' };

/** How often the card asks whether a Re-run has finished, and how long it keeps
 *  asking before it stops and tells you to look for the row instead. FR-82. */
const RERUN_POLL_MS = 3000;
const RERUN_MAX_WAIT_MS = 5 * 60 * 1000;


function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const unit = days >= 1 ? `${days}d` : hrs >= 1 ? `${hrs}h` : `${mins}m`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}
function intervalLabel(ms: number): string {
  const days = ms / 86_400_000;
  if (days >= 1 && Number.isInteger(days)) return `every ${days} day${days === 1 ? '' : 's'}`;
  return `every ${Math.round(ms / 3_600_000)}h`;
}

export function ScheduleCard({
  schedule,
  onStop,
  onTogglePause,
  onDone,
  onHold,
}: {
  schedule: FormSchedule;
  onStop: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  /** Reload the list once this card has finished showing its "stopped" note. */
  onDone: () => void;
  /** Hold/release the parent's background poll while the "stopped" note is up. */
  onHold: (active: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<FormRunRecord[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [justStopped, setJustStopped] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const rerunPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);

  const verdict = schedule.lastStatus
    ? runVerdict(schedule.lastReasonCode ?? '', schedule.lastFormFound ?? false, schedule.lastStatus)
    : null;
  const level: VerdictLevel | 'pending' = verdict ? verdict.level : 'pending';
  const style = LEVEL_STYLE[level];

  // Scheduled runs only. This trend and its percentage answer "how has this form
  // been doing on its schedule?" — a run someone started by hand is not part of
  // that answer, and letting re-runs in would move the number every time you
  // pressed the button. The re-runs are still in the history below, tagged. FR-82.
  const scheduledRuns = (runs ?? []).filter((r) => r.trigger !== 'manual');
  const recentRuns = scheduledRuns.slice(0, 12).reverse();
  const levels = recentRuns.map((r) => runVerdict(r.reasonCode, r.fingerprint.formFound, r.status, r.fingerprint.formConfidenceLevel).level);
  // A detected third-party embed is a fine outcome — count it as OK for the pass
  // rate and give it its own sky bar in the trend (not amber). FR-60.
  const passPct = levels.length ? Math.round((levels.filter((l) => l === 'healthy' || l === 'detected').length / levels.length) * 100) : null;
  const trendTones: TrendTone[] = levels.map((l) => (l === 'healthy' ? 'emerald' : l === 'detected' ? 'sky' : l === 'failing' ? 'red' : 'amber'));

  /**
   * Load the run history. Returns whether a Re-run is still in flight, which the
   * server tracks — so the card can keep saying "Running…" even if you refreshed
   * or left the tab while it ran. FR-82.
   *
   * `silent` skips the loading state. A background refresh (the re-run poll)
   * must not swap the list for skeletons: it made the open history collapse and
   * re-expand every few seconds, which reads as the panel flickering shut. Only
   * a first load, when there is genuinely nothing to show yet, shows skeletons.
   */
  async function loadRuns(opts?: { silent?: boolean }): Promise<boolean> {
    if (!opts?.silent) setLoadingRuns(true);
    try {
      const res = await fetch(`/api/form-watch/results?id=${encodeURIComponent(schedule.id)}`, { cache: 'no-store' }).then((r) => r.json());
      setRuns(Array.isArray(res?.runs) ? res.runs : []);
      return res?.manualRunning === true;
    } catch {
      setRuns([]);
      return false;
    } finally {
      if (!opts?.silent) setLoadingRuns(false);
    }
  }
  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadRuns();
  }
  useEffect(() => {
    // A re-run started before this card mounted (another visit, a refresh, or a
    // tab change) may still be going. The server knows; pick that up from the
    // same request rather than resetting the button to "Re-run". FR-82.
    void loadRuns().then((manualRunning) => {
      if (manualRunning && !rerunPoll.current) { setRerunning(true); startRerunPoll(); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.lastRunAt]);

  // Release the poll hold if this card unmounts while its note is still up, and
  // stop watching a re-run we can no longer show the result of.
  useEffect(() => () => {
    if (holding.current) onHold(false);
    if (timer.current) clearTimeout(timer.current);
    if (rerunPoll.current) clearInterval(rerunPoll.current);
  }, [onHold]);


  function finish() {
    if (timer.current) clearTimeout(timer.current);
    if (holding.current) { holding.current = false; onHold(false); }
    onDone();
  }

  async function doStop() {
    setStopping(true);
    try {
      await onStop(schedule.id); // API only — no reload yet
    } finally {
      setStopping(false);
    }
    setConfirmStop(false);
    holding.current = true;
    onHold(true); // freeze the poll so the note stays put
    setJustStopped(true);
    timer.current = setTimeout(finish, 7000);
  }

  /**
   * Test this form now. Adds one tagged row to the run history below and changes
   * nothing else — the schedule, its next run and its health trend all stay
   * exactly as they were. FR-82.
   *
   * A form run drives a real browser, so it takes a minute or so and the server
   * keeps going after this request returns. We poll the history until the server
   * says the run is done; the server owns that flag, so leaving the tab or
   * refreshing doesn't lose track of it.
   */
  async function handleRerun() {
    setRerunning(true);
    setRerunError(null);
    setExpanded(true); // the answer lands in the history — open it before it does
    try {
      const res = await fetch('/api/form-watch/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: schedule.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRerunError(data?.error || 'Could not start the run just now. Try again in a moment.');
        setRerunning(false);
        return;
      }
      startRerunPoll();
    } catch {
      setRerunError('Could not reach the server. Your schedule is unaffected.');
      setRerunning(false);
    }
  }

  /** Watch for the re-run to finish. Gives up after RERUN_MAX_WAIT_MS rather
   *  than polling forever — the run itself is unaffected either way, and its row
   *  will be in the history whenever it lands. */
  function startRerunPoll() {
    if (rerunPoll.current) clearInterval(rerunPoll.current);
    const startedAt = Date.now();
    rerunPoll.current = setInterval(() => {
      void loadRuns({ silent: true }).then((stillRunning) => {
        if (stillRunning && Date.now() - startedAt < RERUN_MAX_WAIT_MS) return;
        if (rerunPoll.current) clearInterval(rerunPoll.current);
        rerunPoll.current = null;
        setRerunning(false);
        if (stillRunning) {
          setRerunError('Still running — it’s taking longer than usual. The result will appear in the history when it lands.');
        }
      });
    }, RERUN_POLL_MS);
  }

  async function handlePause() {
    setPausing(true);
    try {
      await onTogglePause(schedule.id, !schedule.paused);
    } finally {
      setPausing(false);
    }
  }

  // ── In-place "stopped" confirmation — appears exactly where this card was ──
  if (justStopped) {
    return <KeptNotice title="Stopped — its last results are kept in Projects" subtitle={schedule.url} onDismiss={finish} />;
  }

  return (
    <div className={cx('rounded-xl border bg-panel/60', schedule.paused ? 'border-dashed border-line-strong' : 'border-line')}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cx('inline-flex items-center gap-1.5 text-xs font-semibold', style.text)}>
                <span className={cx('h-2 w-2 rounded-full', style.dot, level === 'pending' && 'animate-pulse motion-reduce:animate-none')} />
                {level === 'pending' ? 'Setting up' : style.label}
              </span>
              {verdict && <span className="text-[11px] text-ink-muted">· {verdict.label}</span>}
              {level === 'pending' && (
                <span className="text-[11px] text-ink-muted">
                  · running the first check {schedule.landingPage ? 'on this page' : 'across your site'}…
                </span>
              )}
              {schedule.paused && (
                <span className="rounded bg-panel-raised px-1.5 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-line-strong">Paused</span>
              )}
            </div>
            <a href={schedule.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-ink hover:text-accent-soft" title={schedule.url}>
              {schedule.url}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-faint">
              <span>{intervalLabel(schedule.intervalMs)}</span>
              <ModeChip mode={schedule.mode} />
              {schedule.landingPage && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-soft ring-1 ring-accent/30" title="Landing-page mode: tested on this exact URL">Landing</span>
              )}
              <span>last run {relativeTime(schedule.lastRunAt)}</span>
              <span>next {relativeTime(schedule.nextRunAt)}</span>
              {passPct != null && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-ink-muted">{passPct}% healthy</span>
                  <TrendBar tones={trendTones} title={`last ${trendTones.length} runs`} />
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <RerunButton onClick={handleRerun} running={rerunning} what="form" />
            <button
              type="button"
              onClick={handlePause}
              disabled={pausing}
              className="rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-panel hover:text-ink disabled:opacity-40"
            >
              {pausing ? '…' : schedule.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmStop(true)}
              disabled={stopping}
              title="Stops watching this URL and clears its run history here. Its result stays in Projects. Use Pause to keep it."
              className="rounded-md border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
            >
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        </div>

        {schedule.paused && (
          <p className="mt-2.5 rounded-md border border-line bg-panel-raised px-3 py-2 text-[11px] text-ink-muted">
            Paused — not running right now. Its last results stay in Projects; hit <strong className="text-ink-secondary">Resume</strong> to start again.
          </p>
        )}

        {/* Recognised third-party embed on a Live schedule — a settled "detected"
            state, not a warning: it just runs on the provider's domain, so Live
            can't submit through it. Info-toned (sky), never amber. FR-60. */}
        {schedule.mode === 'live' && schedule.lastReasonCode === 'THIRD_PARTY_EMBED_FORM' && (
          <p className="mt-2.5 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-[11px] text-info">
            This is a third-party form running on the provider’s own domain — a recognised setup, nothing is wrong. Live can’t submit through it, so it’s reported as detected; open it to send a quick manual test.
          </p>
        )}

        {/* Up-front heads-up when a Live schedule's last run couldn't submit for
            real — a multi-step form that couldn't be filled/held. So a Live
            schedule that never submits isn't a surprise. FR-63/FR-64. */}
        {schedule.mode === 'live' &&
          (schedule.lastReasonCode === 'MULTI_STEP_FORM_DETECTED' ||
            schedule.lastReasonCode === 'SUBMIT_HELD_INCOMPLETE') && (
            <p className="mt-2.5 rounded-md border border-warn/25 bg-warn/10 px-3 py-2 text-[11px] text-warn">
              {schedule.lastReasonCode === 'SUBMIT_HELD_INCOMPLETE'
                ? 'This multi-step form gets filled, but Live held the submission because the run didn’t cleanly reach the end with an email — no partial entry is sent. Verify it manually.'
                : 'This multi-step form couldn’t be auto-filled on the last run. Live can’t submit what it can’t fill — verify it manually.'}
            </p>
          )}

        {rerunError && (
          <p className="mt-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent-soft">{rerunError}</p>
        )}

        <button type="button" onClick={toggleExpand} className="mt-3 text-xs font-medium text-ink-muted transition-colors hover:text-ink">
          {expanded ? '▾ Hide run history' : '▸ View run history'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-line p-4">
          {loadingRuns && (
            <div className="space-y-2"><div className="fp-skeleton h-12 rounded-lg" /><div className="fp-skeleton h-12 rounded-lg" /></div>
          )}
          {!loadingRuns && runs && runs.length === 0 && (
            <p className="text-xs text-ink-faint">No runs yet — they appear here after the first check.</p>
          )}
          {!loadingRuns && runs && runs.map((run, i) => <RunRow key={`${run.ranAt}-${i}`} run={run} />)}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        variant="danger"
        title="Stop this form scheduler?"
        confirmLabel="Stop scheduler"
        message={
          <>
            Stops watching <span className="break-all font-mono text-ink-secondary">{schedule.url}</span> and clears its run history here.{' '}
            <strong className="text-ink-secondary">Its result stays in Projects</strong> — only deleting the project removes it. Want to keep it? Use{' '}
            <strong className="text-ink-secondary">Pause</strong>.
          </>
        }
        onConfirm={doStop}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}

/**
 * The check mode, colour-coded by how much it DOES to the client's site — the
 * one fact on this row worth reading at a glance across a list of monitors.
 *
 * It used to be the same grey as the interval and the timestamps beside it, so
 * the difference between "fills a form every day" and "SUBMITS a real message
 * every day" was invisible in a scan. Live gets the warning colour it deserves;
 * detect-only, which touches nothing, stays quiet. Same semantic palette the
 * mode buttons in the form above use, so the chip reads as the same thing.
 */
function ModeChip({ mode }: { mode: string }) {
  const style =
    mode === 'live' ? 'bg-danger/12 text-danger ring-danger/35'
    : mode === 'safe' ? 'bg-accent/12 text-accent-soft ring-accent/35'
    : 'bg-info/12 text-info ring-info/30';
  const label = mode === 'detect-only' ? 'detect' : mode;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${style}`}
      title={
        mode === 'live'
          ? 'Live — every check submits a real message to the site'
          : mode === 'safe'
            ? 'Safe — every check fills the form but never submits'
            : 'Detect only — every check confirms the form is there, nothing is filled'
      }
    >
      {label}
    </span>
  );
}

function RunRow({ run }: { run: FormRunRecord }) {
  const v = runVerdict(run.reasonCode, run.fingerprint.formFound, run.status, run.fingerprint.formConfidenceLevel);
  const s = LEVEL_STYLE[v.level];
  return (
    <div className="rounded-lg border border-line bg-ground/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', s.text)}>
          <span className={cx('h-2 w-2 rounded-full', s.dot)} />
          {s.label}
          <span className="font-normal text-ink-muted">· {v.label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {run.trigger === 'manual' && <RerunTag />}
          <span className="text-[11px] text-ink-faint">{new Date(run.ranAt).toLocaleString()}</span>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-ink-faint">
        {MODE_LABEL[run.mode] ?? run.mode} mode · {Math.round(run.durationMs / 1000)}s
      </div>
      {(() => {
        const fp = run.fingerprint;
        const embed = fp.formType === 'third-party';
        if (!fp.formFound && !embed) return null;
        // Step-ness is only shown when actually known (new-format records);
        // legacy runs without the facts omit it rather than guess.
        const stepKnown = fp.formType === 'native' || fp.isMultiStep === true;
        return (
          <div className="mt-2 space-y-1.5 text-[11px] text-ink-muted">
            <div>
              <span className="font-medium text-ink-secondary">Form found</span>
              {fp.contactPage && <> on <span className="break-all font-mono text-ink-faint">{fp.contactPage}</span></>}
            </div>
            <FormSummary
              formType={fp.formType}
              embedProvider={fp.embedProvider}
              embedKind={fp.embedKind}
              isMultiStep={fp.isMultiStep}
              fieldCount={fp.fieldCount}
              stepKnown={stepKnown}
              captchaPresent={fp.captchaDetected}
            />
            <TrackingParamsLine tracking={fp.tracking} />
            <FormsOnPageLine forms={fp.formsOnPage} pageUrl={fp.contactPage ?? undefined} />
          </div>
        );
      })()}
      {friendlyNotes(run.notes).length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {friendlyNotes(run.notes).map((n, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-ink-faint"><span className="shrink-0 text-ink-faint">•</span><span>{n}</span></li>
          ))}
        </ul>
      )}
      {run.errors.length > 0 && <p className="mt-1.5 text-[11px] text-danger/80">{run.errors.slice(0, 2).join('; ')}</p>}
    </div>
  );
}
