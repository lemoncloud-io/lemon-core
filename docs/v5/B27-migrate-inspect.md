# v5 B27 — read-only follow-up of a migrated stack (`lemon-lambda-migrate inspect | reconcile | resolve`)

Track: v5 deployment (in preparation, `HOW_TO_DEPLOY_V5.md`), not the code upgrade (`HOW_TO_UPGRADE_V5.md`).

Status: implemented on `feat/v5-b27-migrate-inspect` (base `v5` @ `68b05490`, lemon-core 5.0.17). Not released; no
version bump. This is one slice of the deployment-migration tool plan (inventory / reconcile / no-op for stacks that
are already migrated). The other strategies of that plan (keep / detach / retire / adopt, the server-side approval
and lease) are not part of it.

## Why

The six phases of `lemon-lambda-migrate` (`plan → retain → remove → tag → apply → verify`, B19/B24) move a
Serverless stack under the deploy service once. After that there was no tool to answer, for a migrated stack:

-   Is the live state still what the migration recorded (its `after.json` / `before.json` baseline)?
-   Is a run whose `verify` ended `unknown` on an observed setting difference (for example a log retention that the
    deploy service set to 14 days where the stack had 7) settled by an owner decision?

B27 adds three commands for that. None of them changes an AWS resource, the run receipt, the owner file, the lock
or a snapshot file.

## Commands

```text
lemon-lambda-migrate inspect   --config <file> [--execute] [--http-probe]
lemon-lambda-migrate reconcile --config <file> --inventory <file> [--deploy-receipt <file>] [--resolution <file>]...
lemon-lambda-migrate resolve   --config <file> --inventory <file> --accept <path>=<from>-><to> [--accept ...] --reason <text>
lemon-lambda-migrate <inspect|reconcile|resolve> --help
```

-   `--config` is the existing migration config (schema unchanged). It must match one reviewed target of the B24
    registry, and the pinned checkout is validated exactly as for the phases (`validateRepository`).
-   The command must be the **first** argument. Every other argv takes the B19/B24 path unchanged; the general
    `--help` keeps its text (the new usage is `<command> --help`).
-   All three need the owned run state of the target (`<runsDir>/<stack>/`, owner file + integrity-checked receipt
    of this config). `inspect --execute` without it stops with `RUN_STATE_MISSING` and creates nothing: creating
    the run dir would make a later `plan` phase refuse to start.

| Exit | `inspect`                                   | `reconcile`                        | `resolve`           |
| ---- | ------------------------------------------- | ---------------------------------- | ------------------- |
| `0`  | plan printed / inventory without read error | `verified-no-op`                   | resolution recorded |
| `1`  | failed (STS account, private state, write)  | failed (private state, record)     | failed              |
| `2`  | invalid input                               | invalid input (bad deploy receipt) | refused / invalid   |
| `3`  | inventory written **with** read errors      | `reconcile-required` or `blocked`  | —                   |

Stdout carries names, counts and status only. No value, no ARN, no account; a last guard masks the configured
account and any `arn:` text (the tests require that nothing needs masking). Errors go to stderr as one JSON line
(`status`, `code`, `message`) without values.

### `inspect`

Without `--execute`: an offline plan — the read APIs and how many calls each (from the baseline identities), the
record it would write, the run receipt status. No AWS call.

With `--execute`:

1. Run state check (owner, receipt integrity, 0700/0600 tree; the same `validateOwned` as every phase), then the
   baseline identities are validated before any of them reaches the AWS CLI.
2. STS `get-caller-identity` with the explicit profile, in the private child (the check of every phase). A
   different account stops the command before any read (`ACCOUNT_MISMATCH`).
3. Read-only AWS CLI v2 calls (`execFile`, `--profile <profile> --region <region> --output json --no-cli-pager`),
   with the scrubbed target environment of the phases (no inherited AWS keys, `GIT_*`, `NODE_OPTIONS`). Only the
   operations below can run (an allowlist in `READS`); Lambda `invoke`, the code ZIP download (`get-function`), tag
   writes and deploy-service tool calls are never made.
4. The inventory is written to `<runsDir>/<stack>/inspections/<UTC-stamp>.json`.

| Observed                                   | AWS CLI read                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stack `<stack>`                            | `cloudformation describe-stacks`                                                                                                                                                 |
| `<stack>-lambda`, `<stack>-backend`        | `lambda get-function-configuration`, `list-tags` (deploy-\* tags kept), `list-event-source-mappings`                                                                             |
| tables (baseline)                          | `dynamodb describe-table`                                                                                                                                                        |
| queues                                     | `sqs get-queue-url`, `get-queue-attributes`                                                                                                                                      |
| topics                                     | `sns get-topic-attributes`, `list-subscriptions-by-topic`                                                                                                                        |
| buckets                                    | `s3api head-bucket`, `list-buckets` (filtered by `--query` to the bucket: no per-bucket API has the creation date), `list-objects-v2`, `get-bucket-website`, `get-bucket-policy` |
| log groups                                 | `logs describe-log-groups`                                                                                                                                                       |
| REST API                                   | `apigateway get-resources --embed methods`, `get-stages`                                                                                                                         |
| CloudFormation owner of each retained item | `cloudformation describe-stack-resources --physical-resource-id <id>` (+ `describe-stacks --stack-name <stack id>` when a stack is listed)                                       |
| HTTP GET probes (only with `--http-probe`) | `GET https://<api>.execute-api.<region>.amazonaws.com/<stage><path>` for the baseline `http` paths; status only; marked `appCall: true`                                          |

Baseline: `after.json` of the run, else `before.json`. The retained identities (tables, queues, topics, buckets,
log groups, API, HTTP probe paths) come from it; without a baseline only the stack and the two functions are read.

Inventory fields mirror the canonical snapshot shapes (`scripts/migrate/migrate.mjs` `snapshot()` at the pinned
revision) so they compare with `after.json`. Every field carries `sourceApi` and `observedAt`:

-   functions: `runtime`, `architecture`, `handler`, `memory`, `timeout`, `codeSha`, `lastModified`, `roleArn`,
    `state`, `lastUpdateStatus`, `envKeys` (names), `env` (categories, below), `tags` (deploy-\* only),
    `eventSourceMappings` (uuid, source ARN, state, batch size, starting position);
-   tables: `arn`, `id`, `created`, `keySchema`, `stream`, `items` (`approximate: true`), `cfOwner`;
-   queues: `url`, `created`, `messages` (`approximate: true`), `cfOwner`;
-   topics: `subscriptions` (confirmed + pending, as the canonical snapshot), `endpoints` (protocol + endpoint, with
    `count`), `cfOwner`; buckets: `created`, `objects`, `website`, `policySids`, `cfOwner`;
    log groups: `created`, `retention`, `cfOwner`; API: `id`, `routes`, `stages`, `cfOwner`.

A resource or field is `present` (with values), `absent`, or `error` with a fixed `errorKind` (`access-denied`,
`throttling`, `timeout`, `other`, or `target-mismatch` for an ARN / queue URL outside the configured account or
region) and the AWS error code. The raw error text is never stored. `absent` is used **only** for an exact
not-found answer: the stack only for the `ValidationError` "Stack with id `<stack>` does not exist"; a function or
table for `ResourceNotFoundException`; a queue for `NonExistentQueue` / `QueueDoesNotExist`; a topic for
`NotFound`; a bucket for `404`; an API for `NotFoundException`; a log group when the exact name is not listed.
AccessDenied, throttling, a timeout or any other error is never absence.

**Env.** The live values are compared in memory with the run's private backup `env.json`
(`{ "<function>": { KEY: value } }`) with `compareEnvironment` of `lambda-env.mjs` (B26). Categories: `same`,
`changed`, `backupOnly` (in the backup, not live), `liveOnly`, and `notComparable` — a KMS ciphertext (`*AQIC…`)
on either side, because it changes per encryption. Only key names, categories and counts are stored. No value and
no hash of a value is stored or printed (T4.5).

**CloudFormation owner.** For every retained resource that is present: the exact "Stack for `<id>` does not exist"
`ValidationError` means no owner (`cfOwner: none`); a listed stack that is `DELETE_COMPLETE` is also `none`, with
`trace: DELETE_COMPLETE`; any other listed stack is `stack` (live owner); any other error is a read error. The
physical id is the table name, the queue URL, the topic ARN, the bucket name, the log group name or the REST API id.

### `reconcile`

Offline. Reads the inventory (must be a record in `inspections/` of this run: private, envelope-checked), the
current run state, an optional deploy receipt and optional resolutions. Writes its result next to the inventory
(`inspections/<inventory-stamp>.reconcile-<UTC-stamp>.json`).

Comparison with the baseline (canonical verify rules, then the B27 changes marked †):

| Axis (scope name)                                | Expected value                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `function-config(handler,memory,timeout)`        | baseline function fields                                                                                                |
| `function-code-sha`                              | baseline `codeSha`, **or** the artifact of a valid completed deploy receipt of this target (hex sha256 → Lambda base64) |
| `function-env-keys`                              | baseline `envKeys`                                                                                                      |
| `function-env-values(...)` †                     | `changed` / `backupOnly` / `liveOnly` keys differ; `notComparable` keys are listed as not compared                      |
| `function-runtime-override`                      | only with a config `runtime`: the live runtime equals it (else runtime is not compared)                                 |
| `function-state(Active,Successful)` †            | `State = Active`, `LastUpdateStatus = Successful`                                                                       |
| `function-management-tag(deploy-managed)`        | `deploy-managed = true` on both functions                                                                               |
| `table-identity(arn,created,keySchema,stream)` † | ARN from the config, baseline `created` / `stream`, key schema of `plan.json` `tableProps`                              |
| `queue-identity(url,created)`                    | baseline                                                                                                                |
| `topic-subscription-count`                       | baseline                                                                                                                |
| `bucket(created,objects,website,policySids)`     | baseline                                                                                                                |
| `log-group(created,retention)`                   | baseline                                                                                                                |
| `rest-api(id,routes,stages)`                     | baseline                                                                                                                |
| `http-status(...)`                               | baseline, only when the inventory was taken with `--http-probe`                                                         |
| `cloudformation-owner-of-retained-resources` †   | `none` for every retained resource                                                                                      |

-   A `created` time also compares by instant († the CLI prints times in the local time zone).
-   `ItemCount` and the queue message count are approximate references only (`approximate: same | different`). They
    are **not** a comparison axis (†: the canonical verify compares items; B27 deliberately does not). A same count
    is no proof of no data loss, and a different count is no proof of loss.
-   Deploy receipt (`--deploy-receipt .artifacts/deploy/run-*/receipt.json` of `lemon-lambda-deploy(-dev)`): the B19
    receipt format has no hash envelope, so its integrity check is the private-file rule (0600 file in a 0700 dir,
    owned, one link, no symlink) plus its internal bindings: `status: completed`, the artifact key ends with
    `/<sha256>.zip`, the code (or bootstrap function) steps and `end` succeeded and were verified, and the function
    ARNs are the two functions of this stack. A receipt that fails that is refused (`DEPLOY_RECEIPT_INVALID`,
    exit 2). A valid receipt of another project / stage / installation is never used and blocks the result
    (`target-mismatch`). Its `deployId` is recorded in the result; checking it against the deploy-service history
    or the active lease is **not** part of B27 (listed under `notCompared`).

Classes (`class`), with the reasons of `blocked` (all that apply):

| Class                | When                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| `verified-no-op`     | no blocking reason and every compared axis equal (or explained by the deploy receipt) |
| `reconcile-required` | no blocking reason, but differing field **paths** (listed, no values on stdout)       |
| `blocked`            | one or more reasons below                                                             |

| Reason                       | Meaning                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no-baseline`                | the run has neither `after.json` nor `before.json`                                                           |
| `stack-present`              | the CloudFormation stack exists                                                                              |
| `read-error`                 | any observation of the inventory is `error`                                                                  |
| `inventory-stale`            | the inventory is older than 1 h (or dated in the future), or the receipt / baseline / env backup changed     |
| `receipt-unknown-unresolved` | the run receipt is not `completed` and no applicable resolution covers it                                    |
| `target-mismatch`            | inventory of another target or config, live ARN outside the account/region, deploy receipt of another target |
| `baseline-changed`           | a snapshot file differs from the hash the receipt recorded (`changed-after-verify` / `-plan`)                |
| `cf-owned-resource`          | a retained resource is still owned by a live CloudFormation stack                                            |

The result also reports, unchanged, the original run receipt status (`completed`, `unknown`, …), the lock
(`present` / `absent`), the baseline binding (`bound-at-verify`, `unbound-at-verify` when `verify` stopped before
recording the `after.json` hash — the hello case, the sha256 is pinned in the result —, `changed-after-…`), and the
run state:

| Run state                | Meaning                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `completed`              | the receipt is `completed`                                                                                |
| `resolved-observed-diff` | the receipt stopped `unknown` at `verify` and an applicable resolution attests exactly its DIFF; terminal |
| `unresolved`             | any other receipt status                                                                                  |

`resumable` is `false` for both non-ready states: no phase resumes an unknown run (the phases still refuse it
with `SEQUENCE_INVALID`, and `--migration-receipt` still refuses it with `RECEIPT_INVALID`).

Every result carries `scope` (the axes compared) and `notCompared`, for example
`deploy-service-history-and-active-lease`, `event-delivery`, `data-equality`, `runtime-performance`,
`iam-role-and-policy`, `table-item-count (approximate reference only)`, `http-status (probes off)`,
`kms-encrypted-env-values`. A `verified-no-op` is a statement about the compared axes only.

### `resolve`

A **local attestation** of an owner decision. It is not the server-side approval receipt the deployment-migration
plan proposes (T4), it authorizes no write, it never changes the receipt to `completed`, and it never removes the
lock.

-   Only a run whose receipt stopped `unknown` at `verify` (five phases completed, `after.json` present) can be
    resolved, and only for the DIFF of that verify: `before.json` vs `after.json` with the canonical verify rules,
    without `ItemCount`.
-   The accepted paths must equal that DIFF set **exactly** (all of it, nothing else), with `<from>` = the
    `before.json` value and `<to>` = the `after.json` value, and the inventory must still observe `<to>`.
-   Only non-secret scalar settings: `logGroups/<name>/retention`, `functions/<name>/memory`,
    `functions/<name>/timeout`. Env keys and values, code, ARNs, URLs, identities and policies are refused. A value
    is an integer, or `none` for unset (for example a retention that never expires).
-   The inventory must be fresh (≤ 1 h) and of the current run state. `--reason` is 1–500 printable characters.
-   The record binds: the sha256 of the receipt file (envelope), `ownerId`, the config fingerprint, the receipt's
    snapshot hashes, the sha256 and binding of `before.json` and `after.json` (`unbound-at-verify`), the inventory
    sha256, the accepted paths with from/to, the reason, the tool version and Git SHA (when lemon-core runs from its
    own checkout, else `null`) and `createdAt`. `kind: "local-attestation"`, `authorizesMutation: false`.
-   Written to `<runsDir>/<stack>/resolutions/<UTC-stamp>.json`, append-only (a file is never overwritten).

`reconcile --resolution <file>` applies a resolution only when all its bindings still match the run and its
accepted set equals the verify DIFF; otherwise it is reported as not applied.

Field paths are `<section>/<name>/<field>`, with the name as is: a log group gives a double slash, e.g.
`logGroups//aws/lambda/lemon-hello-api-dev-lambda/retention`. A topic is named by its topic name, never its ARN.

Example (the hello case: verify `unknown` on the retention DIFF 7 → 14):

```sh
npm run lambda:migrate -- inspect --config migration.json --execute
npm run lambda:migrate -- reconcile --config migration.json --inventory <inspections/…json> --deploy-receipt <receipt.json>
#   → blocked [receipt-unknown-unresolved], runState unresolved, baseline unbound-at-verify
npm run lambda:migrate -- resolve --config migration.json --inventory <inspections/…json> \
    --accept 'logGroups//aws/lambda/lemon-hello-api-dev-lambda/retention=7->14' \
    --accept 'logGroups//aws/lambda/lemon-hello-api-dev-backend/retention=7->14' --reason '<owner decision>'
npm run lambda:migrate -- reconcile --config migration.json --inventory <inspections/…json> \
    --deploy-receipt <receipt.json> --resolution <resolutions/…json>
#   → verified-no-op, runState resolved-observed-diff, receipt still unknown, lock present
```

## Private records

| Record     | Path (under `<runsDir>/<stack>/`)                          | Kind                             |
| ---------- | ---------------------------------------------------------- | -------------------------------- |
| inventory  | `inspections/<UTC-stamp>.json`                             | `lemon-lambda-migrate/inventory` |
| reconcile  | `inspections/<inventory-stamp>.reconcile-<UTC-stamp>.json` | `lemon-lambda-migrate/reconcile` |
| resolution | `resolutions/<UTC-stamp>.json`                             | `local-attestation`              |

-   Dirs 0700, files 0600, owned, one link, no symlink (a symlinked or loose record dir is refused before any AWS
    call). Each file is created with `wx` (never an overwrite) and carries the receipt-style envelope
    `{ payload, sha256 }`; a reader refuses a record outside its dir of this run or with a broken envelope.
-   The records stay **inside** the run dir. The run-tree check of every phase (`privateTree`: 0700/0600, one link,
    no symlinks) accepts them, so `verifyMigrationReceipt` (the `--migration-receipt` gate) still passes for a
    completed run that holds them (tested). The snapshot hashes cover named files only, so the records never change
    a receipt binding.
-   The records may hold ARNs and URLs (private run state, like `plan.json`); they never hold an env value.

## Limits

-   No mutation: STS identity and Describe/Get/List reads only; probes only with `--http-probe` (they are app calls).
-   `ItemCount` / message counts are approximate references, not evidence of data equality.
-   Env: key names and categories only; KMS ciphertext values are not comparable.
-   The not-found texts of `describe-stacks` and `describe-stack-resources` are matched exactly. They were taken from
    the AWS CLI error format and are not yet confirmed against a live account in this slice: if AWS answers with
    another text, the observation is a read error and `reconcile` is `blocked` (fail-closed), never a false no-op.
-   Not compared: deploy-service history and lease, event delivery, data equality, runtime performance, IAM role and
    policy, mapping / subscription settings beyond what is listed.
-   `resolve` is not the T4 approval and does not make a run resumable.

## Byte-identical existing phases

`bin/lib/migrate-inspect.spec.mjs` § compat holds values captured on `v5` @ `68b05490` before any code change; the
same spec passed on that base (twice) before the code was edited:

| What                                                                                    | sha256                            |
| --------------------------------------------------------------------------------------- | --------------------------------- |
| general `--help` stdout                                                                 | `c7fb0872…`                       |
| six CLI offline plans, templates / hello (checkout root stubbed, node path masked)      | `0af6a126…` (= B24) / `b5ca05cf…` |
| existing argument errors (stderr + exit code, incl. `inspect` as a 2nd argument)        | `18464baa…`                       |
| six `--execute` stdouts + the masked final receipt + run-dir listing, templates / hello | `5847a7b4…` / `1351c3b8…`         |

Every command case also checks that the receipt, owner, lock, `plan.json`, `env.json`, `before.json` and
`after.json` are byte-identical before and after the command.

## Tests

`bin/lib/migrate-inspect.spec.mjs` (18): the 4 compat locks above, and — with a fake `aws` CLI (an injected
`execFile`), a fetch spy and a control-write spy — the offline plan and `RUN_STATE_MISSING` (no run dir created);
the inventory (fields with `sourceApi`/`observedAt`, deploy-\* tags only, mapping and subscription shapes, env
categories with a KMS key, the filtered bucket list, one owner read per retained resource); absent vs AccessDenied
vs throttling vs timeout vs another ValidationError (exit 3, never absent); absent function, in-progress update,
CloudFormation-owned table and a `DELETE_COMPLETE` trace; baseline `after.json` vs `before.json` vs none; probes
off by default and `appCall`; symlinked / loose record dir, wrong STS account, append-only stamp; `reconcile`
classes and every reason; code sha via a deploy receipt (valid, three tampered forms, loose mode, other project);
runtime override; the hello flow (unknown verify → resolve → `resolved-observed-diff`, receipt and lock unchanged,
`--migration-receipt` gate and phases still refuse); resolve refusals (env key, env value, code, URL, item count,
partial / extra set, wrong from/to, syntax, duplicate, reason, stale, moved live value, completed run); CLI help and
argument errors. Every case asserts the read-only allowlist (no write verb, no `get-function`, no `invoke`), the
scrubbed environment and the absence of env values, ARNs, the account and credentials on stdout/stderr.
