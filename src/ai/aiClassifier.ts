/**
 * AI fallback classifier — disabled by default.
 *
 * This module is intentionally a stub. To enable AI-assisted disambiguation,
 * set `aiEnabled: true` in config and implement the provider integration below.
 *
 * TODO: integrate Claude/OpenAI here. Keep prompts compact — pass only
 * extracted metadata (URLs, scores, field names), never raw HTML.
 */

import type { ContactCandidate, FormCandidate } from '../types.js';
import { logger } from '../utils/logger.js';

export interface AiPageChoice {
  chosenUrl: string;
  reasoning: string;
}

export interface AiFormChoice {
  chosenIndex: number;
  reasoning: string;
}

/**
 * Ask AI to pick the best contact page from ambiguous candidates.
 * Called only when deterministic scoring cannot confidently pick one.
 *
 * @param candidates - top 3–5 scored candidates with their signals
 * @param homepageUrl - the original homepage for context
 */
export async function pickContactPage(
  candidates: ContactCandidate[],
  homepageUrl: string,
): Promise<AiPageChoice | null> {
  logger.warn('AI classifier called for contact page disambiguation (stub — not implemented)');

  // TODO: call Claude/OpenAI here with a compact prompt like:
  //
  // const prompt = `
  // You are a QA assistant. Given these candidate contact page URLs for ${homepageUrl},
  // pick the most likely real contact page URL. Reply with JSON: {"url": "<url>", "reason": "<brief>"}
  //
  // Candidates:
  // ${candidates.slice(0, 5).map((c) => `- ${c.url} (score: ${c.score}, signals: ${c.signals.join(', ')})`).join('\n')}
  // `;
  //
  // const response = await callLLM(prompt); // implement callLLM
  // return JSON.parse(response);

  return null;
}

/**
 * Ask AI to pick the best contact form from ambiguous form candidates.
 * Called only when two forms score within 5 points of each other.
 *
 * @param forms - scored form candidates with their signals
 * @param pageUrl - the contact page URL for context
 */
export async function pickContactForm(
  forms: FormCandidate[],
  pageUrl: string,
): Promise<AiFormChoice | null> {
  logger.warn('AI classifier called for form disambiguation (stub — not implemented)');

  // TODO: call Claude/OpenAI here with a compact prompt like:
  //
  // const prompt = `
  // You are a QA assistant. A contact page at ${pageUrl} has ${forms.length} forms.
  // Pick the index of the main contact form. Reply with JSON: {"index": <number>, "reason": "<brief>"}
  //
  // Forms:
  // ${forms.map((f) => `- index:${f.index} score:${f.score} signals:[${f.signals.join(',')}] negative:[${f.negativeSignals.join(',')}]`).join('\n')}
  // `;
  //
  // const response = await callLLM(prompt); // implement callLLM
  // return JSON.parse(response);

  return null;
}
