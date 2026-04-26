function color(v: number) {
  if (v >= 0.75) return 'bg-emerald-500';
  if (v >= 0.5) return 'bg-amber-500';
  return 'bg-red-500';
}

export function ConfidenceBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-slate-400 w-28 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color(value)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-slate-300 w-8 text-right shrink-0">{pct}%</span>
    </div>
  );
}
