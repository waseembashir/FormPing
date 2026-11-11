# Security

FormPing tests contact forms and monitors client websites, so it holds client URLs, monitoring history and a small amount of configuration. This page explains how to report a vulnerability and how the app protects what it holds.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [the private reporting form](https://github.com/waseembashir/FormPing/security/advisories/new). Only the maintainers can see what you submit.

A useful report includes:

- what an attacker could do, and to whom
- the steps or request that show it
- the page, route or file involved, if you know it

You will get an acknowledgement, and the fix is made on a private branch and released before the details are discussed in public.

## Supported version

FormPing is deployed continuously from `main`. Only the code on `main` is supported; a fix is released by merging to `main`, which deploys it.

## How the app protects what it holds

**Sign-in.** Access requires Google sign-in, limited to approved email domains. Each person then has a role (Owner, Admin, Member or Viewer), and the server checks that role on every write. The interface hides what a role cannot do, but the server is the gate.

**Secrets.** Keys and tokens are read from environment variables and are never committed. Locally they live in `ui/.env.local`, which git ignores; `ui/.env.example` lists the variable names with no values. Contributors stage files by name and review the diff before every commit and push — see [CONTRIBUTING.md](CONTRIBUTING.md).

**Client status pages.** A status page is reached through an unguessable token and is built from a separate, client-safe shape. Response times, reason codes, content-change detail, project notes and form screenshots never enter that shape, so a page cannot show them.

**Form screenshots.** Screenshots are stored server-side, served only through a signed-in route, and named with a random component so their address cannot be guessed from a site's URL. They are captured before any test data is typed, and they are deleted with their URL or project.

**Error messages.** Raw technical errors stay in server logs. The interface, alerts and status pages describe what happened in plain language and never print stack traces, database errors or network messages.

**Testing other people's sites.** FormPing never attempts to bypass a CAPTCHA or an anti-bot challenge; when it meets one, the run stops and reports it. Live mode sends real messages and is for sites you are authorized to test — see [Responsible use](README.md#responsible-use).

## Dependencies

Dependencies are kept current through regular updates, and every update must pass the full test suite before it merges. If you find a vulnerable dependency, report it the same way as any other vulnerability.
