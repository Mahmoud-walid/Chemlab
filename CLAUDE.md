# Chemlab / CHEMVERSE

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

## Checks

Run `pnpm check` (typecheck + lint + tests) before pushing; CI (`.github/workflows/ci.yml`)
runs the same steps plus `pnpm build`. The package manager is pinned via the
`packageManager` field in `package.json`.
