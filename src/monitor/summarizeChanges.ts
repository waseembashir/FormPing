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

  // Tightly constrained prompt with four examples covering the four common
  // diff shapes (append, multi-change, suffix add, removal). Strict rules
  // prevent both hallucination AND the opposite failure of "claiming nothing
  // changed" when small diffs are dismissed as insignificant.
  const prompt = `You are a precise diff summarizer for website changes between two snapshots.

OUTPUT: ONE sentence (max two), describing ONLY what changed.

STRICT RULES:
- Describe ONLY the literal differences shown in the diff list.
- ALWAYS report what changed — even tiny edits like a single word, character, or punctuation.
- FORBIDDEN: claiming "no changes", "no significant changes", "nothing changed", or "identical". The diff list is non-empty by definition; if you see no obvious change, look harder for the literal text difference.
- NEVER describe unchanged content of the page.
- NEVER infer reasons, intent, or impact unless explicitly stated in the diff.
- Use past tense ("X was changed to Y", "field X was added", "word X was removed").
- Plain text — no markdown, no JSON, no greetings.

EXAMPLES:

Input: PAGE: example.com/ [low]
  - Body text edited: "Welcome to our company" → "Welcome to our awesome company"
Output: The homepage hero text added the word "awesome" — "Welcome to our company" became "Welcome to our awesome company".

Input: PAGE: example.com/contact [high]
  - New required tel field added: "phone"
  - Submit button edited: "Send" → "Get Quote"
Output: The contact form added a new required phone field, and the submit button text changed from "Send" to "Get Quote".

Input: PAGE: example.com/about [low]
  - Body text edited: "10 years of experience" → "10 years of experience helping clients."
Output: The about page appended " helping clients." to the existing experience description.

Input: PAGE: example.com/about [low]
  - Body text edited: "Bio text with extras Hello" → "Bio text with extras"
Output: The about page removed the trailing word "Hello" from the body text.

NOW SUMMARIZE THESE CHANGES:

Site: ${site}
${compactChanges(changes)}

Output:`;

  const result = await tryAiCall(selection, prompt, {
    maxTokens: 220,
    // 0.1 — almost deterministic, but 0 can push models toward dismissive
    // "safest" answers like "nothing significant changed" on tiny diffs.
    temperature: 0.1,
  });
  if (!result) return null;

  const cleaned = result.text
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(summary|output):?\s*/i, '')
    .trim();

  if (!cleaned) return null;

  // Safety net: if the AI claims nothing changed despite a non-empty diff list,
  // it's confused — fall back to the deterministic summary. This catches
  // model regressions (e.g. Gemini sometimes dismisses one-word diffs).
  const NO_CHANGE_PHRASE =
    /\b(no|not\s+any|zero)\s+(significant|notable|major|relevant)?\s*(changes?|differences?|edits?|modifications?|updates?)\b|\bnothing\s+(changed|was\s+changed|to\s+report)\b|\b(content|page)\s+is\s+identical\b/i;
  if (NO_CHANGE_PHRASE.test(cleaned)) {
    logger.warn(
      `AI summary claimed no changes despite ${changes.length} change(s) — falling back to deterministic`,
    );
    return null;
  }

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
