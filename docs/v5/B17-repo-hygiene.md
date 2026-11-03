# v5 B17 — repository hygiene

Status: implemented 2026-10-30 on `chore/v5-b17-repo-hygiene` (base `v5` @ `88502a04` = 5.0.10). Found during the B12 README work. No package change: `src/`, `package.json` and the published files are untouched.

## Removed

| File | Why |
|---|---|
| `.travis.yml` | Travis CI is not in use. Nothing in the repo runs or references it (no script in `package.json`, no badge left, no workflow). Last changed 2022-02. The file held a plaintext Codecov upload token. |
| `.github/workflows/docgen.yaml` | Every step was dead: `npx typedoc` (typedoc left the devDependencies in `66622218`), an S3 copy of that output, and a `gh-pages` deploy. The `doc` / `doc:html` / `doc:publish` scripts and `gh-pages` were removed in #225 (2026-10-28). It had no test or lint step, so nothing valid was kept. |
| README codecov badge | It pointed at the Codecov project that `.travis.yml` fed. |

The workflow ran on push to `develop`. Removing it on `v5` reaches `develop` only when `v5` lands there (decision D59, vault). Until then `develop` keeps it.

## Owner action: rotate the Codecov token

Removing `.travis.yml` does **not** remove the token: it stays in git history (every commit that held the file, and every clone and fork). The owner must **revoke or rotate the upload token on codecov.io** (repository settings of `lemoncloud-io/lemon-core`). An agent cannot do this. Rewriting git history is not planned; rotation makes the old value useless.

When `docgen.yaml` is gone from every branch that runs it, the owner may also delete the AWS key secrets the workflow used from the GitHub repository settings.

## CONTRIBUTING change

`CONTRIBUTING.md` § Branching gets a subsection "5.x work (`v5` branch)": branch from `v5`, PR base `v5`, bundle branch names `feat/v5-<bundle>-<topic>` / `docs/v5-…` / `fix/v5-…`, squash or merge is the owner's call, the publish commits (`vX.Y.Z published`) are made by the owner on `v5`, and each bundle is recorded in `docs/v5/` and `HOW_TO_UPGRADE_V5.md`. The PR-process step now says "merge into `develop` (4.x) or `v5` (5.x)". The test command was already `LS=1 vitest run`; the commit conventions are unchanged.

## Kept on purpose

- `.npmignore` patterns for `.travis.yml` and `.codecov.yml`: generic ignore lines for files that no longer exist; harmless.
- `tsconfig.json` `typedocOptions` and `.gitignore` `tsdoc/`: inert leftovers of typedoc. Out of scope here; a later clean-up may drop them.

## Gates

`npm test` 64 files / 880 tests, `npm run build`, `npm run api:check` (`base=304 current=306 added=24 removed=22 allow=46 not-allowed=0`, unchanged), `npm run esm:smoke` (`subpaths=5`).
