/**
 * Returns the list of AI providers and whether each one is configured/available.
 * The UI dropdown uses this to populate the choices and show setup hints.
 *
 * Implementation note: we delegate to the formping CLI (which has dotenv loaded
 * and ships the provider adapters). This keeps a single source of truth for
 * "what's configured" — both the CLI and the UI agree.
 */

import { spawn } from 'child_process';
import path from 'path';

export const runtime = 'nodejs';
// short cache so the dropdown doesn't refetch on every keystroke, but updates
// quickly when the user adds a new env var and reloads
export const revalidate = 5;

interface ProviderInfo {
  id: string;
  label: string;
  modelLabel: string;
  configured: boolean;
  available: boolean;
  setupHint: string;
}

async function listProvidersViaCli(): Promise<ProviderInfo[]> {
  const formpingRoot = path.join(process.cwd(), '..');
  const tsxBin = path.join(formpingRoot, 'node_modules', '.bin', 'tsx');
  const helperPath = path.join(formpingRoot, 'src', 'ai', 'list-providers.ts');

  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [helperPath], {
      cwd: formpingRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`provider listing failed (${code}): ${err.slice(0, 300)}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()) as ProviderInfo[]);
      } catch (e) {
        reject(new Error(`provider listing output not JSON: ${out.slice(0, 200)}`));
      }
    });
    child.on('error', (e) => reject(e));
  });
}

export async function GET() {
  try {
    const providers = await listProvidersViaCli();
    const configured = providers.filter((p) => p.configured && p.available);
    const fallback = configured[0]?.id ?? null;
    return Response.json({ providers, fallback });
  } catch (e) {
    return Response.json(
      { error: 'Failed to list providers', detail: String(e) },
      { status: 500 },
    );
  }
}
