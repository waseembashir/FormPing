'use client';
import { useState } from 'react';
import type { PageChange, TextChange } from '@/types';
import { SeverityBadge } from './SeverityBadge';
import { TextDiffBlock } from './TextDiffBlock';

const BORDER: Record<PageChange['severity'], string> = {
  high: 'border-red-500/20',
  medium: 'border-amber-500/20',
  low: 'border-slate-700',
};

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || '/';
  } catch {
    return url;
  }
}

/** Hide the high-level lines that are already shown via TextDiffBlock to avoid duplication. */
function isStructuralLine(line: string): boolean {
  return /^(Heading|H1|H2|H3|Paragraph|List item)\s+(edited|added|removed):/.test(line);
}

const PREVIEW_TEXT_DIFFS = 3;

export function PageChangeCard({ change }: { change: PageChange }) {
  const [showAllText, setShowAllText] = useState(false);

  const textChanges: TextChange[] = change.textChanges ?? [];
  const visibleTextChanges = showAllText ? textChanges : textChanges.slice(0, PREVIEW_TEXT_DIFFS);
  const otherChanges = change.changes.filter((c) => !isStructuralLine(c));

  return (
    <div className={`rounded-xl border ${BORDER[change.severity]} bg-slate-900 overflow-hidden animate-slide-in`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium text-slate-100 truncate">{shortPath(change.url)}</p>
          <p className="font-mono text-xs text-slate-500 truncate mt-0.5">{change.url}</p>
        </div>
        <SeverityBadge severity={change.severity} />
      </div>

      {/* Other (non-text) changes — forms, scripts, SEO, etc. */}
      {otherChanges.length > 0 && (
        <ul className="px-4 py-3 space-y-1.5 border-b border-slate-800">
          {otherChanges.map((c, i) => (
            <li key={i} className="text-sm text-slate-300 flex gap-2 leading-relaxed">
              <span className="text-slate-600 shrink-0 mt-0.5">·</span>
              <span className="break-words">{c}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Structured text diffs */}
      {textChanges.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Text changes
              <span className="ml-2 text-slate-600 font-mono normal-case tracking-normal">
                {textChanges.length} item{textChanges.length !== 1 ? 's' : ''}
              </span>
            </p>
            {textChanges.length > PREVIEW_TEXT_DIFFS && (
              <button
                onClick={() => setShowAllText((v) => !v)}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {showAllText ? 'Show less' : `Show all ${textChanges.length}`}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {visibleTextChanges.map((tc, i) => (
              <TextDiffBlock key={i} change={tc} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
