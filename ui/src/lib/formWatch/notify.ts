/**
 * Completion hook for a Form Watch run.
 *
 * Called by the ticker right after a run finishes but BEFORE the new record is
 * appended to history — so `latestRun` still returns the PREVIOUS run, giving
 * us a clean before/after comparison. Computes changes + suggestions, then hands
 * the result to the alert dispatcher.
 *
 * BEHAVIOUR PRESERVED: this still fires on EVERY run, success included, so the
 * "submitted OK" ping you asked for keeps arriving. What changed is only HOW it
 * is delivered — through the shared dispatcher, so it is deduped, rate-limited
 * and logged like every other alert instead of POSTing to Slack on its own.
 */

import type { FormSchedule, FormRunRecord } from './types';
import { latestRun } from './historyStore';
import { compareFingerprints, isRegression } from './diff';
import { buildSuggestions } from './suggestions';
import { formRunFacts, formRunScope, manualActionFor } from './alertFacts';
import { runVerdict } from './verdict';
import { dispatchAlert } from '@/lib/alerts/dispatch';
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
        : verdict.level === 'detected'
          ? 'notice'
          : 'info';

  // `detected` (a recognised third-party embed) is informational, like `healthy` —
  // NOT a "needs attention" ping. FR-60.
  const isProblem = verdict.level === 'failing' || verdict.level === 'attention';
  /**
   * A headline may only claim what the mode actually tested.
   *
   * "Contact form OK" was sent for Detect-mode runs, which confirm that a form
   * exists and do nothing else — no fill, no submit. Read at a glance in Slack,
   * that says "your contact form works", which we had not established and could
   * not have. Safe mode fills but never submits, so it cannot claim delivery
   * either. Only Live mode actually puts a message through. FR-91.
   */
  const okTitle =
    record.mode === 'live'
      ? `Contact form OK — ${record.site}`
      : record.mode === 'safe'
        ? `Contact form filled OK — ${record.site}`
        : `Contact form found — ${record.site}`;

  const title =
    verdict.level === 'detected'
      ? `Third-party form detected — ${record.site}`
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
      // One occurrence == one run of this schedule.
      dedupeKey: `form:${schedule.id}:${record.ranAt}`,
      occurredAt: record.ranAt,
    },
    {
      moreNote: changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} since last check` : null,
      detailPath: await detailPathFor('form', record.url),
    },
  );
}
