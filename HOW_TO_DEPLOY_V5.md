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

## Where it stands

-   The dev stages of lemon-templates-api and lemon-hello-api were moved to the deploy service as early runs of this track. Their prod stages were not moved.
-   The B30 migration guard (`docs/v5/B30-migration-guard.md`, one guarded write at a time per installation for the reviewed targets) is a library only; it is not connected to the deploy or migrate writers yet.
-   Open items before the track is ready: sending the environment with a deploy (B26 P1), removing keys (B26 P2), prod stages, and onboarding more services.
