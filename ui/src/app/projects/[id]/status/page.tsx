'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { ClientStatus } from '@/lib/status/types';
import { StatusView } from '@/components/status/StatusView';

/** INTERNAL, auth-gated status view for a project (by id — no share token).
 *  Any signed-in team member can open it; renders the same StatusView the
 *  public page uses. Sits under /projects so it stays behind the login gate. */
export default function InternalStatusPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<ClientStatus | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/status`, { cache: 'no-store' });
      if (!res.ok) {
        setState('notfound');
        return;
      }
      setData((await res.json()) as ClientStatus);
      setState('ready');
    } catch {
      setState('notfound');
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <Link href={`/projects/${id}`} className="text-xs text-slate-500 hover:text-indigo-300 transition-colors">
        ← Back to {data?.name ?? 'project'}
      </Link>
      <div className="mt-4">
        {state === 'loading' && (
          <div className="space-y-4">
            <div className="fp-skeleton h-7 w-52 rounded" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="fp-skeleton h-20 rounded-lg" /><div className="fp-skeleton h-20 rounded-lg" /><div className="fp-skeleton h-20 rounded-lg" /></div>
            <div className="fp-skeleton h-40 rounded-lg" />
            <div className="fp-skeleton h-40 rounded-lg" />
          </div>
        )}
        {state === 'notfound' && (
          <div className="text-center py-20">
            <h1 className="text-lg font-semibold text-slate-200">Project not found</h1>
            <p className="text-sm text-slate-500 mt-2">It may have been deleted.</p>
          </div>
        )}
        {state === 'ready' && data && <StatusView data={data} internal />}
      </div>
    </main>
  );
}
