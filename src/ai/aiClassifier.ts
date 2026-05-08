/**
 * AI fallback classifier.
 *
 * Wraps the provider-agnostic AI layer to disambiguate when deterministic
 * scoring is too close to call. Always returns null when no provider is
 * configured or when the call fails — caller falls back to heuristic pick.
 */

import type { ContactCandidate, FormCandidate } from '../types.js';
import { tryAiCall, type AiProviderSelection } from './providers.js';
import { logger } from '../utils/logger.js';

export interface AiPageChoice {
  chosenUrl: string;
  reasoning: string;
  provider: string;
}

export interface AiFormChoice {
  chosenIndex: number;
  reasoning: string;
  provider: string;
}

/** Strip a markdown code fence if the model wrapped its JSON. */
function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function parseJsonSafely<T>(text: string): T | null {
  try {
    return JSON.parse(stripCodeFence(text)) as T;
  } catch {
    // Some models wrap JSON in extra prose — try to extract the first {...} block
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Ask AI to pick the best contact page from ambiguous candidates.
 * Called only when deterministic scoring cannot confidently pick one.
 */
export async function pickContactPage(
  candidates: ContactCandidate[],
  homepageUrl: string,
  selection: AiProviderSelection = 'auto',
): Promise<AiPageChoice | null> {
  if (selection === 'off' || candidates.length === 0) return null;

  const top = candidates.slice(0, 5);
  const prompt = `You are a QA assistant. Pick the most likely real contact page URL for "${homepageUrl}".

Candidates (already scored by heuristics):
${top.map((c) => `- ${c.url} (score: ${c.score}, signals: ${c.signals.join('; ') || 'none'})`).join('\n')}

Reply with ONLY a JSON object, no prose:
{"url": "<one of the urls above>", "reason": "<one short sentence>"}`;

  const result = await tryAiCall(selection, prompt, { maxTokens: 200, temperature: 0 });
  if (!result) return null;

  const parsed = parseJsonSafely<{ url?: string; reason?: string }>(result.text);
  if (!parsed?.url || !parsed?.reason) {
    logger.warn(`AI page-pick returned malformed JSON: ${result.text.slice(0, 100)}`);
    return null;
  }
  // Sanity: chosen URL must be in the candidate list
  if (!top.some((c) => c.url === parsed.url)) {
    logger.warn(`AI page-pick returned URL outside candidate list: ${parsed.url}`);
    return null;
  }
  return {
    chosenUrl: parsed.url,
    reasoning: parsed.reason,
    provider: result.provider.modelLabel,
  };
}

/**
 * Ask AI to pick the best contact form from ambiguous form candidates.
 * Called only when two forms score within 5 points of each other.
 */
export async function pickContactForm(
  forms: FormCandidate[],
  pageUrl: string,
  selection: AiProviderSelection = 'auto',
): Promise<AiFormChoice | null> {
  if (selection === 'off' || forms.length === 0) return null;

  const top = forms.slice(0, 5);
  const prompt = `You are a QA assistant. A contact page at "${pageUrl}" has ${forms.length} candidate forms. Pick the one most likely to be the main contact form.

Forms:
${top.map((f, i) => `- index ${f.index} (rank ${i}): score=${f.score}, signals=[${f.signals.join(', ') || 'none'}], negative=[${f.negativeSignals.join(', ') || 'none'}]`).join('\n')}

Reply with ONLY a JSON object, no prose:
{"index": <number from "index" field above>, "reason": "<one short sentence>"}`;

  const result = await tryAiCall(selection, prompt, { maxTokens: 200, temperature: 0 });
  if (!result) return null;

  const parsed = parseJsonSafely<{ index?: number; reason?: string }>(result.text);
  if (typeof parsed?.index !== 'number' || !parsed?.reason) {
    logger.warn(`AI form-pick returned malformed JSON: ${result.text.slice(0, 100)}`);
    return null;
  }
  if (!top.some((f) => f.index === parsed.index)) {
    logger.warn(`AI form-pick returned index outside candidate list: ${parsed.index}`);
    return null;
  }
  return {
    chosenIndex: parsed.index,
    reasoning: parsed.reason,
    provider: result.provider.modelLabel,
  };
}
