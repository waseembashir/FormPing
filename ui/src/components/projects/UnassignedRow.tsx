'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProjectRollup, UrlHealth } from '@/lib/projects/types';
import { UrlHealthDetail } from './uiKit';
import { AssignToProject } from './AssignToProject';
import { DismissUrlButton } from './DismissUrlButton';

/**
 * The "Unassigned" bucket — monitored/tested URLs not tied to any client. Kept
 * visually DISTINCT from the client cards (dashed, muted, its own header) so it
 * reads as a catch-all, not a client. Each URL is a card with Assign / Delete.
 * The guarantee that makes Projects a complete inventory — no monitor invisible.
 */
export function UnassignedRow({
  urls,
  onChanged,
}: {
  urls: string[];
  rollup: ProjectRollup; // accepted for API symmetry; the bucket shows per-URL detail instead
  onChanged: () => void;
}) {
  const [health, setHealth] = useState<UrlHealth[] | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/projects/unassigned', { cache: 'no-store' }).then((x) => x.json());
      setHealth(Array.isArray(res?.health) ? res.health : []);
    } catch {
      setHealth([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // After assign/dismiss: refresh this bucket AND the parent list.
  const handleChanged = () => {
    void loadDetail();
    onChanged();
  };

  return (
    <section className="fp-rise mt-7 rounded-xl border border-dashed border-slate-700/70 bg-slate-900/25 p-4">
      <div className="mb-3.5 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-600 text-base text-slate-500">
          ⋯
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Unassigned</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {urls.length} monitored URL{urls.length === 1 ? '' : 's'} not tied to a client — assign so its alerts route correctly.
          </p>
        </div>
      </div>

      {loading && <div className="fp-skeleton h-20 rounded-lg" />}

      {!loading && health && health.length > 0 && (
        <div className="space-y-2.5">
          {health.map((h) => (
            <div key={h.url} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <UrlHealthDetail h={h} />
              <div className="mt-2.5 flex justify-end gap-2">
                <DismissUrlButton url={h.url} onDone={handleChanged} />
                <AssignToProject url={h.url} onAssigned={handleChanged} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && health && health.length === 0 && (
        <p className="text-xs text-slate-500">Nothing unassigned — every monitored URL is in a client. 🎉</p>
      )}
    </section>
  );
}
