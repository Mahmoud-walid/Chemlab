# Chemlab

## Git

Commit as the repository owner:

- name: `Mahmoud-walid`
- email: `modywmbadr@gmail.com`

```bash
git config user.name "Mahmoud-walid"
git config user.email "modywmbadr@gmail.com"
```

`main` is protected by a repository ruleset — changes must land through a pull
request, direct pushes are rejected.

## Workflow

Every change follows the same path:

1. Create a branch off `main`.
2. Run `pnpm check` locally.
3. Open a pull request against `main`.
4. Watch CI on that pull request and drive it to green before reporting back.

## Checks

Run `pnpm check` (typecheck + lint + tests) before pushing; CI (`.github/workflows/ci.yml`)
runs the same steps plus `pnpm build`. The package manager is pinned via the
`packageManager` field in `package.json`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
