/**
 * Summarize change reports.
 *
 * Default behaviour is deterministic: counts and severity buckets.
 * AI summarization is opt-in via the aiProvider setting and is
 * provider-agnostic — see src/ai/providers.ts.
 */

import type { PageChange } from './types.js';
import { tryAiCall, type AiProviderSelection } from '../ai/providers.js';
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

/** Build a compact representation of the changes — no raw HTML, just metadata. */
function compactChanges(changes: PageChange[]): string {
  return changes
    .map((c) => {
      const lines = c.changes.slice(0, 6).map((s) => `  · ${s}`).join('\n');
      return `${c.url} [${c.severity}]:\n${lines}`;
    })
    .join('\n\n');
}

async function aiSummary(
  changes: PageChange[],
  site: string,
  selection: AiProviderSelection,
): Promise<string | null> {
  if (changes.length === 0) return null;

  const prompt = `Summarize these website changes in 1–2 sentences for a non-technical audience. Be specific about WHAT changed and WHY it might matter. Do not greet, do not list — write a concise readable paragraph.

Site: ${site}
Changes:
${compactChanges(changes)}

Reply with just the summary text — no greeting, no JSON, no markdown.`;

  const result = await tryAiCall(selection, prompt, {
    maxTokens: 250,
    temperature: 0.3, // slight creativity for prose
  });
  if (!result) return null;

  // Light cleanup — strip any leading "Summary:" or quotes the model may add
  const cleaned = result.text
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^summary:?\s*/i, '')
    .trim();

  if (!cleaned) return null;
  logger.debug(`AI summary via ${result.provider.id}: ${cleaned.slice(0, 80)}…`);
  return cleaned;
}

export async function summarizeChanges(
  changes: PageChange[],
  site: string,
  selection: AiProviderSelection,
): Promise<string> {
  if (selection !== 'off') {
    const ai = await aiSummary(changes, site, selection);
    if (ai) return ai;
    // fall through to deterministic if AI failed or no provider available
  }
  return deterministicSummary(changes);
}
