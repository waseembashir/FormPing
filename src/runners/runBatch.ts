import type { AppConfig, SiteResult } from '../types.js';
import { launchBrowser, closeBrowser } from '../browser/playwrightClient.js';
import { runSingleSite } from './runSingleSite.js';
import { logger } from '../utils/logger.js';

/** Run URLs in controlled-concurrency batches sharing one browser instance */
export async function runBatch(
  urls: string[],
  config: AppConfig,
  onResult?: (result: SiteResult, index: number, total: number) => void,
): Promise<SiteResult[]> {
  const results: SiteResult[] = [];
  const browser = await launchBrowser(config);
  const concurrency = Math.max(1, config.batchConcurrency);

  logger.info(`Batch: ${urls.length} URL(s), concurrency=${concurrency}`);

  try {
    for (let i = 0; i < urls.length; i += concurrency) {
      const chunk = urls.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((url) => runSingleSite(url, browser, config)),
      );
      for (let j = 0; j < chunkResults.length; j++) {
        const result = chunkResults[j]!;
        results.push(result);
        onResult?.(result, i + j, urls.length);
        logger.info(
          `  [${i + j + 1}/${urls.length}] ${result.normalizedUrl} → ${result.finalStatus} (${result.reasonCode})`,
        );
      }
    }
  } finally {
    await closeBrowser();
  }

  return results;
}
