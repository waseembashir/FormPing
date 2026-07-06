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
      <Link href="/projects" className="text-xs text-slate-500 hover:text-indigo-300 transition-colors">
        ← Back to Projects
      </Link>
      <div className="mt-4">
        {state === 'loading' && <p className="text-sm text-slate-500 text-center py-20">Loading status…</p>}
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
