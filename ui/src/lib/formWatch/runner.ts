/**
 * Runs a single form test by spawning the EXISTING form-test CLI unchanged
 * (`tsx src/cli.ts --stream --mode <mode> --url <url>`), exactly how
 * /api/run already does. Returns the parsed SiteResult, or null on failure.
 *
 * Additive by design: we shell out to the CLI rather than importing from the
 * CLI package, so there is zero compile-time coupling to existing code.
 */

import { spawn } from 'child_process';
import path from 'path';

/** The subset of the CLI's SiteResult we consume. Parsed defensively. */
export interface RawSiteResult {
  finalStatus?: string;
  reasonCode?: string;
  submissionResult?: string;
  durationMs?: number;
  resolvedContactPage?: string | null;
  formFound?: boolean;
  formConfidence?: number;
  formIdentifier?: { id?: string | null; action?: string | null; method?: string | null } | null;
  captchaDetected?: boolean;
  notes?: string[];
  errors?: string[];
  [k: string]: unknown;
}

/** Hard cap on a single run so a hung browser can't wedge the scheduler. */
const RUN_TIMEOUT_MS = 4 * 60 * 1000;

export function runFormTest(
  url: string,
  mode: string,
  landingPage = false,
): Promise<RawSiteResult | null> {
  return new Promise((resolve) => {
    const uiRoot = process.cwd();
    const formpingRoot = path.join(uiRoot, '..');
    const cliPath = path.join(formpingRoot, 'src', 'cli.ts');
    // Invoke tsx's JS entry with `node` directly (process.execPath) rather than
    // the `.bin/tsx` shim. The shim is a shell script that Windows can't exec
    // (it would need tsx.cmd), so this keeps local dev working on Windows while
    // behaving identically on Railway's Linux. Args are passed as an array, so
    // the space in the install path ("Apexure dev") is handled safely.
    const tsxCli = path.join(formpingRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

    const args = [tsxCli, cliPath, '--stream', '--mode', mode, '--url', url];
    if (landingPage) args.push('--landing-page');
    const child = spawn(process.execPath, args, {
      cwd: formpingRoot,
      env: { ...process.env, DEBUG: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let result: RawSiteResult | null = null;
    let stdoutBuf = '';

    const tryParse = (line: string) => {
      const t = line.trim();
      if (!t) return;
      try {
        const parsed = JSON.parse(t) as Record<string, unknown>;
        if (parsed['__type'] === 'result' && parsed['result']) {
          result = parsed['result'] as RawSiteResult;
        }
      } catch {
        /* ignore non-JSON log lines */
      }
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, RUN_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) tryParse(line);
    });

    // Surface CLI logs to the server's stderr (Railway log collector picks them up).
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.on('close', () => {
      clearTimeout(timer);
      if (stdoutBuf.trim()) tryParse(stdoutBuf); // drain tail line without trailing \n
      resolve(result);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.warn(`[formWatch/runner] spawn error for ${url}: ${err.message}`);
      resolve(null);
    });
  });
}
