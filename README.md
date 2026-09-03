# CHEMVERSE

CHEMVERSE is an open-source, interactive web app for learning chemistry. It’s designed so anyone—from curious kids to confused adults—can explore atoms, molecules, elements, and reactions without needing an account.

Think of it as a place where the periodic table is fun, molecules don’t bite, and quizzes might just make you say “Omg, that actually makes sense!”

## Features

- Explore the periodic table interactively
- Learn about atoms, molecules, and chemical reactions
- Take random quizzes to test your knowledge
- Kid-friendly, but suitable for chemistry enthusiasts of all ages

## Metadata Highlights

- **Title:** CHEMVERSE – Interactive Chemistry Learning for Kids
- **Description:** Fun, interactive, and kid-friendly web app to explore chemistry
- **Keywords:** chemistry, learning, kids, interactive, periodic table, molecules, atoms, science, educational app
- **Website:** [[https://chemverse.app](https://chemverse.app) ](https://chemverse-io.vercel.app)

## Getting Started

This is a [Next.js](https://nextjs.org) app. You need Node.js 20+ and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/jayemscript/chemverse.git
cd chemverse
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

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
