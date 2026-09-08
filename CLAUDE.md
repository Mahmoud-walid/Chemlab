# Chemlab

A bilingual (English / Arabic) chemistry learning platform for school-age
readers: a periodic table, lessons as rich posts with comments and engagement,
quizzes and timed exams, an admin panel, and Web Push notifications.

**This file is the handover.** It is written for a session that has never seen
this repository before. Read it fully before touching anything — most of what
follows is not discoverable from the code in the time you would have, and
several items are decisions that look like arbitrary style until you know the
failure they prevent.

---

## 1. Git and identity

Commit as the repository owner. Set this in every fresh container:

```bash
git config user.name "Mahmoud-walid"
git config user.email "modywmbadr@gmail.com"
```

**`main` is protected by a repository ruleset — direct pushes are rejected.**
Everything lands through a pull request.

Never rewrite `jayemscript`'s commit authorship anywhere in this history: they
are the MIT copyright holder of the original work this project builds on.

**Never paste a credential into chat, an issue, a pull request body, a commit
message, or a code comment.** Issues and PRs on this repository are public and
permanent.

---

## 2. The workflow, every time

1. Branch off `main`.
2. Build the change.
3. `pnpm check` locally — and, when the change touches the database or the UI,
   the integration and e2e suites too (§6).
4. Open a pull request against `main`.
5. **Watch CI and drive it to green before reporting back.** A red PR is not
   "waiting on review".
6. Merge once green.

The owner's standing instruction: **do not stop for confirmation between
issues.** Once one is done, verified and green, continue to the next. If a
decision genuinely needs the owner, either ask or record it in
`docs/DEFERRED_QUESTIONS.md` — never guess silently.

### Pull request titles are load-bearing

Squash-merging makes the PR title the commit message on `main`, and
release-please reads those messages to decide the version bump.
`.github/workflows/pr-title.yml` lints the title as Conventional Commits
(`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`,
`style`, `revert`). A mistyped type produces a release with missing notes and
nothing complains at the time.

### Releases

`release-please` (`.github/workflows/release.yml`,
`release-please-config.json`) opens a release PR against `main`; merging it
tags the version and writes `CHANGELOG.md`. `bump-minor-pre-major` is on, so
while the version is `0.x` a `feat` bumps the minor.

---

## 3. Commands

```bash
pnpm check              # format:check + typecheck + lint + pages:check + unit tests
pnpm test               # unit only — the inner loop
pnpm test:integration   # needs Postgres
pnpm test:integration:shuffle
pnpm test:e2e           # Playwright; builds and starts the app itself
pnpm build              # next build --turbopack
pnpm bundle:check       # greps the BUILT client output for server secrets
pnpm env:check          # what is configured and what is not
pnpm pages:check        # every route is in the kill-switch list or documented open

pnpm db:migrate         # apply migrations
pnpm db:seed            # idempotent; reconciles seeded roles' grants
pnpm db:verify          # field-level check that content matches data/
pnpm db:generate        # drizzle-kit generate — writes a migration from the schema
pnpm reconcile          # proves the counter triggers survived a migration
pnpm push:drain         # send queued Web Push deliveries
pnpm db:bootstrap-admin # grant the first Super Admin
```

The package manager is pinned by `packageManager` in `package.json`
(pnpm 10.33.0). Node ≥ 20; CI uses 22.

---

## 4. Stack, and what is unusual about it

- **Next.js 16 App Router + Turbopack**, React 19, TypeScript 5.9 strict,
  Tailwind v4, shadcn/ui (added via its CLI — `pnpm ui:add` — never
  hand-copied, so upstream fixes stay mergeable).
- **Postgres** via Drizzle ORM. Neon in the owner's environment; a local
  Postgres 17 in CI and in the container.
- **Better Auth** for identity. **next-intl** for i18n. **Vitest** +
  **Playwright** for tests.

Three things that will trip you up if you assume otherwise:

**`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention and it now
defaults to the Node runtime rather than the edge. That is what makes the page
open/closed switch possible at all — it is a database read.

**`localePrefix: "as-needed"`.** The default locale (`en`) is served without a
prefix, so `/lessons` and `/en/lessons` are the same page and `/ar/lessons` is
the Arabic one. next-intl remembers the last locale in a `NEXT_LOCALE` cookie
— which is why every admin e2e test navigates with an **explicit `/en`
prefix**. Without it, a test that visited an Arabic reader page first gets the
admin panel in Arabic, where every English button name misses and
`toHaveCount(0)` is trivially true.

**`lib/load-env.ts` makes `.env.local` OVERRIDE the shell environment**, which
is the opposite of stock dotenv. If you are testing something by setting a
variable on the command line and nothing changes, this is why.

---

## 5. Layout

```
app/[locale]/(public)/     reader-facing pages
app/[locale]/(admin)/admin admin panel
app/api/                   route handlers (Node runtime)
components/                ui/ is shadcn; the rest is ours
db/schema/                 Drizzle tables, one file per area
db/queries/                all SQL; admin/ is the admin-only half
db/migrations/             checked-in SQL + meta/_journal.json
db/seed/                   rbac.ts is the permission catalogue
lib/                       domain logic, one directory per area
messages/en.json, ar.json  every user-facing string
scripts/                   the pnpm scripts above
tests/lib|components|hooks unit
tests/integration/         real Postgres
tests/e2e/                 Playwright
docs/                      the "why" for each subsystem
```

**`docs/` is where the reasoning lives.** Before working on an area, read its
document — they are written to explain decisions, not to describe code:
`AUTH.md`, `PERMISSIONS.md`, `DATABASE.md`, `SETTINGS.md`, `NOTIFICATIONS.md`,
`CI_ALERTS.md`, `ACTIVITY.md`, `MEDIA.md`, `page-structure.md`, `lesson.md`,
`chemical-equations.md`, and **`DEFERRED_QUESTIONS.md`**, which is the running
record of every decision deferred to the owner (Q1–Q44 as of now).

---

## 6. Testing

Three layers, and putting a test in the wrong one means it either runs too
slowly to be useful or proves nothing. `tests/README.md` has the full version.

- **Unit** (Vitest, jsdom, no I/O) — pure logic, schemas, formatters, hooks,
  component rendering. Exam grading belongs here and should be exhaustive: it
  is pure, and it is where a bug costs a student their mark.
- **Integration** (Vitest, node, **real Postgres**) — SQL, migrations,
  constraints, cascades, and **every server action's authorisation check**. A
  unit test with a mocked `db` passes while the action is wide open.
- **E2E** (Playwright, real browser, built app) — journeys a user would
  recognise, and only those.

Both Vitest suites run **shuffled** in CI. That is deliberate: an ordering
dependency between tests fails there rather than becoming a mystery flake
later. If you add a test that only passes in one order, the shuffle is right
and the test is wrong.

The unit project uses `pool: "vmThreads"` — one jsdom per worker instead of
one per file, which is where 77% of the inner loop's time was going. Do not
"simplify" it to `isolate: false`: that would break the shuffle guarantee.

**Server actions are excluded from coverage**, with the reasoning recorded in
`vitest.config.mts`. Including them was measured: the headline dropped 53% →
43% with nothing tested differently.

### Verify your tests can fail

This is the single most valuable habit in this repository, and it has caught
real problems more than once — a leak guard that searched for an empty string,
an e2e journey that could not exist in CI, a Google sign-in test asserting a
button that was never rendered.

Before believing a test: break the thing it guards, and watch it fail. If it
still passes, the test is decoration.

---

## 7. Authorization — the rules that are not negotiable

Full reasoning in `docs/PERMISSIONS.md`.

Authorization is **data, not constants**. The vocabulary lives in
`db/seed/rbac.ts` and is seeded on every deploy; the database holds which
permissions exist and who has them. Names are `resource:action`.

1. **The server is the only gate.** A hidden menu item is a convenience.
   `tests/lib/authz-enforcement.test.ts` walks every server action and route
   handler and fails the build when one mutates without a check.
2. **The actor comes from the session** — never from a `userId` in a body, a
   query string, or a header. The same test greps for that.
3. **No cross-request cache.** `getPermissionContext` is wrapped in React's
   `cache()` (per request). It is deliberately not a TTL cache: a revoked role
   has to take effect on the user's very next request.

`requirePermission("lesson:publsh")` **throws** rather than denying. Denying
would look exactly like a guard that works and stay invisible until somebody
removed the "broken" check.

Adding a permission: a row in `db/seed/rbac.ts`, a grant to whichever seeded
roles should hold it, a line in `docs/PERMISSIONS.md`, then `pnpm db:seed`.

Three permissions are held by **no role by default**, on purpose:
`lesson:delete_hard`, `quiz:delete_hard`, and `notification:subscribe_ci`. A
Super Admin grants them at runtime.

---

## 8. Environment and secrets

`lib/env.ts` is the public schema; `lib/env.server.ts` is the server one, with
`import "server-only"` at the top so an accidental client import is a **build
error**. `lib/env.server.schema.ts` holds the logic without the guard, so
scripts and tests can reach it.

**`pnpm bundle:check` greps the BUILT client output** for each server secret's
value. It has one sharp edge worth remembering: **it skips any secret whose
value is unset**, so an unset variable makes its probe a silent no-op. That is
why `.github/workflows/ci.yml` sets throwaway values for every guarded name —
without them, four of seven probes did nothing on every run. If you add a
secret, add a throwaway to CI and _measure_ the probe count change.

`configStatusFrom` (`lib/settings/config-status-core.ts`) reports each
integration as Configured / Not configured — **never the value, never a masked
prefix, never a length**. Half a credential counts as **not** configured: a
Google client id without its secret fails at the callback with an error that
reads like a bug in the app. This has been wrong twice (Web Push read a
variable no code path sets; Cloudinary reported configured with three of four),
so treat it as a place bugs hide.

---

## 9. Local Postgres in the container

The container runs Postgres 17 locally. **It dies regularly, always from a
stale pid file, and it always presents as `Failed to collect page data` during
`next build`** — which looks like a Next.js problem and is not.

```bash
pg_ctlcluster 16 main start    # "Removed stale pid file." then it works
pg_isready
```

Playwright: the container has Chromium build 1194 and the project pins 1234, so
every e2e test fails at 1–3 ms with "Executable doesn't exist". Use the config's
escape hatch:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:e2e
```

The owner uses **Neon**; keep container testing on local Postgres. Migrations
are applied locally by you and **to Neon by the owner**, when they are ready.

---

## 10. Postgres facts learned the hard way

- **Generated columns must be IMMUTABLE and cannot reference another table.**
  No subqueries. This is why translation freshness is a per-row `source_hash`
  rather than a parent hash covering children.
- **`md5(text)` is the only IMMUTABLE hash Postgres exposes over `text`.**
  `sha256` takes `bytea`, and `convert_to` is only STABLE.
- **Drizzle renders columns unqualified inside a `sql` template.** In a
  correlated subquery an unqualified `"id"` binds to the INNER table and
  silently counts zero. Qualify them.
- **Every primary-key column is `NOT NULL` whether the schema says so or not.**
  A nullable column in a composite key is a constraint that disagrees with its
  own declaration. `media_usages.block_id` is `NOT NULL DEFAULT ''` for exactly
  this reason.
- Composite-row comparison (`NEW IS NOT DISTINCT FROM anonymised`) works in
  plpgsql for whole-row equality with no extension — used by the audit-log
  trigger.
- **React's `cache()` is a no-op outside a request scope.** Measured: three
  calls, three executions. `--conditions=react-server` does not install the
  scope either. So integration tests really do re-read, which is what they
  need — but a query-count assertion cannot be made from there.

---

## 11. Where things stand (2026-09-07, v0.25.1)

Issue **#8** is the epic and the map; it is now ticked from reality and states
what blocks what. **Every issue in the v1 plan is merged except three, and all
three are waiting on a credential rather than on work.**

| Open                     | What is left                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#18** Better Auth      | Merged. Open only for one Google OAuth round trip against a real client, plus Q28                                                                         |
| **#24** CI alerts        | Web Push, the settings UI and the drain schedule are merged. **Slack** needs `SLACK_WEBHOOK_URL`                                                          |
| **#27** Cloudinary media | Foundation merged (tables, signature, folder convention, constraints, `media:upload_video`). Everything that _calls_ Cloudinary is blocked on the account |

**Three migrations are applied locally but NOT to Neon:** `0023`
(quiz option translations), `0024` (presence opt-in + audit anonymisation),
`0025` (media tables). The owner applies them when ready.

**Four decisions are waiting on the owner**, recorded with recommendations as
**Q41–Q44** in `docs/DEFERRED_QUESTIONS.md`: whether a normal account may
upload video, whether SVG is ever allowed, what a storage quota is, and whether
previews share the production Cloudinary account.

Resolved recently and worth knowing: presence defaults to **`nobody`** (opt-in,
Q39); the audit log is immutable **and** an audited actor can be deleted, via a
trigger widened by exactly one case — `actor_id` → NULL with every other column
identical (Q40).

**A standing item to raise with the owner:** the previous container's
environment carried a Neon `DATABASE_URL`, Google, Cloudinary and Resend
credentials that Claude did not set. Worth rotating.

---

## 12. What "done" looks like here

The bar on this project is higher than "the tests pass", because several things
have passed for the wrong reason. Concretely:

- **Say what you actually verified**, and how. "CI is green" and "I ran the
  suite and one unrelated spec flaked, here it is" are different sentences.
- **Comments explain the failure a decision prevents**, not what the line does.
  The existing code is written that way; match it. A comment that restates the
  code is noise, and one that records why an obvious alternative is wrong is
  the most valuable thing in the file.
- **Report every reason at once, not the first.** An operator who clears one
  blocker and is then told about the next has been made to discover the rules
  one round trip at a time. Bulk actions, hard-delete refusals and upload
  constraints all follow this.
- **A control that cannot work should be absent, not disabled** — and where a
  reader has no business knowing a feature exists, the API answers **404, not
  403** (`/api/ci/preferences`).
- **Never weaken a test to get green.** Never skip, disable or quarantine one.
  A failing test is not an infra flake until you have proven it is.
- If you make a claim to the owner and it turns out to be wrong, correct it
  plainly and move on.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
