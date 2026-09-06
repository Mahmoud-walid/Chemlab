# Testing

Three layers, each with a different job. Choosing the right one is not a style
preference — put a test in the wrong layer and it either runs too slowly to be
useful or proves nothing.

| Layer           | Runner                         | Environment             | What it is for                                            |
| --------------- | ------------------------------ | ----------------------- | --------------------------------------------------------- |
| **Unit**        | Vitest (`unit` project)        | jsdom, no I/O           | Pure logic and presentation                               |
| **Integration** | Vitest (`integration` project) | node, real Postgres     | SQL, migrations, constraints, server-action authorisation |
| **E2E**         | Playwright                     | real browser, built app | User journeys across the network boundary                 |

## Which layer?

**Unit** — anything that does not touch a database, a network or a browser
API beyond the DOM. Scoring and grading rules, Zod schemas, formatters, locale
helpers, hooks, component rendering and interaction. Exam grading in particular
belongs here and should be exhaustive: it is pure, and it is where a bug costs a
student their mark.

Target: milliseconds. Mock as little of our own code as possible — a test that
mocks the module next to it is testing the mock.

**Integration** — anything whose failure lives in the gap between units:

- A Drizzle query whose generated SQL is subtly wrong
- A cascade delete that orphans rows
- A unique constraint that does not hold under a race
- A migration that applies cleanly to an empty database and deadlocks on a full one
- **A server action that forgets its authorisation check**

That last one is the important one. A unit test with a mocked `db` will pass
while the action is wide open. Every new server action gets an integration test
proving it rejects a user without the permission.

**E2E** — journeys a user would recognise, and only those. E2E is the slowest
and flakiest layer, so it earns its place on cross-cutting paths, not on
branches better covered below it.

## Running

```bash
pnpm test              # unit only — the inner loop, keep it fast
pnpm test:watch        # unit, watching
pnpm test:coverage     # unit with coverage
pnpm test:integration  # needs a database (see below)
pnpm test:all          # unit + integration
pnpm test:e2e          # Playwright, builds and starts the app itself
pnpm test:e2e:ui       # Playwright in UI mode
pnpm test:e2e:report   # open the last HTML report
```

### Why the unit project uses `pool: "vmThreads"`

The inner loop is meant to be fast enough that nobody is tempted to skip it,
and it had quietly stopped being: 1108 tests in about 30 seconds, of which
**77% was building a jsdom environment 75 times — once per test file**, not
running assertions.

`vmThreads` builds one per worker instead, keeping per-file isolation. The
run went to about 5 seconds, and to about 10 with coverage and shuffling.

`isolate: false` would be faster still and is deliberately not used. It shares
one environment across files, so a module-level cache or a mutated global
leaks between them — and the shuffled runs in CI exist precisely to catch that
class of bug. Buying a few seconds by removing the isolation those runs depend
on would trade a real guarantee for a smaller number.

`pnpm check` runs `format:check → typecheck → lint → test` (unit). It is the
gate before pushing; CI additionally runs integration, E2E and `build`.

## The integration database

Integration tests need a **real Postgres**, not a mock and not an in-process
substitute. That is the whole point: they exist to catch SQL and migration
mistakes, and a database that diverges from production on exactly those points
fails at its one job.

- **CI** — a `postgres` service container, pinned to the same major version the
  Neon project runs, sets `DATABASE_URL` automatically.
- **Locally** — `docker compose up -d postgres`, then `export DATABASE_URL=...`.

`tests/integration/setup.ts` **fails loudly** when `DATABASE_URL` is missing
rather than skipping. A green integration run that touched no database is worse
than no run at all.

### Why not Neon branches, or pglite?

- **Neon branch per run** — highest fidelity, but a network round trip per query,
  an API key CI must hold (so fork PRs cannot run it), branch-quota contention,
  and leaked branches when a run is cancelled.
- **pglite** — fastest by far, but it is Postgres compiled to WASM: extensions,
  `pg_catalog` details, roles and concurrency semantics differ. It would let
  exactly the bugs these tests exist to catch slip through.
- **Service container** — real Postgres, local-socket fast, no API key, works
  offline and on forks. The gap it leaves is Neon-specific behaviour (pooling,
  cold starts), which shows up in E2E against a preview deployment instead.

## Isolation

Tests must pass in any order. The suite is run with `--sequence.shuffle` in CI
to prove it.

- Prefer wrapping each test in a **transaction rolled back** at the end.
- Where the code under test manages its own transaction, fall back to
  `TRUNCATE ... RESTART IDENTITY CASCADE` between tests.
- Never depend on rows left behind by an earlier test.

## Factories, not fixtures

`tests/factories/` builds the rows a test needs — a user, a lesson and its
sections, a quiz and its questions, a comment, a translation — with defaults
that are valid and overrides for the one field the test actually cares about:

```ts
const reader = await createUser(db);
const lesson = await createLesson(db, { status: "published", sections: 2 });
await createComment(db, { subjectId: lesson.id, authorId: reader.id });
```

**The point is not brevity.** Every suite that hand-rolls a fixture has to know
things about the schema that have nothing to do with what it is testing, and
several got one wrong before these existed:

- a comment needs its threading columns (`path`, `depth`, `root_id`), so the
  factory goes through the real writer rather than inserting directly;
- a section body is an array of typed blocks with ids and rich-text runs, not a
  string;
- a translation's `source_hash` must be **read back** from the source's
  generated column, never recomputed — a second implementation of that hash is
  exactly what `db/queries/translations.ts` exists to prevent;
- a `.invalid` email address cannot resolve, which matters the first time a
  mailer is misconfigured.

Each of those cost a failure that looked like a bug in the code under test.

They serve the integration suite and the e2e suite alike: both talk to the same
database through the same `SeedDatabase` handle, and a factory that only one of
them could use would be copied into the other within a week.

One big shared fixture creates invisible coupling: a test starts depending on a
field it never mentions, and changing that field breaks tests that look
unrelated. Factories are the opposite — each test builds exactly what it needs.

Deleting a test **account** is deliberately not offered. A user who has audited
anything cannot be deleted (see Q40 in `docs/DEFERRED_QUESTIONS.md`), so a
helper that appeared to clean them up would fail precisely in the suites that
exercise admin actions. Test accounts are left behind; it costs nothing.

`pnpm db:seed` is a different thing — development data for a human browsing the
app. Do not conflate the two.

## E2E journeys

Currently implemented:

1. **Take a quiz** — start, answer every question, see the score.
2. **Accounts** — sign up, survive a reload, edit the profile, sign out; an
   anonymous visitor bounced to sign-in and returned afterwards; a hostile
   `next` parameter refused.
3. **Sign in with Google, with Google intercepted** — the button is clicked for
   real and Better Auth builds the authorize URL for real, but every request to
   `accounts.google.com` is answered by the test. What is asserted is the shape
   of that URL: an authorization-code flow, a client id present, a callback on
   this app's own origin, and identity scopes only. See below on why this is
   worth more than a mock of the whole flow.
4. **Admin CRUD round-trips** — lessons, quizzes, elements and pages created,
   edited, published and withdrawn through the real screens.
5. **Permission gating** — every admin section has a test that a role without
   its permission sees none of it, plus a signed-in non-admin getting a 404
   with no admin markup at all.
6. **Comments** — posting into a virtualized list and seeing it appear.
7. **Translation** — writing a lesson or quiz translation, the write/review
   split, and the published translation reaching an Arabic reader.
8. **Locale and RTL** — `dir`/`lang` per locale, `Accept-Language` honoured, an
   unsupported locale 404s, hreflang present, Arabic navigation rendered, and
   the periodic table held in canonical group order on an RTL page.
9. **Accessibility** — axe (WCAG 2.0/2.1 A and AA) across the quiz list, the
   sitting, and the Arabic home page.

### Why the Google journey stops at the redirect

The rest of the flow — Google's consent screen, the code exchange, the session
Better Auth then creates — is Google's code and Better Auth's code. Driving it
would either need a real account (a test that fails when Google is slow) or a
mock deep enough that it tests the mock.

What is ours, and what actually breaks, is the handoff: which client id we
send, which callback we ask Google to return to, and which scopes we request. A
wrong callback origin fails on Google's own error page, which is the worst
place to discover it. So that is what is asserted, and CI sets deliberately
fake Google credentials so the path exists to be tested at all — without them
the button does not render and the journey would silently not run.

**The rule that matters: no test may make a network call to Google.** One of
the two tests exists only to assert that loading the sign-in page contacts
Google zero times.

### Known violations are pinned, not disabled

The axe assertions carry a `KNOWN_VIOLATIONS` list of rule ids, currently
`color-contrast` (issue #33). They are filtered by id rather than switched off
with `disableRules`, so a _new_ contrast failure still fails the suite. When #33
lands, the list empties.

### The browser binary

CI installs its own browsers. Environments that ship a pre-installed Chromium
whose revision does not match this Playwright version can point at it:

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

## Fork pull requests

No job in CI needs a secret: integration uses a service container, and E2E
builds and runs the app locally. Fork PRs therefore run the full suite.

That changes the moment a test needs a real credential — `pull_request` runs
from forks do not receive secrets. When that day comes, the safe default is a
**reduced job set for forks** (unit + build) rather than `pull_request_target`,
which runs the fork's code with access to your secrets and is a well-known way
to leak them.

## Coverage

Coverage is a **report**, not a gate — a global percentage target drives people
to write assertion-free tests over presentational code to move the number.
Thresholds are set per area, high where the code is pure and a bug is expensive
(`lib/`, `i18n/`), and absent for React components and generated Drizzle schema.

The hard rules are behavioural instead:

- **Every bug fix ships with a regression test.**
- **Every new server action ships with an authorisation test.**
