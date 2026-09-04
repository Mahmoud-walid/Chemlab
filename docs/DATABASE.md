# Database conventions

Binding for every table added from here on. Decided once in #10 so later issues
implement rather than re-litigate.

## Stack

- **Neon Postgres** — serverless Postgres with branching.
- **Drizzle ORM** — typed schema, SQL-level control, migrations committed to the repo.
- **`@neondatabase/serverless`** as the driver, not `node-postgres`.

Vercel's serverless functions get no long-lived process, so a `pg.Pool` either
leaks connections across invocations or pays a fresh TCP+TLS handshake per
request. Neon's driver speaks HTTP/WebSocket to Neon's own pooler and is built
for that lifecycle.

**The trade-off:** it is Neon-specific. Moving to plain Postgres means swapping
the driver — the Drizzle layer above is unchanged. Its HTTP mode also has no
interactive multi-statement transactions: use `drizzle-orm/neon-http` for
single-shot queries and `drizzle-orm/neon-serverless` where a real transaction
is needed.

## Two URLs, two jobs

| Variable                | Endpoint                    | Used by                                 |
| ----------------------- | --------------------------- | --------------------------------------- |
| `DATABASE_URL`          | **Pooled** (`-pooler` host) | The running app                         |
| `DATABASE_URL_UNPOOLED` | **Direct**                  | `drizzle-kit`, migrations, seed scripts |

PgBouncer in transaction mode cannot hold the session-level locks DDL needs, so
migrations must not go through the pooler.

**Both are server-only secrets.** Never prefix either `NEXT_PUBLIC_` — that
inlines the value into the JavaScript every visitor downloads, and a Neon URL
carries its password inline. `lib/env.server.ts` imports `server-only`, so an
accidental client import is a build error rather than a published credential.

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
