/**
 * Summarize change reports.
 * Default behaviour is deterministic: counts and severity buckets.
 * AI summarization is opt-in (--ai-summary) and is currently a stub —
 * see TODO below to wire in Claude / OpenAI.
 */

import type { PageChange } from './types.js';
import { logger } from '../utils/logger.js';

function deterministicSummary(changes: PageChange[]): string {
  if (changes.length === 0) return 'No changes detected.';

  const total = changes.reduce((acc, c) => acc + c.changes.length, 0);
  const high = changes.filter((c) => c.severity === 'high').length;
  const medium = changes.filter((c) => c.severity === 'medium').length;
  const low = changes.filter((c) => c.severity === 'low').length;

  const parts: string[] = [
    `${total} change${total !== 1 ? 's' : ''} across ${changes.length} page${changes.length !== 1 ? 's' : ''}.`,
  ];
  if (high > 0) parts.push(`${high} high-severity`);
  if (medium > 0) parts.push(`${medium} medium`);
  if (low > 0) parts.push(`${low} low`);

  // Highlight the single most consequential change
  const highChange = changes.find((c) => c.severity === 'high');
  if (highChange) {
    parts.push(`Most notable: ${highChange.url} — ${highChange.changes[0]}.`);
  }

  return parts.join(' ');
}

/**
 * Optional AI-powered summary. Stub by default — returns null and the caller
 * falls back to the deterministic summary.
 *
 * TODO: Implement provider integration here. Recommended approach:
 *
 *   const prompt = `Summarize these website changes in 1–2 sentences for a
 *   non-technical audience. Be specific about what changed.
 *   Site: ${site}
 *   Changes: ${JSON.stringify(changes, null, 2)}`;
 *   const response = await callLLM(prompt);
 *   return response;
 *
 * Keep prompts compact — pass diff metadata only, never raw HTML.
 */
async function aiSummary(changes: PageChange[], site: string): Promise<string | null> {
  logger.warn('AI summary requested but not implemented (stub)');
  void changes;
  void site;
  return null;
}

export async function summarizeChanges(
  changes: PageChange[],
  site: string,
  useAi: boolean,
): Promise<string> {
  if (useAi) {
    const ai = await aiSummary(changes, site);
    if (ai) return ai;
    // fall through to deterministic
  }
  return deterministicSummary(changes);
}
