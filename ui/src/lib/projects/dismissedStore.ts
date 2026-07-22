/**
 * URLs the user explicitly chose NOT to track in Projects ("Don't track").
 *
 * Backed by Supabase (`dismissed_urls` table, one row per normalized URL key).
 * Best-effort: errors are logged, never thrown. Stored by normalized+lowercased
 * URL key so matching is consistent with the Unassigned computation.
 */

import { urlKey as key } from './projectStore';
import { supabaseAdmin } from '@/lib/supabase';

/** Set of dismissed URL keys (for fast exclusion in the Unassigned computation). */
export async function listDismissed(): Promise<Set<string>> {
  return new Set(await listDismissedUrls());
}

/** Dismissed URL keys as an array (for the read paths). */
export async function listDismissedUrls(): Promise<string[]> {
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
  const { error } = await supabaseAdmin().from('dismissed_urls').delete().eq('url_key', k);
  if (error) console.warn(`[dismissedStore] removeDismissed: ${error.message}`);
}

/** True if this URL was dismissed from Projects. */
export async function isDismissed(url: string): Promise<boolean> {
  const k = key(url);
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
  const { error } = await supabaseAdmin().from('dismissed_urls').upsert({ url_key: k }, { onConflict: 'url_key' });
  if (error) console.warn(`[dismissedStore] addDismissed: ${error.message}`);
}
