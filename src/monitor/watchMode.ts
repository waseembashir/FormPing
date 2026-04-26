import type { Browser } from 'playwright';
import type { AppConfig } from '../types.js';
import type { MonitorOptions, ChangeReport } from './types.js';
import { runCompare } from './compareSnapshots.js';
import { logger } from '../utils/logger.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Watch mode: snapshot + compare on a fixed interval until SIGINT.
 * Each cycle prints a JSON report; the caller decides what to do with it.
 */
export async function watchMode(
  rootUrl: string,
  browser: Browser,
  config: AppConfig,
  options: MonitorOptions,
  onReport?: (report: ChangeReport) => void,
): Promise<void> {
  let stopRequested = false;
  const onSigInt = () => {
    if (stopRequested) return;
    stopRequested = true;
    logger.info('SIGINT received — finishing current cycle then stopping');
  };
  process.on('SIGINT', onSigInt);

  logger.info(
    `Watch started for ${rootUrl} (interval: ${Math.round(options.watchIntervalMs / 1000)}s)`,
  );

  try {
    while (!stopRequested) {
      const cycleStart = Date.now();
      try {
        const report = await runCompare(rootUrl, browser, config, options);
        onReport?.(report);

        if (report.changesFound === 0 && report.previousSnapshot !== null) {
          logger.info(`Watch: no changes detected (${report.pagesScanned} pages)`);
        } else if (report.changesFound > 0) {
          logger.warn(
            `Watch: ${report.changesFound} change(s) on ${report.pagesChanged} page(s) of ${report.site}`,
          );
        }
      } catch (err) {
        logger.error(`Watch cycle failed: ${err}`);
      }

      if (stopRequested) break;

      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(0, options.watchIntervalMs - elapsed);
      logger.info(`Watch: sleeping ${Math.round(wait / 1000)}s until next cycle`);

      // Sleep in 1-second chunks so SIGINT can interrupt promptly
      const chunkMs = 1000;
      const chunks = Math.ceil(wait / chunkMs);
      for (let i = 0; i < chunks; i++) {
        if (stopRequested) break;
        await sleep(Math.min(chunkMs, wait - i * chunkMs));
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigInt);
  }

  logger.info('Watch stopped');
}
