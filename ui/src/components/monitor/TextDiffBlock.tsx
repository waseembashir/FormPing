import type { TextChange } from '@/types';

const KIND_LABEL: Record<string, string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  listItem: 'List item',
  other: 'Text',
};

const TYPE_STYLE = {
  added:   { tag: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', label: 'Added',   wrap: 'border-emerald-500/20' },
  removed: { tag: 'bg-red-500/15 text-red-300 ring-red-500/30',           label: 'Removed', wrap: 'border-red-500/20' },
  edited:  { tag: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',     label: 'Edited',  wrap: 'border-amber-500/20' },
} as const;

/**
 * Token-level diff using LCS.
 * Returns tokens tagged unchanged/added/removed.
 */
function tokenDiff(a: string, b: string): { value: string; type: 'common' | 'added' | 'removed' }[] {
  const aTok = a.split(/(\s+|[.,!?;:])/g).filter((s) => s !== '');
  const bTok = b.split(/(\s+|[.,!?;:])/g).filter((s) => s !== '');
  const m = aTok.length;
  const n = bTok.length;
  // Simple O(m*n) LCS table
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aTok[i - 1] === bTok[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const out: { value: string; type: 'common' | 'added' | 'removed' }[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (aTok[i - 1] === bTok[j - 1]) {
      out.unshift({ value: aTok[i - 1]!, type: 'common' });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      out.unshift({ value: aTok[i - 1]!, type: 'removed' });
      i--;
    } else {
      out.unshift({ value: bTok[j - 1]!, type: 'added' });
      j--;
    }
  }
  while (i > 0) {
    out.unshift({ value: aTok[i - 1]!, type: 'removed' });
    i--;
  }
  while (j > 0) {
    out.unshift({ value: bTok[j - 1]!, type: 'added' });
    j--;
  }
  return out;
}

function HeadingPrefix({ meta, kind }: { meta?: string; kind: TextChange['kind'] }) {
  // Heading uses meta directly (H1/H2/...). 'other' kind uses meta if provided
  // (e.g. "Body" → "Body text") to distinguish fallback diffs from generic divs.
  let label: string;
  if (kind === 'heading' && meta) {
    label = meta;
  } else if (kind === 'other' && meta === 'Body') {
    label = 'Body text';
  } else {
    label = KIND_LABEL[kind] ?? kind;
  }
  return (
    <span className="text-xs font-semibold text-slate-500 font-mono mr-2 shrink-0">
      [{label}]
    </span>
  );
}

function LocationBreadcrumb({ location }: { location?: TextChange['location'] }) {
  if (!location) return null;
  const { section, heading, tag } = location;
  // Build the trail: section › heading › tag
  const parts: { kind: 'section' | 'heading' | 'tag'; text: string }[] = [];
  if (section) parts.push({ kind: 'section', text: section });
  if (heading) parts.push({ kind: 'heading', text: heading });
  if (tag) parts.push({ kind: 'tag', text: `<${tag}>` });
  if (parts.length === 0) return null;

  return (
    <div className="px-3 py-1.5 bg-slate-950/60 border-b border-slate-800/60 flex items-center gap-1.5 flex-wrap">
      <span className="text-slate-600 text-xs">🧭</span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1.5 min-w-0">
          {i > 0 && <span className="text-slate-700 text-xs">›</span>}
          <span
            className={`text-xs truncate ${
              p.kind === 'tag'
                ? 'font-mono text-slate-500'
                : p.kind === 'heading'
                  ? 'text-slate-400 italic'
                  : 'text-slate-400 font-medium'
            }`}
            title={p.text}
          >
            {p.text}
          </span>
        </span>
      ))}
    </div>
  );
}

export function TextDiffBlock({ change }: { change: TextChange }) {
  const style = TYPE_STYLE[change.type];

  const renderEdited = () => {
    const tokens = tokenDiff(change.before ?? '', change.after ?? '');
    return (
      <div className="space-y-1.5">
        {/* Before — show only common + removed tokens */}
        <div className="text-sm leading-relaxed flex items-start gap-2">
          <span className="text-red-500/60 font-mono text-xs mt-0.5 shrink-0">−</span>
          <p className="break-words">
            {tokens
              .filter((t) => t.type !== 'added')
              .map((t, i) =>
                t.type === 'removed' ? (
                  <span key={i} className="bg-red-500/20 text-red-200 rounded px-0.5">{t.value}</span>
                ) : (
                  <span key={i} className="text-slate-400">{t.value}</span>
                ),
              )}
          </p>
        </div>
        {/* After — show only common + added tokens */}
        <div className="text-sm leading-relaxed flex items-start gap-2">
          <span className="text-emerald-500/80 font-mono text-xs mt-0.5 shrink-0">+</span>
          <p className="break-words">
            {tokens
              .filter((t) => t.type !== 'removed')
              .map((t, i) =>
                t.type === 'added' ? (
                  <span key={i} className="bg-emerald-500/20 text-emerald-200 rounded px-0.5 font-medium">{t.value}</span>
                ) : (
                  <span key={i} className="text-slate-300">{t.value}</span>
                ),
              )}
          </p>
        </div>
      </div>
    );
  };

  const renderAddedOrRemoved = () => {
    const isAdded = change.type === 'added';
    const text = isAdded ? change.after : change.before;
    return (
      <div className="text-sm leading-relaxed flex items-start gap-2">
        <span
          className={`font-mono text-xs mt-0.5 shrink-0 ${isAdded ? 'text-emerald-500/80' : 'text-red-500/60'}`}
        >
          {isAdded ? '+' : '−'}
        </span>
        <p
          className={`break-words ${
            isAdded
              ? 'text-emerald-200 bg-emerald-500/10 rounded px-1.5 py-0.5'
              : 'text-red-200/90 bg-red-500/10 rounded px-1.5 py-0.5 line-through decoration-red-500/40'
          }`}
        >
          {text}
        </p>
      </div>
    );
  };

  return (
    <div className={`rounded-lg border ${style.wrap} bg-slate-950/40 overflow-hidden`}>
      <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2">
        <HeadingPrefix meta={change.meta} kind={change.kind} />
        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ${style.tag}`}>
          {style.label}
        </span>
      </div>
      <LocationBreadcrumb location={change.location} />
      <div className="px-3 py-2.5">
        {change.type === 'edited' ? renderEdited() : renderAddedOrRemoved()}
      </div>
    </div>
  );
}
