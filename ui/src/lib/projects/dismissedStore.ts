/**
 * URLs the user explicitly chose NOT to track in Projects.
 *
 * When a monitor is added (Form/Site Watch) for a URL that isn't in any project,
 * we ask "add to a project?". If they say "No", the monitor keeps running but the
 * URL should NOT clutter the Unassigned bucket — it's a deliberate throwaway/test.
 * We remember that choice here (by normalized URL key) so it stays out of
 * Unassigned and we don't keep re-prompting.
 *
 * Best-effort JSON, stored inside the snapshots dir so it survives redeploys.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { normalizeUrl } from './projectStore';

const FILE = 'data/snapshots/.formping-project-dismissed.json';

function filePath(): string {
  return path.join(process.cwd(), '..', FILE);
}
function key(url: string): string {
  return normalizeUrl(url).toLowerCase();
}

async function readAll(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Set of dismissed URL keys (for fast exclusion in the Unassigned computation). */
export async function listDismissed(): Promise<Set<string>> {
  return new Set(await readAll());
}

/** True if this URL was dismissed from Projects. */
export async function isDismissed(url: string): Promise<boolean> {
  return (await readAll()).includes(key(url));
}

/** Mark a URL as "don't track in Projects". Idempotent + best-effort. */
export async function addDismissed(url: string): Promise<void> {
  try {
    const all = await readAll();
    const k = key(url);
    if (all.includes(k)) return;
    all.push(k);
    await mkdir(path.dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(all), 'utf-8');
  } catch (err) {
    console.warn(`[dismissedStore] addDismissed failed: ${err}`);
  }
}
