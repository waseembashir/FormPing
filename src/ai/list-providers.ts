/**
 * Tiny CLI helper — used by the UI's /api/ai/providers endpoint to query
 * which AI providers are currently configured and available.
 *
 * Run it with `tsx src/ai/list-providers.ts` and it prints a JSON array
 * of AiProviderInfo to stdout.
 */
import 'dotenv/config';
import { listProviders } from './providers.js';

async function main() {
  const providers = await listProviders();
  process.stdout.write(JSON.stringify(providers));
}

main().catch((err) => {
  process.stderr.write(`list-providers failed: ${err}\n`);
  process.exit(1);
});
