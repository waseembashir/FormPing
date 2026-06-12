/**
 * Persistence for Form Watch schedules.
 *
 * Stored as a single JSON file. Like the monitor's active-watches store, the
 * file lives INSIDE data/snapshots/ so it lands on Railway's persistent
 * volume and survives redeploys. The dot-prefix marks it as a system file so
 * it never collides with the hostname-named snapshot directories.
 *
 * All operations are best-effort: disk errors are logged, never thrown, so a
 * bad disk state can't block the scheduler or the API.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { FormSchedule } from './types';

const FILE_REL = 'data/snapshots/.formping-form-schedules.json';

interface FileShape {
  schedules: FormSchedule[];
}

/** Absolute path. Routes/server modules run with cwd = formping/ui; data is one level up. */
function filePath(): string {
  return path.join(process.cwd(), '..', FILE_REL);
}

async function readAll(): Promise<FormSchedule[]> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (!parsed || !Array.isArray(parsed.schedules)) return [];
    return parsed.schedules;
  } catch {
    return [];
  }
}

async function writeAll(schedules: FormSchedule[]): Promise<void> {
  const fp = filePath();
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify({ schedules }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[formWatch/scheduleStore] write failed at ${fp}: ${err}`);
  }
}

/** All schedules (active set). */
export async function listSchedules(): Promise<FormSchedule[]> {
  return readAll();
}

/** Find a schedule by id. */
export async function getSchedule(id: string): Promise<FormSchedule | undefined> {
  return (await readAll()).find((s) => s.id === id);
}

/** Find an existing schedule for a normalized URL (used to prevent duplicates). */
export async function findScheduleByUrl(url: string): Promise<FormSchedule | undefined> {
  const norm = url.trim().replace(/\/+$/, '').toLowerCase();
  return (await readAll()).find(
    (s) => s.url.trim().replace(/\/+$/, '').toLowerCase() === norm,
  );
}

/** Add or update a schedule (keyed by id). */
export async function upsertSchedule(entry: FormSchedule): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((s) => s.id === entry.id);
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  await writeAll(all);
}

/** Remove a schedule by id (no-op if absent). Returns true if something was removed. */
export async function removeSchedule(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}
