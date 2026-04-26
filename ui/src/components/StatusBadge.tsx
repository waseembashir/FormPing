import type { FinalStatus } from '@/types';

const STYLES: Record<FinalStatus, string> = {
  pass: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
  fail: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30',
  warn: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
  error: 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30',
};

const DOT: Record<FinalStatus, string> = {
  pass: 'bg-emerald-400',
  fail: 'bg-red-400',
  warn: 'bg-amber-400',
  error: 'bg-slate-400',
};

export function StatusBadge({ status }: { status: FinalStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide uppercase ${STYLES[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[status]}`} />
      {status}
    </span>
  );
}

export function ReasonCodeBadge({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-slate-800 text-slate-300 ring-1 ring-slate-700">
      {code}
    </span>
  );
}
