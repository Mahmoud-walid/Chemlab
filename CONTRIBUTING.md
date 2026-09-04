# Contributing to Chemlab

## The workflow

Every change follows the same path. `main` is protected by a repository
ruleset — direct pushes are rejected.

1. Branch off `main`: `feat/<issue>-<slug>`.
2. Build it. Run `pnpm check` before you push.
3. Open a pull request against `main`, with `Closes #<issue>` in the body.
4. Get CI green.
5. Squash-merge.

## Commit messages

We squash-merge, so **the pull request title becomes the commit message on
`main`** — and release-please reads those messages to decide the next version.
A mistyped type produces a release with missing notes, so PR titles are linted
by [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml) and a
title like `add stuff` fails the check.

Individual commits on your branch are _not_ linted. Work however you like
locally; only the title has to be right.

```
<type>(<optional scope>): <subject in lowercase>
```

### Types and what they do

| Type                                              | Meaning                             | Bump (while 0.x) | Bump (after 1.0) | Changelog          |
| ------------------------------------------------- | ----------------------------------- | ---------------- | ---------------- | ------------------ |
| `feat`                                            | new user-visible capability         | minor            | minor            | Features           |
| `fix`                                             | bug fix                             | patch            | patch            | Bug Fixes          |
| `perf`                                            | faster, no behaviour change         | patch            | patch            | Performance        |
| `refactor`                                        | internal restructuring              | patch            | patch            | Refactors          |
| `docs`                                            | documentation only                  | patch            | patch            | Documentation      |
| `revert`                                          | reverts a previous commit           | patch            | patch            | Reverts            |
| `test`                                            | tests only                          | none             | none             | hidden             |
| `build`                                           | build system, bundler, Next config  | none             | none             | hidden             |
| `ci`                                              | workflow files only                 | none             | none             | hidden             |
| `chore`                                           | dependencies, tooling, housekeeping | none             | none             | hidden             |
| `style`                                           | formatting only                     | none             | none             | hidden             |
| any type with `!`, or a `BREAKING CHANGE:` footer | incompatible change                 | **minor**        | **major**        | ⚠ Breaking Changes |

**The pre-1.0 rule surprises people:** while the version is `0.x.y`, semver
makes no stability promise, so `feat!:` bumps the **minor** version — `0.2.0`
becomes `0.3.0`, not `1.0.0`. Reaching `1.0.0` is a product decision, made
deliberately, not something a commit message triggers.

### Scopes

Optional and cosmetic — they group the changelog. Not enforced.

`auth`, `admin`, `db`, `exam`, `lessons`, `comments`, `i18n`, `media`,
`notifications`, `ui`, `deps`

```
feat(exam): add per-question time limits
fix(auth): keep the session cookie on locale change
chore(deps): upgrade radix packages
```

## Releasing

Releases are not automatic, and that is on purpose.

1. You merge a `feat:` or `fix:` PR into `main`.
2. CI runs. If it passes, [`release.yml`](.github/workflows/release.yml) opens
   or updates a **`chore: release x.y.z`** pull request containing the bumped
   `package.json` and the regenerated `CHANGELOG.md`.
3. That PR accumulates every change since the last release. Read it — it is
   exactly what is about to ship.
4. Merging it creates the git tag and the GitHub Release.

Nothing in this pipeline pushes to `main`, so the branch ruleset needs no
bypass and no token holds bypass permission. The cost is two clicks per
release; the benefit is that a machine never decides on its own that a change
is safe to ship.

`CHANGELOG.md` is generated and contains **only** the title and the release
entries. Editing it by hand is pointless — the next release overwrites it;
change the commit message instead. Do not add a preamble to it either:
release-please inserts each new release directly beneath the title, so any
static prose ends up below the newest entry.

> **Note on CI for the release PR.** A pull request opened by `GITHUB_TOKEN`
> does not trigger `pull_request` workflows, so CI does not run on the release
> PR itself. That is acceptable because it only touches `CHANGELOG.md` and
> `package.json`, both already verified on `main`. If you want CI there, swap in
> a fine-grained PAT stored as a repository secret.

## Rolling back

When something ships broken:

1. **Find the last good release** — the [Releases page](../../releases), or
   `git tag --sort=-v:refname | head`.
2. **Redeploy that tag** from the hosting dashboard. This is the fast fix and it
   does not touch the repository.
3. **Then land a `revert:` PR** against `main`, so the code and the deployment
   agree. Never fix forward by pushing to `main` directly — the ruleset forbids
   it, and it would skip CI.

### Rollback does not undo a migration

Once the database lands, reverting application code does **not** revert a
schema migration. A rollback therefore only works if the previous release can
still run against the new schema.

Keep every migration backward-compatible for at least one release:

- Add columns as nullable, or with a default. Never add a `NOT NULL` column
  without one.
- Never drop or rename a column in the same release that stops using it. Ship
  the code change first, drop the column a release later.
- Split renames into add → backfill → switch reads → stop writing → drop.

If a migration cannot be made backward-compatible, say so in the PR
description, because it means that release cannot be rolled back by redeploying
the previous tag.

## Checks

`pnpm check` runs `format:check` → `typecheck` → `lint` → `test`, cheapest
first. CI runs the same four plus `test:coverage` and `build`. See the
[README](README.md#pnpm-check-versus-ci).

## UI components

shadcn/ui components are vendored in `components/ui`. Add and update them
through the CLI — `pnpm ui:add <component>`, `pnpm ui:diff <component>` — never
by hand-copying, so upstream fixes stay mergeable.
