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
