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

// ═══════════════════════════════════════════════════════════════════════════
// AI RESCUE — fires when deterministic scoring finds NOTHING (not just ties).
// Different from the pick* functions above: we pass ALL the links/forms on the
// page, not just candidates that passed our heuristic. The AI is asked to
// either pick one or explicitly say "none exists here". The result is sanity-
// checked (must reference one of the things we sent it) before we trust it.
// ═══════════════════════════════════════════════════════════════════════════

export interface AiRescueLink {
  href: string;
  text: string;
}

export interface AiRescueFormField {
  name: string;
  type: string;
  label: string;
}

export interface AiRescueFormCandidate {
  index: number;
  /** All visible fields on the form */
  fields: AiRescueFormField[];
  /** Submit button text if any */
  submitText: string;
  /** ID/name/class hints */
  identifier: string;
}

/**
 * AI rescue for contact page when deterministic scoring returned zero
 * candidates. Pass up to 40 same-origin links; AI picks one or says NONE.
 */
export async function rescueContactPage(
  allLinks: AiRescueLink[],
  homepageUrl: string,
  selection: AiProviderSelection,
): Promise<AiPageChoice | null> {
  if (selection === 'off' || allLinks.length === 0) return null;

  // Prioritize links by potential relevance — keep short URLs near the top
  // so the AI sees the most likely candidates first if we hit the cap
  const trimmed = allLinks
    .slice() // copy
    .sort((a, b) => a.href.length - b.href.length)
    .slice(0, 40);

  const prompt = `You are a QA assistant. The homepage at "${homepageUrl}" has these internal links. My deterministic patterns (/contact, /get-in-touch, etc.) did NOT match any of them. Look at each link's URL path AND its visible text — does any link look like a contact page in disguise (e.g., "Say Hi", "Lets Chat", non-English variants like "Kontakt" or "Nous Contacter", creative naming, etc.)?

Links:
${trimmed.map((l, i) => `${i}. ${l.href}  ←  "${l.text.slice(0, 60).replace(/\s+/g, ' ').trim()}"`).join('\n')}

Reply with ONLY JSON, no prose:
- If a link looks like the contact page: {"url": "<one of the urls above>", "reason": "<short>"}
- If no link looks like a contact page: {"url": null, "reason": "<short>"}`;

  const result = await tryAiCall(selection, prompt, { maxTokens: 250, temperature: 0 });
  if (!result) return null;

  const parsed = parseJsonSafely<{ url?: string | null; reason?: string }>(result.text);
  if (!parsed?.reason) {
    logger.warn(`AI rescue page returned malformed JSON: ${result.text.slice(0, 120)}`);
    return null;
  }
  if (!parsed.url) {
    logger.info(`AI rescue: no contact page identified (reason: ${parsed.reason})`);
    return null;
  }
  // Sanity check — chosen URL must be in the list we sent
  if (!trimmed.some((l) => l.href === parsed.url)) {
    logger.warn(`AI rescue page returned URL outside list: ${parsed.url}`);
    return null;
  }
  logger.info(`AI rescue (${result.provider.modelLabel}) picked ${parsed.url}: ${parsed.reason}`);
  return {
    chosenUrl: parsed.url,
    reasoning: parsed.reason,
    provider: result.provider.modelLabel,
  };
}

/**
 * AI rescue for contact form when deterministic scoring rejected every form
 * on the page (all scored < 0). Pass up to 8 forms with their fields; AI picks
 * one or says NONE.
 */
export async function rescueContactForm(
  allForms: AiRescueFormCandidate[],
  pageUrl: string,
  selection: AiProviderSelection,
): Promise<AiFormChoice | null> {
  if (selection === 'off' || allForms.length === 0) return null;

  const trimmed = allForms.slice(0, 8);

  const prompt = `You are a QA assistant. A page at "${pageUrl}" has these forms. My deterministic scoring rejected all of them (no clear name/email/textarea pattern, or matched a negative signal like "search" / "newsletter"). Look carefully — is any of them actually the contact form, perhaps disguised (e.g., "Get in touch" form with creative field naming)?

Forms:
${trimmed.map((f) => `- index ${f.index}: identifier="${f.identifier}", submit="${f.submitText}"\n    fields: ${f.fields.map((field) => `${field.type}[name=${field.name},label=${field.label.slice(0, 30)}]`).join(', ') || '(none visible)'}`).join('\n')}

Reply with ONLY JSON, no prose:
- If one is the contact form: {"index": <number from "index" field above>, "reason": "<short>"}
- If none is a real contact form: {"index": null, "reason": "<short>"}`;

  const result = await tryAiCall(selection, prompt, { maxTokens: 200, temperature: 0 });
  if (!result) return null;

  const parsed = parseJsonSafely<{ index?: number | null; reason?: string }>(result.text);
  if (!parsed?.reason) {
    logger.warn(`AI rescue form returned malformed JSON: ${result.text.slice(0, 120)}`);
    return null;
  }
  if (parsed.index === null || parsed.index === undefined) {
    logger.info(`AI rescue: no contact form identified (reason: ${parsed.reason})`);
    return null;
  }
  if (!trimmed.some((f) => f.index === parsed.index)) {
    logger.warn(`AI rescue form returned index outside list: ${parsed.index}`);
    return null;
  }
  logger.info(`AI rescue (${result.provider.modelLabel}) picked form index ${parsed.index}: ${parsed.reason}`);
  return {
    chosenIndex: parsed.index,
    reasoning: parsed.reason,
    provider: result.provider.modelLabel,
  };
}
