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

| Script               | What it does                            |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Start the dev server (Turbopack)        |
| `pnpm build`         | Production build                        |
| `pnpm start`         | Serve the production build              |
| `pnpm lint`          | Lint with ESLint                        |
| `pnpm lint:fix`      | Lint and auto-fix                       |
| `pnpm typecheck`     | Type-check with `tsc --noEmit`          |
| `pnpm format`        | Format with Prettier                    |
| `pnpm format:check`  | Check formatting without writing        |
| `pnpm test`          | Run the test suite once                 |
| `pnpm test:watch`    | Run tests in watch mode                 |
| `pnpm test:ui`       | Run tests in the Vitest UI              |
| `pnpm test:coverage` | Run tests with a coverage report        |
| `pnpm check`         | Typecheck + lint + tests (what CI runs) |
| `pnpm clean`         | Remove `.next`, `out`, and `coverage`   |

## Testing

Tests run on [Vitest](https://vitest.dev) with jsdom and
[Testing Library](https://testing-library.com). Config lives in
`vitest.config.mts`, shared setup in `tests/setup.ts`, and specs in `tests/`:

- `tests/lib/` — pure helpers (`cn`, element category styles, quiz storage and grading)
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
