# Contributing to lemon-core

Thanks for your interest in contributing to `lemon-core` (lemoncloud-io/lemon-core)! This document
covers the local dev setup, branch/commit conventions, and the PR process
common to the LemonCloud module repos (`lemon-core`, `lemon-model`,
`lemon-devkit`).

> This is a shared template. Per-repo values (Node version, test command) are
> filled in per repo below — see the repo's own `package.json` as the source
> of truth if this file drifts.

## Development setup

1. Fork and clone the repository.
2. Install dependencies:

   ```sh
   npm install
   ```

3. Node version — this repo requires **`>=24.0.0`** (from
   `package.json#engines.node`). The three lemon module repos currently do
   **not** agree on a minimum version:

   | repo | `engines.node` |
   |---|---|
   | lemon-core | `>=24.0.0` |
   | lemon-model | `>=18.19.0` |
   | lemon-devkit | `>=24.0.0` |

   Use the value from *this* repo's `package.json`, not the table above.

## Branching

- Default branch: **`develop`** (confirmed via `gh repo view` `defaultBranchRef`
  for all three repos — not `main`/`master`).
- Branch from `develop`, open PRs against `develop`.
- Branch-naming convention was not verified for this draft (no
  `.github/` branch-protection config was found in any of the three repos to
  confirm one). If your repo has a house style, follow it; otherwise pick a
  short descriptive branch name and call it out in the PR description.

## Commit messages

Observed convention (measured from `git log --oneline -20` on each repo,
2026-09-02 — **not identical across the three repos**, do not assume one
without checking the repo you're in):

- **lemon-core**: mixes Conventional-Commits-style prefixes (`feat:`, `fix:`)
  with un-prefixed version-bump commits (e.g. `v4.3.0 embed cores template
  layer as extended/cores`) and `Merge pull request #NNN from ...` merge
  commits. Also seen: `chore: <msg>`.
- **lemon-model**: `feat:`, `docs:`, `chore:` prefixes, plain version-bump
  commits (e.g. `v1.2.3`), and `Merge pull request #NNN from ...`.
- **lemon-devkit**: `feat:`, `docs:`, `test:`, `chore:`, and scoped
  `refactor(scope): <msg>` (e.g. `refactor(exec-cli): ...`), plus version-bump
  commits (e.g. `v0.2.0 audit fix`) and `Merge pull request #NNN from ...`.

Common ground across all three: `feat:` / `fix:` / `chore:` / `docs:` prefixes
when present, and a version-bump commit for releases. Use one of the observed
prefixes for your repo; don't invent a new one.

## Running tests

Test command is **not the same across the three repos** — use the exact
`package.json#scripts.test` value for the repo you're in:

| repo | `scripts.test` |
|---|---|
| lemon-core | `LS=1 vitest run` |
| lemon-model | `jest --config=jest.config.json` |
| lemon-devkit | `LS=1 vitest run` |

```sh
npm test
```

Run lint before opening a PR:

```sh
npm run lint
```

## Pull request process

1. Open an issue first for non-trivial changes, or reference an existing one.
2. Keep PRs focused — one logical change per PR.
3. Make sure `npm test` and `npm run lint` pass locally.
4. Update the README / CHANGELOG (or the `## VERSION INFO` table, per repo
   convention) if your change is user-visible.
5. A maintainer will review and merge into `develop`.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE), the same license as `lemon-core`.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it
before participating.
