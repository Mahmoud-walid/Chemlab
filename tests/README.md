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

`tests/factories/` builds the objects a test needs — a user, a lesson, an exam,
a comment — with sensible defaults and overrides for the fields the test cares
about:

```ts
const user = await makeUser({ role: "student" });
const lesson = await makeLesson({ status: "published", authorId: user.id });
```

One big shared fixture creates invisible coupling: a test starts depending on a
field it never mentions, and changing that field breaks tests that look
unrelated.

`pnpm db:seed` is a different thing — development data for a human browsing the
app. Do not conflate the two.

## E2E journeys

Currently implemented:

1. **Take a quiz** — start, answer every question, see the score.
2. **Locale and RTL** — `dir`/`lang` per locale, `Accept-Language` honoured, an
   unsupported locale 404s, hreflang present, Arabic navigation rendered, and
   the periodic table held in canonical group order on an RTL page.
3. **Accessibility** — axe (WCAG 2.0/2.1 A and AA) on the quiz list and the
   Arabic home page.

Planned as their features land: sign-in with Google (mocked, never hitting real
Google), an admin CRUD round-trip, posting a comment in a virtualized list, and
the **RBAC denial path** — a non-admin blocked by the server action itself, not
only by the UI.

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
