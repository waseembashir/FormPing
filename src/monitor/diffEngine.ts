import type {
  ChangeSeverity,
  PageChange,
  PageSnapshot,
  SiteSnapshot,
  FormFieldSnapshot,
  TextChange,
  TextChangeKind,
} from './types.js';

/** Word-set similarity (Jaccard on lowercase words). 0–1. */
function similarity(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (aWords.size === 0 && bWords.size === 0) return 1;
  let intersect = 0;
  for (const w of aWords) if (bWords.has(w)) intersect++;
  const union = aWords.size + bWords.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * Diff two arrays of text strings. Items that exact-match are unchanged.
 * Unmatched items are paired by best-similarity (>= 0.55) → 'edited',
 * remaining unpaired old → 'removed', unpaired new → 'added'.
 */
export function diffTextArrays(
  oldArr: string[],
  newArr: string[],
  kind: TextChangeKind,
  meta?: (text: string, isNew: boolean) => string,
): TextChange[] {
  const result: TextChange[] = [];
  const oldSet = new Set(oldArr);
  const newSet = new Set(newArr);

  // 1) Unmatched (need fuzzy pairing)
  const oldUnmatched = oldArr.filter((s) => !newSet.has(s));
  const newUnmatched = newArr.filter((s) => !oldSet.has(s));
  const usedNew = new Set<number>();

  for (const oldItem of oldUnmatched) {
    let bestIdx = -1;
    // Lower threshold for short strings (≤3 words) since "Welcome" → "Welcome Home"
    // would have similarity 0.5 but is clearly an edit, not a separate item.
    const wordCount = oldItem.split(/\s+/).filter(Boolean).length;
    let bestSim = wordCount <= 3 ? 0.34 : 0.5;
    for (let i = 0; i < newUnmatched.length; i++) {
      if (usedNew.has(i)) continue;
      const sim = similarity(oldItem, newUnmatched[i]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const newItem = newUnmatched[bestIdx]!;
      usedNew.add(bestIdx);
      result.push({
        type: 'edited',
        kind,
        before: oldItem,
        after: newItem,
        ...(meta ? { meta: meta(newItem, true) } : {}),
      });
    } else {
      result.push({
        type: 'removed',
        kind,
        before: oldItem,
        ...(meta ? { meta: meta(oldItem, false) } : {}),
      });
    }
  }

  for (let i = 0; i < newUnmatched.length; i++) {
    if (usedNew.has(i)) continue;
    const item = newUnmatched[i]!;
    result.push({
      type: 'added',
      kind,
      after: item,
      ...(meta ? { meta: meta(item, true) } : {}),
    });
  }

  return result;
}

const SEVERITY_RANK: Record<ChangeSeverity, number> = { low: 1, medium: 2, high: 3 };

function maxSeverity(a: ChangeSeverity, b: ChangeSeverity): ChangeSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function fieldKey(f: FormFieldSnapshot): string {
  return f.name || f.label || f.type;
}

/** Diff a single page. Returns null if there are no changes. */
export function diffPage(oldPage: PageSnapshot, newPage: PageSnapshot): PageChange | null {
  const changes: string[] = [];
  let severity: ChangeSeverity = 'low';
  const bump = (msg: string, sev: ChangeSeverity) => {
    changes.push(msg);
    severity = maxSeverity(severity, sev);
  };

  // ── SEO ────────────────────────────────────────────────────────────────────
  if (oldPage.title !== newPage.title) {
    bump(`Title changed: "${truncate(oldPage.title)}" → "${truncate(newPage.title)}"`, 'medium');
  }
  if (oldPage.metaDescription !== newPage.metaDescription) {
    bump('Meta description changed', 'low');
  }
  if (oldPage.h1 !== newPage.h1) {
    bump(`H1 changed: "${truncate(oldPage.h1)}" → "${truncate(newPage.h1)}"`, 'medium');
  }
  if (oldPage.canonical !== newPage.canonical) {
    bump(`Canonical URL changed: "${oldPage.canonical}" → "${newPage.canonical}"`, 'medium');
  }
  if (oldPage.metaRobots !== newPage.metaRobots) {
    bump(`Robots meta changed: "${oldPage.metaRobots}" → "${newPage.metaRobots}"`, 'high');
  }

  // ── Form fields ───────────────────────────────────────────────────────────
  const oldFieldByKey = new Map(oldPage.formFields.map((f) => [fieldKey(f), f]));
  const newFieldByKey = new Map(newPage.formFields.map((f) => [fieldKey(f), f]));

  for (const [key, f] of newFieldByKey) {
    if (!oldFieldByKey.has(key)) {
      const reqText = f.required ? 'required ' : '';
      bump(`New ${reqText}${f.type} field added: "${key}"`, 'high');
    }
  }
  for (const [key, f] of oldFieldByKey) {
    if (!newFieldByKey.has(key)) {
      bump(`Form field removed: "${key}" (was ${f.type})`, 'high');
    }
  }
  for (const [key, newF] of newFieldByKey) {
    const oldF = oldFieldByKey.get(key);
    if (oldF && oldF.required !== newF.required) {
      bump(
        `Field "${key}" is ${newF.required ? 'now required' : 'no longer required'}`,
        'medium',
      );
    }
    if (oldF && oldF.type !== newF.type) {
      bump(`Field "${key}" type changed: ${oldF.type} → ${newF.type}`, 'medium');
    }
  }

  // ── Buttons / CTAs ────────────────────────────────────────────────────────
  const oldButtons = new Set(oldPage.buttons);
  const newButtons = new Set(newPage.buttons);
  for (const b of newButtons) {
    if (!oldButtons.has(b)) bump(`New button: "${truncate(b, 40)}"`, 'medium');
  }
  for (const b of oldButtons) {
    if (!newButtons.has(b)) bump(`Button removed: "${truncate(b, 40)}"`, 'medium');
  }

  // ── Scripts (tracking, analytics, libs) ───────────────────────────────────
  const oldScripts = new Set(oldPage.scripts);
  const newScripts = new Set(newPage.scripts);
  for (const s of newScripts) {
    if (!oldScripts.has(s)) bump(`New script loaded: ${truncate(s, 80)}`, 'low');
  }
  for (const s of oldScripts) {
    if (!newScripts.has(s)) bump(`Script removed: ${truncate(s, 80)}`, 'low');
  }

  // ── Structured text-block diff (headings / paragraphs / list items) ──────
  const oldHeadings = (oldPage.textBlocks?.headings ?? []).map((h) => h.text);
  const newHeadings = (newPage.textBlocks?.headings ?? []).map((h) => h.text);
  const headingTagOf = (page: typeof newPage, text: string) =>
    page.textBlocks?.headings.find((h) => h.text === text)?.tag.toUpperCase() ?? 'H?';

  const textChanges: TextChange[] = [
    ...diffTextArrays(oldHeadings, newHeadings, 'heading', (text, isNew) =>
      headingTagOf(isNew ? newPage : oldPage, text),
    ),
    ...diffTextArrays(
      oldPage.textBlocks?.paragraphs ?? [],
      newPage.textBlocks?.paragraphs ?? [],
      'paragraph',
    ),
    ...diffTextArrays(
      oldPage.textBlocks?.listItems ?? [],
      newPage.textBlocks?.listItems ?? [],
      'listItem',
    ),
    ...diffTextArrays(
      oldPage.textBlocks?.other ?? [],
      newPage.textBlocks?.other ?? [],
      'other',
    ),
  ];

  // Bubble structured text changes up to high-level changes too
  for (const tc of textChanges) {
    const label =
      tc.kind === 'heading'
        ? (tc.meta ?? 'Heading')
        : tc.kind === 'paragraph'
          ? 'Paragraph'
          : tc.kind === 'listItem'
            ? 'List item'
            : 'Text';
    if (tc.type === 'edited') {
      bump(`${label} edited: "${truncate(tc.before!, 60)}" → "${truncate(tc.after!, 60)}"`, tc.kind === 'heading' ? 'medium' : 'low');
    } else if (tc.type === 'added') {
      bump(`${label} added: "${truncate(tc.after!, 80)}"`, tc.kind === 'heading' ? 'medium' : 'low');
    } else {
      bump(`${label} removed: "${truncate(tc.before!, 80)}"`, tc.kind === 'heading' ? 'medium' : 'low');
    }
  }

  // Fallback: text-content hash for cases where structured diff missed something
  // (e.g. divs / spans / non-semantic text). Keep it as a lower-priority signal.
  if (
    textChanges.length === 0 &&
    oldPage.textContentHash &&
    oldPage.textContentHash !== newPage.textContentHash
  ) {
    const lenDiff = Math.abs(newPage.textContentLength - oldPage.textContentLength);
    const pct = lenDiff / Math.max(oldPage.textContentLength, 1);
    if (pct >= 0.2) {
      bump(`Major text content change (${Math.round(pct * 100)}% size delta — non-semantic markup)`, 'medium');
    } else if (pct >= 0.05) {
      bump(`Text content edited (${Math.round(pct * 100)}% size delta — non-semantic markup)`, 'low');
    }
  }

  // ── Performance ──────────────────────────────────────────────────────────
  if (
    oldPage.loadTime > 0 &&
    newPage.loadTime > 0 &&
    newPage.loadTime > oldPage.loadTime * 1.5 &&
    newPage.loadTime - oldPage.loadTime > 500
  ) {
    bump(`Load time increased: ${oldPage.loadTime}ms → ${newPage.loadTime}ms`, 'low');
  }

  if (changes.length === 0) return null;
  return {
    url: newPage.url,
    changes,
    ...(textChanges.length > 0 ? { textChanges } : {}),
    severity,
  };
}

/** Diff two site snapshots. Returns one PageChange entry per page that changed. */
export function diffSnapshots(oldSnap: SiteSnapshot, newSnap: SiteSnapshot): PageChange[] {
  const result: PageChange[] = [];
  const oldByUrl = new Map(oldSnap.pages.map((p) => [p.url, p]));
  const newByUrl = new Map(newSnap.pages.map((p) => [p.url, p]));

  for (const newPage of newSnap.pages) {
    const oldPage = oldByUrl.get(newPage.url);
    if (!oldPage) {
      result.push({
        url: newPage.url,
        changes: ['Page is new (not in previous snapshot)'],
        severity: 'medium',
      });
      continue;
    }
    const diff = diffPage(oldPage, newPage);
    if (diff) result.push(diff);
  }

  for (const oldPage of oldSnap.pages) {
    if (!newByUrl.has(oldPage.url)) {
      result.push({
        url: oldPage.url,
        changes: ['Page no longer found in latest crawl'],
        severity: 'high',
      });
    }
  }

  return result;
}

export function totalChanges(pageChanges: PageChange[]): number {
  return pageChanges.reduce((acc, c) => acc + c.changes.length, 0);
}
