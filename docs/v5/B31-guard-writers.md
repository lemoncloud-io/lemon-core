# v5 B31 — the migration guard on the writers, and `lemon-lambda-guard`

Track: v5 deployment (in preparation, `HOW_TO_DEPLOY_V5.md`), not the code upgrade (`HOW_TO_UPGRADE_V5.md`).

Status: implemented on `feat/v5-b31-guard-writers` (base `v5` @ `13b6ca93`, lemon-core 5.0.20). Not released; no
version bump. B30 (`docs/v5/B30-migration-guard.md`) shipped the guard as a library only. B31 connects it to the three
writers of the reviewed targets and adds the `lemon-lambda-guard` command for the installation, the registry, the
status and the recovery.

## What changes

| Command                                                                  | Before B31        | B31                                                                      |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------ |
| `lemon-lambda-deploy --apply`                                            | writes at once    | a reviewed target writes under `guardedWrite`; any other target as is    |
| `lemon-lambda-deploy-dev --apply`                                        | writes at once    | writes under `guardedWrite` (every dev release target is reviewed)       |
| `lemon-lambda-migrate <phase> --execute` (six phases)                    | writes at once    | writes under `guardedWrite`; the run LOCK / owner files stay as they are |
| the same three without `--apply` / `--execute` (plan)                    | offline plan      | a reviewed target's plan adds a read-only `guard` summary                |
| `lemon-lambda-migrate inspect \| reconcile \| resolve \| adopt-baseline` | read-only / local | unchanged                                                                |
| `lemon-lambda-pack`, `lemon-lambda-env`, local / invoke / logs / perf    | no deploy write   | unchanged                                                                |
| `lemon-lambda-guard` (new)                                               | —                 | `init`, `register`, `status`, `resolve`                                  |

A target outside `ORG_DEFAULTS.migration.targets` (any general deploy) keeps its exact plan and apply output, its
errors and its exit codes: the guard only classifies it and does no state I/O for it (no install file, root, port or
journal is read or opened; B30 N14).

## Decisions

-   **D-1 validated input only.** The guard gets the values that passed the existing validation, never raw argv:
    `input = { project, stage }` for deploy and deploy-dev (the stack is the registry's) and
    `{ project, stage, stack }` for migrate; `expected = { account, region }` from the same config.
-   **D-2 outside the registry: same bytes.** `classifyTarget` only; the plan, the apply result and every failure
    line are the pre-B31 bytes. Locked by `bin/lib/guard-writers.spec.mjs` (a) per writer, and by the B19 / B24 /
    B27 compat locks with their captured hashes unchanged.
-   **D-3 the write under the guard.** `--apply` / `--execute` of a reviewed target runs
    `guardedWrite({ input, expected, holder, adapter: { passthrough, write } })` (through `runGuarded` of
    `bin/lib/migrate-guard.mjs`). `passthrough` and `write` call the same existing function (`runDeployment`, the
    `runDevRelease` apply branch, `executeMigration`). Holders: `lemon-lambda-deploy`, `lemon-lambda-deploy-dev`,
    `lemon-lambda-migrate:<phase>`.
-   **D-4 results.**
    -   blocked → one stderr line
        `{ "status": "blocked", "code": "GUARD_BLOCKED", "reason": "<BLOCKED_REASONS value>", "message": "<fixed sentence>" }`,
        exit 1. The guard runs first: no deploy receipt, credential, network, run receipt or migration LOCK file is
        opened.
    -   completed → the existing stdout result plus `guard: { operationId, journal: "completed" }` (appended last).
    -   the write threw → the writer's own failure line (code, receipt, diagnostic, exit code) plus `operationId`; the
        journal records the operation `unknown`, so the next write of that installation is blocked until `resolve`.
    -   the journal could not be written after the write (`WRITE_UNKNOWN`, `stateWriteFailed`) → status `unknown`,
        exit 3, `operationId` and `stateWriteFailed: true` (and the result's `receipt` / `deployId` when the write
        itself returned).
    -   outside the registry → no field added (D-2).
-   **D-5 plan summary.** Without `--apply` / `--execute`, a reviewed target's plan adds
    `guard: { applicability: "applicable", status: "ready" | "blocked", reason? }` from `guardStatus` (read-only, no
    lock, no write). A plan outside the registry is unchanged.
-   **D-6 untouched.** The migration LOCK and owner files stay (the guard lock is taken around them); the read-only
    and local commands above are not changed.
-   **D-7 `lemon-lambda-guard`.** New bin `bin/lemon-lambda-guard.mjs`, logic in `bin/lib/guard-cli.mjs` (every effect
    injectable for tests), listed in `package.json` `bin` and `files`.

### Implementation notes

-   **Input refusals before the guard (migrate).** `executeMigration`'s input-only checks (platform, reviewed target,
    placeholder values, `--allow-sensitive-backup`, `--confirm-stack`) moved to `executionPrecheck` in
    `bin/lib/migrate-core.mjs` (same codes, messages and order; `executeMigration` calls it first as before). The CLI
    calls it before the guard, so a missing flag is exit 2 and opens no journal record. deploy-dev already refused
    placeholders before the client; it now does so before the guard.
-   **A known failure inside the write is journaled `unknown`.** The B30 guard has no `failed` journal state: any
    throw of the write is `unknown`. The writer keeps its own status and exit code (for example `failed`, exit 1),
    adds `operationId`, and the target stays blocked until an owner decision is recorded with `resolve`.
-   **deploy-dev `--migration-receipt`.** The receipt check is input validation and stays before the guard (it opens
    the migration receipt read-only); the deploy receipt is opened only inside the write.
-   **Test seams.** The writers' `main` (and `runDevRelease`) take `guardEnv` / `guardDeps` for the guard only;
    `lemon-lambda-deploy` `main` also takes `run` (default `runDeployment`), as `lemon-lambda-deploy-dev` did.

## Order of a guarded write

```text
lemon-lambda-deploy --apply
  parse argv → loadDeployment (config + artifact checks)
  → classifyTarget({ project, stage })
      outside the registry → client → runDeployment → stdout (unchanged)
      reviewed → install → host lock → journal idle? → registry entry → journal inflight
               → client → runDeployment → journal completed → stdout + guard
               (blocked at any step → GUARD_BLOCKED, exit 1; nothing after it runs)

lemon-lambda-deploy-dev --apply
  parse argv → reviewed config copy → loadDeployment → same target check
  → --migration-receipt check (read-only) → placeholder check
  → guard (as above, holder lemon-lambda-deploy-dev) → client → runDeployment → stdout + guard

lemon-lambda-migrate <phase> --execute
  parse argv → validateMigrationConfig → validateRepository
  → executionPrecheck (platform, target, placeholders, consent, confirm-stack)
  → guard (holder lemon-lambda-migrate:<phase>)
  → executeMigration (run dir, receipt, LOCK file, STS, canonical child) → stdout + guard

plan (no --apply / --execute)
  ... → classifyTarget → outside: plan as before | reviewed: plan + guardStatus summary
```

## Exit codes

| Command                         | 0                       | 1                                                             | 2                                                                       | 3                                          |
| ------------------------------- | ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `lemon-lambda-deploy`           | plan / completed        | `GUARD_BLOCKED`, a failed write (journal `unknown`), failures | input errors (as before)                                                | unknown write, `WRITE_UNKNOWN` (as before) |
| `lemon-lambda-deploy-dev`       | plan / completed        | same as above                                                 | input / target (as before)                                              | same as above                              |
| `lemon-lambda-migrate` (phases) | plan / completed        | same as above                                                 | input / flags (as before)                                               | same as above                              |
| `lemon-lambda-guard`            | success (status: ready) | blocked status, refusals (`INSTALL_EXISTS`, `ROOT_EXISTS`, …) | `INVALID_ARGS`, `INVALID_INPUT`, `TARGET_MISMATCH`, `REVISION_MISMATCH` | —                                          |

## `lemon-lambda-guard`

| Command                                                                                                          | What it does                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init --root <root> --port <1024..65535> --confirmed-by <name>`                                                  | Writes the install file at `installPath()` (`LEMON_MIGRATION_GUARD_INSTALL`, absolute, else `~/.lemon-core/migration-guard.install.json`; 0600, never overwritten: `INSTALL_EXISTS`), then `initializeRoot`. `machineId` = first 16 hex of sha256(hostname). A failed root setup removes the new install file again. |
| `register --config <config> --run-state <…> --class <…> --baseline-kind <…> --run-ref <absolute run-state path>` | Reads `account` / `region` / `stage` / `project` (and `stack` of a migration config) from a validated migration or deploy config and calls `registerTarget`. The run-state path is stored as its sha256 only. Enums and the absolute path are checked first (exit 2).                                                |
| `status --config <config>`                                                                                       | Prints `guardStatus` as is (`not-applicable` outside the registry, with no guard state I/O). Exit 1 when blocked.                                                                                                                                                                                                    |
| `resolve --operation <uuid> --ref <decision ref> --digest <sha256 hex>`                                          | `resolveOperation`: records the owner decision on an `inflight` / `unknown` operation (B30 rules for the ref and the digest).                                                                                                                                                                                        |

Errors are one stderr JSON line `{ status: "failed", code, message }`; the message is a fixed sentence passed through
`scrub()` (no path, no account). `init` prints the install file and the root it wrote (the operator's own values).

## Operating procedure (one machine)

1. **Install once.** Pick a root on a local, non-synced volume and a port reserved for the guard:
   `npx lemon-lambda-guard init --root <root> --port <port> --confirmed-by <name>`.
2. **Register the reviewed dev targets** (lemon-templates-api, lemon-hello-api, eureka-hello-api), each from its
   private migration config and with the values of its last check (B27 `reconcile` class, run state, baseline):
   `npx lemon-lambda-guard register --config <migration config> --run-state completed --class verified-no-op --baseline-kind run-receipt --run-ref <run-state dir>`.
   A target without run state in this checkout uses `--run-state none --baseline-kind first-observation`.
3. **Check.** `npx lemon-lambda-guard status --config <config>` → `ready`. The plan of each writer shows the same
   summary.
4. **Write.** `lemon-lambda-deploy-dev --apply`, `lemon-lambda-migrate <phase> --execute` or `lemon-lambda-deploy --apply` as before; the result carries `guard.operationId`.

### Recovery

A write that ends `unknown` (or failed, or with `stateWriteFailed`) leaves its journal operation unresolved, and every
guarded write of the installation is `blocked: journal-unresolved`. Check the target (deploy receipt, run receipt,
B27 `inspect` / `reconcile`), record the owner decision somewhere durable, then:
`npx lemon-lambda-guard resolve --operation <operationId> --ref <decision ref> --digest <sha256 of the decision text>`.
A resolution records that a decision exists; it does not approve or repeat the write. If the target's run state
changed, `register` it again with the new values.

## Limits

-   Same as B30: a cooperative control of one installation, not a security boundary; another installation, another
    machine or a tool without the guard is not stopped.
-   `guardStatus` in a plan reads without the lock; the write checks again under the lock.
-   A known failure of the write blocks the installation until `resolve` (fail-closed by the B30 journal states).
-   The expected account / region are the config's; the live STS account is still checked by the writers themselves
    (migrate: STS before the canonical child; deploy: the deploy-service answers are checked against the config
    account and region).

## Tests

-   `bin/lib/guard-writers.spec.mjs` (18): per writer (a) outside the registry — pre-B31 bytes, no guard fs / net /
    home access; (b) no installation — `install-invalid`, write and client not called, no receipt dir / run dir;
    (c) installed and registered — write once, `guard.operationId`, journal `completed` with the holder; (d) unknown
    or failed write — `operationId`, then `journal-unresolved`; (e) plan summary (`ready`, `install-invalid`,
    `identity-mismatch`, `not-registered`); `stateWriteFailed` after a completed and after a failed write; a missing
    `--allow-sensitive-backup` refused before the guard (journal idle); `runGuarded` input errors.
-   `bin/lib/guard-cli.spec.mjs` (8): help and argument errors; `init` normal, `INSTALL_EXISTS`, input errors, rollback
    on `ROOT_EXISTS`; `register` from a migration and a deploy config, history, enum / relative path / target
    refusals; `status` (not-applicable without guard I/O, blocked, ready); `resolve` normal, `INVALID_INPUT`,
    `OPERATION_NOT_FOUND`, `OPERATION_RESOLVED`; missing installation.
-   Existing specs: the reviewed-target apply / execute cases now provision a guard installation
    (`bin/lib/guard-test-fixture.mjs`, test-only), and the B24 / B27 compat locks compare the CLI output without the
    appended `guard` field — every captured hash is unchanged (`deploy.spec`, `dev-release.spec`,
    `migrate-diagnostic.spec`, `migrate-inspect.spec`, `migrate-targets.spec`). `bin-entries.spec` lists the new bin.
