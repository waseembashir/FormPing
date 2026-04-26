export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function containsAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function firstMatch(text: string, patterns: RegExp[]): RegExp | null {
  return patterns.find((p) => p.test(text)) ?? null;
}

export function truncate(s: string, max = 120): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
