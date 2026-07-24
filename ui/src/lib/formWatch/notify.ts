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
import { runVerdict } from './verdict';
import { dispatchAlert } from '@/lib/alerts/dispatch';
import { detailPathFor } from '@/lib/alerts/link';
import type { AlertSeverity } from '@/lib/alerts/types';

export async function onRunComplete(schedule: FormSchedule, record: FormRunRecord): Promise<void> {
  const prev = await latestRun(schedule.id); // previous run (this one not yet stored)
  const changes = compareFingerprints(prev?.fingerprint ?? null, record.fingerprint);
  const prevLevel = prev
    ? runVerdict(prev.reasonCode, prev.fingerprint.formFound, prev.status).level
    : null;
  const verdict = runVerdict(record.reasonCode, record.fingerprint.formFound, record.status);
  const regression = isRegression(prevLevel, verdict.level);
  const suggestions = buildSuggestions(record, changes);

  const severity: AlertSeverity =
    verdict.level === 'failing' ? 'critical' : verdict.level === 'attention' ? 'warning' : 'info';

  const title =
    verdict.level === 'healthy'
      ? `Contact form OK — ${record.site}`
      : `Contact form ${verdict.level === 'failing' ? 'failing' : 'needs attention'} — ${record.site}`;

  const summaryParts = [`${verdict.label} (${record.reasonCode || 'no reason code'})`];
  if (regression) summaryParts.push('Worse than the previous check.');
  if (changes.length) summaryParts.push(`${changes.length} change${changes.length === 1 ? '' : 's'} since last check.`);

  await dispatchAlert(
    {
      kind: 'form',
      event: verdict.level === 'healthy' ? 'form_ok' : 'form_problem',
      severity,
      title,
      summary: summaryParts.join(' '),
      site: record.site,
      url: record.url,
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
