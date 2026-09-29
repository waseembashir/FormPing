/**
 * Completion hook for a Form Watch run.
 *
 * Called by the ticker right after a run finishes but BEFORE the new record is
 * appended to history — so `latestRun` still returns the PREVIOUS run, giving
 * us a clean before/after comparison. Computes changes + suggestions, then hands
 * the result to the alert dispatcher.
 *
 * A run is only ANNOUNCED when it carries news: the first observation, a change
 * of verdict, a change in the form itself, or a spaced reminder that a broken
 * form is still broken. A monitor repeating an unchanged verdict every cycle is
 * how a channel earns its mute, and a muted channel swallows the alert that
 * mattered. The standing state lives on the monitor card, where it is there when
 * someone looks instead of interrupting to say nothing new. FR-97.
 *
 * Every run is still STORED. This decides who gets interrupted, never what is
 * recorded.
 */

import type { FormSchedule, FormRunRecord } from './types';
import { latestRun } from './historyStore';
import { compareFingerprints, isRegression } from './diff';
import { buildSuggestions } from './suggestions';
import { formRunFacts, formRunScope, manualActionFor, runOutcome } from './alertFacts';
import { runVerdict } from './verdict';
import { shouldNotify, verdictIdentity } from './alertGate';
import { dispatchAlert } from '@/lib/alerts/dispatch';
import { reportSubmissionsBlocked } from '@/lib/alerts/monitoringOutage';
import { lastAlertAt } from '@/lib/alerts/store';
import { detailPathFor } from '@/lib/alerts/link';
import type { AlertSeverity } from '@/lib/alerts/types';

export async function onRunComplete(
  schedule: FormSchedule,
  record: FormRunRecord,
  /**
   * The raw engine result for this run. Carries the whole-site form inventory
   * (`siteForms`), which the fingerprint does not — without it a notification
   * can only describe the page that was tested, and will contradict the Form
   * Tester for the very same run. FR-91.
   */
  raw?: unknown,
): Promise<void> {
  const prev = await latestRun(schedule.id); // previous run (this one not yet stored)
  const changes = compareFingerprints(prev?.fingerprint ?? null, record.fingerprint);
  const prevLevel = prev
    ? runVerdict(prev.reasonCode, prev.fingerprint.formFound, prev.status, prev.fingerprint.formConfidenceLevel).level
    : null;
  const verdict = runVerdict(record.reasonCode, record.fingerprint.formFound, record.status, record.fingerprint.formConfidenceLevel);
  const regression = isRegression(prevLevel, verdict.level);
  const suggestions = buildSuggestions(record, changes);

  /**
   * `detected` gets its own severity rather than borrowing `info`. A recognised
   * third-party form is not a success — nothing was submitted — and it is not a
   * fault either. The app has always drawn it in its own sky tone; Slack used to
   * render a green tick, which reads as "your form works" for a form that was
   * never tested. FR-91.
   */
  const severity: AlertSeverity =
    verdict.level === 'failing'
      ? 'critical'
      : verdict.level === 'attention'
        ? 'warning'
        : verdict.level === 'detected' || verdict.level === 'limited'
          ? 'notice'
          : 'info';

  // `detected` (a recognised third-party embed) is informational, like `healthy` —
  // NOT a "needs attention" ping. FR-60. `limited` joins it: the check could not
  // be completed and nothing is known to be wrong with the site, so it is not a
  // problem to report against the form's owner. FR-97.
  const isProblem = verdict.level === 'failing' || verdict.level === 'attention';
  /**
   * A headline may only claim what the run actually achieved.
   *
   * FR-91 made this mode-aware: "Contact form OK" had been sent for Detect runs,
   * which confirm a form exists and nothing else. But mode-aware is not enough —
   * a Safe run that filled nothing still read "Contact form filled OK". The
   * claim now comes from the outcome, so a title cannot outrun the evidence
   * however the modes and reason codes are combined in future. FR-96.
   */
  const outcome = runOutcome(record);
  const okTitle =
    outcome.submitted === 'confirmed'
      ? `Contact form OK — ${record.site}`
      : outcome.submitted === 'unconfirmed'
        ? `Contact form submitted, no confirmation — ${record.site}`
        : outcome.filled
          ? `Contact form filled OK — ${record.site}`
          : `Contact form found — ${record.site}`;

  const title =
    verdict.level === 'detected'
      ? `Third-party form detected — ${record.site}`
      : // A limited run says what we could not do, never what the site got wrong.
        // "Needs attention" on a form with a CAPTCHA reads as an accusation about
        // a site that is behaving exactly as its owner intended. FR-97.
        verdict.level === 'limited'
        ? `Form found — could not be tested — ${record.site}`
        : !isProblem
          ? okTitle
          : `Contact form ${verdict.level === 'failing' ? 'failing' : 'needs attention'} — ${record.site}`;

  // The reason code used to be appended here, so a Slack message read
  // "Third-party form detected (THIRD_PARTY_EMBED_FORM)". That is an internal
  // identifier in a message a person reads — the same defect FR-86 removed from
  // the dashboards. The verdict label already says it in English. FR-91.
  const summaryParts = [verdict.label];
  if (regression) summaryParts.push('Worse than the previous check.');
  if (changes.length) summaryParts.push(`${changes.length} change${changes.length === 1 ? '' : 's'} since last check.`);

  /**
   * Our proxy refused to forward the submission, so it never reached the site.
   * Nothing is known about this form, and announcing it against the client's
   * name would blame them for our outage. It is reported instead as what it is
   * — our monitoring being down — once per window, however many monitors trip
   * over it. FR-103.
   *
   * This replaces the per-monitor alert rather than joining it: two messages
   * about one run, one of them wrong, is worse than the one that is right.
   */
  if (record.reasonCode === 'PROXY_REJECTED_POST') {
    await reportSubmissionsBlocked({
      site: record.site,
      url: record.url,
      occurredAt: record.ranAt,
    });
    return;
  }

  /**
   * Is this worth interrupting someone for?
   *
   * `renotifyDue` is only consulted for a failing monitor, so the alert-log
   * query is skipped entirely for every other outcome — the common case does no
   * extra work.
   */
  const gate = shouldNotify({
    current: verdictIdentity(verdict.level, record.reasonCode),
    previous: prev && prevLevel ? verdictIdentity(prevLevel, prev.reasonCode) : null,
    level: verdict.level,
    changeCount: changes.length,
    renotifyDue: verdict.level === 'failing' ? await renotifyDue(record.site) : false,
  });

  if (!gate.send) {
    // Logged, not silent: when someone asks why no alert arrived, the answer is
    // in the server log rather than inferred from an absence.
    console.info(`[formWatch/notify] ${record.site}: no alert — ${gate.reason} (${verdict.label})`);
    return;
  }

  await dispatchAlert(
    {
      kind: 'form',
      event: isProblem ? 'form_problem' : 'form_ok',
      severity,
      title,
      summary: summaryParts.join(' '),
      site: record.site,
      url: record.url,
      // What this run actually found, from the rebuilt engine: the provider
      // behind an embed, the field count, the page it was found on, how many
      // forms compete for attention there, and the engine's own doubt. Before
      // FR-91 none of this reached a notification, so a third-party form could
      // only be announced as "detected" with nothing to identify it.
      facts: formRunFacts(record, raw),
      // Which search ran — a site-wide crawl reports the form it judged to be
      // the main one, which is NOT "this is the only form". FR-91.
      scope: formRunScope(record),
      // And when nothing was actually submitted, what a person must do and the
      // reason we could not do it for them.
      action: manualActionFor(record, raw) ?? undefined,
      suggestions,
      // One occurrence == one run of this schedule. The gate above decides
      // WHETHER a run is announced; this only stops the same run being sent
      // twice, which is a different job and still needed.
      dedupeKey: `form:${schedule.id}:${record.ranAt}`,
      occurredAt: record.ranAt,
    },
    {
      moreNote: changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} since last check` : null,
      detailPath: await detailPathFor('form', record.url),
    },
  );
}

/**
 * True once the re-notify window has passed since the last problem alert for
 * this site — the same spacing Site Watch uses for an ongoing outage, read from
 * the same alert log, so the two monitors speak at one cadence rather than two.
 *
 * Returns true when nothing has ever been sent, so a first failure is never
 * held back by a window that has not started.
 */
async function renotifyDue(site: string): Promise<boolean> {
  const hours = Number(process.env.ALERT_RENOTIFY_HOURS);
  const windowMs = (Number.isFinite(hours) && hours > 0 ? hours : 6) * 3_600_000;
  const last = await lastAlertAt(site, ['form_problem']);
  if (!last) return true;
  return Date.now() - new Date(last).getTime() >= windowMs;
}
