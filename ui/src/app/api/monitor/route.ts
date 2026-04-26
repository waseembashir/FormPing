import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 600; // up to 10 min for watch cycles

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    url: string;
    monitorMode: 'snapshot' | 'compare' | 'watch';
    maxPages: number;
    takeScreenshots: boolean;
    aiSummary: boolean;
    watchIntervalMs: number;
  };

  const { url, monitorMode, maxPages, takeScreenshots, aiSummary, watchIntervalMs } = body;

  if (!url || !monitorMode) {
    return new Response(JSON.stringify({ error: 'url and monitorMode are required' }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
      if (aiSummary) args.push('--ai-summary');
      if (monitorMode === 'watch') args.push('--watch-interval', String(watchIntervalMs));

      const child = spawn(tsxBin, args, {
        cwd: formpingRoot,
        env: { ...process.env, DEBUG: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
              send({ type: 'report', report: parsed });
            }
          } catch {
            // ignore non-JSON output
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
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
            else if ('details' in parsed) send({ type: 'report', report: parsed });
          } catch { /* ignore */ }
        }
        send({ type: 'done', exitCode: code });
        controller.close();
      });

      child.on('error', (err) => {
        send({ type: 'error', message: err.message });
        controller.close();
      });

      // Allow cancellation: kill the child if the client disconnects
      request.signal.addEventListener('abort', () => {
        if (!child.killed) child.kill('SIGINT');
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
