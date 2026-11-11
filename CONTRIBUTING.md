# Contributing to FormPing

FormPing is maintained by Apexure. This guide is for the people who work on it: how a change is planned, built, checked and merged. Set the project up first with [Getting started](README.md#getting-started).

---

## The flow, end to end

1. **Track it.** Every feature, change or removal has an issue in the team tracker before work starts. If the work continues something already tracked, it stays on that issue rather than starting a duplicate.
2. **Branch off `main`.** Name the branch `<your-name>/<short-description>`, for example `alex/catch-broken-pages`. Never build on `main`.
3. **Build it, with its tests.** See [What a change must include](#what-a-change-must-include).
4. **Run the checks** CI runs, and get them all green. See [Checks before every commit](#checks-before-every-commit).
5. **Commit** in reviewable units. See [Commits](#commits).
6. **Push and open a pull request** with a title and body in the format below.
7. **Merge with a merge commit**, never squash, so each commit keeps its own history.
8. **Clean up.** Delete the merged branch locally and on GitHub, so the remote keeps only `main`.

---

## What a change must include

- **Tests that prove it.** Engine logic is covered by the Vitest suite in `tests/`. Anything a person sees or clicks in the web app gets a Playwright test in `ui/e2e/` that exercises the new or changed behaviour.
- **Current docs.** Every new feature, improvement, or fix that changes behaviour updates both documents in the same pull request:
  - the in-app **`/docs` page**, written for the people who use FormPing — plain language, nothing from inside the codebase;
  - the **README**, written for collaborators — what the app is, how it works, how to run it.

  Before calling a change done, search both for the behaviour you touched and check neither still describes the old flow. A test, `tests/docsHygiene.test.ts`, holds both documents (and this guide) to their audience: no tracker ids, no chat tone, no roadmap, no list of what the product lacks, and no tooling credit.
- **Nothing broken.** Changes are additive by default. Removing or changing an existing feature is discussed and agreed first.
- **A responsive interface.** Every page and component works at phone (~375px), tablet (~768px) and desktop widths, with no sideways scrolling.
- **The surrounding style.** The UI leans on a shared component kit and one set of design tokens, and the engine on deterministic, well-tested heuristics. Match what is already there rather than introducing a parallel pattern.
- **Design consistency.** Use the shared component kit and the `--fp-*` design tokens rather than one-off colours or spacing. Icons are SVGs, never emoji. Every result or status reads accurately and says what it means; nothing wears success styling unless it succeeded.

---

## Checks before every commit

These are the same five checks CI (GitHub Actions) runs on every push and pull request, and all of them must be green before a pull request merges. Run them from a clean state; anything red blocks the commit.

```bash
# Engine (repository root)
npm run lint
npm test

# Web app
cd ui
npm run lint
npx tsc --noEmit
npm run test:e2e        # always the full suite — it proves nothing else broke
```

The end-to-end suite is hermetic: sign-in, the database and Slack are disabled for the run, so it needs no secrets and touches no real service.

If a test at the root imports web-app code (an `@/` path), run `npm test` once with `ui/node_modules` moved aside. The engine CI job installs only the root package, so this is how you see what CI will see.

---

## Commits

- **One commit is one reviewable decision**, with everything that makes it true. The test: could this commit be reverted on its own and leave a coherent codebase? If reverting it would break the commit before it, they were one decision. If it holds two separately arguable things, it is two commits.
- **Every commit is green on its own.** Check out each commit and run the suite before you push.
- **Tests ship with the code they prove**, in the same commit, so a revert takes both.
- **Docs are usually their own commit**, because the wording can be argued separately from the behaviour.
- **Never pad.** No one-file-per-commit trails, no empty commits, and no squashing several decisions into one because they felt small. The count follows the work.
- **Use a conventional prefix:** `feat:`, `fix:`, `docs:`, `test:`, `build:`, `chore:`, `refactor:` or `perf:`, with a scope where it helps — `feat(site-watch): …`.
- **Explain the decision and why**, not the list of files.

---

## Secrets

- Keys, tokens and environment files are never committed. They are read from `process.env`; locally they live in `ui/.env.local`, which git ignores.
- **Stage files by name** and read the diff before every commit and every push. Never `git add -A`, and never stage `.env*` files, keys or the `data/` folder.

More in [SECURITY.md](SECURITY.md).

---

## Production data

`main` deploys straight to production, and client data must survive every change.

- **Migrations are additive and forward-only.** A new feature gets a new column or table, created `if not exists`. No `drop`, `truncate` or destructive `alter`. Migrations are plain SQL in `supabase/migrations/`, applied by hand — read its README first.
- **Never change how records are keyed** without a backfill in the same pull request; a changed key orphans every existing row.
- **Local development and any destructive script run against the `dev` schema**, never `public`.
- Deleting data always goes through a confirmation dialog. There is no silent delete path.

---

## Pull requests

**Title:** a type prefix, then one plain sentence saying what the change does.

```
feat: report a site as down when it loads an error page instead of the site
```

**Body:** three parts, written as facts about the product.

1. **Why** — the concrete problem.
2. **What changed** — the change, in product terms.
3. **What it solves** — how the product behaves now.

Leave out process detail — test counts, "all checks green", environment notes — and anything that reads as a conversation rather than a record of the change.

---

## If a merge breaks production

Revert first, debug second.

1. **Revert the merge** — the Revert button on the pull request, or `git revert -m 1 <merge-sha>` and push. That redeploys the last good state.
2. **Roll back the deploy** from the hosting dashboard if you need an instant stopgap.
3. **Then fix forward** on a new branch: reproduce, fix, verify locally, open a new pull request.

---

## License

FormPing is proprietary software owned by Apexure. By contributing, you agree that your contributions become Apexure's property under the terms in [LICENSE](LICENSE).
