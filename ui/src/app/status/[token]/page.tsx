'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ClientStatus } from '@/lib/status/types';
import { StatusView } from '@/components/status/StatusView';

/** PUBLIC per-client status page (auth-exempt via middleware). Fetches by
 *  share token; renders the shared StatusView. */
export default function PublicStatusPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<ClientStatus | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/status/${token}`, { cache: 'no-store' });
      if (!res.ok) {
        setState('notfound');
        return;
      }
      setData((await res.json()) as ClientStatus);
      setState('ready');
    } catch {
      setState('notfound');
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 sm:py-14">
      {state === 'loading' && <p className="text-sm text-slate-500 text-center py-20">Loading status…</p>}
      {state === 'notfound' && (
        <div className="text-center py-20">
          <h1 className="text-lg font-semibold text-slate-200">Status page not found</h1>
          <p className="text-sm text-slate-500 mt-2">This status link is invalid or has been turned off.</p>
        </div>
      )}
      {state === 'ready' && data && <StatusView data={data} />}
    </main>
  );
}
