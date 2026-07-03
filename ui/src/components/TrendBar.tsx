/**
 * Tiny status sparkline — one bar per recent check/run, oldest → newest
 * (left → right). Shared by the Site Watch + Form Watch cards to show at-a-glance
 * history without expanding. Pure presentational; the caller maps its history to
 * tones.
 */

export type TrendTone = 'emerald' | 'amber' | 'red' | 'slate';

const BAR: Record<TrendTone, string> = {
  emerald: 'bg-emerald-400/80',
  amber: 'bg-amber-400/80',
  red: 'bg-red-400/80',
  slate: 'bg-slate-600',
};

export function TrendBar({ tones, title }: { tones: TrendTone[]; title?: string }) {
  if (tones.length === 0) return null;
  return (
    <span className="inline-flex items-end gap-0.5 h-3.5 align-middle" title={title} aria-hidden>
      {tones.map((t, i) => (
        <span key={i} className={`w-1 rounded-sm ${BAR[t]} h-full`} />
      ))}
    </span>
  );
}
