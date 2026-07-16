# FormPing

A QA automation tool that finds, fills, and verifies contact forms on websites you own or are authorized to test — and now monitors websites for meaningful changes over time.

---

## What it does

The web UI is organized around **Projects** (a client + their URLs), plus two tool areas — **Forms** and **Site** — and Docs:

| Area | What it is |
|------|-------|
| **Projects** | Group a client's URLs into a project; see their form, uptime & SSL health in one place (a thin overlay over the monitors). URLs you've tested or monitored but not grouped appear in an **Unassigned** bucket to **assign** or **dismiss**. |
| **Status page** | Per-client health page built from the same data. **Internal** ops view (`/projects/<id>/status`, auth-gated, with technical detail) + an opt-in **public** shareable link (`/status/<token>`, no login, client-safe only). Uptime history, 24h/7d/30d, response-time trend, SSL & form status. |
| **Forms** | *Test a form* (on-demand — results persist across tabs/refresh, with a **Clear** button) · *Scheduled monitors* (recurring form tests + Slack alerts) |
| **Site** | *Uptime & SSL* (availability + cert-expiry monitoring + Slack) · *Change tracking* (content / SEO / form / script changes over time) |

### Form testing (original)

1. Accepts one URL or a batch file of URLs
2. Discovers the contact page using deterministic heuristics (path matching + anchor text scoring)
3. Verifies the top candidates by loading them with Playwright and scoring the page content
4. Detects the main contact form on that page using heuristic scoring (field types, submit button text)
5. Fills the form with configurable test data
6. Optionally submits it and observes for a thank-you redirect or inline success message
7. Returns a structured JSON result for each site

**Landing-page mode** (`--landing-page`, or the "Landing page" toggle in the UI): skips steps 2–3
and runs form detection **directly on the given URL** — for standalone landing pages that have an
inline form and no separate `/contact` page (which would otherwise fail `CONTACT_PAGE_NOT_FOUND`).
Off by default. Available on both the Form Tester and Form Watch (remembered per scheduled monitor).

### Website Change Monitor (new)

1. Crawls a small set of important pages (homepage, about, pricing, services, contact, thank-you)
2. Saves a snapshot of each page (title, meta, H1, form fields, buttons, scripts, text-hash, optional screenshot)
3. Re-checks later, compares old vs new, and reports meaningful changes
4. Detects content, SEO, form, and technical changes
5. Optional AI summary turns the diff into a human-readable paragraph

---

## Ethical usage — read this first

FormPing is for **authorized testing only**.

- Use it only on websites you own, operate, or have explicit written permission to test
- Never use it against third-party sites without permission
- Never use it to spam, flood, or abuse contact forms
- Real submissions in live mode send real emails — use a test email address you control

---

## Limitations

- Cannot bypass CAPTCHA or anti-bot systems (by design)
- JavaScript-heavy SPAs may need longer timeouts
- Some forms use non-standard submit mechanisms that heuristics may miss
- AI fallback is a stub — you must implement the LLM provider yourself
- Does not handle file upload fields

---

## Setup

### Requirements

- Node.js >= 18
- npm >= 9

### Install

```bash
cd formping
npm install
npx playwright install chromium
```

---

## Commands

### Single URL (safe mode — fills form but does NOT submit)

```bash
npm run start -- --url https://example.com
```

### Single URL with live submission

```bash
npm run start -- --url https://example.com --mode live
```

### Detect only (find contact page and form, do nothing else)

```bash
npm run start -- --url https://example.com --mode detect-only
```

### Batch from file

```bash
npm run start -- --file sites.txt --output results.json
```

### Batch with pretty JSON and live mode

```bash
npm run start -- --file sites.csv --output results.json --json-pretty --mode live
```

### Run with visible browser

```bash
npm run start -- --url https://example.com --headed
```

### Full options

```
--url <url>           Single URL to test
--file <path>         Path to .txt or .csv with one URL per line
--mode <mode>         live | safe | detect-only  (default: safe)
--headed              Show browser window
--output <path>       Write results to JSON file
--json-pretty         Pretty-print JSON output
--timeout <ms>        Per-action timeout (default: 15000)
--concurrency <n>     Batch concurrency (default: 2)
--ai                  Enable AI fallback (disabled by default)
--email <email>       Override test email address
```

---

## Modes

| Mode | Behavior |
|------|----------|
| `safe` | Discover contact page, find form, fill fields — **do not submit** |
| `live` | Full flow including form submission — use only on authorized sites |
| `detect-only` | Find contact page and form, do not fill or submit |

Default is `safe`.

---

## Configuration

Edit `src/config.ts` to customize:

- `testData` — names, email, phone, message used to fill forms
- `thankYouUrlPatterns` — URL patterns that indicate successful submission
- `inlineSuccessPatterns` — text patterns on-page that indicate success
- `batchConcurrency` — number of parallel sites in batch mode
- `headless` — show/hide browser
- `timeout` / `navigationTimeout` — timeouts in ms
- `saveScreenshotOnFailure` — capture screenshot on failure (wiring optional)
- `saveHtmlSnapshotOnFailure` — save HTML snapshot on failure (wiring optional)

### Storage backend — Supabase (Postgres) or JSON files

FormPing persists to **Supabase (Postgres)** when configured, otherwise to JSON
files (the original, still supported as a fallback). It picks the backend at
runtime from the env — no code change needed. Check which one is live at any time
via **`GET /api/health`** → `{"storage":"supabase" | "json"}`.

To use Supabase, set these **server-only** vars in `ui/.env.local` (local) and
Railway's Variables (prod). Never commit them:

```
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret key>   # bypasses RLS — server-side only
```

The schema lives in `supabase/migrations/` (run each file in the Supabase SQL
Editor). Tables are named after the app's tools:

- **Phase 1 (core)** — `projects`, `form_tester_runs` (Test a form),
  `form_watch_schedules` (Form Watch), `site_watch_schedules` (Site Watch),
  `dismissed_urls` (Projects "Don't track").
- **Phase 2 (history + reports)** — `form_watch_runs` (Form Watch run history),
  `site_watch_runs` (Site Watch check history), `change_reports` (Change Monitor).
  The two history tables cascade-delete with their parent schedule, so removing a
  monitor also clears its history (no orphan rows).

RLS is enabled on every table (the anon key can do nothing; the server's secret
key bypasses it and has full access). Check the live backend at `/api/health`
(`storage: "supabase" | "json"`).

### JSON fallback + where it lives (`FORMPING_DATA_DIR`)

When Supabase is **not** configured, all UI persistence — projects, form/site
schedules, run history, change reports, dismissals, on-demand runs — is written
under `data/snapshots/…`. By default that is `<repo>/data/snapshots` (on Railway
this is the mounted persistent volume, so leave it unset in production).

Set `FORMPING_DATA_DIR` (in `ui/.env.local`) to an **absolute** path to relocate
all of it. This matters for **local dev when the repo lives inside a synced
folder like OneDrive/Dropbox**, which continually re-syncs and reverts these
small, frequently-written JSON files — silently wiping your schedules and
projects. Point it at a non-synced folder, e.g.:

```
FORMPING_DATA_DIR="C:/Users/<you>/AppData/Local/FormPing/data"
```

The default (unset) behaviour is unchanged.

## AI providers (optional)

AI is **off by default**. To enable, create a `.env` file in `formping/` with one or more of these keys:

```bash
# Pick whichever provider you want — all four are optional
ANTHROPIC_API_KEY=sk-ant-...     # Claude Haiku 4.5 — best quality, paid
GEMINI_API_KEY=...                # Gemini 1.5 Flash — free tier, no card needed
GROQ_API_KEY=gsk_...              # Llama 3.1 8B — free tier, very fast
# Ollama needs no key — install from ollama.com and run `ollama pull llama3.1:8b`
```

Setup links:
- Anthropic: https://console.anthropic.com/settings/keys (paid, ~$0.30–$2/mo for typical use)
- Gemini: https://aistudio.google.com/app/apikey (free tier covers FormPing easily)
- Groq: https://console.groq.com/keys (free tier)
- Ollama: https://ollama.com (free, local-only — needs ~5GB disk)

When enabled, the UI shows a dropdown to pick which provider to use, with "Auto" selecting the first available in the priority order: Anthropic → Gemini → Groq → Ollama. CLI users can pass `--ai-provider <id>` or `--ai-provider auto`.

---

## Public deployment via Cloudflare Quick Tunnel (free, $0/month)

You can expose the local UI to the internet behind a password gate without buying a domain or server.

### One-time setup

1. **Add a basic-auth password** in `ui/.env.local` (this file is gitignored):
   ```
   BASIC_AUTH_USER=admin
   BASIC_AUTH_PASSWORD=YourLongRandomPasswordHere
   ```
   Generate a strong password:
   ```bash
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```

2. **Install `cloudflared`**:
   ```bash
   brew install cloudflared
   ```

### Each time you want the tool live

Open **two terminals**:

```bash
# Terminal 1 — start the UI (also starts the password gate)
cd formping/ui
npm run dev

# Terminal 2 — start the tunnel and get a public URL
cloudflared tunnel --url http://localhost:3000
```

The tunnel command prints something like:
```
| Your quick Tunnel has been created! Visit it at:    |
| https://random-words-here.trycloudflare.com         |
```

Copy that URL. Anyone visiting it sees the basic-auth login. Only people with the password get through.

### Notes

- The `*.trycloudflare.com` URL **changes every time you restart `cloudflared`** — bookmark whichever is current. To get a stable URL, register a domain at Cloudflare Registrar (~$10/yr) and use a named tunnel instead.
- When your Mac sleeps or the dev server stops, the public URL goes down. For 24/7 uptime, deploy to a small VPS (Hetzner CX22 €4/mo is the best value).
- Watch out for **port collisions**: Next.js may pick port 3001 if 3000 is busy. Adjust the `cloudflared --url` accordingly.

---

## Output schema

```json
{
  "inputUrl": "https://example.com",
  "normalizedUrl": "https://example.com",
  "mode": "safe",
  "resolvedContactPage": "https://example.com/contact",
  "contactPageFound": true,
  "contactPageConfidence": 0.91,
  "formFound": true,
  "formConfidence": 0.88,
  "formIdentifier": {
    "id": "contact-form",
    "name": null,
    "action": "/submit",
    "method": "post"
  },
  "submissionAttempted": false,
  "submissionResult": "not_attempted",
  "redirectUrl": null,
  "finalUrl": "https://example.com/contact",
  "thankYouDetected": false,
  "inlineSuccessDetected": false,
  "captchaDetected": false,
  "antiBotDetected": false,
  "finalStatus": "warn",
  "reasonCode": "SAFE_MODE_NO_SUBMIT",
  "notes": [],
  "durationMs": 3421
}
```

### Reason codes

| Code | Meaning |
|------|---------|
| `CONTACT_PAGE_NOT_FOUND` | No contact page candidate found |
| `CONTACT_PAGE_AMBIGUOUS` | Multiple candidates, low confidence |
| `FORM_NOT_FOUND` | No contact form on the contact page |
| `FORM_AMBIGUOUS` | Multiple forms, low confidence |
| `CAPTCHA_DETECTED` | CAPTCHA widget found — aborted |
| `ANTI_BOT_DETECTED` | Anti-bot/challenge page — aborted |
| `REQUIRED_FIELDS_UNSUPPORTED` | Could not fill required fields |
| `SAFE_MODE_NO_SUBMIT` | Safe mode — filled but not submitted |
| `DETECT_ONLY` | Detect-only mode — no interaction |
| `SUBMIT_FAILED` | Submit click failed |
| `VALIDATION_ERROR` | Form showed validation errors |
| `NO_REDIRECT_NO_SUCCESS` | Submitted but no success signal |
| `INLINE_SUCCESS_ONLY` | Inline success message detected |
| `THANK_YOU_REDIRECT` | Redirected to thank-you URL |
| `PASS` | Full success |
| `ERROR` | Unhandled exception |

### Final status values

| Status | Meaning |
|--------|---------|
| `pass` | Form submitted and success confirmed |
| `fail` | Something went wrong or blocked |
| `warn` | Partial — safe/detect-only mode, or ambiguous |
| `error` | Unhandled exception |

---

## Success detection rules

### Thank-you URL detection

URL is matched against patterns: `thank-you`, `thankyou`, `success`, `submitted`, `confirmation`, `sent`, `received`

### Inline success detection

Page text is matched against: "thank you", "thanks for contacting", "message sent", "form submitted", "we'll be in touch", "submission received", "get back to you"

---

## CAPTCHA and anti-bot behavior

FormPing **never attempts to bypass** CAPTCHA or anti-bot systems.

- If a CAPTCHA widget is detected before form fill, it stops and returns `CAPTCHA_DETECTED`
- If an anti-bot challenge page is detected when loading the contact page, it stops and returns `ANTI_BOT_DETECTED`
- It does not retry through protected pages

---

## AI fallback behavior

AI is **disabled by default** and is an **optional stub**.

When enabled (`--ai` flag or `aiEnabled: true` in config), it is only called in two cases:

1. Multiple contact page candidates score similarly — AI picks one
2. Multiple forms on the contact page score similarly — AI picks one

The AI stub lives in `src/ai/aiClassifier.ts`. It returns `null` until you implement a provider. Prompts use only compact metadata (URLs, scores, field names) — never raw HTML.

### Keeping AI disabled

Do not pass `--ai`. The default config has `aiEnabled: false`. The stub contains clear TODO comments showing exactly where to wire in Claude or OpenAI.

---

## Running tests

```bash
npm test
```

Tests cover:
- Contact link scoring and exclusion logic
- Success URL detection
- Inline success text detection
- Validation error detection
- CAPTCHA detection
- Anti-bot detection
- Post-submit analysis composition

---

## Future improvements

### ✅ Recently shipped

1. ~~Per-change location context in monitor diffs~~ — done. Each diff card now shows a breadcrumb like `🧭 main › About me › <p>`.
2. ~~Wire AI toggles~~ — done, and made provider-agnostic. Supports Anthropic Claude Haiku, Google Gemini Flash, Groq Llama, and local Ollama. Pick one in the UI dropdown or set `AI_PROVIDER=auto` to use the first configured provider.

### 🎯 Up next

(Add new ideas here.)

### Backlog

- Screenshot capture on failure
- HTML snapshot on failure
- Retry logic for flaky navigations
- Proxy/rotation support for large-scale authorized testing
- Configurable per-site overrides (contact page URL, field mapping)
- Output formats: CSV, JUnit XML for CI integration
- Slack/webhook notifications for batch results
- Visual diffs from monitor screenshots (pixel-by-pixel)
- Accessibility / Lighthouse score tracking in monitor

---

# Website Change Monitor

A separate mode that snapshots your site over time and reports meaningful changes — content, SEO, forms, tracking scripts, performance.

## Quick start

```bash
# 1. Take a baseline snapshot
npm run start -- --url https://yoursite.com --monitor snapshot

# 2. Later, compare current state vs the most recent snapshot
npm run start -- --url https://yoursite.com --monitor compare --json-pretty

# 3. Or run on a schedule until Ctrl+C
npm run start -- --url https://yoursite.com --monitor watch --watch-interval 3600000
```

## Modes

| Mode | What it does |
|------|---------------|
| `snapshot` | Crawls important pages, saves snapshot JSON, exits |
| `compare`  | Takes a fresh snapshot, diffs it against the most recent stored snapshot, prints a change report, saves the new one |
| `watch`    | Repeats `compare` on a fixed interval until SIGINT |

## Monitor flags

```
--monitor <mode>           snapshot | compare | watch
--pages <n>                max pages to crawl (default 10)
--screenshots              capture full-page screenshots (uses Playwright)
--ai-summary               use AI to summarize change reports (stub by default)
--watch-interval <ms>      cycle interval for watch mode (default 3600000 = 1 hour)
--output <file>            write JSON report to a file (in addition to stdout)
--json-pretty              pretty-print JSON
```

## What gets snapshotted

For each page crawled:

```json
{
  "url": "https://example.com/contact",
  "title": "Contact Us",
  "metaDescription": "Get in touch...",
  "metaRobots": "index,follow",
  "canonical": "https://example.com/contact",
  "h1": "Talk to us",
  "textContentHash": "9a3b2c1d4e5f6789",
  "textContentLength": 4231,
  "formFields": [
    { "name": "email", "type": "email", "required": true, "label": "Email" },
    { "name": "message", "type": "textarea", "required": true, "label": "Message" }
  ],
  "buttons": ["Send Message"],
  "links": ["/about", "/pricing", "..."],
  "scripts": ["https://www.googletagmanager.com/gtm.js?id=..."],
  "loadTime": 842,
  "screenshotPath": "data/snapshots/example.com/screenshots/2026-04-26T18-00-00-000Z/contact.png",
  "timestamp": "2026-04-26T18:00:00.000Z",
  "fetchedVia": "fetch"
}
```

## Output report

`compare` and `watch` produce a structured report:

```json
{
  "site": "example.com",
  "rootUrl": "https://example.com/",
  "checkedAt": "2026-04-27T18:00:00.000Z",
  "previousSnapshot": "data/snapshots/example.com/2026-04-26T18-00-00-000Z.json",
  "pagesScanned": 5,
  "pagesChanged": 2,
  "changesFound": 3,
  "summary": "3 changes across 2 pages. 1 high-severity. Most notable: /contact — New required tel field added: \"phone\".",
  "details": [
    {
      "url": "https://example.com/",
      "changes": [
        "H1 changed: \"Welcome\" → \"Get Started Today\"",
        "New button: \"Get Started\""
      ],
      "severity": "medium"
    },
    {
      "url": "https://example.com/contact",
      "changes": ["New required tel field added: \"phone\""],
      "severity": "high"
    }
  ]
}
```

## What kinds of change are detected

| Category | Examples |
|----------|----------|
| **Content** | H1 changed, major text-content delta, button/CTA text changed |
| **SEO** | Title, meta description, canonical, robots meta |
| **Forms** | Field added/removed, field becomes required, type changed, button text changed |
| **Technical** | New tracking scripts (GTM, GA, Meta Pixel), removed scripts, load-time spikes |
| **Site-level** | New page appears, page disappears |

## Severity tiers

| Severity | Meaning |
|----------|---------|
| `low` | Cosmetic — meta description, minor text edits, script noise, load-time |
| `medium` | Likely intentional — title/H1 changed, CTA text changed, page added |
| `high` | Material — form field added/removed, page disappeared, robots meta changed |

## Storage

```
formping/data/snapshots/example.com/
  2026-04-26T18-00-00-000Z.json
  2026-04-27T18-00-00-000Z.json
  screenshots/
    2026-04-26T18-00-00-000Z/
      home.png
      contact.png
```

No database, no remote storage. Snapshots are plain JSON on disk so you can inspect, archive, or delete them with normal tooling.

## Cost

The monitor is built to be cheap by default:

- **Cheerio fetch** is used for HTML parsing — Playwright launches **only** when `--screenshots` is enabled
- Page count is capped via `--pages` (default 10)
- AI summarization is **opt-in only** (`--ai-summary`) and the implementation is a stub until you wire in a provider
- No diffing libraries — the diff engine is pure TS, ~150 LOC

## AI summary

`--ai-summary` enables a hook in [src/monitor/summarizeChanges.ts](src/monitor/summarizeChanges.ts) where you can wire in Claude or OpenAI. Until then it logs a warning and falls back to the deterministic summary. Prompts should pass diff metadata only (URLs, severities, change strings) — never raw page HTML.

## Watch mode

`watch` runs `compare` in a loop until SIGINT. The interval is set with `--watch-interval` (ms, default 1 hour). Each cycle:

1. Snapshot current site
2. Diff against previous snapshot
3. Emit a JSON report to stdout
4. Sleep until next cycle (interruptible by Ctrl+C)

Pipe stdout to a log, a webhook handler, or your own alerting glue.
