#!/usr/bin/env node
import 'dotenv/config'; // load .env so AI provider keys are picked up
import { Command, InvalidArgumentError } from 'commander';
import { DEFAULT_CONFIG, DEFAULT_MONITOR_OPTIONS } from './config.js';
import type { AppConfig, SiteResult, SubmitMode } from './types.js';
import type { MonitorMode, MonitorOptions } from './monitor/types.js';
import type { AiProviderSelection } from './ai/providers.js';
import { runSingleSite } from './runners/runSingleSite.js';
import { runBatch } from './runners/runBatch.js';
import { launchBrowser, closeBrowser } from './browser/playwrightClient.js';
import { readLines, writeJson, fileExists } from './utils/fs.js';
import { logger } from './utils/logger.js';
import { snapshotSite } from './monitor/snapshotSite.js';
import { runCompare } from './monitor/compareSnapshots.js';
import { watchMode } from './monitor/watchMode.js';

const VALID_AI_PROVIDERS: AiProviderSelection[] = ['off', 'auto', 'anthropic', 'gemini', 'groq', 'ollama'];
function parseAiProvider(v: string): AiProviderSelection {
  if (!VALID_AI_PROVIDERS.includes(v as AiProviderSelection)) {
    throw new InvalidArgumentError(`--ai-provider must be one of: ${VALID_AI_PROVIDERS.join(', ')}`);
  }
  return v as AiProviderSelection;
}

const program = new Command();

program
  .name('formping')
  .description('QA automation tool for authorized contact form testing')
  .version('1.0.0');

program
  .option('--url <url>', 'Single URL to test')
  .option('--file <path>', 'Path to a .txt or .csv file with one URL per line')
  .option('--mode <mode>', 'Submission mode: live | safe | detect-only (default: safe)', 'safe')
  .option('--headed', 'Run with visible browser (default: headless)', false)
  .option('--output <path>', 'Write JSON results to this file')
  .option('--json-pretty', 'Pretty-print JSON output', false)
  .option('--stream', 'Output each result as NDJSON immediately (used by the web UI)', false)
  .option('--timeout <ms>', 'Per-action timeout in milliseconds', (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1000) throw new InvalidArgumentError('Timeout must be >= 1000 ms');
    return n;
  })
  .option('--concurrency <n>', 'Batch concurrency (default: 2)', (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1) throw new InvalidArgumentError('Concurrency must be >= 1');
    return n;
  })
  .option('--ai', 'Shortcut for --ai-provider auto (form-tester AI fallback)', false)
  .option('--ai-provider <id>', 'AI provider: off | auto | anthropic | gemini | groq | ollama', parseAiProvider)
  .option('--email <email>', 'Test email address to use in forms')
  // ─── Monitor mode options ────────────────────────────────────────────────
  .option('--monitor <mode>', 'Run change monitor: snapshot | compare | watch')
  .option('--pages <n>', 'Max pages to crawl in monitor mode', (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1) throw new InvalidArgumentError('--pages must be >= 1');
    return n;
  })
  .option('--screenshots', 'Capture screenshots during snapshot (uses Playwright)', false)
  .option('--ai-summary', 'Shortcut for --ai-provider auto on monitor summary', false)
  .option('--watch-interval <ms>', 'Interval between watch-mode cycles (ms)', (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 10000) throw new InvalidArgumentError('--watch-interval must be >= 10000');
    return n;
  })
  .action(async (opts: {
    url?: string;
    file?: string;
    mode: string;
    headed: boolean;
    output?: string;
    jsonPretty: boolean;
    stream: boolean;
    timeout?: number;
    concurrency?: number;
    ai: boolean;
    aiProvider?: AiProviderSelection;
    email?: string;
    monitor?: string;
    pages?: number;
    screenshots: boolean;
    aiSummary: boolean;
    watchInterval?: number;
  }) => {
    if (!opts.url && !opts.file) {
      logger.error('Provide --url or --file');
      process.exit(1);
    }

    const validModes: SubmitMode[] = ['live', 'safe', 'detect-only'];
    if (!validModes.includes(opts.mode as SubmitMode)) {
      logger.error(`Invalid mode "${opts.mode}". Must be one of: ${validModes.join(', ')}`);
      process.exit(1);
    }

    // --ai-provider wins; --ai is a shortcut for "auto"; default 'off'
    const aiProvider: AiProviderSelection =
      opts.aiProvider ?? (opts.ai ? 'auto' : 'off');

    const config: AppConfig = {
      ...DEFAULT_CONFIG,
      mode: opts.mode as SubmitMode,
      headless: !opts.headed,
      aiProvider,
      prettyJson: opts.jsonPretty,
      outputFile: opts.output,
      ...(opts.timeout ? { timeout: opts.timeout, navigationTimeout: opts.timeout * 1.5 } : {}),
      ...(opts.concurrency ? { batchConcurrency: opts.concurrency } : {}),
      testData: {
        ...DEFAULT_CONFIG.testData,
        ...(opts.email ? { email: opts.email } : {}),
      },
    };

    // ── Monitor mode short-circuit ─────────────────────────────────────────
    if (opts.monitor) {
      if (!opts.url) {
        logger.error('Monitor mode requires --url');
        process.exit(1);
      }
      const validMonitorModes: MonitorMode[] = ['snapshot', 'compare', 'watch'];
      if (!validMonitorModes.includes(opts.monitor as MonitorMode)) {
        logger.error(`Invalid --monitor value. Must be one of: ${validMonitorModes.join(', ')}`);
        process.exit(1);
      }
      // For monitor mode, --ai-provider applies to the summary call.
      // --ai-summary is a backward-compat shortcut for "auto".
      const monitorAiProvider: AiProviderSelection =
        opts.aiProvider ?? (opts.aiSummary ? 'auto' : 'off');

      const monitorOptions: MonitorOptions = {
        ...DEFAULT_MONITOR_OPTIONS,
        ...(opts.pages ? { maxPages: opts.pages } : {}),
        takeScreenshots: opts.screenshots,
        aiProvider: monitorAiProvider,
        ...(opts.watchInterval ? { watchIntervalMs: opts.watchInterval } : {}),
        ...(opts.output ? { outputFile: opts.output } : {}),
      };

      logger.info(`FormPing Monitor — mode=${opts.monitor} site=${opts.url}`);
      const browser = await launchBrowser(config);
      try {
        if (opts.monitor === 'snapshot') {
          const { snapshot, path } = await snapshotSite(opts.url, browser, config, monitorOptions);
          const out = { snapshotPath: path, site: snapshot.site, pagesScanned: snapshot.pagesScanned };
          process.stdout.write(JSON.stringify(out, null, opts.jsonPretty ? 2 : 0) + '\n');
        } else if (opts.monitor === 'compare') {
          const report = await runCompare(opts.url, browser, config, monitorOptions);
          const json = opts.jsonPretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
          if (monitorOptions.outputFile) {
            await writeJson(monitorOptions.outputFile, report, opts.jsonPretty);
            logger.info(`Report written to ${monitorOptions.outputFile}`);
          }
          process.stdout.write(json + '\n');
          logger.info(
            `Done. ${report.changesFound} change(s) on ${report.pagesChanged} page(s). ${report.summary}`,
          );
          process.exit(report.changesFound > 0 ? 0 : 0);
        } else if (opts.monitor === 'watch') {
          await watchMode(opts.url, browser, config, monitorOptions, (report) => {
            process.stdout.write(
              JSON.stringify(report, null, opts.jsonPretty ? 2 : 0) + '\n',
            );
          });
        }
      } finally {
        await closeBrowser();
      }
      return;
    }
    // ── End monitor mode ───────────────────────────────────────────────────

    logger.info(`FormPing v1.0.0 — mode=${config.mode} headless=${config.headless} ai=${config.aiProvider}`);

    if (config.mode === 'live') {
      logger.warn('⚠  LIVE MODE: Forms will actually be submitted. Use only on authorized sites.');
    }

    // Stream mode emits a progress marker before each URL so the UI can show progress
    function emitProgress(url: string, index: number, total: number) {
      if (opts.stream) {
        process.stdout.write(
          JSON.stringify({ __type: 'progress', url, index, total }) + '\n',
        );
      }
    }

    function emitResult(result: SiteResult) {
      if (opts.stream) {
        process.stdout.write(JSON.stringify({ __type: 'result', result }) + '\n');
      }
    }

    let results: SiteResult[];

    if (opts.url) {
      const total = 1;
      emitProgress(opts.url, 0, total);
      const browser = await launchBrowser(config);
      try {
        const result = await runSingleSite(opts.url, browser, config);
        emitResult(result);
        results = [result];
      } finally {
        await closeBrowser();
      }
    } else {
      const filePath = opts.file!;
      if (!fileExists(filePath)) {
        logger.error(`File not found: ${filePath}`);
        process.exit(1);
      }
      const urls = await readLines(filePath);
      if (urls.length === 0) {
        logger.error('No URLs found in file');
        process.exit(1);
      }
      logger.info(`Loaded ${urls.length} URL(s) from ${filePath}`);

      let completedCount = 0;
      results = await runBatch(urls, config, (result, _index) => {
        emitResult(result);
        completedCount++;
        // Emit progress for next URL
        if (completedCount < urls.length) {
          emitProgress(urls[completedCount]!, completedCount, urls.length);
        }
      });

      // Emit first progress before batch starts (runBatch fires immediately)
      // Already emitted inside runBatch via onResult — but we need the first one
      // We handle this by pre-emitting before runBatch
    }

    // In stream mode, signal completion
    if (opts.stream) {
      process.stdout.write(JSON.stringify({ __type: 'done' }) + '\n');
    }

    // Normal (non-stream) output
    if (!opts.stream) {
      const jsonOutput = config.prettyJson
        ? JSON.stringify(results, null, 2)
        : JSON.stringify(results);

      if (config.outputFile) {
        await writeJson(config.outputFile, results, config.prettyJson);
        logger.info(`Results written to ${config.outputFile}`);
      }

      process.stdout.write(jsonOutput + '\n');
    } else if (config.outputFile) {
      await writeJson(config.outputFile, results, config.prettyJson);
      logger.info(`Results written to ${config.outputFile}`);
    }

    const pass = results.filter((r) => r.finalStatus === 'pass').length;
    const fail = results.filter((r) => r.finalStatus === 'fail').length;
    const warn = results.filter((r) => r.finalStatus === 'warn').length;
    const error = results.filter((r) => r.finalStatus === 'error').length;
    logger.info(`Done. pass=${pass} fail=${fail} warn=${warn} error=${error}`);

    const hasFailures = fail > 0 || error > 0;
    process.exit(hasFailures ? 1 : 0);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  logger.error(`Fatal: ${err}`);
  process.exit(1);
});
