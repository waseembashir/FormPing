/**
 * Summarize change reports.
 *
 * Default behaviour is deterministic: counts and severity buckets.
 * AI summarization is opt-in via the aiProvider setting and is
 * provider-agnostic — see src/ai/providers.ts.
 */

import type { PageChange, TextChange } from './types.js';
import { tryAiCall, type AiProviderSelection } from '../ai/providers.js';
import { logger } from '../utils/logger.js';

export interface SummaryResult {
  text: string;
  /** Model label that produced the summary (e.g. "Gemini 2.5 Flash") — undefined when deterministic. */
  aiProvider?: string;
}

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

  const highChange = changes.find((c) => c.severity === 'high');
  if (highChange) {
    parts.push(`Most notable: ${highChange.url} — ${highChange.changes[0]}.`);
  }

  return parts.join(' ');
}

/** Format a single TextChange as a bounded one-liner, keeping it factual. */
function formatTextChange(tc: TextChange): string {
  const kindLabel =
    tc.kind === 'heading' ? (tc.meta ?? 'Heading') :
    tc.kind === 'paragraph' ? 'Paragraph' :
    tc.kind === 'listItem' ? 'List item' :
    tc.meta === 'Body' ? 'Body text' : 'Text';
  const trunc = (s: string, n = 80) => (s.length > n ? s.slice(0, n) + '…' : s);
  if (tc.type === 'edited') {
    return `${kindLabel} edited: "${trunc(tc.before ?? '')}" → "${trunc(tc.after ?? '')}"`;
  }
  if (tc.type === 'added') return `${kindLabel} added: "${trunc(tc.after ?? '')}"`;
  return `${kindLabel} removed: "${trunc(tc.before ?? '')}"`;
}

/** Build a compact representation of the changes — no raw HTML, just metadata.
 * For text edits we provide BOTH the high-level lines and explicit textChanges
 * so the model can compare specific before→after rather than re-describing
 * the unchanged content. */
function compactChanges(changes: PageChange[]): string {
  return changes
    .map((c) => {
      const lines = c.changes.slice(0, 8).map((s) => `  - ${s}`).join('\n');
      const textLines =
        c.textChanges && c.textChanges.length > 0
          ? '\n  TEXT_DIFFS:\n' +
            c.textChanges.slice(0, 6).map((tc) => `    * ${formatTextChange(tc)}`).join('\n')
          : '';
      return `PAGE: ${c.url} [${c.severity}]\n${lines}${textLines}`;
    })
    .join('\n\n');
}

async function aiSummary(
  changes: PageChange[],
  site: string,
  selection: AiProviderSelection,
): Promise<{ text: string; provider: string } | null> {
  if (changes.length === 0) return null;

  // Tightly constrained prompt to prevent the model from inventing details.
  // Three explicit examples (single-word edit, CTA change, form field) so the
  // model knows the EXPECTED shape: describe the literal delta, not the page.
  const prompt = `You are a precise diff summarizer. Given a list of website changes between two snapshots, write ONE sentence (max two) describing ONLY what changed.

STRICT RULES:
- Describe ONLY the literal differences between old and new versions.
- NEVER describe the unchanged content of the page.
- NEVER infer reasons, intent, or impact unless explicitly stated in the diff.
- If only a single word or phrase changed, say so explicitly.
- If only a few characters were added, quote them.
- Use past tense ("X was changed to Y", "field X was added").
- Plain text — no markdown, no JSON, no bullet list, no greetings.

EXAMPLES:

Input:
PAGE: example.com/ [low]
  - Body text edited: "Welcome to our company" → "Welcome to our awesome company"
Output:
The homepage hero text added the word "awesome" — "Welcome to our company" became "Welcome to our awesome company".

Input:
PAGE: example.com/contact [high]
  - New required tel field added: "phone"
  - Submit button edited: "Send" → "Get Quote"
Output:
The contact form added a new required phone field, and the submit button text changed from "Send" to "Get Quote".

Input:
PAGE: example.com/about [low]
  - Body text edited: "10 years of experience" → "10 years of experience helping clients."
Output:
The about page appended " helping clients." to the existing experience description.

NOW SUMMARIZE THESE CHANGES:

Site: ${site}
${compactChanges(changes)}

Output:`;

  const result = await tryAiCall(selection, prompt, {
    maxTokens: 200,
    temperature: 0, // deterministic — no creative interpretation
  });
  if (!result) return null;

  const cleaned = result.text
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(summary|output):?\s*/i, '')
    .trim();

  if (!cleaned) return null;
  logger.debug(`AI summary via ${result.provider.id}: ${cleaned.slice(0, 80)}…`);
  return { text: cleaned, provider: result.provider.modelLabel };
}

/**
 * Returns a summary plus the provider that produced it (when AI was used).
 * Falls back to deterministic counts on any AI failure.
 */
export async function summarizeChanges(
  changes: PageChange[],
  site: string,
  selection: AiProviderSelection,
): Promise<SummaryResult> {
  if (selection !== 'off') {
    const ai = await aiSummary(changes, site, selection);
    if (ai) return { text: ai.text, aiProvider: ai.provider };
  }
  return { text: deterministicSummary(changes) };
}
