'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMe } from '@/lib/auth/useMe';

/**
 * Public documentation / knowledge center (FR-33).
 *
 * Reachable WITHOUT login (allow-listed in middleware) so anyone evaluating
 * FormPing can read it. It is PRODUCT documentation only — deliberately carries
 * no infrastructure, storage, env, or account/ops detail. Self-contained chrome
 * (its own header + footer); the app header/footer are suppressed on /docs.
 *
 * Layout: a grouped, sticky sidebar with scroll-spy highlighting + a readable
 * content column. Tailwind only (no styled-jsx) so styles are server-rendered.
 */

interface NavItem { id: string; label: string; }
interface NavGroup { group: string; items: NavItem[]; }

const NAV: NavGroup[] = [
  { group: 'Introduction', items: [
    { id: 'what', label: 'What is FormPing' },
    { id: 'why', label: 'Why use it' },
    { id: 'organized', label: 'How it’s organized' },
  ] },
  { group: 'Contact Forms', items: [
    { id: 'form-tester', label: 'Form Tester' },
    { id: 'form-scheduler', label: 'Form Scheduler' },
  ] },
  { group: 'Site Health', items: [
    { id: 'uptime-ssl', label: 'Uptime & SSL' },
    { id: 'content-changes', label: 'Content Changes' },
  ] },
  { group: 'Projects', items: [
    { id: 'projects', label: 'Projects & Unassigned' },
    { id: 'status-pages', label: 'Client status pages' },
  ] },
  { group: 'Team', items: [
    { id: 'access-roles', label: 'Access & roles' },
    { id: 'alerts', label: 'Alerts' },
  ] },
  { group: 'Help', items: [
    { id: 'faq', label: 'FAQ' },
  ] },
];

const ALL_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));

export default function DocsContent() {
  const me = useMe();
  const [active, setActive] = useState<string>('what');
  const [menuOpen, setMenuOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const signedIn = Boolean(me.email);

  // Scroll-spy: highlight the section currently nearest the top of the viewport.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const els = ALL_IDS.map((id) => root.querySelector<HTMLElement>(`#${id}`)).filter(Boolean) as HTMLElement[];
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -68% 0px', threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-ground text-ink">
      {/* ── Self-contained header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-ground/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
          <Link href="/welcome" className="flex items-center gap-2.5" aria-label="FormPing home">
            <BrandMark />
            <span className="flex items-baseline gap-2">
              <span className="text-base font-bold text-ink">FormPing</span>
              <span className="hidden text-xs font-medium text-ink-faint sm:inline">Docs</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="rounded-lg border border-line-strong p-2 text-ink-secondary lg:hidden"
              aria-label="Toggle contents"
              aria-expanded={menuOpen}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
            {signedIn ? (
              <Link href="/" className="rounded-lg bg-gradient-to-b from-accent to-accent-strong px-3.5 py-2 text-xs font-semibold text-white shadow ring-1 ring-accent-soft/20 hover:brightness-110">
                Open app →
              </Link>
            ) : (
              <Link href="/login" className="rounded-lg bg-gradient-to-b from-accent to-accent-strong px-3.5 py-2 text-xs font-semibold text-white shadow ring-1 ring-accent-soft/20 hover:brightness-110">
                Sign in →
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:pt-10">
        <div className="lg:grid lg:grid-cols-12 lg:gap-10">
          {/* ── Sidebar nav (grouped + scroll-spy) ──────────────────────── */}
          <aside className={`${menuOpen ? 'block' : 'hidden'} lg:block lg:col-span-3`}>
            <nav className="lg:sticky lg:top-24 mb-8 rounded-xl border border-line bg-panel/40 p-3 lg:mb-0">
              {NAV.map((grp) => (
                <div key={grp.group} className="mb-3 last:mb-0">
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{grp.group}</p>
                  <ul className="space-y-0.5">
                    {grp.items.map((it) => {
                      const on = active === it.id;
                      return (
                        <li key={it.id}>
                          <a
                            href={`#${it.id}`}
                            onClick={() => setMenuOpen(false)}
                            aria-current={on ? 'true' : undefined}
                            className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                              on ? 'bg-accent/12 font-medium text-accent-soft ring-1 ring-accent/25' : 'text-ink-muted hover:bg-panel hover:text-ink'
                            }`}
                          >
                            {it.label}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {/* ── Content ─────────────────────────────────────────────────── */}
          <div ref={contentRef} className="lg:col-span-9">
            <div className="max-w-3xl">
              {/* Hero */}
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">FormPing Docs</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Know your clients’ sites are working — and prove it.</h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
                A practical guide to what FormPing does, why it’s useful, and how to use every part of it — contact-form testing, uptime &amp; SSL, content-change monitoring, projects, and shareable client status pages.
              </p>

              {/* ══ Introduction ══ */}
              <Section id="what" title="What is FormPing">
                <P>FormPing is a monitoring tool for agencies. It continuously checks that your clients’ websites are actually working — their <strong className="text-ink">contact forms submit</strong>, their <strong className="text-ink">sites stay up</strong>, their <strong className="text-ink">SSL certificates are valid</strong>, and their <strong className="text-ink">pages haven’t silently changed</strong> — and it pings you the moment something breaks.</P>
                <P>Everything lives in one place: a dashboard per client, and a clean status page you can hand to the client. You run it in the browser — nothing to install.</P>
              </Section>

              <Section id="why" title="Why use it">
                <P>When a client’s contact form quietly breaks or their site goes down, <strong className="text-ink">leads stop arriving and no one notices</strong> — until the client asks why business went quiet. FormPing closes that gap:</P>
                <UL>
                  <LI><strong className="text-ink">Catch problems first.</strong> You hear about a broken form or an expiring certificate before the client does — so you look proactive, not caught out.</LI>
                  <LI><strong className="text-ink">No lead falls through.</strong> Scheduled checks submit a real test entry, so you know the form actually delivers to the inbox — not just that it looks fine.</LI>
                  <LI><strong className="text-ink">One board for every client.</strong> Forms, uptime, SSL, domain expiry, and content changes across all clients in one view.</LI>
                  <LI><strong className="text-ink">Show your work.</strong> A live, login-free status page per client makes the monitoring visible and builds trust.</LI>
                </UL>
              </Section>

              <Section id="organized" title="How it’s organized">
                <P>FormPing is built around <strong className="text-ink">Projects</strong> (a client plus their URLs), and two tool areas:</P>
                <Table
                  headers={['Area', 'What it answers']}
                  rows={[
                    [<b key="0">Projects</b>, 'Group a client’s URLs; see their form, uptime, and SSL health together — and share a status page.'],
                    [<b key="0">Contact Forms</b>, 'Is the client’s contact form working? On-demand (Form Tester) and scheduled (Form Scheduler).'],
                    [<b key="0">Site Health</b>, 'Is the client’s site up, secure, and unchanged? Uptime & SSL, plus Content Changes.'],
                  ]}
                />
                <Note>Any URL you test or monitor automatically appears in Projects — under its client, or in an <strong>Unassigned</strong> bucket if you haven’t grouped it yet. Nothing you’ve touched is ever invisible.</Note>
              </Section>

              {/* ══ Contact Forms ══ */}
              <Section id="form-tester" title="Form Tester" eyebrow="Contact Forms">
                <P>Run an <strong className="text-ink">instant check</strong> on any URL: FormPing finds the contact page, locates the form, fills it with test data, optionally submits it, and confirms the success (thank-you) state. It finds the form even when the contact page has an unusual name or sits on the homepage, when the site is built with JavaScript, or when the form is split across multiple steps — not just a simple form at a standard <code>/contact</code> address.</P>
                <Table
                  headers={['Mode', 'What it does']}
                  rows={[
                    [<Code key="0">Detect</Code>, 'Just confirms a form is there. Nothing filled, nothing sent. The default.'],
                    [<Code key="0">Safe</Code>, 'Fills the form with test data but does NOT submit.'],
                    [<Code key="0">Live</Code>, 'Actually submits — confirms the form delivers. Use only on sites you’re authorized to test.'],
                  ]}
                />
                <P>Each result is a clear verdict — <strong className="text-ink">healthy</strong>, <strong className="text-ink">needs attention</strong>, or <strong className="text-ink">failing</strong> — with a plain-English reason. It also shows what was found: the page the form is on, whether it’s a <strong className="text-ink">native</strong> in-page form or a <strong className="text-ink">third-party</strong> one (Typeform, HubSpot, …), how many fields and their names, and whether it’s a <strong className="text-ink">single- or multi-step</strong> form. CAPTCHA and anti-bot protection are detected and reported, never bypassed.</P>
                <Note>
                  <strong>See the form we found.</strong> Every form comes with a <strong>picture of it, headline and all</strong> — and cookie banners or chat bubbles are taken out of the shot, so you see the form and not what was sitting on top of it. Its address opens the page right at that form, so you can check in a second that we tested the form you meant instead of taking our word for it.
                </Note>
                <Note>
                  <strong>We tell you when we’re not sure.</strong> If the only form on a page has a single box to type in, that’s usually a search bar or a newsletter sign-up rather than a way to contact you — so we don’t fill it and call it healthy. We show you the picture and ask. And a <strong>CAPTCHA is only reported on the form that actually has one</strong>: if the protection sits elsewhere on the page, we say that instead, because it doesn’t tell you whether your form is protected.
                </Note>
                <Note>
                  <strong>Landing-page mode.</strong> By default the tester searches your site to find the contact form (and tells you which page it tested if that differs from the URL you entered). Turn on <strong>Landing page</strong> when you want to test the exact URL you gave — a standalone landing page, or when the form is a quiz, assessment, or booking style that a whole-site search might skip. It tests only that page, and is lenient enough to accept those non-standard forms.
                </Note>
                <Note>
                  <strong>It tells you <em>why</em>, not just “not found”.</strong> When no contact form is submitted you get a clear outcome: <strong>No form on the page</strong>; <strong>Found a form — but not a contact form</strong> (with which contact fields are missing); <strong>Third-party embed found</strong> — a hosted Typeform, HubSpot, Calendly, Jotform, Tally, or GoHighLevel form that genuinely exists but can’t be auto-submitted across origins, so it’s named for you to check by hand; or <strong>Multi-step form found</strong> — a “Next”-style wizard. FormPing walks the steps and fills them; in Live mode it only submits when the walk cleanly reaches the end and enters an email, otherwise it fills through and holds the submission so no partial entry is sent.
                </Note>
                <Note>Your results (and the URL) stay on screen when you switch tabs or refresh — and so does the mode you ran them in, so what you’re reading always matches how it was tested. <strong>Clear</strong> wipes the view but keeps the saved result that Projects uses — “clear the view, keep the data” — and returns the mode to Detect. To keep watching a URL over time, set it up in the <strong>Form Scheduler</strong>.</Note>
                <Note><strong>Leave the tab and the test keeps going.</strong> A run doesn’t stop because you looked at something else. A small notice appears telling you it’s still going and which tab to go back to, and the result is waiting for you when you return.</Note>
              </Section>

              <Section id="form-scheduler" title="Form Scheduler" eyebrow="Contact Forms">
                <P>The Scheduler re-tests a form <strong className="text-ink">automatically on a fixed schedule</strong> and alerts you when it changes or breaks — so you catch a silently-broken form within one cycle, instead of when leads dry up. It’s the Form Tester on a timer, tracking the result over time.</P>
                <UL>
                  <LI>Add a URL, a check frequency (daily by default), and a mode. The first check runs straight away — the monitor opens its own history and shows you that result as soon as it lands, so you’re not left wondering.</LI>
                  <LI><strong className="text-ink">Re-run</strong> checks that URL right now, in the same mode, without disturbing anything: your schedule, its next run and its health figure all stay exactly as they were. The result is added to the history below, marked <strong>Re-run</strong> so you can tell it apart from the scheduled checks.</LI>
                  <LI><strong className="text-ink">Pause / Resume</strong> any time (keeps its history), or <strong>Delete</strong> to remove it. Each card shows a recent-runs trend — % healthy plus a sparkline, counting the scheduled runs only.</LI>
                  <LI>Each run records the verdict, the reason, and the same details as the Tester — the form found, its type, field count, and single/multi-step — plus what changed since last time and a suggested next action, and sends a Slack alert.</LI>
                </UL>
                <Note tone="warn"><strong>Live mode submits a real entry every cycle</strong>, which lands in the client’s inbox/CRM. Use it only on forms you’re authorized to monitor — the test data identifies it as a health check.</Note>
              </Section>

              {/* ══ Site Health ══ */}
              <Section id="uptime-ssl" title="Uptime & SSL" eyebrow="Site Health">
                <P>Monitors three things a form check can’t catch — a site going <strong className="text-ink">down</strong>, an <strong className="text-ink">SSL certificate</strong> quietly expiring, and the quiet killer, a <strong className="text-ink">domain registration lapsing</strong> entirely.</P>
                <Table
                  headers={['Check', 'What you get']}
                  rows={[
                    [<b key="0">Uptime</b>, 'Up / down / reachable-but-challenged, with status code and response time.'],
                    [<b key="0">SSL</b>, 'Days until the certificate expires.'],
                    [<b key="0">Domain</b>, 'Days until the domain registration expires.'],
                  ]}
                />
                <P>Alerts are <strong className="text-ink">change-based</strong>, never a ping every cycle: <strong>down</strong> after two checks in a row fail (so a brief blip doesn’t cry wolf) and again when it recovers; <strong>SSL</strong> and <strong>domain</strong> as each threshold is crossed (30 / 14 / 7 days, then expired), resetting on renewal. While a site stays down — or a certificate/domain stays expired — a <strong>reminder repeats every few hours</strong> until it’s fixed, so an ongoing problem doesn’t go quiet.</P>
                <P>Each monitor opens with a plain reading of where it stands — <strong>Up · responding normally</strong>, <strong>Down · we can’t reach it right now</strong> — followed by its certificate and domain status, an uptime % and a recent-checks sparkline. Above the list, a summary counts how many sites are up, down, challenged or have a certificate expiring soon, so you can see whether anything needs you without reading every card.</P>
                <UL>
                  <LI>Adding a URL takes you straight to it and shows the first check as soon as it finishes.</LI>
                  <LI><strong className="text-ink">Re-run</strong> checks the site right now and shows you the real result — live response time, status code and certificate — without disturbing your schedule, its next check, its uptime figure, or triggering any alert. It’s added to the history marked <strong>Re-run</strong>.</LI>
                  <LI><strong className="text-ink">Pause / Resume</strong> any time, keeping the history.</LI>
                </UL>
                <Note>A few heavily-protected sites return a challenge page to automated checks — FormPing classifies that as <em>reachable (challenged)</em>, not <em>down</em>, so it never cries wolf.</Note>
              </Section>

              <Section id="content-changes" title="Content Changes" eyebrow="Site Health">
                <P>Takes a <strong className="text-ink">snapshot</strong> of a site’s key pages, then later compares the current pages against the last snapshot and reports what changed — so a “small tweak” never silently breaks a page or its SEO.</P>
                <UL>
                  <LI>Detects meaningful <strong className="text-ink">content, SEO, form, and script</strong> changes (e.g. a heading rewritten, a meta description dropped, a form field removed, a tracking script added).</LI>
                  <LI>Tracking is <strong className="text-ink">site-level</strong> — it walks a whole site from its homepage, so URLs on the same site share one history.</LI>
                  <LI>Every check shows up on the project’s <strong>change timeline</strong>; expand a row to see the exact page-by-page before/after.</LI>
                </UL>
                <Note>Content changes are for your team only — they never appear on a client’s public status page.</Note>
              </Section>

              {/* ══ Projects ══ */}
              <Section id="projects" title="Projects & Unassigned" eyebrow="Projects">
                <P>A <strong className="text-ink">Project</strong> is a client and their URLs. Open one to see every monitor for that client — form health, uptime, SSL, and content changes — in a single view, plus a per-URL <strong>Dashboard</strong> for any one page.</P>
                <UL>
                  <LI>Any URL you’ve tested or monitored but not yet grouped shows up in an <strong className="text-ink">Unassigned</strong> bucket, with <strong>Assign to project</strong> and <strong>Dismiss</strong> actions — so nothing is a dead end.</LI>
                  <LI><strong className="text-ink">Remove</strong> a URL from a project → if it has test/monitor activity it drops to <strong>Unassigned</strong> keeping its data and monitors; if it has none yet, it simply drops off (nothing to keep). <strong>Delete</strong> a URL (or a whole project) is a complete, confirmed, irreversible removal of its monitors and results. Removing and deleting are limited to <strong className="text-ink">Admins &amp; Owners</strong> — Members can add URLs but not take them out.</LI>
                  <LI>Each project can hold a <strong>contact</strong> — who to notify for that client.</LI>
                  <LI>Each project shows <strong>who added it and who last edited it</strong> (with the time), so accountability is clear at a glance.</LI>
                </UL>
              </Section>

              <Section id="status-pages" title="Client status pages" eyebrow="Projects">
                <P>Publish a <strong className="text-ink">clean, client-safe status page</strong> you can share with the client — a simple “is my site healthy?” view with none of the internal detail.</P>
                <UL>
                  <LI>It shows the page URL, overall status, each site up/down, a 30-day uptime history, uptime % for 24h / 7d / 30d, whether the contact form is working, and SSL validity. <strong className="text-ink">No reason codes, modes, notes, response times, or content-change detail</strong> ever appear.</LI>
                  <LI>You get a <strong>private link</strong> that opens with <strong className="text-ink">no login</strong>. <strong>Regenerate</strong> it to replace the old one, or <strong>Turn off</strong> to disable it — a disabled link just shows a “not found” page.</LI>
                  <LI>Each URL can also have its <strong>own</strong> client share link (just that one page), generated and revoked independently.</LI>
                  <LI>Only projects where you’ve explicitly created a link are ever public — nothing is published unless you create one.</LI>
                </UL>
              </Section>

              {/* ══ Team ══ */}
              <Section id="access-roles" title="Access & roles" eyebrow="Team">
                <P>The app itself is private — sign-in is limited to your team’s authorized accounts. On top of who can get in, every user has a <strong className="text-ink">role</strong> that controls what they can do:</P>
                <Table
                  headers={['Role', 'Can']}
                  rows={[
                    [<b key="0">Owner</b>, 'Everything — plus manage admins and transfer ownership. Exactly one exists.'],
                    [<b key="0">Admin</b>, 'Full app, including deleting projects and managing members/viewers.'],
                    [<b key="0">Member</b>, 'Add URLs, create/run/edit monitors, rename & edit projects, view everything. Can’t remove or delete URLs or projects, and no user management. (The default.)'],
                    [<b key="0">Viewer</b>, 'Read-only.'],
                  ]}
                />
                <P>Permissions are enforced for real — not just hidden buttons. A viewer genuinely can’t make changes, and only Admins &amp; Owners can remove or delete URLs and projects. Role changes take effect immediately. Admins and the Owner get a <strong>Team</strong> page to manage users and roles.</P>
              </Section>

              <Section id="alerts" title="Alerts" eyebrow="Team">
                <P>FormPing pings your team’s <strong className="text-ink">Slack channel</strong> when something needs attention — a scheduled form run, a site going down, or a certificate/domain nearing expiry. Each alert carries the URL, what happened, and a suggested next step, then links to the full detail in the app.</P>
                <UL>
                  <LI>You won’t be spammed — a brief blip pings once, and while a problem stays unresolved (a site down, or an expired certificate/domain) you get a <strong className="text-ink">spaced reminder</strong> every few hours until it recovers. Everything is paced so it never floods your channel, even if a check retries or restarts.</LI>
                  <LI>Alerts are <strong className="text-ink">internal-only</strong> — they go to your team, never to a client.</LI>
                  <LI>Slack delivery is optional and set up by an admin; if it isn’t configured, checks still run and record normally — only the Slack ping is skipped.</LI>
                </UL>
              </Section>

              {/* ══ Help ══ */}
              <Section id="faq" title="FAQ" eyebrow="Help">
                <Faq q="Is my client data private?">
                  Yes. The app and every piece of client data sit behind login. The only things that are ever public are (1) these product docs and (2) a client status page that <em>you</em> explicitly choose to publish — and that page shows only reassuring, non-technical health signals.
                </Faq>
                <Faq q="Who can read these docs?">
                  Anyone with the link. They’re general product documentation — there’s no client data, no account detail, and nothing sensitive here.
                </Faq>
                <Faq q="Do I need to install anything?">
                  No. FormPing runs entirely in the browser. Sign in and start adding URLs.
                </Faq>
                <Faq q="What happens if a form is a Typeform or HubSpot embed?">
                  It’s detected and named for you. Because a hosted embed lives on another domain, FormPing can’t auto-submit it — so it reports the embed exists and asks you to verify it by hand, rather than falsely saying “no form found.”
                </Faq>
                <Faq q="Will scheduled Live checks spam the client’s inbox?">
                  Each Live run does submit one real entry, clearly marked as a health check by its test data. Use Safe mode if you only need to confirm the form fills, or Live on forms you’re authorized to monitor.
                </Faq>
                <Faq q="Found a bug or have feedback?">
                  Use <strong>Report a bug</strong> in the footer — it reaches the team instantly. Admins can see and triage every report (resolve, reopen, or delete) from the Team page.
                </Faq>
              </Section>

              <p className="mt-16 border-t border-line pt-6 text-xs text-ink-faint">
                FormPing — contact-form QA &amp; site monitoring, by Apexure.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── primitives ──────────────────────────────────────────────────────────── */
function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pt-14">
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wider text-accent/80">{eyebrow}</p>}
      <h2 className="mb-4 mt-1 border-b border-line pb-2 text-xl font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}
function P({ children }: { children: ReactNode }) { return <p className="mb-4 leading-relaxed text-ink-secondary">{children}</p>; }
function UL({ children }: { children: ReactNode }) { return <ul className="mb-4 ml-1 space-y-2">{children}</ul>; }
function LI({ children }: { children: ReactNode }) {
  return <li className="flex gap-2.5 leading-relaxed text-ink-secondary"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" /><span>{children}</span></li>;
}
function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-ground px-1.5 py-0.5 font-mono text-xs text-ink ring-1 ring-line-strong">{children}</code>;
}
function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const c = tone === 'warn' ? 'border-warn/30 bg-warn/10 text-warn' : 'border-accent/20 bg-accent/10 text-ink';
  return <div className={`my-4 rounded-lg border px-4 py-3 text-sm leading-relaxed ${c}`}>{children}</div>;
}
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl ring-1 ring-line">
      <table className="w-full text-sm">
        <thead className="bg-panel"><tr>{headers.map((h, i) => (
          <th key={i} className="border-b border-line px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">{h}</th>
        ))}</tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={i} className="border-b border-line/60 last:border-b-0">{row.map((cell, j) => (
            <td key={j} className="px-4 py-3 align-top text-ink-secondary">{cell}</td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}
function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border border-line bg-panel/40 p-4">
      <p className="font-semibold text-ink">{q}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}
function BrandMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden className="block">
      <defs><linearGradient id="fpDocsMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#4338ca" /></linearGradient></defs>
      <rect width="64" height="64" rx="14" fill="url(#fpDocsMark)" />
      <rect x="14" y="12" width="27" height="29" rx="5" fill="#ffffff" />
      <rect x="19" y="18.4" width="17" height="3.2" rx="1.6" fill="#c7d2fe" />
      <rect x="19" y="24.4" width="17" height="3.2" rx="1.6" fill="#c7d2fe" />
      <rect x="19" y="30.4" width="11" height="3.2" rx="1.6" fill="#c7d2fe" />
      <circle cx="45" cy="46" r="8" fill="none" stroke="#ff6a2b" strokeWidth="2.4" opacity="0.5" />
      <circle cx="45" cy="46" r="4.2" fill="#ff6a2b" />
    </svg>
  );
}
