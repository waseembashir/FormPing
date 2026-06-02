import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { registerWatch, getWatch, siteKey } from '@/lib/watchRegistry';
import { saveReport } from '@/lib/reportStore';

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
  // The user can call /api/monitor/stop first if they want to restart with
  // a different config.
  const site = siteKey(url);
  if (monitorMode === 'watch' && getWatch(site)) {
    return new Response(
      JSON.stringify({
        error: `A watch is already active for ${site}. Stop it first to start a new one.`,
      }),
      { status: 409 },
    );
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

      const uiRoot = process.cwd();
      const formpingRoot = path.join(uiRoot, '..');
      const cliPath = path.join(formpingRoot, 'src', 'cli.ts');
      const tsxBin = path.join(formpingRoot, 'node_modules', '.bin', 'tsx');

      const args: string[] = [
        cliPath,
        '--url', url,
        '--monitor', monitorMode,
        '--pages', String(maxPages),
      ];
      if (takeScreenshots) args.push('--screenshots');
      // Prefer explicit --ai-provider; fall back to legacy --ai-summary (= 'auto')
      if (aiProvider && aiProvider !== 'off') args.push('--ai-provider', aiProvider);
      else if (aiSummary) args.push('--ai-summary');
      if (monitorMode === 'watch') args.push('--watch-interval', String(watchIntervalMs));

      const child = spawn(tsxBin, args, {
        cwd: formpingRoot,
        env: { ...process.env, DEBUG: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Register watch processes so they survive client disconnect and
      // can be stopped from any tab via /api/monitor/stop.
      if (monitorMode === 'watch') {
        registerWatch({
          site,
          url,
          startedAt: new Date(),
          watchIntervalMs,
          child,
        });
      }

      let stdoutBuf = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            // Detect what we got based on shape
            if ('snapshotPath' in parsed) {
              send({ type: 'snapshot', result: parsed });
            } else if ('details' in parsed && 'pagesScanned' in parsed) {
              // Persist the report to disk so it survives browser refresh,
              // then forward it on the SSE stream. Fire-and-forget; failures
              // are logged inside saveReport and won't break the loop.
              void saveReport(site, parsed);
              send({ type: 'report', report: parsed });
            }
          } catch {
            // ignore non-JSON output
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        // Forward to parent stderr so Railway/Docker log collectors see it
        process.stderr.write(chunk);

        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          if (/INFO|WARN|ERROR/.test(line)) {
            const cleaned = line.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s+\w+\s+/, '').trim();
            if (cleaned) send({ type: 'log', message: cleaned });
          }
        }
      });

      child.on('close', (code) => {
        if (stdoutBuf.trim()) {
          try {
            const parsed = JSON.parse(stdoutBuf.trim()) as Record<string, unknown>;
            if ('snapshotPath' in parsed) send({ type: 'snapshot', result: parsed });
            else if ('details' in parsed) {
              void saveReport(site, parsed);
              send({ type: 'report', report: parsed });
            }
          } catch { /* ignore */ }
        }
        send({ type: 'done', exitCode: code });
        close();
      });

      child.on('error', (err) => {
        send({ type: 'error', message: err.message });
        close();
      });

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
