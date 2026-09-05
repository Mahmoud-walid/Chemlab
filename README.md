# Chemlab

Chemlab is an open-source, interactive web app for learning chemistry. It's designed so anyone—from curious kids to confused adults—can explore atoms, molecules, elements, and reactions without needing an account.

Think of it as a place where the periodic table is fun, molecules don't bite, and quizzes might just make you say "Omg, that actually makes sense!"

## Features

- Explore the periodic table interactively
- Learn about atoms, molecules, and chemical reactions
- Take random quizzes to test your knowledge
- Kid-friendly, but suitable for chemistry enthusiasts of all ages

## Getting Started

This is a [Next.js](https://nextjs.org) app. You need Node.js 20+ and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/Mahmoud-walid/Chemlab.git
cd Chemlab
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Environment variables

Chemlab runs with **no environment file at all** — every variable has a working
default. Configure them when you deploy to a real domain:

```bash
cp .env.example .env.local
```

`.env.local` is git-ignored; `.env.example` is the tracked template.

| Variable                       | Purpose                                                                                                                                                                                  | Default                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `NEXT_PUBLIC_SITE_URL`         | Canonical origin of the deployment. Used for `metadataBase`, the canonical link, Open Graph / Twitter URLs, and the absolute OG image URL. Must be an absolute URL including the scheme. | `http://localhost:3000` |
| `NEXT_PUBLIC_SITE_NAME`        | Product name shown in page titles, metadata and the UI.                                                                                                                                  | `Chemlab`               |
| `NEXT_PUBLIC_SITE_DESCRIPTION` | Meta description and Open Graph / Twitter card description.                                                                                                                              | see `.env.example`      |
| `NEXT_PUBLIC_TWITTER_HANDLE`   | Handle for the `twitter:site` card tag, including the `@`. Omitted from metadata when unset.                                                                                             | unset                   |

Three things worth knowing:

- **In production, set `NEXT_PUBLIC_SITE_URL`.** Leave it at the default and your
  canonical URLs and social cards will point at `localhost`, which search engines
  and link previews cannot resolve.
- **`NEXT_PUBLIC_*` values are inlined at build time**, not read at runtime. They
  end up in the browser bundle, so they are public — never put a secret behind
  this prefix — and changing one requires a rebuild, not just a server restart.
- **Invalid values fail fast.** A malformed URL or an empty name throws at startup
  with a message naming the offending variable, rather than quietly emitting
  broken metadata. Validation lives in `lib/env.ts`.

## Scripts

| Script                     | What it does                                     |
| -------------------------- | ------------------------------------------------ |
| `pnpm dev`                 | Start the dev server (Turbopack)                 |
| `pnpm build`               | Production build                                 |
| `pnpm start`               | Serve the production build                       |
| `pnpm lint`                | Lint with ESLint                                 |
| `pnpm lint:fix`            | Lint and auto-fix                                |
| `pnpm typecheck`           | Type-check with `tsc --noEmit`                   |
| `pnpm format`              | Format with Prettier                             |
| `pnpm format:check`        | Check formatting without writing                 |
| `pnpm test`                | Run the test suite once                          |
| `pnpm test:watch`          | Run tests in watch mode                          |
| `pnpm test:ui`             | Run tests in the Vitest UI                       |
| `pnpm test:coverage`       | Run tests with a coverage report                 |
| `pnpm test:e2e`            | Placeholder — fails until Playwright lands       |
| `pnpm check`               | The gate to run before pushing                   |
| `pnpm clean`               | Remove `.next`, `out`, and `coverage`            |
| `pnpm ui:add <component>`  | Add a shadcn/ui component via its CLI            |
| `pnpm ui:diff [component]` | Diff vendored shadcn components against upstream |

### `pnpm check` versus CI

`pnpm check` runs `format:check` → `typecheck` → `lint` → `test`, cheapest
first, so a formatting slip fails in seconds rather than after the suite.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same four
steps and then two more: `test:coverage` instead of `test`, and `build`. The
asymmetry is deliberate — coverage instrumentation and a full production build
cost time you do not want on every local run, but you do want them before a
merge. A green `pnpm check` therefore predicts CI, but does not guarantee the
build step; run `pnpm build` too if you have touched anything Next.js compiles
differently in production.

### Releasing

Merging a `feat:` or `fix:` PR into `main` makes release-please open a
`chore: release x.y.z` pull request with the version bump and generated
changelog; merging that PR cuts the tag and the GitHub Release. Commit-message
conventions, the version-bump table and the rollback procedure live in
[CONTRIBUTING.md](CONTRIBUTING.md).

### Database

Chemlab runs with **no database configured** — `pnpm dev`, `pnpm build` and the
test suite all work without one. When you want migrations or real data, the
default is a **local PostgreSQL cluster**; nothing here needs a cloud account.

```bash
cp .env.example .env.local   # the defaults already point at the local cluster
pnpm db:local:start          # start PostgreSQL on 127.0.0.1:5432
pnpm env:check               # what will the app ACTUALLY connect to?
pnpm db:migrate              # apply committed migrations
pnpm db:seed                 # load the JSON content — safe to re-run
pnpm db:check                # prove connectivity
pnpm db:verify               # prove it matches data/ field by field
```

To use hosted Postgres instead, point `DATABASE_URL` at a Neon endpoint — the
driver is chosen from the connection string, so nothing else changes.

Pages read the database, not `data/*.json`. `pnpm build` still works with no
database: the list pages render on demand and the detail pages prerender only
when one is present. See [docs/DATABASE.md](docs/DATABASE.md).

| Script                | What it does                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `pnpm env:check`      | Validate configuration; print the resolved host, driver and leak check |
| `pnpm db:generate`    | Read the schema, emit SQL — needs no database                          |
| `pnpm db:migrate`     | Apply committed migrations                                             |
| `pnpm db:seed`        | Load content from the JSON files — idempotent                          |
| `pnpm db:verify`      | Compare the database against `data/` field by field                    |
| `pnpm db:check`       | Connectivity, server version, applied-migration count                  |
| `pnpm db:studio`      | Browse the data                                                        |
| `pnpm db:local:start` | Start the local cluster                                                |
| `pnpm db:local:stop`  | Stop it                                                                |
| `pnpm db:local:reset` | Drop and rebuild from nothing — refuses non-local hosts                |

Both URLs are **server-only secrets** and must never carry a `NEXT_PUBLIC_`
prefix; `pnpm env:check` fails if one does. Note that `.env.local` **overrides**
a `DATABASE_URL` already set in your shell, so an injected one in a hosted dev
container cannot quietly redirect your writes. Conventions, the driver split,
the migration loop and the rollback rules are in
[docs/DATABASE.md](docs/DATABASE.md).

### Accounts

Sign-in is optional: with no `BETTER_AUTH_SECRET` the site serves every public
page and the account UI does not appear.

```bash
# in .env.local
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=http://localhost:3000
```

`pnpm env:check` then reports whether you have email/password only or Google as
well. Google needs a client id and secret from the Google Cloud console, and a
redirect URI registered verbatim as `/api/auth/callback/google` — the exact
console settings, the security properties and the rules for building on top of
this are in [docs/AUTH.md](docs/AUTH.md).

Never give any of these a `NEXT_PUBLIC_` prefix; `pnpm env:check` fails if you
do.

### Roles and permissions

Authorization is data: roles and permissions are rows, so the Super Admin can
define both at runtime. `pnpm db:seed` creates the vocabulary and five starting
roles; the first Super Admin is granted at deployment time because granting a
role requires already being one:

```bash
# sign up normally at /sign-up first, then
SUPER_ADMIN_EMAIL=owner@example.com pnpm db:bootstrap-admin
```

The database itself refuses to remove the last Super Admin, to delete or re-key
the protected role, or to edit the audit log. The vocabulary, the rules for
building on `requirePermission()`, and how to add a permission are in
[docs/PERMISSIONS.md](docs/PERMISSIONS.md).

### CI alerts

A red `main` that nobody notices is worse than one that pages somebody: every
branch cut afterwards inherits it. The `notify` job in `ci.yml` posts the
outcome of a whole workflow run to `/api/ci/notify`, which reaches opted-in
developers by Web Push and, when a webhook is configured, Slack.

```bash
openssl rand -hex 32   # CI_NOTIFY_SECRET — the same value both sides
```

| Variable            | Where it lives                        | Notes                                                                                      |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `CI_NOTIFY_SECRET`  | GitHub Actions secret **and** the app | The HMAC key. Never transmitted — a copy of it is the only way to forge                    |
| `CI_NOTIFY_URL`     | GitHub Actions secret only            | Always the **production** deployment: the alert path must not depend on what may be broken |
| `SLACK_WEBHOOK_URL` | The app, server-only                  | The URL **is** the credential. Optional — push works without it                            |

All three are **server-only**; none may carry a `NEXT_PUBLIC_` prefix, and
`pnpm bundle:check` fails the build if one reaches the client bundle. CI
notifications are opt-in per account — an absent preference row means never —
and the job can never change the build's own result. The full policy, and how
to answer "why did nobody get paged?", is in
[docs/CI_ALERTS.md](docs/CI_ALERTS.md).

### UI components

shadcn/ui components are vendored into `components/ui`. Add and update them
**through the CLI**, never by hand:

```bash
pnpm ui:add dialog        # add a component
pnpm ui:diff button       # see what upstream changed
```

Hand-editing a vendored component is fine when you mean to customise it, but
run `pnpm ui:diff` first so you know what you are diverging from.

## Testing

Tests run on [Vitest](https://vitest.dev) with jsdom and
[Testing Library](https://testing-library.com). Config lives in
`vitest.config.mts`, shared setup in `tests/setup.ts`, and specs in `tests/`:

- `tests/lib/` — pure helpers (`cn`, element category styles, quiz storage and
  grading, date formatting, env parsing)
- `tests/hooks/` — React hooks (`useIsMobile`, `useCommonState`)
- `tests/components/` — component rendering and interaction
- `tests/data/` — integrity checks for `data/*.json` (unique slugs, answers that
  match an option, elements ordered by atomic number and on a valid grid cell)

```bash
pnpm test            # run once
pnpm test:watch      # watch mode
pnpm test:coverage   # coverage report in ./coverage
```

The data tests guard the JSON that drives the periodic table, lessons, and
quizzes — if a new element or quiz is added with a missing field, a duplicate
slug, or an answer that is not one of its options, the suite fails.
