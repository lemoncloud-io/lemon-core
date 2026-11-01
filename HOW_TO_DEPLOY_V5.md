# DEPLOY GUIDE: the v5 deployment (in preparation)

> **Status: in preparation.** This is the deployment track of v5. It is separate from upgrading your service code to v5, which is [HOW_TO_UPGRADE_V5.md](HOW_TO_UPGRADE_V5.md). The tools below ship with lemon-core 5, but the track is not ready for general use. Keep your current deployment unless the lemon-core maintainers have onboarded your service.

## Two tracks

| Track           | What changes                                                                                           | Status             | Guide                                        |
| --------------- | ------------------------------------------------------------------------------------------------------ | ------------------ | -------------------------------------------- |
| Code v5 upgrade | Your service source: lemon-core 5, Node 24, imports, dependencies, local tools                         | Ready              | [HOW_TO_UPGRADE_V5.md](HOW_TO_UPGRADE_V5.md) |
| v5 deployment   | A deployed service or a similar environment: who owns the stack, how code and environment reach Lambda | **In preparation** | this file                                    |

The word "migrate" in `lemon-lambda-migrate` means the deployment track: it moves a deployed Serverless stack under the deploy service. It does not change your code.

## Tools (deployment track)

| Script in your `package.json` | Command                   | What it does                                                                                            | Details                            |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `lambda:pack`                 | `lemon-lambda-pack`       | builds a verified Lambda ZIP in Docker, offline                                                         | `docs/v5/B19-bin-deploy.md`        |
| `lambda:deploy`               | `lemon-lambda-deploy`     | deploys a packed ZIP through the deploy service; offline plan by default                                | `docs/v5/B19-bin-deploy.md`        |
| `lambda:deploy:dev`           | `lemon-lambda-deploy-dev` | the guarded dev release of a migrated dev target                                                        | `docs/v5/B19-bin-deploy.md`        |
| `lambda:migrate`              | `lemon-lambda-migrate`    | one guarded phase of a reviewed stack migration                                                         | `docs/v5/B24-migration-targets.md` |
| `lambda:env`                  | `lemon-lambda-env`        | builds the Lambda environment from the env file and compares it with the deployed functions (read-only) | `docs/v5/B26-lambda-env.md`        |
| (none; `npx`)                 | `lemon-lambda-guard`      | the migration guard of this machine: install, register a reviewed target, status, resolve               | `docs/v5/B31-guard-writers.md`     |

-   `lemon-lambda-migrate` and `lemon-lambda-deploy-dev` accept only a reviewed target: the project, stack and revision must match one entry of `bin/lib/org-defaults.mjs` `migration.targets` (since B24: `lemon-templates-api` dev and `lemon-hello-api` dev; B28 adds `eureka-hello-api` dev, migrated 2026-11-01). A new service is added by a reviewed lemon-core change and release; it cannot be configured.
-   Do not use `lemon-lambda-deploy` `bootstrap` mode for a migrated service (lemon-hello-api, and eureka-hello-api even though its table follows the lemon naming rule): use `lemon-lambda-migrate`, then `lemon-lambda-deploy-dev` in `code` mode (`docs/v5/B24-migration-targets.md`).
-   `code` mode deploys do not change the Lambda environment. `lemon-lambda-env` (B26) builds the map Serverless used to merge on `sls deploy` (values as they are, `!` kept) and compares it by key name; sending it with a deploy is planned (B26 P1).
-   A failed deploy round of any project other than lemon-templates-api is aborted with the reason `lemon-lambda-deploy:<code>` (lemon-templates-api keeps `templates-cli:<code>`). `lemon-lambda-deploy` stops with `TARGET_MISMATCH` before `deploy.begin` when the deploy service resolves function names other than `<project>-<stage>-lambda` / `<project>-<stage>-backend`.
-   AWS SDK peers for `--apply`: `@aws-sdk/client-lambda`, `@aws-sdk/credential-providers`.

## After a migration: inspect, reconcile, resolve (in preparation)

For a stack that the phases already moved, `lemon-lambda-migrate` has three follow-up commands (B27,
`docs/v5/B27-migrate-inspect.md`). They change no AWS resource, and never the run receipt, the owner file or the lock.

| Command                                               | What it does                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect --config <file> [--execute] [--http-probe]`  | offline plan by default; `--execute`: STS check, then read-only Describe/Get/List calls, private inventory (`inspections/` of the run); probes are opt-in |
| `reconcile --config <file> --inventory <file> [...]`  | offline: compares the inventory with the run baseline → `verified-no-op`, `reconcile-required` (paths only) or `blocked` (reason codes)                   |
| `resolve --config <file> --inventory <file> --accept` | records a local attestation of an owner decision on the setting DIFF of a `verify` that ended `unknown` (for example a log retention 7 → 14)              |

-   A `verified-no-op` covers the compared axes it lists (`scope`); deploy-service history, event delivery and data
    equality are listed under `notCompared`. `ItemCount` is an approximate reference only.
-   A resolution is not an approval: it authorizes no write, the receipt stays `unknown` and the run stays not
    resumable; `--migration-receipt` still refuses such a run.
-   A migrated target **without run state** in your checkout (for example lemon-templates-api dev) uses the first
    observation as its baseline: `inspect --execute --discover` (functions, their mappings, subscriptions and log
    groups, and the resources the migration tagged; each resource attributed to the stage by its name, otherwise
    `blocked: ambiguous-discovery`), then `adopt-baseline --inventory <file> --reason <text>` once, then `reconcile` with
    a newer `--discover` inventory. It never creates the run dir. Such a baseline proves nothing about the state at
    migration time (`notProven`).

## Migration guard (in preparation)

Since B31, `lemon-lambda-deploy --apply`, `lemon-lambda-deploy-dev --apply` and the six `lemon-lambda-migrate`
phases with `--execute` write a **reviewed target** only through the migration guard (B30 library,
`docs/v5/B30-migration-guard.md`): one guarded write at a time per installation, and a journal that blocks further
writes after an unfinished or unknown one until an owner decision is recorded. Any other deploy target keeps its
exact output and does no guard I/O. A reviewed target's plan shows a `guard` summary (`ready` or `blocked` with a
reason); a blocked write stops with `{"status":"blocked","code":"GUARD_BLOCKED","reason":"…"}` (exit 1) without
opening the deploy receipt, the credentials or the network (deploy-dev's `--migration-receipt` is a read-only input
check made before the guard).

| Command                                                                                                         | What it does                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `lemon-lambda-guard init --root <root> --port <port> --confirmed-by <name>`                                     | once per machine: install file (0600, never overwritten) and a new guard root                                             |
| `lemon-lambda-guard register --config <config> --run-state <…> --class <…> --baseline-kind <…> --run-ref <dir>` | registers a reviewed target with the expected account / region of its config                                              |
| `lemon-lambda-guard status --config <config>`                                                                   | read-only: `ready`, `blocked` with a reason (and the unresolved operation ids), or `not-applicable` (exit 1 when blocked) |
| `lemon-lambda-guard resolve --operation <id> --ref <decision ref> --digest <sha256>`                            | records the owner decision on an unresolved operation; it does not repeat the write                                       |

-   Order: `init` → `register` the three dev targets → `status` → write as before; the result carries
    `guard.operationId`. Recovery after an `unknown` (or failed) write: `status` lists the operation, check the
    target, record the decision, `resolve`. A failure that ends before any AWS effect (for example a phase out of
    order) blocks the same way; only flag and argument errors are refused before the guard. Details and exit codes:
    `docs/v5/B31-guard-writers.md`.
-   The root must be on a local volume that is not synced (`--confirmed-by` records who checked it); the port is
    reserved for the guard.

## Where it stands

-   The dev stages of lemon-templates-api and lemon-hello-api were moved to the deploy service as early runs of this track. Their prod stages were not moved.
-   The B30 migration guard (`docs/v5/B30-migration-guard.md`, one guarded write at a time per installation for the reviewed targets) is connected to the deploy, deploy-dev and migrate writers since B31 (`docs/v5/B31-guard-writers.md`); each machine that writes a reviewed target needs `lemon-lambda-guard init` and `register` first.
-   Open items before the track is ready: sending the environment with a deploy (B26 P1), removing keys (B26 P2), prod stages, and onboarding more services.
