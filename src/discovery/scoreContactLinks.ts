import type { AppConfig, ContactCandidate } from '../types.js';
import { resolveHref, isSameOrigin, urlPath } from '../utils/url.js';
import { normalizeText } from '../utils/text.js';

interface RawLink {
  href: string;
  text: string;
}

/**
 * Score a single link's URL path for contact relevance.
 * Returns a score 0–5 and the signals that contributed.
 */
function scoreLink(
  resolved: string,
  text: string,
  config: AppConfig,
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;
  const path = urlPath(resolved);
  const t = normalizeText(text);

  // Path-based scoring
  for (const pattern of config.contactPathPatterns) {
    if (pattern.test(path)) {
      score += 3;
      signals.push(`path matches ${pattern.source}`);
      break;
    }
  }

  // Anchor text scoring
  for (const pattern of config.contactTextPatterns) {
    if (pattern.test(t)) {
      score += 2;
      signals.push(`anchor text matches: "${text.slice(0, 40)}"`);
      break;
    }
  }

  // Exclusion: heavy penalty
  for (const pattern of config.excludePathPatterns) {
    if (pattern.test(path)) {
      score -= 10;
      signals.push(`excluded path: ${pattern.source}`);
      break;
    }
  }

  return { score, signals };
}

/**
 * Given raw links extracted from a homepage, return ranked ContactCandidates.
 * Only returns same-origin links with a positive score.
 */
export function scoreContactLinks(
  rawLinks: RawLink[],
  baseUrl: string,
  config: AppConfig,
): ContactCandidate[] {
  const seen = new Set<string>();
  const candidates: ContactCandidate[] = [];

  for (const { href, text } of rawLinks) {
    const resolved = resolveHref(baseUrl, href);
    if (!resolved) continue;
    if (!isSameOrigin(resolved, baseUrl)) continue;

    // Deduplicate by path+origin (ignore query/hash)
    let dedupeKey: string;
    try {
      const u = new URL(resolved);
      dedupeKey = u.origin + u.pathname;
    } catch {
      dedupeKey = resolved;
    }
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { score, signals } = scoreLink(resolved, text, config);
    if (score > 0) {
      candidates.push({ url: resolved, score, signals });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
