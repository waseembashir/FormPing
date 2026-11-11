<div align="center">

# FormPing

### Contact-form QA & website monitoring — in one place

Find, fill and verify contact forms on sites you own or are authorized to test, and keep watch on uptime, SSL, and meaningful content changes over time. Group everything by client, and share a clean, live status page with them.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js%2014-000000?style=flat&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React%2018-20232A?style=flat&logo=react&logoColor=61DAFB)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat&logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![CI](https://github.com/waseembashir/FormPing/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-proprietary-lightgrey?style=flat)

**[Features](#features)** &nbsp;·&nbsp; **[How it works](#how-it-works)** &nbsp;·&nbsp; **[Getting started](#getting-started)** &nbsp;·&nbsp; **[CLI](#command-line-engine)** &nbsp;·&nbsp; **[Reference](#reference)** &nbsp;·&nbsp; **[Contributing](CONTRIBUTING.md)** &nbsp;·&nbsp; **[Security](SECURITY.md)** &nbsp;·&nbsp; **[License](LICENSE)**

</div>

---

## What FormPing is

FormPing is two things that share one engine:

1. **A web app** — the day-to-day product. Organize clients and their URLs into **projects**, run and schedule contact-form tests, monitor uptime / SSL / content changes, and hand each client a live, non-technical **status page**.
2. **A command-line engine** — the same detection and monitoring logic as a scriptable CLI, for one-off runs, batches, and CI.

Everything the app shows is built on top of the engine, so a result means the same thing whether it came from a scheduled monitor or a terminal command.

---

## Features

The app is organized around **Projects** (a client and their URLs), with two tool areas — **Contact Forms** and **Site Health** — plus Team and Docs.

| Feature | What it does |
|---------|--------------|
| **Form Tester** | Runs the engine on demand across a whole site: finds every form, works out what each is for, fills the lead forms, and in Live mode submits the contact form and watches for success. Every matched form is photographed with the heading above it. |
| **Form Scheduler** | Watches one form on one page on a cadence, and alerts the person who set it up when its verdict changes. The page is resolved once and checked directly from then on. |
| **Uptime & SSL** | Checks availability, response time, certificate expiry and domain expiry on its own ticker. A page that answers but shows a known failure screen — a database or code error, a suspended hosting account, a parked domain — counts as down. |
| **Content Changes** | Snapshots a site's key pages and reports what changed over time — content, SEO, forms and scripts — graded by severity. |
| **Projects** | A client and their URLs: the shared record. Every project, URL and result is visible to the whole team, and each URL names who watches it. A URL tested or monitored but not yet grouped lands in an **Unassigned** bucket rather than nowhere. |
| **Client status pages** | A live, client-safe page per project or URL, shared by link, with uptime, SSL and form health. |
| **Slack alerts** | A failing check posts to Slack with what was found, what was checked, and what still needs a person — and @mentions whoever owns the monitor. |
| **Roles & team** | Google sign-in limited to approved domains, four roles enforced on the server, bug-report triage and a per-project activity log. |

Two rules shape almost everything above. **A URL has one monitor of each kind, and one person responsible for it** — enforced across the whole team, not per user. And **an on-demand run and a scheduled run are different resources**: one is ephemeral and personal, the other is a persistent owned thing with its own history.

Every action that changes or removes data is confirmed before it happens, and the copy states the consequence — a convention worth keeping when adding one, particularly where a form test would actually **submit**.

### Website change monitoring

The monitor snapshots a small set of important pages (home, about, pricing, services, contact, thank-you) and compares them over time:

- **Content** — H1 changes, major text deltas, CTA/button text.
- **SEO** — title, meta description, canonical, robots.
- **Forms** — a field added or removed, a field becoming required, a type change.
- **Technical** — new or removed tracking scripts, load-time spikes.
- **Site-level** — a page appears or disappears.

Each change is graded **low / medium / high** so you can tell a cosmetic tweak from a material one, and an optional AI summary turns the diff into a readable paragraph. It's cheap by default — plain HTML fetching is used for parsing, and a full browser only launches when screenshots are requested.

### Client status pages

One presentation powers both a public and an internal view, curated so nothing technical can reach a client:

- **Public status page** — client-safe only: the page URL, overall status, uptime %, uptime history, SSL validity, and whether the contact form is working. No response times, reason codes, or content-change detail.
- **Internal dashboard** — the full picture for the team: response-time and uptime charts, HTTP status, check frequency, domain expiry, and the content-change timeline (each run expands to show what changed).

The split is enforced by what the builder puts in each shape, not by hiding fields in the view, so a value that never reaches the public payload cannot leak through a component that forgets to check. **The project's name is the one thing a client reads that the team types**: it is the heading on the page they are sent, which is why the project form says so beneath the field rather than leaving it to be discovered. A project's notes are internal and never enter the client-facing shape at all.

Content diffs are internal-only by design — "84 changes detected" would alarm a client about what is often their own team's intentional edits. Both views carry a **Today / 7 days / 30 days / All-time** filter.

### Roles & access

Signing in is limited to approved domains; on top of that, each person has a role that decides what they can do:

| Role | Can |
|------|-----|
| **Owner** *(exactly one)* | Everything, plus manage admins and transfer ownership. |
| **Admin** | Full app, including deleting projects and managing members and viewers. |
| **Member** *(default)* | Add URLs, run and edit monitors, rename and edit projects, view everything. |
| **Viewer** | Read-only. |

Enforcement is **server-side on every write** — the interface hides what a role can't do, but the server is the real gate. Roles are read fresh on each request, so a change takes effect immediately. There is always exactly one owner, and ownership is transferred (never left empty), so the app can't be locked out.

Each person's tool tabs are their own workspace, while Projects stays shared — see [Your own workspace, one shared record](docs/how-it-works.md#your-own-workspace-one-shared-record).

---

## How it works

Point the engine at a URL and it does what a careful person would: find the forms, work out what each one is for, fill the ones that capture leads, and — in Live mode — actually send one and watch what the site does with it. Then it reports what happened, in plain language, with a picture of what it matched.

### Test modes

| Mode | Behavior |
|------|----------|
| `detect-only` | Find the contact page and form; don't fill or submit. |
| `safe` | Find the page and form, fill the fields — **never submit**. |
| `live` | The full flow **including submission** — only on sites you're authorized to test. |

The **app** defaults to `detect-only` in both the Form Tester and the Form Scheduler: the out-of-the-box behaviour puts nothing into a stranger's form, and Safe and Live are deliberate choices. The **CLI** still defaults to `safe` (`--mode`), since it's invoked explicitly and scripts depend on that behaviour.

**Landing-page mode** skips discovery and the site crawl, testing the form on the exact URL given — for standalone landing pages with an inline form and no separate `/contact` page. Detection is also more lenient there: since you've asserted the form is on this page, the best-scoring form is accepted even if it wouldn't clear the usual contact-form threshold (a quiz, assessment or booking form is still a real form) — and the result says plainly that it's a low-confidence match.

**A pinned page** (`--target-page`) also skips discovery and the crawl, and is otherwise nothing like landing-page mode. It exists for the Form Scheduler, where a monitor watches one form on one page: the page is resolved once and then loaded directly on every later check. Because the page was resolved rather than asserted, detection stays **strict** — borrowing landing-page leniency would let a monitor settle on a newsletter box — and the run reports no contact-page confidence, since no discovery ran; the confidence that chose the page belongs to the run that resolved it.

Leniency lowers the *threshold*, not the standard. A form a visitor can see always beats one they cannot, so a hidden form is accepted only when it is the page's **only** candidate — the hidden multi-step wizard that leniency exists for.

### In depth

The full detail lives in **[How FormPing works](docs/how-it-works.md)**:

- [The web app](docs/how-it-works.md#the-web-app) — how the areas map onto the engine and its storage
- [Form testing](docs/how-it-works.md#form-testing) — finding, filling and submitting forms, the evidence captured, and how uncertainty is reported
- [Notifications](docs/how-it-works.md#notifications-carry-what-the-run-found-and-link-to-where-the-rest-is) — what an alert carries, how severity reads, and who it mentions
- [Failed checks](docs/how-it-works.md#a-failed-check-explains-itself-and-retries-at-a-sensible-interval) — how a check that could not answer explains itself and retries
- [Storage failures](docs/how-it-works.md#a-result-that-couldnt-be-stored-is-reported-not-painted-over) — why a result that could not be saved is reported rather than hidden
- [How a run flows](docs/how-it-works.md#how-a-run-flows) — a form test, a scheduled check and a content-change run, step by step

---

## Tech stack

- **Web app** — Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS. A single design-token system drives the whole UI in one coherent dark theme.
- **Engine** — TypeScript, [Playwright](https://playwright.dev) for real-browser form testing, and lightweight HTML parsing for fast change detection.
- **Data** — PostgreSQL for structured data; captured page snapshots are kept on disk for diffing; form screenshots go to object storage, so only a URL ever reaches the browser.
- **Linting** — [ESLint](https://eslint.org) with `next/core-web-vitals` on the web app, catching the hook-dependency, accessibility and Next-specific mistakes a typechecker cannot see.
- **Testing** — [Vitest](https://vitest.dev) for the engine's detection and analysis logic, [Playwright](https://playwright.dev) end-to-end tests for the web app, and a Playwright-driven **fixture suite** that runs the real detection and filling code against saved pages.

---

## Project structure

```
formping/
├── src/            # the CLI engine — form detection, testing, change monitoring
├── tests/          # engine unit tests (Vitest)
│   └── engine/     #   the same engine run against saved pages — fixtures + harness
├── docs/           # how-it-works.md — the engine and the app, in depth
├── supabase/
│   └── migrations/ # plain SQL, applied by hand — read its README before adding one
└── ui/             # the Next.js web app (App Router)
    ├── e2e/        # end-to-end tests (Playwright)
    └── src/
        ├── app/            # routes, pages, and API endpoints
        ├── components/     # UI — a shared component kit + per-feature views
        └── lib/            # app logic: projects, monitors, status, auth, design tokens
```

The root package is the engine; `ui/` is the web app and has its own dependencies.

---

## Getting started

**Prerequisites:** Node.js ≥ 18 and npm ≥ 9.

**Engine (CLI):**

```bash
npm install
npx playwright install chromium
npm test          # run the engine test suite
```

> The engine and the web app pin the **same** Playwright version deliberately, and both read one shared browser cache. Keeping them in step means a single browser download serves both, and installing from either package leaves the other working. Change one and you must change the other.

**Fixture tests.** `tests/engine/` runs the real `findContactForm` / `fillForm` against saved HTML in `tests/engine/fixtures/`: a real Chromium, no network, no external site contacted. Each fixture is a *shape* of page — "a site whose only visible form is a newsletter, with a login modal hidden behind it" — and its test asserts what the engine must conclude about that shape. They run with `npm test` like any other suite.

**Web app:**

```bash
cd ui
npm install
npm run dev       # http://localhost:3000
npm run dev:wsl   # http://localhost:3001, when 3000 is taken
```

**End-to-end tests** (Playwright) run the web app in a browser. They're hermetic — auth, database, and Slack are disabled for the run, so they need no secrets and touch no real services:

```bash
cd ui
npx playwright install chromium   # one-time browser download
npm run test:e2e                  # boots the app and runs the e2e suite
```

Configuration (auth, database, and optional integrations) is supplied through environment variables — copy `.env.example` and fill in your own values.

**Database.** The app runs without one: with no Supabase variables set it falls back to JSON files on disk, which is enough to develop against. To use Postgres instead, apply the SQL in `supabase/migrations/` first — there is no migration framework, so they are applied by hand and in order. Read `supabase/migrations/README.md` before you do: production and development share one project and are kept apart by Postgres schema, and each migration is applied once per schema.

---

## Command-line engine

The same logic the app uses, as a script.

<details>
<summary><strong>Form testing</strong></summary>

```bash
# Single URL — safe mode (fills the form but does NOT submit)
npm run start -- --url https://example.com

# Detect only — find the contact page and form, do nothing else
npm run start -- --url https://example.com --mode detect-only

# Live submission — only on authorized sites
npm run start -- --url https://example.com --mode live

# Batch from a file, write results to JSON
npm run start -- --file sites.txt --output results.json --json-pretty
```

**Options**

```
--url <url>          Single URL to test
--file <path>        .txt or .csv with one URL per line
--mode <mode>        live | safe | detect-only   (default: safe)
--landing-page       Detect the form on the given URL (skip contact-page discovery)
--target-page <url>  Test the form on this exact page (skip discovery and the site crawl)
--headed             Show the browser window
--output <path>      Write results to a JSON file
--json-pretty        Pretty-print JSON
--timeout <ms>       Per-action timeout (default: 15000)
--concurrency <n>    Batch concurrency (default: 2)
--email <email>      Override the test email address
```

</details>

<details>
<summary><strong>Change monitoring</strong></summary>

```bash
# Take a baseline snapshot
npm run start -- --url https://yoursite.com --monitor snapshot

# Later, compare current state against the most recent snapshot
npm run start -- --url https://yoursite.com --monitor compare --json-pretty

# Or run on a schedule until Ctrl+C
npm run start -- --url https://yoursite.com --monitor watch --watch-interval 3600000
```

**Options**

```
--monitor <mode>       snapshot | compare | watch
--pages <n>            max pages to crawl (default: 10)
--screenshots          capture full-page screenshots
--watch-interval <ms>  interval for watch mode (default: 3600000 = 1 hour)
--output <file>        also write the JSON report to a file
--json-pretty          pretty-print JSON
```

</details>

---

## Reference

<details>
<summary><strong>Form test result — reason codes</strong></summary>

| Code | Meaning |
|------|---------|
| `CONTACT_PAGE_NOT_FOUND` | No contact page candidate found |
| `CONTACT_PAGE_AMBIGUOUS` | Multiple candidates, low confidence |
| `FORM_NOT_FOUND` | No form of any kind on the page |
| `NON_CONTACT_FORM_FOUND` | A form exists but didn't score as a contact form |
| `LOW_CONFIDENCE_FORM` | Only a single-input form matched — not filled, shown for you to confirm |
| `THIRD_PARTY_EMBED_FORM` | A hosted embed is present — exists, not auto-testable |
| `FORM_AMBIGUOUS` | Multiple forms, low confidence |
| `BLOCKED_BY_HOST` | The host refused every request — a hosting-provider IP block, not a site fault |
| `CAPTCHA_DETECTED` | CAPTCHA widget found — aborted |
| `ANTI_BOT_DETECTED` | Anti-bot challenge page — aborted |
| `REQUIRED_FIELDS_UNSUPPORTED` | Could not fill required fields |
| `MULTI_STEP_FORM_DETECTED` | Multi-step form found but couldn't be filled this run |
| `SUBMIT_HELD_INCOMPLETE` | Multi-step form filled, but live submission held (not a clean/complete entry) |
| `SAFE_MODE_NO_SUBMIT` | Safe mode — filled but not submitted |
| `DETECT_ONLY` | Detect-only mode — no interaction |
| `SUBMIT_FAILED` | Submit click failed |
| `VALIDATION_ERROR` | Form showed validation errors |
| `SERVER_ERROR` | The site's own backend returned 5xx — the form is broken, nothing delivered |
| `SUBMISSION_BLOCKED_BY_ANTISPAM` | An anti-spam plugin or WAF rejected the submission (402/403/429) |
| `PROXY_REJECTED_POST` | The outbound proxy, not the site, refused to forward the submission |
| `NO_REDIRECT_NO_SUCCESS` | Submitted but no success signal |
| `INLINE_SUCCESS_ONLY` | Inline success message detected |
| `THANK_YOU_REDIRECT` | Redirected to a thank-you URL |
| `PASS` | Full success |
| `ERROR` | Unhandled exception |

**Final status** rolls these up into `pass` · `warn` · `fail` · `error`.

</details>

<details>
<summary><strong>Change severity tiers</strong></summary>

| Severity | Meaning |
|----------|---------|
| `low` | Cosmetic — meta description, minor text edits, script noise, load time |
| `medium` | Likely intentional — title/H1 changed, CTA text changed, page added |
| `high` | Material — form field added/removed, page disappeared, robots meta changed |

</details>

---

## Contributing

Branch off `main`, keep every check green, and open a pull request. **[CONTRIBUTING.md](CONTRIBUTING.md)** covers the whole flow: tracking, branching, the checks CI runs, commit rules, docs, production data, secrets and pull-request format. To report a security problem, follow **[SECURITY.md](SECURITY.md)** rather than opening an issue.

---

## Responsible use

FormPing is for **authorized testing only**.

- Use it only on sites you own, operate, or have written permission to test.
- Never target third-party sites without permission, and never use it to spam or flood forms.
- In live mode, submissions send **real** messages — use a test address you control.

By design it never attempts to bypass a CAPTCHA or an anti-bot challenge: when one is detected the run stops and reports it.

---

## License

FormPing is proprietary software. Copyright © 2026 Apexure. All rights reserved — see [LICENSE](LICENSE).
