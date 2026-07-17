/**
 * URLs the user explicitly chose NOT to track in Projects ("Don't track").
 *
 * Backed by Supabase (`project_dismissed` table, one row per normalized URL key)
 * when configured, else the legacy JSON file. Best-effort: errors logged, never
 * thrown. Stored by normalized+lowercased URL key so matching is consistent with
 * the Unassigned computation.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { urlKey as key } from './projectStore';
import { dataPath } from '@/lib/dataPaths';
import { supabaseAdmin, supabaseEnabled } from '@/lib/supabase';

// ── JSON implementation (fallback) ───────────────────────────────────────────
const FILE = 'data/snapshots/.formping-project-dismissed.json';
function filePath(): string {
  return dataPath(FILE);
}
async function readAll(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
async function writeAllJson(keys: string[]): Promise<void> {
  await mkdir(path.dirname(filePath()), { recursive: true });
  await writeFile(filePath(), JSON.stringify(keys), 'utf-8');
}

// ── Public API (dispatches on backend) ───────────────────────────────────────

/** Set of dismissed URL keys (for fast exclusion in the Unassigned computation). */
export async function listDismissed(): Promise<Set<string>> {
  return new Set(await listDismissedUrls());
}

/** Dismissed URL keys as an array (for the read paths). */
export async function listDismissedUrls(): Promise<string[]> {
  if (!supabaseEnabled()) return readAll();
  const { data, error } = await supabaseAdmin().from('dismissed_urls').select('url_key');
  if (error) {
    console.warn(`[dismissedStore] list: ${error.message}`);
    return [];
  }
  return (data as { url_key: string }[]).map((r) => r.url_key);
}

/** Un-dismiss a URL (re-enables the add-to-project prompt for it). Best-effort. */
export async function removeDismissed(url: string): Promise<void> {
  const k = key(url);
  if (!supabaseEnabled()) {
    try {
      const all = await readAll();
      const next = all.filter((x) => x !== k);
      if (next.length !== all.length) await writeAllJson(next);
    } catch (err) {
      console.warn(`[dismissedStore] removeDismissed failed: ${err}`);
    }
    return;
  }
  const { error } = await supabaseAdmin().from('dismissed_urls').delete().eq('url_key', k);
  if (error) console.warn(`[dismissedStore] removeDismissed: ${error.message}`);
}

/** True if this URL was dismissed from Projects. */
export async function isDismissed(url: string): Promise<boolean> {
  const k = key(url);
  if (!supabaseEnabled()) return (await readAll()).includes(k);
  const { data, error } = await supabaseAdmin().from('dismissed_urls').select('url_key').eq('url_key', k).maybeSingle();
  if (error) {
    console.warn(`[dismissedStore] isDismissed: ${error.message}`);
    return false;
  }
  return !!data;
}

/** Mark a URL as "don't track in Projects". Idempotent + best-effort. */
export async function addDismissed(url: string): Promise<void> {
  const k = key(url);
  if (!supabaseEnabled()) {
    try {
      const all = await readAll();
      if (!all.includes(k)) await writeAllJson([...all, k]);
    } catch (err) {
      console.warn(`[dismissedStore] addDismissed failed: ${err}`);
    }
    return;
  }
  const { error } = await supabaseAdmin().from('dismissed_urls').upsert({ url_key: k }, { onConflict: 'url_key' });
  if (error) console.warn(`[dismissedStore] addDismissed: ${error.message}`);
}
