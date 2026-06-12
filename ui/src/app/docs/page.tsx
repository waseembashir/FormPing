'use client';

import { Header } from '@/components/Header';
import type { ReactNode } from 'react';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'storage', label: 'Storage layout' },
  { id: 'snapshot-data', label: 'What gets saved' },
  { id: 'comparison', label: 'How comparison works' },
  { id: 'efficiency', label: 'Efficiency numbers' },
  { id: 'cheap-by-default', label: 'Why it is cheap' },
  { id: 'scaling', label: 'What scales' },
  { id: 'tradeoffs', label: 'Trade-offs' },
  { id: 'math', label: 'Scaling math' },
  { id: 'form-tester', label: 'Form Tester quick ref' },
  { id: 'form-watch', label: 'Form Watch (scheduler)' },
];

// ─── Styled primitives ─────────────────────────────────────────────────────

function H1({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h1 id={id} className="text-3xl font-bold text-slate-100 scroll-mt-24 mb-1">
      {children}
    </h1>
  );
}

function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="text-xl font-bold text-slate-100 scroll-mt-24 mt-14 mb-4 pb-2 border-b border-slate-800"
    >
      {children}
    </h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-slate-300 leading-relaxed mb-4">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-xs bg-slate-800 text-slate-200 px-1.5 py-0.5 rounded ring-1 ring-slate-700">
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-slate-900 ring-1 ring-slate-800 rounded-xl px-4 py-3 my-4 overflow-x-auto">
      <code className="text-xs font-mono text-slate-300 leading-relaxed whitespace-pre">{children}</code>
    </pre>
  );
}

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const styles =
    tone === 'warn'
      ? 'bg-amber-500/10 border-amber-500/20 text-amber-200'
      : 'bg-indigo-500/10 border-indigo-500/20 text-slate-200';
  return (
    <div className={`my-4 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

interface TableProps {
  headers: string[];
  rows: ReactNode[][];
}

function Table({ headers, rows }: TableProps) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl ring-1 ring-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/60 last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-slate-300 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UL({ children }: { children: ReactNode }) {
  return <ul className="list-none space-y-1.5 mb-4 ml-1">{children}</ul>;
}

function LI({ children }: { children: ReactNode }) {
  return (
    <li className="text-slate-300 leading-relaxed flex gap-2">
      <span className="text-slate-600 shrink-0 mt-0.5">·</span>
      <span>{children}</span>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <main className="max-w-7xl mx-auto px-4 pb-24 pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* ── Sticky TOC ─────────────────────────────────────────── */}
          <aside className="lg:col-span-3 lg:sticky lg:top-24">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                On this page
              </p>
              <nav className="space-y-1">
                {SECTIONS.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="block text-sm text-slate-400 hover:text-indigo-300 hover:bg-slate-800/60 px-2 py-1.5 rounded-md transition-colors"
                  >
                    {s.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* ── Content ───────────────────────────────────────────── */}
          <article className="lg:col-span-9 max-w-3xl">
            <div className="mb-10">
              <H1>FormPing Docs</H1>
              <p className="text-slate-400 mt-2">
                How the Website Change Monitor stores data, runs comparisons, and stays cheap.
              </p>
            </div>

            {/* ── Overview ─────────────────────────────────────── */}
            <H2 id="overview">Overview</H2>
            <P>
              The monitor takes a <em>snapshot</em> of a site (homepage + a few important pages),
              saves it to disk, and later compares the current state of the site against the most
              recent stored snapshot to produce a <em>change report</em>.
            </P>
            <P>It runs in three modes:</P>
            <Table
              headers={['Mode', 'What it does']}
              rows={[
                [<Code key="0">snapshot</Code>, 'Crawl, save snapshot JSON, exit.'],
                [
                  <Code key="0">compare</Code>,
                  'Take a fresh snapshot, diff it against the most recent stored snapshot, print a report, save the new snapshot.',
                ],
                [<Code key="0">watch</Code>, 'Repeat compare on a schedule until stopped.'],
              ]}
            />

            {/* ── Storage layout ──────────────────────────────── */}
            <H2 id="storage">Storage layout</H2>
            <P>
              Every site you monitor gets its own folder under{' '}
              <Code>formping/data/snapshots/&lt;hostname&gt;/</Code>. One snapshot = one JSON file,
              ISO-timestamped:
            </P>
            <CodeBlock>{`formping/data/snapshots/
└── example.com/
    ├── 2026-04-26T18-00-00-000Z.json     ← snapshot taken Apr 26
    ├── 2026-04-27T18-00-00-000Z.json     ← snapshot taken Apr 27
    └── screenshots/                       ← only if --screenshots
        └── 2026-04-27T18-00-00-000Z/
            ├── home.png
            ├── contact.png
            └── pricing.png`}</CodeBlock>
            <P>Why this design:</P>
            <UL>
              <LI>One JSON per snapshot = atomic writes; no half-written state.</LI>
              <LI>
                Filenames are sortable, so &ldquo;find latest&rdquo; is just{' '}
                <Code>ls | sort | tail -1</Code> &mdash; no DB index needed.
              </LI>
              <LI>Each site is isolated in its own folder.</LI>
              <LI>
                No database. Just files you can <Code>cat</Code>, <Code>jq</Code>,{' '}
                <Code>grep</Code>, <Code>rm</Code>, or back up with normal tooling.
              </LI>
            </UL>

            {/* ── What gets saved ─────────────────────────────── */}
            <H2 id="snapshot-data">What gets saved per page</H2>
            <P>
              For each page crawled, the snapshot stores <strong>structured metadata</strong>, not
              raw HTML:
            </P>
            <CodeBlock>{`{
  "url": "https://example.com/contact",
  "title": "Contact Us",
  "metaDescription": "Get in touch with our team...",
  "metaRobots": "index,follow",
  "canonical": "https://example.com/contact",
  "h1": "Talk to us",
  "textContentHash": "9a3b2c1d4e5f6789",   ← 16-char SHA-256 prefix
  "textContentLength": 4231,                ← gives "% changed" later
  "formFields": [
    { "name": "email",   "type": "email",    "required": true, "label": "Email" },
    { "name": "message", "type": "textarea", "required": true, "label": "Message" }
  ],
  "buttons": ["Send Message"],
  "links": [...],          ← capped at 60
  "scripts": [...],        ← only src= scripts, never inline
  "textBlocks": {          ← structured text for granular diffs
    "headings":  [{ "tag": "h1", "text": "Talk to us" }, ...],
    "paragraphs": ["We respond within 24 hours...", ...],
    "listItems": ["Email support", "Phone support", ...]
  },
  "loadTime": 842,
  "screenshotPath": null,
  "timestamp": "2026-04-26T18:00:00Z",
  "fetchedVia": "fetch"
}`}</CodeBlock>
            <Note>
              <strong>The text-storage strategy:</strong> we keep two layers. (1)
              <Code>textBlocks</Code> stores semantic content — headings, paragraphs, list items —
              capped and deduped, ~10–20 KB per page. This powers the per-line before/after diffs
              you see in the UI. (2) <Code>textContentHash</Code> + length is a 24-byte fallback
              that catches changes inside non-semantic markup.
            </Note>

            {/* ── Comparison ──────────────────────────────────── */}
            <H2 id="comparison">How comparison works</H2>
            <CodeBlock>{`┌─ runCompare(url) ──────────────────────────────────────────────────┐
│                                                                     │
│   1. findPreviousSnapshot(site)                                    │
│      → readdir() → sort filenames → pick last → JSON.parse          │
│      Cost: ~5ms                                                     │
│                                                                     │
│   2. snapshotSite(url)                                             │
│      → discoverImportantPages()  ~50ms (Cheerio fetch + scoring)   │
│      → for each page: snapshotPageWithFetch()  ~50ms each          │
│      → write JSON                ~5ms                               │
│      Cost: ~50ms × N pages                                          │
│                                                                     │
│   3. diffSnapshots(old, new)                                       │
│      → match pages by URL                                          │
│      → for each page: diffPage()                                   │
│         · hash compare      (O(1))                                  │
│         · field diff        (O(F))                                  │
│         · button/script set (O(B + S))                              │
│      Cost: ~1ms total — pure function, no I/O                      │
│                                                                     │
│   4. summarizeChanges()                                            │
│      → counts severities, picks top change                         │
│      Cost: <1ms                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘`}</CodeBlock>
            <P>
              The diff itself is microseconds. The cost is dominated by the HTTP fetches in step 2.
            </P>

            {/* ── Efficiency ──────────────────────────────────── */}
            <H2 id="efficiency">Efficiency numbers</H2>
            <P>For a typical 5–10 page marketing site:</P>
            <Table
              headers={['Operation', 'Time', 'Disk', 'Network']}
              rows={[
                [
                  <Code key="0">--monitor snapshot</Code>,
                  <strong key="1">0.3 – 1 s</strong>,
                  '~30 – 80 KB',
                  '1 HTTP request per page',
                ],
                [
                  <Code key="0">--monitor snapshot --screenshots</Code>,
                  <strong key="1">10 – 30 s</strong>,
                  '~30 – 80 KB JSON + ~2 MB images',
                  '1 Playwright load per page',
                ],
                [
                  <Code key="0">--monitor compare</Code>,
                  'snapshot time + ~5 ms diff',
                  '+1 new snapshot file',
                  'same as snapshot',
                ],
                [
                  <Code key="0">--monitor watch</Code>,
                  '(above) every interval',
                  'grows linearly with cycles',
                  'per cycle',
                ],
              ]}
            />
            <P>Per-cycle disk growth:</P>
            <UL>
              <LI>
                JSON only: ~50 KB per snapshot &rarr;{' '}
                <strong>~18 MB after 1 year of hourly checks.</strong>
              </LI>
              <LI>
                With screenshots (10 pages × 200 KB PNG): ~2 MB per snapshot &rarr;{' '}
                <strong>~700 MB after 1 year of hourly checks.</strong>
              </LI>
            </UL>
            <P>
              <strong>Memory:</strong> the entire active comparison fits in &lt; 5 MB even for
              50-page sites &mdash; both snapshots are loaded into memory as JS objects, diffed,
              and dropped.
            </P>

            {/* ── Why it's cheap ──────────────────────────────── */}
            <H2 id="cheap-by-default">Why it&apos;s cheap by default</H2>
            <Table
              headers={['Decision', 'Why it matters']}
              rows={[
                [
                  <span key="0">
                    Cheerio fetch first, Playwright only with <Code>--screenshots</Code>
                  </span>,
                  'A 10-page site costs 10 HTTP requests (~500 ms total) instead of 10 Chromium launches (~30 s).',
                ],
                [
                  <span key="0">
                    <Code>textContentHash</Code> instead of raw text
                  </span>,
                  'One snapshot stays under 100 KB even for content-heavy pages.',
                ],
                [
                  <span key="0">
                    Only <Code>{'<script src=…>'}</Code>, not inline scripts
                  </span>,
                  'Inline scripts vary on every load (CSRF tokens, timestamps) and would create false-positive churn.',
                ],
                [
                  <span key="0">
                    <Code>links</Code> capped at 60
                  </span>,
                  'Some sites have 500+ links per page. We keep the top 60 to detect navigation changes without bloat.',
                ],
                [
                  <span key="0">Hidden form fields excluded</span>,
                  'Hidden inputs often contain nonces and CSRF tokens that change every load.',
                ],
                [
                  <span key="0">Diff engine is pure functions, no I/O</span>,
                  'Trivially testable (17 unit tests, runs in 3 ms). No DB, no caching layer.',
                ],
                [
                  <span key="0">One file per snapshot</span>,
                  'No transactional complexity. If a write crashes, the file is just incomplete and gets ignored — older snapshots remain intact.',
                ],
              ]}
            />

            {/* ── Scaling ─────────────────────────────────────── */}
            <H2 id="scaling">What scales and what doesn&apos;t</H2>
            <P>Scales linearly with:</P>
            <UL>
              <LI>
                Number of pages crawled (<Code>--pages</Code> cap controls this; default 10)
              </LI>
              <LI>Number of snapshots stored (disk only — we only ever read the latest)</LI>
              <LI>Form field count per page (still microseconds)</LI>
            </UL>
            <P>Doesn&apos;t scale at all:</P>
            <UL>
              <LI>Comparison runtime — always near-instant once snapshots are loaded</LI>
              <LI>Memory — only two snapshots in RAM at once</LI>
              <LI>
                Diff complexity — adding a new check in <Code>diffEngine.ts</Code> doesn&apos;t
                slow down existing checks
              </LI>
            </UL>
            <P>Things that grow without bound (clean up manually when needed):</P>
            <UL>
              <LI>
                Old snapshot JSON files &mdash; delete with{' '}
                <Code>rm formping/data/snapshots/&lt;host&gt;/2025-*.json</Code>
              </LI>
              <LI>
                Screenshot folders &mdash; same:{' '}
                <Code>rm -rf formping/data/snapshots/&lt;host&gt;/screenshots/2025-*</Code>
              </LI>
            </UL>

            {/* ── Trade-offs ──────────────────────────────────── */}
            <H2 id="tradeoffs">Honest trade-offs</H2>
            <Table
              headers={['What we don’t do', 'Why', 'Workaround']}
              rows={[
                [
                  <span key="0">
                    Show prose changes inside <Code>{'<div>'}</Code>/<Code>{'<span>'}</Code>{' '}
                    soup
                  </span>,
                  'We extract semantic blocks (h1–h3, p, li). Text inside non-semantic markup falls back to the hash-based "size delta" indicator.',
                  'Re-crawl manually, or add custom selectors to extractTextBlocks().',
                ],
                [
                  'Pixel-perfect visual diffs',
                  'Image diffing is heavy.',
                  'Add an image-diff library; you already have screenshots side-by-side.',
                ],
                [
                  'Track historical trends (avg load time over a week)',
                  'Always comparing latest-vs-latest.',
                  'Aggregate across snapshot files in a script.',
                ],
                [
                  'Detect changes in JS-rendered SPAs by default',
                  'Cheerio doesn’t run JS.',
                  <span key="0">
                    Use <Code>--screenshots</Code> (forces Playwright + JS-rendered HTML).
                  </span>,
                ],
                [
                  'Detect content inside iframes',
                  'Each iframe is its own document.',
                  'Add iframe URLs to the crawl set.',
                ],
              ]}
            />

            {/* ── Math ────────────────────────────────────────── */}
            <H2 id="math">Concrete scaling math</H2>
            <P>
              If you watch <strong>10 sites every hour</strong>, with screenshots disabled:
            </P>
            <UL>
              <LI>
                Per cycle: 10 sites × 10 pages × 50 ms = <strong>5 seconds</strong> of work
              </LI>
              <LI>
                Per day: 24 cycles × 5 s = <strong>2 minutes total</strong> of CPU time
              </LI>
              <LI>
                Per year: ~<strong>12 hours</strong> of total CPU time
              </LI>
              <LI>
                Disk: 10 sites × 24 cycles × 365 days × 50 KB ={' '}
                <strong>~4 GB / year</strong>
              </LI>
            </UL>
            <Note tone="warn">
              Enable <Code>--screenshots</Code> and you multiply network/CPU by ~30× and disk by
              ~40×. Use it sparingly — only when you actually need visual evidence.
            </Note>

            {/* ── Form Tester ─────────────────────────────────── */}
            <H2 id="form-tester">Form Tester quick reference</H2>
            <P>
              The original feature: discovers a site&apos;s contact page, finds the main contact
              form, fills it with test data, optionally submits, and verifies the thank-you state.
            </P>
            <Table
              headers={['Mode', 'Behavior']}
              rows={[
                [<Code key="0">safe</Code>, 'Fills the form but does NOT submit. Default.'],
                [
                  <Code key="0">live</Code>,
                  'Actually submits. Use only on sites you own / are authorized to test.',
                ],
                [
                  <Code key="0">detect-only</Code>,
                  'Finds the contact page and form. No fill, no submit.',
                ],
              ]}
            />
            <P>Result statuses:</P>
            <Table
              headers={['Status', 'Meaning']}
              rows={[
                [<Code key="0">pass</Code>, 'Form submitted and success confirmed.'],
                [<Code key="0">fail</Code>, 'Something went wrong or was blocked.'],
                [<Code key="0">warn</Code>, 'Partial — safe / detect-only mode, or ambiguous.'],
                [<Code key="0">error</Code>, 'Unhandled exception.'],
              ]}
            />
            <P>
              CAPTCHA / anti-bot is detected and reported, never bypassed. See the{' '}
              <Code>README.md</Code> in the repo for the full reason-code list.
            </P>

            {/* ── Form Watch ──────────────────────────────────── */}
            <H2 id="form-watch">Form Watch (scheduler)</H2>
            <P>
              Form Watch automatically re-tests a contact form on a fixed schedule and alerts you
              when it changes or breaks — so you catch a silently-broken client form within one
              cycle, instead of when leads stop arriving. It reuses the Form Tester engine; it just
              runs it on a timer and tracks the result over time.
            </P>
            <P>Per watched URL:</P>
            <UL>
              <LI>You add a URL, a check frequency (e.g. every 3 days), and a mode.</LI>
              <LI>
                A baseline check runs immediately, then repeats on your interval — automatically —
                until you click <strong>Stop</strong>.
              </LI>
              <LI>Each run records the result and compares it to the previous run.</LI>
              <LI>
                A Slack alert fires on every run (success <em>and</em> failure) with the URL,
                status, any changes, and a suggested next action.
              </LI>
            </UL>

            <P>Modes (same as the Form Tester):</P>
            <Table
              headers={['Mode', 'Behavior']}
              rows={[
                [
                  <Code key="0">live</Code>,
                  'Fills and submits — confirms the form actually delivers. The intended mode for monitoring.',
                ],
                [<Code key="0">safe</Code>, 'Fills the form but does not submit.'],
                [<Code key="0">detect-only</Code>, 'Only confirms a form is present.'],
              ]}
            />
            <Note tone="warn">
              <strong>Live mode submits a real entry every cycle</strong>, which lands in the
              client&apos;s inbox / CRM. Use it only on forms you own or are authorized to monitor.
              The test data identifies it as a health check.
            </Note>

            <P>What each run records:</P>
            <Table
              headers={['Field', 'Meaning']}
              rows={[
                [<Code key="0">status</Code>, 'pass / warn / fail / error — the health verdict.'],
                [
                  <Code key="0">reasonCode</Code>,
                  'e.g. THANK_YOU_REDIRECT, FORM_NOT_FOUND, CAPTCHA_DETECTED, SUBMIT_FAILED.',
                ],
                [
                  'changes',
                  'Before/after differences vs the previous run — form removed, CAPTCHA appeared, submit endpoint changed, confidence dropped.',
                ],
                ['suggestions', 'Plain-English next action derived from the result and the changes.'],
              ]}
            />

            <P>Slack notifications:</P>
            <UL>
              <LI>
                Set the <Code>SLACK_WEBHOOK_URL</Code> env var (the same webhook the Change Monitor
                uses). Point it at the dev channel.
              </LI>
              <LI>
                Without it, runs still execute and are stored — the Slack send is simply skipped
                (best-effort, never blocks a run).
              </LI>
            </UL>

            <P>Storage — no database, files on the same volume as the monitor:</P>
            <CodeBlock>{`formping/data/snapshots/
├── .formping-form-schedules.json     ← the active schedules
└── .formping-form-runs/
    └── <scheduleId>.json              ← run history, newest first, capped`}</CodeBlock>

            <Note>
              The scheduler runs in-process while the server is up. Schedules persist on disk and
              <strong> resume automatically</strong> after a restart or redeploy, so no checks are
              lost. Keep the service always-on for reliable cycles. Minimum interval is 1 hour; a
              URL is validated (must be reachable) before it can be added.
            </Note>
          </article>
        </div>
      </main>
    </div>
  );
}
