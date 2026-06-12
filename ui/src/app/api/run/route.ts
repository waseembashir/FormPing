import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min cap for batch runs

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    urls: string[];
    mode: string;
    timeout: number;
    email: string;
    headed: boolean;
    ai: boolean;
    aiProvider?: string;
    concurrency: number;
    residentialFallback?: boolean;
  };

  const { urls, mode, timeout, email, headed, ai, aiProvider, concurrency, residentialFallback } = body;

  if (!urls || urls.length === 0) {
    return new Response(JSON.stringify({ error: 'No URLs provided' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  let tempFile: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Guard against late events: the CLI child can emit a stderr/stdout line
      // AFTER the stream has been closed (client disconnected, or close() already
      // ran). Enqueuing on a closed controller throws ERR_INVALID_STATE as an
      // uncaught exception — which can crash the server. Swallow it: a late line
      // for a stream nobody is reading is safe to drop.
      let streamClosed = false;
      function send(event: Record<string, unknown>) {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          streamClosed = true;
        }
      }

      // Resolve paths relative to this file's location in the built app.
      // __dirname here is formping/ui/.next/server/app/api/run/ at runtime,
      // so we walk up to formping/ and then into src/cli.ts.
      // For `next dev`, process.cwd() is formping/ui/.
      const uiRoot = process.cwd(); // formping/ui/
      const formpingRoot = path.join(uiRoot, '..'); // formping/
      const cliPath = path.join(formpingRoot, 'src', 'cli.ts');
      // Launch tsx's JS entry via node (process.execPath). The `.bin/tsx` shim is
      // a shell script Windows cannot exec (it needs tsx.cmd) — node + cli.mjs runs
      // identically on Windows (local dev) and Linux (Railway).
      const tsxCli = path.join(formpingRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

      // Build CLI args
      const args: string[] = [cliPath, '--stream', '--mode', mode];
      if (timeout) args.push('--timeout', String(timeout));
      if (email) args.push('--email', email);
      if (headed) args.push('--headed');
      // Prefer explicit --ai-provider; fall back to legacy --ai (= 'auto') for backward compat
      if (aiProvider && aiProvider !== 'off') args.push('--ai-provider', aiProvider);
      else if (ai) args.push('--ai');
      if (concurrency > 1) args.push('--concurrency', String(concurrency));
      if (residentialFallback) args.push('--residential-fallback');

      if (urls.length === 1) {
        args.push('--url', urls[0]!);
      } else {
        // Write URLs to a temp file
        tempFile = path.join(tmpdir(), `formping-${Date.now()}.txt`);
        writeFileSync(tempFile, urls.join('\n'), 'utf-8');
        args.push('--file', tempFile);
      }

      // Emit initial progress event so the UI shows something immediately
      send({ type: 'progress', url: urls[0]!, index: 0, total: urls.length });

      const child = spawn(process.execPath, [tsxCli, ...args], {
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
            const type = parsed['__type'];

            if (type === 'result') {
              send({ type: 'result', result: parsed['result'] });
            } else if (type === 'progress') {
              send({
                type: 'progress',
                url: parsed['url'],
                index: parsed['index'],
                total: parsed['total'],
              });
            } else if (type === 'done') {
              // handled in close
            }
          } catch {
            // non-JSON stdout line — ignore
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        // Forward to the parent process's stderr so Railway / Docker /
        // any log collector captures the CLI's diagnostic output.
        process.stderr.write(chunk);

        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          // Only forward INFO/WARN lines (not DEBUG noise)
          if (/INFO|WARN|ERROR/.test(line)) {
            send({ type: 'log', message: line.replace(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s+\w+\s+/, '').trim() });
          }
        }
      });

      child.on('close', (code) => {
        // Flush any remaining stdout buffer
        if (stdoutBuf.trim()) {
          try {
            const parsed = JSON.parse(stdoutBuf.trim()) as Record<string, unknown>;
            if (parsed['__type'] === 'result') {
              send({ type: 'result', result: parsed['result'] });
            }
          } catch { /* ignore */ }
        }

        if (tempFile) {
          try { unlinkSync(tempFile); } catch { /* ignore */ }
        }

        send({ type: 'done', exitCode: code });
        controller.close();
      });

      child.on('error', (err) => {
        if (tempFile) {
          try { unlinkSync(tempFile); } catch { /* ignore */ }
        }
        send({ type: 'error', message: err.message });
        controller.close();
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
