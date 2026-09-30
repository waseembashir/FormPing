/**
 * FR-107 — a root test may import web-app code, but not the web app's dependencies.
 *
 * The root suite can reach into `ui/src` through the `@` alias, and often
 * should: the alert vocabulary, the verdict table and the run-outcome logic
 * live there and are pure logic worth testing.
 *
 * But the engine's CI job installs the ROOT package only. If a test's import
 * graph reaches a package that exists solely in `ui/node_modules`, that job
 * cannot resolve it:
 *
 *     Failed to load url @supabase/supabase-js … Does the file exist?
 *
 * Locally it passes, because both installs are present and Node resolution
 * walks up into `ui/node_modules`. So the failure is invisible on a developer's
 * machine, appears only after a push, and reads like a broken install rather
 * than a dependency boundary. It cost a CI round trip on FR-103.
 *
 * Two decisions keep this guard from going stale, which was the condition for
 * building it at all:
 *
 *   - The alias is read from `vitest.config.ts`, so the guard and the runner
 *     agree by construction rather than by a copied constant.
 *   - "ui-only" is DERIVED by comparing the two package manifests, not listed.
 *     A guard naming `@supabase/supabase-js` would be wrong the first time
 *     someone imports a different web-app dependency.
 *
 * A test that deliberately stubs the boundary with `vi.mock` is legitimate:
 * the real module never loads, so the dependency is never resolved. Those
 * edges are not traversed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Packages installed for the web app but NOT for the engine. */
function uiOnlyPackages(): Set<string> {
  const deps = (p: string) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  };
  const root = deps('package.json');
  return new Set([...deps('ui/package.json')].filter((d) => !root.has(d)));
}

/** The `@` alias, read from the config the runner itself uses. */
function aliasTarget(): string {
  const config = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
  const match = /'@':\s*fileURLToPath\(new URL\('([^']+)'/.exec(config);
  if (!match) throw new Error('could not read the @ alias from vitest.config.ts');
  return resolve(ROOT, match[1]!);
}

const UI_SRC = aliasTarget();

/**
 * Every specifier a file imports AT RUNTIME.
 *
 * `import type` and `export type` are erased before anything is resolved, so a
 * type-only reference across the boundary is free and must not be reported.
 * Missing this made the guard's first run accuse three innocent tests.
 */
function importsOf(source: string): string[] {
  const runtime = source.replace(/^\s*(?:import|export)\s+type\s[^;]*;?$/gm, '');
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of runtime.matchAll(re)) out.push(m[1]!);
  }
  return out;
}

/**
 * The files a test stubs with `vi.mock`, resolved to paths.
 *
 * `vi.mock` is hoisted and applies to the ENTIRE module graph of that test, not
 * just to the test's own imports — so a stub declared in the test also covers
 * the edge two modules deeper, which is exactly how the database client is
 * kept out of reach today.
 *
 * Resolved to file paths rather than compared as strings, because the test
 * writes `@/lib/supabase` while the module that imports it may write
 * `./supabase`. Those are the same file and must be treated as one.
 */
function stubbedFiles(testFile: string, source: string): Set<string> {
  const out = new Set<string>();
  for (const m of source.matchAll(/\bvi\.mock\(\s*['"]([^'"]+)['"]/g)) {
    const resolved = resolveLocal(m[1]!, testFile);
    if (resolved) out.add(resolved);
    else out.add(m[1]!); // a bare package stubbed directly
  }
  return out;
}

/** Resolve a relative or aliased specifier to a file on disk, or null. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(UI_SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  // Engine sources import with a `.js` extension under ESM; the file is `.ts`.
  const stripped = base.replace(/\.js$/, '');
  const candidates = [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    join(stripped, 'index.ts'),
    join(stripped, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Walk a test's imports; return the first chain that reaches a ui-only package. */
function boundaryBreach(testFile: string, uiOnly: Set<string>): string | null {
  const seen = new Set<string>();
  const stubbed = stubbedFiles(testFile, readFileSync(testFile, 'utf8'));
  const queue: { file: string; chain: string[] }[] = [{ file: testFile, chain: [testFile] }];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');

    for (const specifier of importsOf(source)) {
      if (stubbed.has(specifier)) continue; // a bare package stubbed directly

      const local = resolveLocal(specifier, file);
      if (local) {
        if (stubbed.has(local)) continue; // replaced by a stub; never loaded
        queue.push({ file: local, chain: [...chain, local] });
        continue;
      }
      // A bare specifier: is it one the engine's install does not provide?
      const pkg = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]!;
      if (uiOnly.has(pkg)) {
        const shown = [...chain.map((f) => f.replace(ROOT, '')), pkg];
        return shown.join('\n      → ');
      }
    }
  }
  return null;
}

function rootTests(dir = join(ROOT, 'tests')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return rootTests(full);
    return e.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('the engine test suite stays inside the engine install', () => {
  const uiOnly = uiOnlyPackages();
  const tests = rootTests();

  it('finds the web app dependencies to compare against', () => {
    // Guards the derivation itself: if the manifests move or the comparison
    // breaks, this fails loudly rather than passing an empty set and
    // declaring every test safe.
    expect(uiOnly.size).toBeGreaterThan(3);
    expect(tests.length).toBeGreaterThan(20);
  });

  it.each(rootTests().map((f) => [f.replace(ROOT, ''), f]))(
    '%s resolves with only the root package installed',
    (_name, file) => {
      const breach = boundaryBreach(file, uiOnly);
      expect(
        breach,
        breach
          ? `This test reaches a package the engine CI job does not install.\n` +
            `It passes locally only because ui/node_modules happens to be present.\n\n` +
            `      ${breach}\n\n` +
            `Either import the pure module directly, or stub the boundary with vi.mock().`
          : undefined,
      ).toBeNull();
    },
  );
});
