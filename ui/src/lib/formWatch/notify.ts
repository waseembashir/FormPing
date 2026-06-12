/**
 * Completion hook for a Form Watch run.
 *
 * Called by the ticker right after a run finishes but BEFORE the new record is
 * appended to history — so `latestRun` still returns the PREVIOUS run, giving
 * us a clean before/after comparison. Computes changes + suggestions and fires
 * the Slack notification.
 */

import type { FormSchedule, FormRunRecord } from './types';
import { latestRun } from './historyStore';
import { compareFingerprints, isRegression } from './diff';
import { buildSuggestions } from './suggestions';
import { sendFormSlack } from './slack';

export async function onRunComplete(schedule: FormSchedule, record: FormRunRecord): Promise<void> {
  const prev = await latestRun(schedule.id); // previous run (this one not yet stored)
  const changes = compareFingerprints(prev?.fingerprint ?? null, record.fingerprint);
  const regression = isRegression(prev?.status ?? null, record.status);
  const suggestions = buildSuggestions(record, changes);

  await sendFormSlack({ schedule, record, changes, suggestions, regression });
}
