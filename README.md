# FormPing

A QA automation tool that finds, fills, and verifies contact forms on websites you own or are authorized to test — and now monitors websites for meaningful changes over time.

---

## What it does

### Form testing (original)

1. Accepts one URL or a batch file of URLs
2. Discovers the contact page using deterministic heuristics (path matching + anchor text scoring)
3. Verifies the top candidates by loading them with Playwright and scoring the page content
4. Detects the main contact form on that page using heuristic scoring (field types, submit button text)
5. Fills the form with configurable test data
6. Optionally submits it and observes for a thank-you redirect or inline success message
7. Returns a structured JSON result for each site

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

- Screenshot capture on failure
- HTML snapshot on failure
- Real AI provider integration in `src/ai/aiClassifier.ts` and `src/monitor/summarizeChanges.ts`
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
