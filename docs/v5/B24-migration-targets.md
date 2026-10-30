# v5 B24 — reviewed migration target registry (`lemon-lambda-migrate`, `lemon-lambda-deploy-dev`)

Status: implemented on `feat/v5-b24-migration-targets` (base `v5` @ `06727a94`, lemon-core 5.0.15). Not released;
no version bump. Background: B19 (`docs/v5/B19-bin-deploy.md`) shipped the migration tools with one pinned target,
lemon-templates-api dev. B24 turns that single pin into a registry of reviewed targets and adds lemon-hello-api dev.

## Why

-   The migration is irreversible: the `remove` phase deletes the Serverless stack. It must run only for a stack that
    was rehearsed with the canonical migration script at the pinned revision.
-   B19 principle stays: a pinned value is reviewed and is never overridable by a config file or a flag. A new target
    is therefore a lemon-core change, not a config value.

## What changed

| Area                      | B19                                                   | B24                                                                                                                                            |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORG_DEFAULTS.migration`  | `target`, `revision`, five state names                | `targets`: frozen array of frozen entries; `origin`, `entry`, `imports`, `runsDir` stay shared                                                 |
| Entry                     | —                                                     | `project`, `stage`, `stack`, `revision`, `receiptFile`, `ownerFile`, `lockFile`, `ownerTool`, `devConfigPrefix`                                |
| Config match              | `project`/`stage`/`stack` equal the one target        | `project`/`stage`/`stack` equal exactly one entry, else `TARGET_MISMATCH` (message lists the reviewed targets)                                 |
| Revision                  | `migrationRevision` equals the one revision           | equals the matched entry's `revision`, else `REVISION_MISMATCH`                                                                                |
| State names, owner tag    | fixed `templates-*`                                   | from the matched entry; run state stays in `<runsDir>/<stack>`, so names never collide across stacks                                           |
| Snapshot check            | the two templates dev functions (`<project>-dev-*`)   | the two dev functions of the matched stack (`<stack>-lambda`, `<stack>-backend`; the same names for templates)                                 |
| `lemon-lambda-deploy-dev` | `lemon-templates-api/dev/code` only                   | `<project>/dev/code` of a registry entry; label and temp-dir prefix from that entry                                                            |
| Abort reason (`end`)      | `templates-cli:<code>` for every project              | `deploy.abortReasonPrefixes[project]` if present (`lemon-templates-api` → `templates-cli`), else `lemon-lambda-deploy`                         |
| Deploy runner             | resolved names checked for shape and lambda ≠ backend | also: resolved names must equal `<project>-<stage>-lambda` / `-backend` (`plannedFunctionNames`), else `TARGET_MISMATCH` before `deploy.begin` |
| `--help`                  | names the templates stack / project                   | `--confirm-stack <stack>` and the list of reviewed targets                                                                                     |

Registry (`bin/lib/org-defaults.mjs`):

| project               | stage | stack                     | revision           | receipt / owner / lock                                               | owner tag              | dev temp prefix         |
| --------------------- | ----- | ------------------------- | ------------------ | -------------------------------------------------------------------- | ---------------------- | ----------------------- |
| `lemon-templates-api` | `dev` | `lemon-templates-api-dev` | `66d1e91a…` (B19)  | `templates-receipt.json` / `templates-owner.json` / `templates.lock` | `templates-migrate`    | `templates-dev-config-` |
| `lemon-hello-api`     | `dev` | `lemon-hello-api-dev`     | `66d1e91a…` (same) | `migrate-receipt.json` / `migrate-owner.json` / `migrate.lock`       | `lemon-lambda-migrate` | `lemon-dev-config-`     |

Removed (internal, not reachable through the package `exports` map): `ORG_DEFAULTS.migration.target`,
`.revision`, `.receiptFile`, `.ownerFile`, `.lockFile`, `.ownerTool`, `.devConfigPrefix`, and the `TARGET` /
`REVISION` exports of `bin/lib/migrate-core.mjs`. Their only users were the two bin entries, `dev-release.mjs`, the
test fixture and the specs; B19-bin-deploy.md documented them and now documents `migration.targets`. New exports of
`migrate-core.mjs`: `TARGETS`, `findTarget(config)`, `migrationTarget(config)`. New: `plannedFunctionNames(config)`
(`deploy-plan.mjs`), `abortReasonPrefix(project)` (`deploy-runner.mjs`). The migration config keeps its keys: no
registry key is added, so the config fingerprint does not change.

## Byte-identical for lemon-templates-api

`bin/lib/migrate-targets.spec.mjs` (§ compat) holds values captured on `v5` @ `06727a94` before the change, and the
same spec passed on that base before any code was edited:

| What                                 | How it is locked                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config fingerprint                   | sha256 of the validated config, minimal and with every optional key: `9347e31c…`, `6b8b5a59…`                                                                                       |
| Offline plan output                  | sha256 of the six `migrationPlan` outputs and of the six CLI plan outputs (node path masked): both `0af6a126…`                                                                      |
| State-file paths and owner tag       | `scripts/migrate/runs/lemon-templates-api-dev/templates-receipt.json`, `templates-owner.json`, `templates.lock` during each child, owner `tool: templates-migrate`, owner key order |
| Abort reason                         | `templates-cli:TOOL_FAILED` (`deploy.spec.mjs`, known-round abort case)                                                                                                             |
| Dev-release temp prefix              | `templates-dev-config-XXXXXX` (`dev-release.spec.mjs`, private copy case)                                                                                                           |
| Error codes for a mismatching config | `TARGET_MISMATCH` (project / stage / stack), `REVISION_MISMATCH`, exit 2, for `lemon-lambda-migrate`; `TARGET_MISMATCH`, exit 2 for `lemon-lambda-deploy-dev`                       |

Changed on purpose for templates (codes and exit codes unchanged): the `TARGET_MISMATCH` message text of both tools
(now lists the reviewed targets), the `SNAPSHOT_INVALID` text for the function-set check (names the stack), and the
two `--help` lines.

## The canonical migration script and lemon-hello-api

Read-only check of the deploy-service checkout at the pinned revision (`git show` / `git ls-tree`, nothing fetched
or checked out):

-   `scripts/migrate/migrate.mjs` is generic: `<stack>` is `<service>-<stage>`; the stage is the last `-` segment and
    the service the rest. Run state is `runs/<stack>/`. It reads the live stack; it does not name any service.
-   It has an explicit path for hello's table that is named outside the lemon naming rule: such a kept resource is
    reused as is and is not registered with the tools; only the role is widened to reach it.
-   The skill at that revision (`docs/skills/lemon-sls-migrate/SKILL.md`, § 4) records a 2026-10-30 sandbox rehearsal
    of both lemon-templates-api and lemon-hello-api: `verify` all the same for both; hello kept its public bucket and
    the out-of-rule table, rebuilt 2 functions, role, 2 mappings, the subscription and 19 routes, with about 2 minutes
    of API downtime. It also notes the harness has not yet run on the real services of the organisation account.
-   The deploy service's sls naming rule (`deploy-resolve-names.ts`) is `<project>-<stage>-<component ?? 'lambda'>`,
    the rule `plannedFunctionNames` mirrors.

## Onboarding another service

1. Rehearse the migration of `<project>-<stage>` with the canonical script at the pinned revision, in a sandbox,
   through `verify` (all the same). Record the result where the deploy service records its rehearsals.
2. Open a lemon-core PR that adds one entry to `ORG_DEFAULTS.migration.targets`: `project`, `stage`, `stack`
   (`<project>-<stage>`), the rehearsed `revision`, and the generic state names (`migrate-receipt.json`,
   `migrate-owner.json`, `migrate.lock`, `lemon-lambda-migrate`, `lemon-dev-config-`). Add its cases to
   `migrate-targets.spec.mjs`. Review, merge, publish.
3. The service bumps lemon-core and runs `lemon-lambda-migrate` with its own config (installation values only).

A new revision for an existing entry is the same kind of change (rehearse first, then edit the entry). An entry is
never added through a config file or a flag.

## lemon-hello-api: never use bootstrap mode

Use `lemon-lambda-migrate` (then `lemon-lambda-deploy-dev`, `code` mode) for lemon-hello-api. Do not run
`lemon-lambda-deploy` in `bootstrap` mode for it: bootstrap ensures a table named by the lemon rule, which is a new,
empty table next to hello's existing table (named outside the rule). The function environment would then point to
the new table and the data would be split between two tables.

## Tests

-   `bin/lib/migrate-targets.spec.mjs` (new, 15): the compat lock above (4) and the registry cases — two frozen entries
    with exact keys and the pinned revision; list, entries and defaults cannot be mutated; templates names vs hello
    generic names; hello config matches and plans its own stack; unknown project and mixed fields
    (templates project + hello stack, and others) are `TARGET_MISMATCH`; hello runs all phases in
    `runs/lemon-hello-api-dev/` with `migrate-*` names and its receipt cannot gate a templates release; hello snapshot
    must hold its own two functions; dev release of hello with the `lemon-dev-config-` prefix; deploy-dev mismatch
    message; abort prefix per project (inherited keys ignored); each stack's functions equal the runner's planned
    names.
-   `deploy.spec.mjs` (+2): a non-templates project aborts with `lemon-lambda-deploy:TOOL_FAILED`; resolved names that
    differ from the planned targets stop with `TARGET_MISMATCH` before any read or `deploy.begin`.
-   `bin-entries.spec.mjs`: the frozen check covers `targets`, each entry and `abortReasonPrefixes`.
