# Database conventions

Binding for every table added from here on. Decided once in #10 so later issues
implement rather than re-litigate.

## Stack

- **PostgreSQL** — a local cluster in development, a managed instance (Neon) in
  production. Same wire protocol, same migrations, same schema.
- **Drizzle ORM** — typed schema, SQL-level control, migrations committed to the repo.
- **Two drivers**, chosen from the connection string by `db/driver.ts`.

### The driver is picked from the URL, not from `NODE_ENV`

| Host          | Driver                     | Why                                                                                                                                                                                                                                                 |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.neon.tech` | `@neondatabase/serverless` | Serverless functions get no long-lived process, so a `pg.Pool` either leaks connections across invocations or pays a fresh TCP+TLS handshake per request. Neon's driver speaks HTTP/WebSocket to Neon's own pooler and is built for that lifecycle. |
| anything else | `node-postgres`            | A local cluster speaks the normal wire protocol and cannot answer the Neon driver's HTTP endpoint at all.                                                                                                                                           |

The same environment might point at either, and the connection string is the
thing that actually knows — so `driverFor()` reads the host and nothing else.
It matches on the host **suffix**: `neon.tech.example.com`, or the literal
string appearing in a password or database name, is not Neon.

Everything above the driver — schema, queries, migrations — is unchanged
between the two. Neon's HTTP mode has no interactive multi-statement
transactions, so use `drizzle-orm/neon-http` for single-shot queries and
`drizzle-orm/neon-serverless` where a real transaction is needed (the seed
script does).

## Local Postgres is the default for development

No cloud account, no shared database, nothing to leak:

```bash
pnpm db:local:start   # start PostgreSQL on 127.0.0.1:5432
pnpm env:check        # what will the app ACTUALLY connect to?
pnpm db:migrate       # apply db/migrations
pnpm db:seed          # load the JSON content — safe to re-run
pnpm db:check         # connectivity, server version, migrations applied
```

`pnpm db:local:reset` drops the `public` and `drizzle` schemas so the next
`db:migrate && db:seed` rebuilds from nothing. It refuses to run against any
host that is not local, and against the Neon driver — a reset script that can
reach production is a loaded gun.

`pnpm db:seed` is idempotent: it upserts on natural keys inside one
transaction, then verifies the row counts and that every quiz question ends up
with a `correct_option_id`. Running it twice leaves the same 119 elements, 13
lessons, 6 quizzes and 60 questions.

### `.env.local` wins over the shell

`lib/load-env.ts` loads `.env` without overriding, then `.env.local` **with**
`override: true`, and `next.config.ts`, `drizzle.config.ts` and every script
import it first.

Stock Next.js and dotenv both let a pre-set variable win. That is right on a
server where the platform injects configuration, and wrong in a hosted dev
container, which may already carry a `DATABASE_URL` pointing at a completely
different database — there, the file you just edited silently does nothing and
`pnpm db:seed` writes somewhere you did not intend. `.env.local` is git-ignored
and never shipped, so its presence is always a deliberate local choice and this
precedence cannot affect a real deployment.

When in doubt, `pnpm env:check` prints the host it resolved and the driver it
picked, with the password redacted.

## Two URLs, two jobs

| Variable                | Endpoint                    | Used by                                 |
| ----------------------- | --------------------------- | --------------------------------------- |
| `DATABASE_URL`          | **Pooled** (`-pooler` host) | The running app                         |
| `DATABASE_URL_UNPOOLED` | **Direct**                  | `drizzle-kit`, migrations, seed scripts |

PgBouncer in transaction mode cannot hold the session-level locks DDL needs, so
migrations must not go through the pooler. Locally there is no pooler in front
of the cluster, so both variables can hold the same URL.

**Both are server-only secrets.** Never prefix either `NEXT_PUBLIC_` — that
inlines the value into the JavaScript every visitor downloads, and a hosted
Postgres URL carries its password inline. `lib/env.server.ts` imports
`server-only`, so an accidental client import is a build error rather than a
published credential. `pnpm env:check` also fails on any `NEXT_PUBLIC_` name
that looks like a secret.

## Conventions

### Primary keys: UUID v7, generated in application code

```ts
import { id } from "@/db/schema/_shared";
```

Not `serial`: it leaks row counts, enumerates trivially over a public API, and
forces a round trip before the id is known. Not v4 either — v7 is time-ordered,
so index writes stay at the right-hand edge of the B-tree and rows sort by
insertion order for free.

**Trade-off:** 16 bytes instead of 4, and ugly URLs. User-facing content keeps a
human `slug` as a separate unique column and routes on that.

### Timestamps: always both

```ts
import { timestamps } from "@/db/schema/_shared";
```

`created_at` and `updated_at`, both `timestamptz NOT NULL DEFAULT now()`.
`updated_at` is maintained by Drizzle's `$onUpdate`, not a database trigger, so
the behaviour is visible in TypeScript rather than hidden in the schema.

### Soft delete: no, by default

Only tables where deletion must be reversible or auditable — lessons, comments,
users — get `deleted_at timestamptz`. Each one must also ship a **partial unique
index** so a soft-deleted row does not squat its slug.

A blanket `deleted_at` forces every query everywhere to remember a filter, and
one forgotten filter is a data leak. **Trade-off:** hard deletes rely on the
audit trail from the RBAC work to reconstruct who removed what.

### Naming

- `snake_case` columns, **plural** table names (`lessons`, `role_permissions`)
- Singular TypeScript exports: `export const lessons = pgTable("lessons", …)`
- Foreign keys `<singular>_id`

`casing: "snake_case"` is set in `drizzle.config.ts` and on the client, so
camelCase TypeScript keys map automatically.

## Migration workflow

```bash
pnpm db:generate   # read the schema, emit SQL — needs no database
#                    then READ the emitted SQL and commit it
pnpm db:migrate    # apply, deliberately
pnpm db:check      # prove connectivity, print server version and applied count
pnpm db:studio     # browse
```

**Migrations are committed artifacts.** `drizzle-kit push` is banned outside a
throwaway Neon branch, and migrations are never applied automatically at app
startup or during `next build` — a deploy runs `pnpm db:migrate` as its own
explicit step.

### Migrations must survive a rollback

Redeploying a previous tag does **not** revert a migration. Keep every migration
backward-compatible for at least one release, so the previous build still runs
against the new schema:

- Add columns nullable, or with a default. Never `NOT NULL` without one.
- Never drop or rename a column in the release that stops using it — ship the
  code change first, drop a release later.
- Split renames: add → backfill → switch reads → stop writing → drop.

If a migration cannot be made backward-compatible, say so in the PR: that
release cannot be rolled back by redeploying the previous tag.

## Building without a database

`pnpm build` and `pnpm check` must pass with `DATABASE_URL` unset, and CI runs
with no database and no secret. That holds because:

- `db/client.ts` builds the client **lazily** behind `getDb()`, so importing it
  costs nothing.
- `lib/env.server.ts` validates on first call, not at import.
- No `db` import runs a query at module scope, and nothing in
  `generateStaticParams` or `generateMetadata` touches Postgres.

Keep it that way: a build that needs a database is a build that fails in CI, in
preview, and on every contributor's first clone.

## Content: JSON now, database later

`data/*.json` is the **seed source of truth**: version-controlled, diffable and
reviewable in a pull request. `pnpm db:seed` reads it; nothing else should.

**The hand-over point:** once the admin panel can edit content (#16), the
database becomes authoritative and the JSON drops to a bootstrap fixture used
only for a fresh developer database. Until then, a content change is a JSON
change plus a re-seed.

Deleting the JSON now would throw away the only reviewable record of the
initial dataset and turn "rebuild my dev database" into a database-dump
problem instead of a one-command one. The cost of keeping both is drift, which
the idempotent seed and its verification step contain.

### Reading it

Pages read the database, never the JSON — there is no `import … from
"@/data/*.json"` under `app/`. The queries live in `db/queries/`, one module per
content type, and each returns the shape the components already speak so the
mapping lives in one place instead of at every call site.

`pnpm db:verify` compares the database against the JSON **field by field** —
every scalar, both array columns, each lesson section unwrapped back to its
original prose, and every question's `correct_option_id` resolved to a label.
Counts alone would pass a seed that mapped `melt` onto `boil`. `pnpm db:seed`
runs the same check at the end of every run, and
`tests/integration/content.test.ts` runs it in CI.

### Rendering: which routes need a database, and when

`pnpm build` still works with no database at all, because a build that needs a
live database is a build that fails when the database is down.

| Route                              | Rendering                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `/`, `/lessons`, `/quiz`           | On demand — they list content, so prerendering them would query at build time |
| `/chemical/[slug]`, `/quiz/[slug]` | Prerendered when a database is present, on demand when it is not              |
| `/sitemap.xml`                     | Content URLs when a database is present, static routes only when it is not    |

`db/queries/availability.ts` is the single place that decides. The detail routes
keep `dynamicParams` at its default, so a slug that was not prerendered is
served rather than 404ing. Revisit the first row with ISR once the admin panel
exists and content changes have a known cadence.

### Decisions taken with the content schema

- **`elements.category` is `text`, not an enum.** Fifteen stable values today,
  but under an enum a new category is a migration; as text it is a row.
- **Arrays, not child tables**, for `shells` and `ionization_energies`. They are
  ordered numeric vectors read whole and never queried by member; a child table
  would turn 119 rows into ~1,500 plus a join, to buy a query nobody writes.
- **Lesson bodies are ProseMirror JSON**, not HTML strings. The editor
  round-trips losslessly and rendering is a pure function; HTML would need
  sanitising on every read and re-parsing on every edit.
- **The quiz answer is a foreign key**, not a copy of the option text. The JSON
  stores `answer` as a string duplicating one of `options[]` — rename the option
  and the answer silently orphans. `quiz_questions.correct_option_id` makes that
  impossible.
- **Translations are side-car tables**, not per-locale columns. A third language
  becomes data rather than DDL, and a missing translation is an absent row
  rather than a nullable column every query must remember to check. Only `en`
  is seeded — Arabic content is commissioned, not machine-translated.
- **The twelve body-less lessons seed as summary-only rows.** They have no
  `sections` file; inventing placeholder sections would put fake content in
  front of students. They are also why publishing refuses an empty body only
  going forward — see Q32 in `docs/DEFERRED_QUESTIONS.md`.
- **`lessons.status` decides visibility, `published_at` only records when.**
  Three states (`draft`, `published`, `archived`) do not fit in one nullable
  timestamp, and a pair of columns that can disagree about whether a row is
  live is a bug waiting for a query that checks the wrong one. Migration 0005
  backfills the column from the old rule rather than defaulting every existing
  lesson to `draft` and silently emptying the catalogue.
- **Quizzes carry the same lifecycle as lessons** — `status`, `position`,
  `published_at`, `deleted_at` — plus the sitting rules #16 asks for
  (`time_limit_seconds`, `pass_mark_percent`, `max_attempts`, the two shuffle
  flags) and `points` per question. The rules are stored and edited but not yet
  read: taking a quiz still ignores them, which belongs to the exam-engine
  work. Null means "no limit" for both the timer and the attempt cap; zero
  would be a different claim.
- **`quiz_questions.correct_option_id` is not a declared foreign key.** The
  reference is circular — question → option → question — so it cannot be one
  without a deferrable constraint. A dangling answer is therefore possible and
  is _detected_ rather than prevented: publishing refuses a quiz with one, and
  `getQuizBySlug` throws rather than serving an unanswerable question.
- **`lessons.position` orders the curriculum.** Lessons build on each other, so
  the catalogue is a sequence; ordering by slug put "acids-bases" before
  "atomic-structure". Seeded in tens, so a lesson can be moved between two
  others without renumbering the rest.
