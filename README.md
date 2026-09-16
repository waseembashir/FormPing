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

</div>

---

## Contents

- [What FormPing is](#what-formping-is)
- [The web app](#the-web-app)
- [How form testing works](#how-form-testing-works)
- [Website change monitoring](#website-change-monitoring)
- [Client status pages](#client-status-pages)
- [Roles & access](#roles--access)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Command-line engine](#command-line-engine)
- [Reference](#reference)
- [Contributing](#contributing)
- [Responsible use](#responsible-use)

---

## What FormPing is

FormPing is two things that share one engine:

1. **A web app** — the day-to-day product. Organize clients and their URLs into **projects**, run and schedule contact-form tests, monitor uptime / SSL / content changes, and hand each client a live, non-technical **status page**.
2. **A command-line engine** — the same detection and monitoring logic as a scriptable CLI, for one-off runs, batches, and CI.

Everything the app shows is built on top of the engine, so a result means the same thing whether it came from a scheduled monitor or a terminal command.

---

## The web app

The app is organized around **Projects** (a client and their URLs), with two tool areas — **Contact Forms** and **Site Health** — plus Team and Docs.

| Area | What it does |
|------|--------------|
| **Projects** | Group a client's URLs into a project and see their form, uptime and SSL health at a glance. URLs you've tested or monitored but not grouped yet surface in an **Unassigned** bucket to assign or dismiss, so nothing is ever invisible. |
| **Contact Forms** | **Form Tester** — run an on-demand test against a URL. On a whole-site run it finds *every* form across the site and reports them form-by-form (summary + a tab per form), each with a screenshot of the form it matched; results and the mode they were run in persist across refreshes. **Form Scheduler** — recurring form tests (daily by default) with alerts when a form changes or breaks. |
| **Site Health** | **Uptime & SSL** — availability plus certificate and domain expiry monitoring. **Content Changes** — track content, SEO, form and script changes over time, with an optional AI summary of each diff. |

Both schedulers carry a **Re-run** button: it checks that URL immediately in the monitor's own mode and adds one tagged row to its history, while leaving the schedule untouched — no reschedule, no alert, no change to the stored result or the uptime figure a monitor reports.
| **Status pages** | A live, client-safe health page per client (and per single URL), shareable with no login. An internal, richer version is available to the team. |
| **Team** | Manage who can do what (roles), and triage bug reports submitted from within the app. Every project keeps an **activity log** — who opened it, who added or removed a URL, who shared it, and when — readable by owners and admins. |

Every action that changes or removes data is confirmed first, and the copy always makes clear what will happen — especially whether a form test will actually **submit**.

---

## How form testing works

Point the engine at a URL and it does what a careful person would: find the forms, work out what each one is for, fill the ones that capture leads, and — in Live mode — actually send one and watch what the site does with it. Then it reports what happened, in plain language, with a picture of what it matched.

### 1. Finding the forms

By default a run covers the **whole site**. It discovers the contact page using deterministic heuristics (path matching + anchor-text scoring), and when a site doesn't use a conventional contact slug, a **content-driven fallback** scans the homepage, navigation and sitemap — rendering pages in a real browser when the site is JavaScript-heavy or blocks lightweight fetches — and picks the page that actually holds a contact form, **including one hidden inside a multi-step widget**. The form is found regardless of the page's URL or how it's built.

Alongside that, the engine **inventories every other reachable page** and records **every** form it finds, each with its own live source URL. Only forms a visitor can actually see are reported — a hidden modal copy of a form is not listed as a second form — and a third-party form counts only when its embed is really on the page: a provider's tracking script on its own is evidence the site uses that vendor, not that a form is embedded. Each is classified — **contact, newsletter, search, login, or another lead form** such as a rental or demo request — so the report can say what a form is *for*, not just that one exists. A form that repeats across the site (a header search, a footer newsletter) is recognised as the same form, shown once, and marked **global**.

For each form it reports the source page, native vs third-party embed (and which provider, iframe vs script), field count and names, single- vs multi-step, whether **that form** carries a CAPTCHA, and any hidden **UTM / click-id tracking** it captures — or flags a lead form that captures none, since those leads won't carry a campaign source.

### 2. Filling them

**Every lead form gets filled** with configurable test data — not just the main contact form. Search, newsletter and login inputs are recognised as utility forms and left untouched.

**Multi-step wizards are walked**, step by step (fill → Next → fill) until the submit control is reached, even when the steps live outside the `<form>` element.

### 3. Submitting — Live mode only

In Live mode the primary contact form is submitted and the engine watches for a thank-you redirect or an inline success message. Every other lead form is filled but **not** sent; each can be submitted on demand from its own panel, behind a confirmation.

Two deliberate brakes: a multi-step form is submitted **only if the run cleanly reached the final step and filled an email**, so a partial walk never drops a junk entry into someone's inbox — and CAPTCHA or anti-bot protection is **never bypassed**. If one is hit, the run stops and says so.

### 4. Showing you what it matched

Every matched form is **photographed** — the form *and the heading above it*, since "Request a demo" is what identifies a form and a picture of bare input boxes doesn't. Cookie banners, chat bubbles and sticky headers are hidden for the shot, so the evidence is the form rather than whatever was floating over it. The form's address carries its anchor where the page provides one, so the link opens scrolled to the form.

The images are stored server-side and loaded only when you open a form's tab, so they never slow a run down or bloat what the browser keeps. Each one is captured **before** anything is filled in, so a screenshot never contains test data, and its URL carries a random component so it can't be guessed from a site's address. Re-testing a URL replaces its screenshots rather than adding to them, and deleting the URL or its project deletes them too.

### 5. Saying when it isn't sure

A weak match is reported as a weak match. If the only form on a page has a single input, the engine **stops rather than filling it** and asks whether that's really your contact form — that shape is a search box or an email sign-up far more often than a way to reach you. A form accepted only because Landing-page mode asserted it's on this page is still tested, but presented as *detected*, never as a confident green pass.

Counts and claims are scoped to the form itself: a **CAPTCHA is only reported on the form carrying the widget** (bot-protection code elsewhere on the page is described as exactly that), and a site-wide search input swept in with a form is **listed but not counted**, so the field count matches the form in front of you.

### Test modes

| Mode | Behavior |
|------|----------|
| `detect-only` | Find the contact page and form; don't fill or submit. |
| `safe` | Find the page and form, fill the fields — **never submit**. |
| `live` | The full flow **including submission** — only on sites you're authorized to test. |

The **app** defaults to `detect-only` in both the Form Tester and the Form Scheduler: the out-of-the-box behaviour puts nothing into a stranger's form, and Safe and Live are deliberate choices. The **CLI** still defaults to `safe` (`--mode`), since it's invoked explicitly and scripts depend on that behaviour.

**Landing-page mode** skips discovery and the site crawl, testing the form on the exact URL given — for standalone landing pages with an inline form and no separate `/contact` page. Detection is also more lenient there: since you've asserted the form is on this page, the best-scoring form is accepted even if it wouldn't clear the usual contact-form threshold (a quiz, assessment or booking form is still a real form) — and the result says plainly that it's a low-confidence match.

### When a form isn't submitted, the result says *why*

- **`FORM_NOT_FOUND`** — genuinely nothing: no native form and no known embed.
- **`NON_CONTACT_FORM_FOUND`** — a form exists but isn't a contact form. The result names what it actually is (a search box, a newsletter sign-up) and shows the screenshot.
- **`LOW_CONFIDENCE_FORM`** — the only match was a single-input form, which reads like a search box or an email sign-up. Nothing was filled; the screenshot is shown so you can confirm or rule it out.
- **`SERVER_ERROR`** — the form was filled and submitted, and the site's *own* endpoint answered with a 5xx. The form isn't misconfigured and the data wasn't rejected: the code behind it crashed, so every real enquiry is being lost too. Reported ahead of any error text on the page, because a status code is evidence where page text is a guess.
- **`THIRD_PARTY_EMBED_FORM`** — a hosted embed (Typeform, HubSpot, Calendly, Jotform, Tally, and similar) is present. It's detected and named so you can verify it by hand, even though it can't be auto-filled across origins.
- **`MULTI_STEP_FORM_DETECTED`** — a multi-step ("Next"-style wizard) contact form was found but couldn't be filled this run (its steps/fields weren't reachable). Detected, not broken. When the wizard *can* be walked, the run reports `SAFE_MODE_NO_SUBMIT` (safe) or a submit outcome (live) instead.
- **`SUBMIT_HELD_INCOMPLETE`** — a multi-step form was filled through its steps, but the Live submission was deliberately held because the run didn't cleanly reach the final step or fill an email.

The same facts, in the same words, appear on the Form Tester result card, each Form Scheduler run, and the per-URL dashboard — one engine, one story. A scheduled check stores exactly what a manual test stores, so watching a URL makes its dashboard richer, never thinner; when a URL has both, the page shows the more recent one and says which it was.

### Notifications carry what the run found, and link to where the rest is

A Slack message is a ping, not the record — incoming webhooks throttle, and a message nobody reads is no better than one that says nothing. So an alert carries a short `facts` line built from the run itself: the embed provider behind a third-party form, the field count, the page it was found on, how many forms share that page, whether a CAPTCHA is present, and the engine's own hedge when it wasn't confident (FR-73). Most useful first, capped at five facts and ~240 characters, trimmed by whole facts rather than mid-phrase.

Every alert — Form Watch, Site Watch and the Change Monitor — is assembled the same way: `facts` for what was found, `scope` for what was looked at, and `action` for what a person must still do by hand *and why we could not do it*. Scope matters as much as facts: a whole-site form search reports the form it judged to be the main one, an uptime check covers one URL and not the pages behind it, and a change report compares only the watched pages. Each of those results is easy to over-read, so each states its own limits.

Severity is about how a result should READ, not merely how bad it is. There are four: `critical`, `warning`, `notice` and `info`, matched to the app's own `--fp-danger` / `--fp-warn` / `--fp-info` / `--fp-ok` tokens so a Slack message and a card never disagree. `notice` exists for the case that caused this: a recognised third-party form is not a success — nothing was submitted — and not a fault either, so it wears neither a green tick nor a red bar. The "needs a manual check" line carries the warning instead, and always states the reason.

Internal identifiers never appear. A reason code like `THIRD_PARTY_EMBED_FORM` is an internal enum; the verdict label already says it in English.

The "See the full detail" link resolves to the per-URL dashboard, built with the same `matchKey` + `encodeUrlKey` pair the app's own links use, so the two cannot drift. A unit test walks every path the builder can emit against the actual route files under `ui/src/app` — comparing a link builder to a list written from memory is how it came to point at a route that never existed.

### A failed check explains itself, and retries at a sensible interval

When a check can't produce an answer, the reason is carried as a *kind* — `unreachable`, `rate_limited`, `not_published`, and so on — from the moment it happens. The raw message (`fetch failed`, a TLS socket error, an RDAP status) stays on the result for the server log, and no user surface renders it: the dashboard, the monitor card and the Slack alert all phrase the kind instead.

That distinction also drives the retry. A domain expiry is re-read at most every 12 hours, because it changes once a year and public RDAP endpoints rate-limit. But a registry that was briefly unreachable is asked again in 30 minutes, while a registry that doesn't publish expiry dates at all — true of many country domains — keeps the long interval, since asking twice can't make the field appear. A transient failure also keeps showing the expiry we already know, marked as not refreshed, rather than replacing a good answer with an error.

### A result that couldn't be stored is reported, not painted over

A monitor's run record and the summary on its card are separate writes to separate tables. If the run record is refused — a missing column after a partial migration, a database blip — the summary must not be written anyway, or the card reports a fresh healthy check above a history that doesn't contain it.

So writes are sorted into two kinds. **Essential** writes (the run record, the durable per-URL result, the daily rollup behind the uptime figures) report whether they landed; a failure is logged at `error` level and the monitor keeps the last result it can actually prove, advancing only its retry time. The card then says *"The last check could not be saved"* rather than showing stale figures as current. **Best-effort** writes (screenshots, Slack posts, the activity log, history pruning) still fail quietly on purpose, and say so where that choice is made.

On boot a schema guard selects the columns each critical table is expected to have and logs a loud, unmissable error if any are missing — the condition that caused this, found in seconds rather than hours. It never stops the server: a monitoring tool that refuses to start is worse than one running with a stale column.

---

## Website change monitoring

The monitor snapshots a small set of important pages (home, about, pricing, services, contact, thank-you) and compares them over time:

- **Content** — H1 changes, major text deltas, CTA/button text.
- **SEO** — title, meta description, canonical, robots.
- **Forms** — a field added or removed, a field becoming required, a type change.
- **Technical** — new or removed tracking scripts, load-time spikes.
- **Site-level** — a page appears or disappears.

Each change is graded **low / medium / high** so you can tell a cosmetic tweak from a material one, and an optional AI summary turns the diff into a readable paragraph. It's cheap by default — plain HTML fetching is used for parsing, and a full browser only launches when screenshots are requested.

---

## Client status pages

One presentation powers both a public and an internal view, curated so nothing technical can reach a client:

- **Public status page** — client-safe only: the page URL, overall status, uptime %, uptime history, SSL validity, and whether the contact form is working. No response times, reason codes, or content-change detail.
- **Internal dashboard** — the full picture for the team: response-time and uptime charts, HTTP status, check frequency, domain expiry, and the content-change timeline (each run expands to show what changed).

Content diffs are internal-only by design — "84 changes detected" would alarm a client about what is often their own team's intentional edits. Both views carry a **Today / 7 days / 30 days / All-time** filter.

---

## Roles & access

Signing in is limited to approved domains; on top of that, each person has a role that decides what they can do:

| Role | Can |
|------|-----|
| **Owner** *(exactly one)* | Everything, plus manage admins and transfer ownership. |
| **Admin** | Full app, including deleting projects and managing members and viewers. |
| **Member** *(default)* | Add URLs, run and edit monitors, rename and edit projects, view everything. |
| **Viewer** | Read-only. |

Enforcement is **server-side on every write** — the interface hides what a role can't do, but the server is the real gate. Roles are read fresh on each request, so a change takes effect immediately. There is always exactly one owner, and ownership is transferred (never left empty), so the app can't be locked out.

---

## Tech stack

- **Web app** — Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS. A single design-token system drives the whole UI in one coherent dark theme.
- **Engine** — TypeScript, [Playwright](https://playwright.dev) for real-browser form testing, and lightweight HTML parsing for fast change detection.
- **Data** — PostgreSQL for structured data; captured page snapshots are kept on disk for diffing; form screenshots go to object storage, so only a URL ever reaches the browser.
- **Testing** — [Vitest](https://vitest.dev) for the engine's detection and analysis logic, and [Playwright](https://playwright.dev) end-to-end tests for the web app.

---

## Project structure

```
formping/
├── src/            # the CLI engine — form detection, testing, change monitoring
├── tests/          # engine unit tests (Vitest)
└── ui/             # the Next.js web app (App Router)
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

**Web app:**

```bash
cd ui
npm install
npm run dev       # http://localhost:3000
```

**End-to-end tests** (Playwright) run the web app in a browser. They're hermetic — auth, database, and Slack are disabled for the run, so they need no secrets and touch no real services:

```bash
cd ui
npx playwright install chromium   # one-time browser download
npm run test:e2e                  # boots the app and runs the e2e suite
```

Configuration (auth, database, and optional integrations) is supplied through environment variables — copy `.env.example` and fill in your own values.

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

1. Branch off `main`.
2. Make your change; keep the engine and the web app type-clean (`npm run lint` in each) and green — the engine unit tests (`npm test` at the root) **and** the web app's end-to-end tests (`npm run test:e2e` in `ui/`) must pass before you commit.
3. Open a pull request describing what changed and why.

**CI runs on every push and PR** (GitHub Actions): the engine's typecheck + unit tests and the web app's typecheck + Playwright e2e must all be green before merge.

The codebase leans on a shared component kit and a single set of design tokens for the UI, and deterministic, well-tested heuristics in the engine — please match the surrounding style rather than introducing parallel patterns.

---

## Responsible use

FormPing is for **authorized testing only**.

- Use it only on sites you own, operate, or have written permission to test.
- Never target third-party sites without permission, and never use it to spam or flood forms.
- In live mode, submissions send **real** messages — use a test address you control.

It deliberately cannot bypass CAPTCHA or anti-bot protections, doesn't handle file-upload fields, and may miss forms that use unusual, non-standard submit mechanisms.
