/**
 * The README and the in-app docs are the two documents strangers read, and they
 * have different audiences that must not blur into each other:
 *
 *   README  — for developers and collaborators. What the app is, how it works,
 *             how it's built, how to run it locally, how to contribute.
 *   /docs   — for users. What the product does and how to use it. Nothing
 *             developer-facing.
 *
 * Neither may drift into a work log. No issue references, no chat tone ("you
 * asked for…"), no post-mortems of past defects, no roadmap or self-criticism.
 * A reader is told what the product does today, not what it once did wrong or
 * might do later.
 *
 * Prose discipline decays the moment nothing checks it, so it is checked here,
 * in the suite that gates every commit. These are not style preferences; they
 * are the contract for both files.
 *
 * Note the deliberate asymmetry: this scans the SOURCE of the README (all of it
 * is published) but only the RENDERED TEXT of the docs page, because its code
 * comments are read by developers and are free to reference issues and files.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const README = join(ROOT, 'README.md');
const DOCS = join(ROOT, 'ui/src/app/docs/DocsContent.tsx');

const read = (p: string) => readFileSync(p, 'utf8');

/** Strip JS/JSX comments so only what a reader sees is scanned. */
function renderedText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * The docs page is a component, so its file holds both the copy a user reads and
 * the code that renders it. The phrase checks are safe on the whole file, but the
 * identifier checks are not: `ALL_IDS` is a constant, not something anyone sees.
 *
 * So those checks run on the copy only, identified by dropping the lines that are
 * plainly code. The heuristic is deliberately blunt — a missed code line can only
 * cause a false failure, which is visible and fixable, never a silent pass.
 */
function copyOnly(source: string): string {
  return renderedText(source)
    .split('\n')
    .map((line) => (/^\s*(const|let|var|import|export|function|type|interface|return)\b|=>/.test(line) ? '' : line))
    .join('\n');
}

/** Report every offending line, not just the first — one run, one fix list. */
function offenders(text: string, pattern: RegExp): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, n }) => `line ${n}: ${line.trim().slice(0, 120)}`);
}

/**
 * Phrasings that turn a document into a work log or a confession. Each is
 * banned for a stated reason — the reason is what a future edit is checked
 * against, not the wording of the regex.
 */
const BANNED: Array<{ what: string; why: string; re: RegExp }> = [
  {
    what: 'issue references',
    why: 'a tracker id is internal bookkeeping; the document must stand alone',
    re: /\b(FR|APE)-\d+\b/,
  },
  {
    what: 'chat tone',
    why: 'the document addresses its reader, not a conversation it came from',
    re: /\byou (told|asked|said|wanted|requested|commanded)\b|\bas (you|we) discussed\b|\bper your\b|\bas requested\b/i,
  },
  {
    what: 'roadmap and unfinished work',
    why: 'documents describe what exists today; plans belong in the tracker',
    re: /\b(coming soon|not yet supported|isn'?t supported yet|doesn'?t support yet|we plan to|we'?ll add|we intend to|on the roadmap|in progress|work in progress|TODO|FIXME|for now\b|currently only|only partly|partly handled|until it'?s fixed|next up)\b/i,
  },
  {
    what: 'self-criticism and disclosed weakness',
    why: 'a limitation is either a documented boundary or it is not mentioned',
    re: /\b(weakness(es)?|shortcoming|known (issue|limitation|bug)|we'?re bad at|falls short|can'?t handle|cannot handle|doesn'?t handle|fails to handle)\b/i,
  },
  {
    what: 'post-mortem narration',
    why: 'the reader needs the current rule, not the defect that produced it',
    re: /\b(the (bug|defect|incident) that|what caused this|the case that caused|the condition that caused|post-?mortem|used to (invent|report|claim|say|show)|this is what broke|went wrong when|regression)\b/i,
  },
  {
    what: 'AI authorship or tooling credit',
    why: 'authorship of the code is not documentation of the product',
    re: /\b(AI-generated|generated with|co-authored-by|Claude|ChatGPT|Copilot|as an AI)\b/i,
  },
  {
    what: 'characterisation-test vocabulary',
    why: 'internal test strategy is not product documentation',
    re: /\bcharacteri[sz]ation\b/i,
  },
];

describe('README — for developers, and nothing else', () => {
  const text = read(README);

  for (const { what, why, re } of BANNED) {
    it(`carries no ${what} (${why})`, () => {
      expect(offenders(text, re)).toEqual([]);
    });
  }

  it('still covers what a collaborator needs to get started', () => {
    // Sanitising must never cost a reader the practical sections.
    for (const heading of [
      '## What FormPing is',
      '## Tech stack',
      '## Project structure',
      '## Getting started',
      '## Contributing',
      '## Responsible use',
    ]) {
      expect(text).toContain(heading);
    }
  });

  it('names the four checks that gate a commit, exactly as CI runs them', () => {
    // A contributor following the README must run what CI runs. `next lint` is
    // deliberately absent: the web app has no ESLint config, so that script
    // opens an interactive prompt instead of checking anything.
    const contributing = text.slice(text.indexOf('## Contributing'));
    expect(contributing).toContain('npm run lint');
    expect(contributing).toContain('npm test');
    expect(contributing).toContain('npx tsc --noEmit');
    expect(contributing).toContain('npm run test:e2e');
  });
});

describe('the in-app docs — for users, and nothing else', () => {
  const text = renderedText(read(DOCS));

  for (const { what, why, re } of BANNED) {
    it(`carries no ${what} (${why})`, () => {
      expect(offenders(text, re)).toEqual([]);
    });
  }

  const copy = copyOnly(read(DOCS));

  it('shows a user nothing from inside the codebase', () => {
    // A user reads about the product. File paths, commands, library names and
    // internal enums belong in the README, and an internal identifier on a user
    // surface is the exact thing the alert vocabulary forbids.
    const devFacing =
      /\b(vitest|playwright|typescript|tailwind|supabase|postgres(ql)?|npm run|npx |localhost|reasonCode|process\.env|[a-z]+\.tsx?\b|src\/)/i;
    expect(offenders(copy, devFacing)).toEqual([]);
  });

  it('screams no internal reason codes at a user', () => {
    // SCREAMING_SNAKE enums are ours; the verdict label already says it in
    // English. One exception: prose may not contain them at all, so the check is
    // simply that none appear.
    expect(offenders(copy, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/)).toEqual([]);
  });
});

describe('the README reference stays level with the engine', () => {
  /**
   * The reason-code table is the one part of the README that can silently go
   * stale: a new code ships in the engine and the table simply doesn't mention
   * it. So the table is compared against the type the engine actually emits —
   * documentation currency as a test, not as a habit.
   */
  const union = read(join(ROOT, 'src/types.ts'));
  const block = union.slice(union.indexOf('export type ReasonCode'));
  const engineCodes = [
    ...new Set(
      (block.slice(0, block.indexOf(';')).match(/'[A-Z][A-Z0-9_]*'/g) ?? []).map((c) => c.replace(/'/g, '')),
    ),
  ];
  const readme = read(README);

  it('finds the engine reason codes to compare against', () => {
    // Guards the parse itself: if the union moves or is renamed, this fails
    // loudly rather than quietly comparing an empty list and passing.
    expect(engineCodes.length).toBeGreaterThan(20);
  });

  it('documents every reason code the engine can emit', () => {
    const undocumented = engineCodes.filter((c) => !readme.includes(`\`${c}\``));
    expect(undocumented).toEqual([]);
  });

  it('documents no reason code the engine no longer emits', () => {
    const table = readme.slice(readme.indexOf('Form test result — reason codes'));
    const documented = [...new Set((table.match(/`[A-Z][A-Z0-9_]{4,}`/g) ?? []).map((c) => c.replace(/`/g, '')))];
    const stale = documented.filter((c) => !engineCodes.includes(c));
    expect(stale).toEqual([]);
  });
});
