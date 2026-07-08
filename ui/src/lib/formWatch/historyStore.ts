/**
 * Persistence for Form Watch run history.
 *
 * One JSON file per SCHEDULE (keyed by schedule id), holding an array of run
 * records, newest first, capped to the most recent MAX_RUNS. Keying by
 * schedule id (not hostname) keeps each URL's before/after history isolated,
 * even when several scheduled forms live on the same host.
 *
 * Files live inside data/snapshots/ so they sit on Railway's persistent
 * volume. Best-effort: disk errors are logged, never thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { FormRunRecord } from './types';
import { dataPath } from '@/lib/dataPaths';

const DIR_REL = 'data/snapshots/.formping-form-runs';
const MAX_RUNS = 100;

/** Filesystem-safe filename for a schedule id. */
function safeKey(key: string): string {
  return key.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || 'unknown';
}

function fileFor(scheduleId: string): string {
  return path.join(dataPath(DIR_REL), `${safeKey(scheduleId)}.json`);
}

/** Read a schedule's run history (newest first). */
export async function readHistory(scheduleId: string): Promise<FormRunRecord[]> {
  try {
    const raw = await readFile(fileFor(scheduleId), 'utf-8');
    const parsed = JSON.parse(raw) as FormRunRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The most recent run for a schedule, or null. */
export async function latestRun(scheduleId: string): Promise<FormRunRecord | null> {
  const all = await readHistory(scheduleId);
  return all[0] ?? null;
}

/** Prepend a new run record (keyed by its scheduleId), cap to MAX_RUNS. */
export async function appendRun(record: FormRunRecord): Promise<void> {
  const fp = fileFor(record.scheduleId);
  try {
    const existing = await readHistory(record.scheduleId);
    const next = [record, ...existing].slice(0, MAX_RUNS);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[formWatch/historyStore] write failed at ${fp}: ${err}`);
  }
}
