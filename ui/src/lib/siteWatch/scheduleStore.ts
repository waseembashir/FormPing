/**
 * Persistence for Site Watch schedules. JSON file inside data/snapshots/ so it
 * lands on Railway's persistent volume and survives redeploys. Best-effort:
 * disk errors are logged, never thrown.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { SiteSchedule } from './types';

const FILE_REL = 'data/snapshots/.formping-site-schedules.json';

interface FileShape {
  schedules: SiteSchedule[];
}

function filePath(): string {
  return path.join(process.cwd(), '..', FILE_REL);
}

async function readAll(): Promise<SiteSchedule[]> {
  try {
    const raw = await readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (!parsed || !Array.isArray(parsed.schedules)) return [];
    return parsed.schedules;
  } catch {
    return [];
  }
}

async function writeAll(schedules: SiteSchedule[]): Promise<void> {
  const fp = filePath();
  try {
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, JSON.stringify({ schedules }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[siteWatch/scheduleStore] write failed at ${fp}: ${err}`);
  }
}

export async function listSchedules(): Promise<SiteSchedule[]> {
  return readAll();
}

export async function getSchedule(id: string): Promise<SiteSchedule | undefined> {
  return (await readAll()).find((s) => s.id === id);
}

export async function findScheduleByUrl(url: string): Promise<SiteSchedule | undefined> {
  const norm = url.trim().replace(/\/+$/, '').toLowerCase();
  return (await readAll()).find((s) => s.url.trim().replace(/\/+$/, '').toLowerCase() === norm);
}

export async function upsertSchedule(entry: SiteSchedule): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((s) => s.id === entry.id);
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  await writeAll(all);
}

export async function removeSchedule(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}
