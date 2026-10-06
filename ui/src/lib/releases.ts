/**
 * Curated release notes for the in-app "What's new" page (/whats-new).
 *
 * Hand-written and USER-FACING: describe what changed for the person using
 * FormPing, in plain language — what changed, why it matters, and the benefit —
 * never the engineering behind it, and never any internal / infrastructure
 * detail. Newest release first. Add a new entry at the top each time we cut a
 * version.
 */

/**
 * How a change should read at a glance.
 *
 * `feature` is something you could not do before, `enhancement` something that
 * already worked and now works better, `fix` something that was wrong.
 *
 * The point is skimming. Without it a major feature and a small correction
 * render identically, and somebody looking for the one thing that affects them
 * has to read all of them. It also lets a release say what KIND of release it
 * was before anyone opens it.
 */
export type ReleaseChangeType = 'feature' | 'enhancement' | 'fix';

/** One notable change in a release — a short title plus a paragraph of detail. */
export interface ReleaseChange {
  type: ReleaseChangeType;
  title: string;
  detail: string;
}

export interface Release {
  /** Semantic version, e.g. "2.0.0". */
  version: string;
  /** Short release name shown as the heading. */
  name: string;
  /** Human date, e.g. "August 2026". */
  date: string;
  /** Highlighted with a "Major update" chip when true. */
  major?: boolean;
  /** One-line summary. */
  summary: string;
  /** The notable changes, most important first. */
  changes: ReleaseChange[];
}

export const RELEASES: Release[] = [
  {
    version: '2.2.0',
    name: 'Working as a team',
    date: 'October 2026',
    major: true,
    summary:
      'FormPing is now built for more than one person: your own tests stay yours, every URL says who looks after it, and a page can be handed on when somebody is away.',
    changes: [
      {
        type: 'feature',
        title: 'Your own workspace',
        detail:
          'The four working tabs — Form Tester, Form Scheduler, Uptime & SSL and Content Changes — now show you your own work and nobody else\u2019s. Your tests, your monitors, your logs, your results. Before this, everyone shared one screen: hand the app to four people and each of them waded through the other three\u2019s runs to find their own. Projects is deliberately the other way round — every project, every URL and every result stays visible to the whole team, whoever produced it, because that is the part everyone needs.',
      },
      {
        type: 'feature',
        title: 'Every URL says who looks after it',
        detail:
          'Open a project and each page carries the name of the person watching it. A page is monitored by one person, and until now the app never said who — so if you tried to monitor a URL a colleague already had, you were simply refused, with no way of finding out by whom. Now the refusal names them, and the project names them before you ever reach it. Where one person runs all of a page\u2019s checks their name sits once beside the page; where different people run different checks, each name sits against the check it belongs to.',
      },
      {
        type: 'feature',
        title: 'Hand a page over when somebody is away',
        detail:
          'Press the name beside a URL to pass its checks to somebody else. Useful when a person is on leave or has moved on, and their monitors would otherwise carry on alerting an inbox nobody is reading. The checks continue exactly as before and the alerts go to whoever you chose from then on \u2014 while past checks stay recorded against whoever actually ran them, so the history keeps telling the truth. You can hand on your own at any time; an admin can hand on anybody\u2019s.',
      },
      {
        type: 'feature',
        title: 'Alerts reach the person responsible',
        detail:
          'A failing check now mentions whoever set that monitor up, by name, in Slack. With one person using the app a shared channel was fine; with a team it meant everybody receiving everybody else\u2019s failures and nobody sure which were theirs to act on. A new teammate is mentioned correctly on their very first alert, with nothing to configure. Monitors set up before this still alert as they always did, simply without a name attached.',
      },
      {
        type: 'enhancement',
        title: 'Monitors stop re-reading your client\u2019s whole site',
        detail:
          'A form monitor watches one form on one page. It used to search the entire site for that form on every single check — loading a dozen pages and typing test data into every form it met, over and over, for a year. Now it finds the page once, says which page it settled on, and goes straight there from then on. Faster checks, and far less traffic aimed at a client\u2019s site. If they ever move their contact page, the run tells you where the form seems to have gone and a button re-points the monitor at it.',
      },
      {
        type: 'enhancement',
        title: 'Multi-step forms, step by step',
        detail:
          'A form that asks its questions across several “Next” screens is now walked all the way through, with a picture of each step rather than only the first. The field count is what the whole walk saw — “2 fields” on a three-step form was a true number answering the wrong question. Each result says how many steps it got through, so a form that could not be completed says so plainly instead of looking like a failure.',
      },
      {
        type: 'feature',
        title: 'Check a monitored URL right now',
        detail:
          'Every monitor has a Re-run button: it checks that URL immediately, in the monitor\u2019s own mode, and leaves the schedule completely alone — the interval does not restart, the next check stays where it was, and the health figure does not move. The result is added to the history, clearly marked as a re-run, and clears itself after a day. Checking something should never cost you the schedule you set up for it.',
      },
      {
        type: 'enhancement',
        title: 'Results that only claim what happened',
        detail:
          'A check that could not be completed now says so, rather than reporting a verdict it had no evidence for. A CAPTCHA, a firewall, a page we could not read — each is described in its own words and read as “not tested” rather than “needs attention”, which is reserved for a form that may genuinely be broken. Alerts link straight to the detail, say what they could not do and why, and a result we failed to save is reported instead of quietly presented as current.',
      },
      {
        type: 'feature',
        title: 'Every project keeps a log',
        detail:
          'Who opened a project, who added or removed a URL, who shared it, who handed a monitor on — and when. Readable by owners and admins, so a client\u2019s setup is never a mystery about how it came to be that way.',
      },
    ],
  },
  {
    version: '2.1.0',
    name: 'Engine rebuild',
    date: 'September 2026',
    major: true,
    summary:
      'FormPing now checks every form on a site, shows you a picture of each one it tested, and tells you when it isn’t sure.',
    changes: [
      {
        type: 'feature',
        title: 'Every form on the site, not just the contact form',
        detail:
          'A test used to find one contact form and stop. Now it looks across your client’s whole site — the pages linked from the navigation, the footer and the sitemap — and reports every form it finds, wherever it lives. Each one is identified for what it is: a contact form, a rental or demo request, a newsletter sign-up, a search box. Every form that captures leads is filled with test data, and the results come back as one report with a tab for each form. A quote form sitting on a forgotten page is exactly the kind of thing that breaks quietly, and now you see it.',
      },
      {
        type: 'feature',
        title: 'See the form we tested',
        detail:
          'Every form now comes with a picture of it, headline and all, so you can tell in a second that we checked the form you meant. Cookie banners and chat bubbles are taken out of the shot, so you see the form rather than whatever was floating over it — and the form’s address opens the page right at it. No more taking our word for it.',
      },
      {
        type: 'feature',
        title: 'We tell you when we’re not sure',
        detail:
          'If the only form on a page has a single box to type in, that’s usually a search bar or a newsletter sign-up rather than a way to contact you — so we no longer fill it and call it healthy. We show you the picture and ask. In the same spirit, a CAPTCHA is only reported on the form that actually has one, and field counts now match what you can see on the form.',
      },
      {
        type: 'enhancement',
        title: 'Multi-step forms are tested properly',
        detail:
          'Forms that ask questions across several “Next” steps are now walked through one step at a time, just like a real visitor. In Live mode the message is only sent if the walk completes cleanly and a real email was entered — so a half-finished test entry never lands in your client’s inbox.',
      },
      {
        type: 'enhancement',
        title: 'Clearer results everywhere',
        detail:
          'Every result now says what happened in plain language and, when something failed, why. A broken form caused by the site’s own server error reads as exactly that, instead of a vague “validation error”. Uptime checks, content-change reports and the per-URL dashboard all had the same treatment, so a result means the same thing wherever you read it.',
      },
      {
        type: 'feature',
        title: 'Each URL has its own dashboard',
        detail:
          'Open any URL in a project and you’ll see the detail of the last test we ran on it — which forms were found, what happened to each, when it ran and how long it took — instead of a single pass or fail badge. Uptime and certificate history sit alongside it, with proper charts.',
      },
      {
        type: 'enhancement',
        title: 'Alerts that keep telling you',
        detail:
          'An alert now says exactly what broke and links straight to it. And if a problem is still there tomorrow, you hear about it again on a sensible schedule rather than getting one message and silence — so an ongoing outage can’t quietly slip off the radar.',
      },
    ],
  },
  {
    version: '2.0.0',
    name: 'App redesign',
    date: 'August 2026',
    major: true,
    summary:
      'A top-to-bottom redesign — a cleaner, calmer FormPing that finally feels like one polished product.',
    changes: [
      {
        type: 'enhancement',
        title: 'A cleaner, unified look',
        detail:
          'Over time the app had drifted — slightly different colours, spacing and controls on each screen, which made it feel busier than it needed to. We rebuilt everything on one shared design, with a tidy left sidebar for getting around. Now once you learn one screen you know them all, so you spend less time hunting for things and more time getting work done.',
      },
      {
        type: 'enhancement',
        title: 'Health you can read at a glance',
        detail:
          'We used to describe status a little differently in different places, which made it easy to misread how a client was doing. There is now a single, consistent language — green is healthy, amber means keep an eye on it, red needs attention, and grey means it is not being monitored — used identically everywhere. You can scan a whole client’s health in a second, with nothing to interpret.',
      },
      {
        type: 'enhancement',
        title: 'Rebuilt, focused tools',
        detail:
          'Projects, Contact Forms (Tester and Scheduler), Site Health (Uptime & SSL and Content Changes) and the Team page were each redesigned around the job they actually do — clearer inputs, clearer results, less clutter. Each tab now behaves like a purpose-built tool rather than a generic form, so everyday tasks are quicker and it is obvious what an action will do before you click it.',
      },
      {
        type: 'enhancement',
        title: 'Clearer client status pages',
        detail:
          'The status page you share is the face of your monitoring, so we made it calmer and easier to read. It shows exactly what a client cares about — is my site up, is my form working, is my certificate valid — and deliberately hides anything technical. That keeps clients reassured rather than confused, and makes the work you do visible without you having to explain it.',
      },
      {
        type: 'enhancement',
        title: 'Smarter dashboards',
        detail:
          'A page’s dashboard used to stay empty until a scheduled monitor was running, so a quick one-off test could look like “nothing here yet.” Now your results appear as soon as you have them — from a single manual test, a stopped monitor’s last check, or a live one — so you get the full picture immediately, without setting up a schedule first.',
      },
      {
        type: 'enhancement',
        title: 'Friendlier wording throughout',
        detail:
          'We went through the whole app and rewrote technical or ambiguous wording in plain English — buttons, hints, empty states, confirmations and error messages. Anyone on the team, or a client you invite, can understand what is happening and what a button will do, without needing a technical background.',
      },
    ],
  },
  {
    version: '1.0.0',
    name: 'The first FormPing',
    date: '2026',
    major: true,
    summary:
      'The very first version — contact-form testing and website monitoring for agencies, together in one place.',
    changes: [
      {
        type: 'feature',
        title: 'Contact-form testing',
        detail:
          'A broken contact form is invisible — the page still looks fine, but leads quietly stop arriving. FormPing checks the form the way a real visitor would, on demand or on a schedule, and tells you the moment it stops working, so you find out before your client does.',
      },
      {
        type: 'feature',
        title: 'Uptime, SSL & domain monitoring',
        detail:
          'Sites go down, certificates expire and domains lapse — usually at the worst possible time. FormPing keeps watch and warns you early, well before a certificate or domain runs out, so a small issue never turns into an emergency (or an awkward call from the client).',
      },
      {
        type: 'feature',
        title: 'Content-change tracking',
        detail:
          'Sometimes a “small tweak” quietly breaks a page or its SEO. FormPing snapshots your clients’ key pages and shows you what actually changed over time — content, SEO, forms and scripts — so nothing slips by unnoticed.',
      },
      {
        type: 'feature',
        title: 'Projects & shareable status pages',
        detail:
          'Everything is organised by client, so all of a client’s URLs and monitors live in one place instead of scattered around. And you can hand each client a clean, live status page — no login needed — that reassures them their site is being looked after.',
      },
      {
        type: 'feature',
        title: 'Team roles',
        detail:
          'Give each person exactly the access they need — from full control down to read-only — so the right people can make changes while everyone else can still see what is going on, safely.',
      },
    ],
  },
];
