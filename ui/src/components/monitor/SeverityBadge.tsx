import type { ChangeSeverity } from '@/types';

const STYLES: Record<ChangeSeverity, string> = {
  high: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
  medium: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
  low: 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30',
};

const DOT: Record<ChangeSeverity, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-slate-400',
};

export function SeverityBadge({ severity }: { severity: ChangeSeverity }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide uppercase ${STYLES[severity]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[severity]}`} />
      {severity}
    </span>
  );
}
