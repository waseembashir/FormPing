import { NextRequest } from 'next/server';
import { registerWatch, getWatch, siteKey } from '@/lib/watchRegistry';
import { spawnMonitor } from '@/lib/watchSpawner';
import {
  saveActiveWatch,
  loadAliveActiveWatches,
} from '@/lib/activeWatchesStore';

export const runtime = 'nodejs';
export const maxDuration = 600; // up to 10 min for watch cycles

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    url: string;
    monitorMode: 'snapshot' | 'compare' | 'watch';
    maxPages: number;
    takeScreenshots: boolean;
    aiSummary: boolean;
    aiProvider?: string;
    watchIntervalMs: number;
  };

  const { url, monitorMode, maxPages, takeScreenshots, aiSummary, aiProvider, watchIntervalMs } = body;

  if (!url || !monitorMode) {
    return new Response(JSON.stringify({ error: 'url and monitorMode are required' }), { status: 400 });
  }

  // For watch mode: refuse if there's already an active watch for this site.
  // Two watches against the same site would spam Slack and waste resources.
  // Check both the in-memory registry AND the disk file (with PID liveness
  // check) — the worker handling this request may not be the same one that
  // spawned the existing watch.
  const site = siteKey(url);
  if (monitorMode === 'watch') {
    if (getWatch(site)) {
      return new Response(
        JSON.stringify({
          error: `A watch is already active for ${site}. Stop it first to start a new one.`,
        }),
        { status: 409 },
      );
    }
    const aliveOnDisk = await loadAliveActiveWatches();
    if (aliveOnDisk.some((w) => w.site === site)) {
      return new Response(
        JSON.stringify({
          error: `A watch is already active for ${site} (detached from this worker). Stop it first to start a new one.`,
        }),
        { status: 409 },
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: Record<string, unknown>) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Controller already closed — happens after watch detach when
          // the stream ends but the child keeps running. Safe to ignore.
        }
      }
      function close() {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      const child = spawnMonitor(
        {
          url,
          monitorMode,
          maxPages,
          takeScreenshots,
          aiSummary,
          aiProvider,
          watchIntervalMs,
        },
        {
          onSnapshot: (result) => send({ type: 'snapshot', result }),
          onReport: (report) => send({ type: 'report', report }),
          onLog: (message) => send({ type: 'log', message }),
          onError: (message) => {
            send({ type: 'error', message });
            close();
          },
          onClose: (code) => {
            send({ type: 'done', exitCode: code });
            close();
          },
        },
      );

      // Register watch processes so they survive client disconnect and can
      // be stopped from any tab via /api/monitor/stop. Also persist to disk
      // so the next server boot can auto-resume the watch after a deploy.
      if (monitorMode === 'watch') {
        registerWatch({
          site,
          url,
          startedAt: new Date(),
          watchIntervalMs,
          child,
        });
        void saveActiveWatch({
          site,
          url,
          monitorMode: 'watch',
          maxPages,
          takeScreenshots,
          aiSummary,
          ...(aiProvider !== undefined ? { aiProvider } : {}),
          watchIntervalMs,
          startedAt: new Date().toISOString(),
          // Save PID so cross-worker queries can verify the watch is alive
          // via process.kill(pid, 0). undefined if spawn failed.
          ...(typeof child.pid === 'number' ? { pid: child.pid } : {}),
        });
      }

      // Client-disconnect behavior depends on mode:
      //   - snapshot/compare: one-off, kill the child if the user navigates
      //     away (otherwise it would keep running but produce no useful
      //     output since the stream's closed).
      //   - watch: keep running in the background. The /api/monitor/stop
      //     endpoint is the only way to stop it. This is what makes
      //     "leave it running overnight" actually work.
      request.signal.addEventListener('abort', () => {
        // Close the stream either way — there's no client to send to anymore.
        close();
        if (monitorMode !== 'watch' && !child.killed) {
          child.kill('SIGINT');
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
