import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

export async function readLines(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, 'utf-8');
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export async function writeJson(filePath: string, data: unknown, pretty = false): Promise<void> {
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await writeFile(filePath, json, 'utf-8');
}

export function fileExists(p: string): boolean {
  return existsSync(p);
}
