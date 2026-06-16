/**
 * Persistence for Site Watch check history — one JSON file per schedule
 * (keyed by id), newest first, capped. Lives on the Railway volume.
 * Best-effort: disk errors are logged, never thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { SiteCheckRecord } from './types';

const DIR_REL = 'data/snapshots/.formping-site-runs';
const MAX_RUNS = 200;

function safeKey(key: string): string {
  return key.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || 'unknown';
}

function fileFor(scheduleId: string): string {
  return path.join(process.cwd(), '..', DIR_REL, `${safeKey(scheduleId)}.json`);
}

export async function readHistory(scheduleId: string): Promise<SiteCheckRecord[]> {
  try {
    const raw = await readFile(fileFor(scheduleId), 'utf-8');
    const parsed = JSON.parse(raw) as SiteCheckRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendCheck(record: SiteCheckRecord): Promise<void> {
  const fp = fileFor(record.scheduleId);
  try {
    const existing = await readHistory(record.scheduleId);
    const next = [record, ...existing].slice(0, MAX_RUNS);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[siteWatch/historyStore] write failed at ${fp}: ${err}`);
  }
}
