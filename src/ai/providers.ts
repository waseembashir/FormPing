/**
 * Provider-agnostic AI layer.
 *
 * Supports four backends — Anthropic Claude Haiku, Google Gemini Flash,
 * Groq (Llama 3.1), and a local Ollama install. The active provider is
 * picked at call time from one of:
 *   - explicit selection ('anthropic' | 'gemini' | 'groq' | 'ollama')
 *   - 'auto' → priority cascade (anthropic → gemini → groq → ollama)
 *   - 'off' → AI is disabled, callers fall back to deterministic logic
 *
 * Adding a new provider = ~30 lines: one adapter object, one entry in
 * REGISTRY. The rest of the app stays the same.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

export type AiProviderId = 'anthropic' | 'gemini' | 'groq' | 'ollama';
export type AiProviderSelection = 'off' | 'auto' | AiProviderId;

export interface AiCallOptions {
  /** Hard cap on output length. Default 500 (≈ 1 paragraph). */
  maxTokens?: number;
  /** 0 = deterministic, 1 = creative. Default 0.1. */
  temperature?: number;
  /** Hard timeout for the entire call. Default 15s. */
  timeoutMs?: number;
}

export interface AiProvider {
  id: AiProviderId;
  label: string;
  /** Model id used internally — surfaces in result cards as "Using: Claude Haiku 4.5". */
  modelLabel: string;
  /** True if env vars / local service look configured. Cheap synchronous check. */
  isConfigured(): boolean;
  /** Async health check — used for things like Ollama where we need to ping localhost. */
  isAvailable(): Promise<boolean>;
  /** Call the LLM. Throws on error so callers can fallback to deterministic. */
  call(prompt: string, opts?: AiCallOptions): Promise<string>;
}

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  modelLabel: string;
  configured: boolean;
  available: boolean;
  setupHint: string;
}

// ─── Anthropic ──────────────────────────────────────────────────────────────

const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  modelLabel: 'Claude Haiku 4.5',
  isConfigured: () => Boolean(process.env['ANTHROPIC_API_KEY']),
  isAvailable: async () => Boolean(process.env['ANTHROPIC_API_KEY']),
  async call(prompt, opts = {}) {
    const client = new Anthropic({
      apiKey: process.env['ANTHROPIC_API_KEY']!,
      timeout: opts.timeoutMs ?? 15000,
    });
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.1,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = res.content[0];
    if (!block || block.type !== 'text') throw new Error('Anthropic returned non-text content');
    return block.text;
  },
};

// ─── Gemini ────────────────────────────────────────────────────────────────

const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  modelLabel: 'Gemini 2.5 Flash',
  isConfigured: () => Boolean(process.env['GEMINI_API_KEY']),
  isAvailable: async () => Boolean(process.env['GEMINI_API_KEY']),
  async call(prompt, opts = {}) {
    const apiKey = process.env['GEMINI_API_KEY']!;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 500,
            temperature: opts.temperature ?? 0.1,
            // Disable Gemini 2.5 "thinking mode" — it eats output tokens for
            // internal reasoning we don't need for classification/summary tasks.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini returned no text');
      return text;
    } finally {
      clearTimeout(timer);
    }
  },
};

// ─── Groq (OpenAI-compatible API) ──────────────────────────────────────────

const groqProvider: AiProvider = {
  id: 'groq',
  label: 'Groq',
  modelLabel: 'Llama 3.1 8B (Groq)',
  isConfigured: () => Boolean(process.env['GROQ_API_KEY']),
  isAvailable: async () => Boolean(process.env['GROQ_API_KEY']),
  async call(prompt, opts = {}) {
    const apiKey = process.env['GROQ_API_KEY']!;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.maxTokens ?? 500,
          temperature: opts.temperature ?? 0.1,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Groq ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Groq returned no text');
      return text;
    } finally {
      clearTimeout(timer);
    }
  },
};

// ─── Ollama (local) ────────────────────────────────────────────────────────

const ollamaHost = () => process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
const ollamaModel = () => process.env['OLLAMA_MODEL'] ?? 'llama3.1:8b';

const ollamaProvider: AiProvider = {
  id: 'ollama',
  label: 'Ollama',
  modelLabel: `${ollamaModel()} (local)`,
  // Configured = host overridden OR localhost is reachable. Cheap version: assume default works.
  isConfigured: () => true, // we always check availability for ollama since it's local
  async isAvailable() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${ollamaHost()}/api/tags`, { signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  },
  async call(prompt, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000); // ollama is slower
    try {
      const res = await fetch(`${ollamaHost()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: ollamaModel(),
          prompt,
          stream: false,
          options: {
            num_predict: opts.maxTokens ?? 500,
            temperature: opts.temperature ?? 0.1,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ollama ${res.status}: ${err.slice(0, 200)}`);
      }
      const data = (await res.json()) as { response?: string };
      if (!data.response) throw new Error('Ollama returned no response');
      return data.response;
    } finally {
      clearTimeout(timer);
    }
  },
};

// ─── Registry & resolution ─────────────────────────────────────────────────

/** Priority order for 'auto' mode — first available wins. */
const PRIORITY: AiProviderId[] = ['anthropic', 'gemini', 'groq', 'ollama'];

const REGISTRY: Record<AiProviderId, AiProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  groq: groqProvider,
  ollama: ollamaProvider,
};

const SETUP_HINTS: Record<AiProviderId, string> = {
  anthropic: 'Set ANTHROPIC_API_KEY in .env (sign up at console.anthropic.com)',
  gemini: 'Set GEMINI_API_KEY in .env (free tier at aistudio.google.com/app/apikey)',
  groq: 'Set GROQ_API_KEY in .env (free tier at console.groq.com/keys)',
  ollama: 'Install Ollama from ollama.com and run `ollama pull llama3.1:8b`',
};

/** Resolve a selection to a concrete provider — or null if AI is off / nothing configured. */
export async function resolveProvider(
  selection: AiProviderSelection,
): Promise<AiProvider | null> {
  if (selection === 'off') return null;

  if (selection === 'auto') {
    for (const id of PRIORITY) {
      const p = REGISTRY[id];
      if (!p.isConfigured()) continue;
      if (await p.isAvailable()) return p;
    }
    return null;
  }

  const p = REGISTRY[selection];
  if (!p) return null;
  if (!p.isConfigured()) return null;
  if (!(await p.isAvailable())) return null;
  return p;
}

/** Inspect all providers — used by /api/ai/providers to populate the UI dropdown. */
export async function listProviders(): Promise<AiProviderInfo[]> {
  return Promise.all(
    PRIORITY.map(async (id) => {
      const p = REGISTRY[id];
      const configured = p.isConfigured();
      const available = configured ? await p.isAvailable() : false;
      return {
        id: p.id,
        label: p.label,
        modelLabel: p.modelLabel,
        configured,
        available,
        setupHint: SETUP_HINTS[id],
      };
    }),
  );
}

/** Run an AI call and return the text result, or null on any failure.
 * Logs token usage / errors to stderr so users can see costs. */
export async function tryAiCall(
  selection: AiProviderSelection,
  prompt: string,
  opts: AiCallOptions = {},
): Promise<{ text: string; provider: AiProvider } | null> {
  const provider = await resolveProvider(selection);
  if (!provider) {
    if (selection !== 'off') logger.warn(`AI requested (${selection}) but no provider available`);
    return null;
  }
  try {
    const start = Date.now();
    const text = await provider.call(prompt, opts);
    const ms = Date.now() - start;
    logger.info(`AI call: ${provider.modelLabel} ${ms}ms ${text.length}ch`);
    return { text, provider };
  } catch (err) {
    logger.warn(`AI call failed (${provider.id}): ${err}`);
    return null;
  }
}
