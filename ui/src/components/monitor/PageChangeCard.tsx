import type { PageChange } from '@/types';
import { SeverityBadge } from './SeverityBadge';

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

export function PageChangeCard({ change }: { change: PageChange }) {
  return (
    <div className={`rounded-xl border ${BORDER[change.severity]} bg-slate-900 overflow-hidden animate-slide-in`}>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium text-slate-100 truncate">{shortPath(change.url)}</p>
          <p className="font-mono text-xs text-slate-500 truncate mt-0.5">{change.url}</p>
        </div>
        <SeverityBadge severity={change.severity} />
      </div>

      <ul className="px-4 py-3 space-y-1.5">
        {change.changes.map((c, i) => (
          <li key={i} className="text-sm text-slate-300 flex gap-2 leading-relaxed">
            <span className="text-slate-600 shrink-0 mt-0.5">·</span>
            <span className="break-words">{c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
