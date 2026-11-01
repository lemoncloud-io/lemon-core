# v5 B27 — read-only follow-up of a migrated stack (`lemon-lambda-migrate inspect | reconcile | resolve | adopt-baseline`)

Track: v5 deployment (in preparation, `HOW_TO_DEPLOY_V5.md`), not the code upgrade (`HOW_TO_UPGRADE_V5.md`).

Status: implemented on `feat/v5-b27-migrate-inspect` (base `v5` @ `68b05490`, lemon-core 5.0.17). Not released; no
version bump. This is one slice of the deployment-migration tool plan (inventory / reconcile / no-op for stacks that
are already migrated). The other strategies of that plan (keep / detach / retire / adopt, the server-side approval
and lease) are not part of it. B27-b (same branch) adds the first-observation baseline for a migrated target without
run state in the checkout (§ First-observation baseline).

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
lemon-lambda-migrate inspect   --config <file> [--execute] [--http-probe | --discover]
lemon-lambda-migrate reconcile --config <file> --inventory <file> [--deploy-receipt <file>] [--resolution <file>]...
lemon-lambda-migrate resolve   --config <file> --inventory <file> --accept <path>=<from>-><to> [--accept ...] --reason <text>
lemon-lambda-migrate adopt-baseline --config <file> --inventory <file> --reason <text>
lemon-lambda-migrate <inspect|reconcile|resolve|adopt-baseline> --help
```

-   `--config` is the existing migration config (schema unchanged). It must match one reviewed target of the B24
    registry, and the pinned checkout is validated exactly as for the phases (`validateRepository`).
-   The command must be the **first** argument. Every other argv takes the B19/B24 path unchanged; the general
    `--help` keeps its text (the new usage is `<command> --help`).
-   `inspect`, `reconcile` and `resolve` need the owned run state of the target (`<runsDir>/<stack>/`, owner file +
    integrity-checked receipt of this config). `inspect --execute` without it stops with `RUN_STATE_MISSING` and
    creates nothing: creating the run dir would make a later `plan` phase refuse to start. A target without run
    state uses `inspect --discover`, `adopt-baseline` and `reconcile` against that baseline (§ First-observation
    baseline); `--discover` and `adopt-baseline` are refused (`RUN_STATE_PRESENT`, exit 2) when run state exists.

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
| `ambiguous-discovery`        | first-observation mode only: the discovery could not attribute a resource to exactly one stage (B27-b)       |

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

## First-observation baseline (B27-b)

Owner decision (2026-11-01): a target that was migrated but has **no run state in this checkout** (lemon-templates-api
dev) adopts its **first observation** as the baseline. Without `--discover` nothing changes: `inspect --execute` on
such a target still stops with `RUN_STATE_MISSING` before any AWS call.

```sh
npm run lambda:migrate -- inspect --config migration.json --execute --discover
npm run lambda:migrate -- adopt-baseline --config migration.json --inventory <.observed/inspections/…json> --reason '<owner decision>'
# later
npm run lambda:migrate -- inspect --config migration.json --execute --discover
npm run lambda:migrate -- reconcile --config migration.json --inventory <the newer inventory> [--deploy-receipt <receipt.json>]
```

### `inspect --execute --discover`

Allowed only when `<runsDir>/<stack>/` does not exist. Same STS check, same read-only allowlist, same per-resource
reads and field shapes as `inspect`; no HTTP probes (`--http-probe` is refused with `--discover`). The resources are
discovered from five sources, each recorded on the resource as `discoveredBy`:

| Source                 | Read                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the two functions      | `<stack>-lambda`, `<stack>-backend` (`lambda get-function-configuration`, `list-tags`, `list-event-source-mappings`)                                                                                                               |
| `event-source-mapping` | their mapping sources: a DynamoDB stream ARN gives the table, an SQS ARN the queue (this account/region only)                                                                                                                      |
| `sns-subscription`     | `sns list-subscriptions` (account-wide, filtered by `--query` to `Endpoint` = one of the two function ARNs)                                                                                                                        |
| `log-group-prefix`     | `/aws/lambda/<function>` (`logs describe-log-groups --log-group-name-prefix`)                                                                                                                                                      |
| `tag`                  | `resourcegroupstaggingapi get-resources --tag-filters Key=deploy-managed,Values=true Key=deploy-project,Values=<project without -api> --resource-type-filters dynamodb:table sqs sns s3 logs:log-group apigateway lambda:function` |

The tag rule is the one of the canonical `tag` phase at the pinned revision (`deploy-managed=true`,
`deploy-project` = the project without `-api`; tables, queues, topics, log groups, the REST API, and buckets via
`PutBucketTagging`). A tagged REST API is named with `apigateway get-rest-api`; a tagged mapping of another function
is attributed through `lambda get-event-source-mapping` (its function).

**Stage attribution.** `deploy-project` carries no stage, so each tagged resource is attributed by its name (a REST
API by its API name, e.g. `dev-<service>`; an API stage by its stage name):

1. The name is split into lower-case alphanumeric segments; the segments of the project name are ignored. The
   stage words are `local`, `dev`, `develop`, `test`, `qa`, `stage`, `staging`, `prod`, `production` and the config
   stage. Exactly one stage word attributes the resource to that stage; none or several is not attributable.
2. A tagged resource that the two functions already lead to (mapping, subscription, log group) is ours when its
   name has our stage word or none; a name with another stage word is a **conflict**.
3. Another stage is **excluded** (recorded with its stage; stdout counts per stage).
4. Not attributable, a conflict, a tagged function of our stage other than the two, several REST APIs of our stage,
   or a tagged API stage of another API is **ambiguous**: the inventory `status` is `blocked`, reason
   `ambiguous-discovery`, with the names of the ambiguous items only (exit 3). Nothing is guessed.
5. Other tagged types of our stage are recorded as `otherTagged` (not observed); mapping sources of another
   service or account are recorded as `external`.

The functions have no env backup: env **key names** only (`env: no-backup`). The inventory is written to
`<runsDir>/<stack>.observed/inspections/<UTC-stamp>.json` (a sibling private dir, 0700/0600, the same record
rules). `<runsDir>/<stack>/` is never created, so a later `plan` phase starts as before (tested).

### `adopt-baseline`

Offline. The inventory must be a `--discover` inventory of this target and config with `status: observed` (no read
error, no `ambiguous-discovery`), stack `absent`, both functions present, `Active` / `Successful` and
`deploy-managed=true`, and not older than 1 h. Writes `<runsDir>/<stack>.observed/baseline.json` with an exclusive
create; an existing baseline is never replaced (`BASELINE_EXISTS`, exit 2; a later re-adoption needs its own
design). The record binds the inventory sha256, the target, the config fingerprint, the tool version / Git SHA,
`createdAt` and the reason: `kind: local-attestation`, `provenance: first-observation`, `authorizesMutation: false`,
`notProven: [equality-with-migration-time-state, data-equality, event-delivery, deploy-service-history]`.

### `reconcile` against the first observation

When `<runsDir>/<stack>/` does not exist and `baseline.json` does, `reconcile` compares a **newer** `--discover`
inventory (another file, later `startedAt`; else `INVENTORY_NOT_NEWER`, exit 2) with the adopted one (its sha256
must still match the baseline). Same axes and rules as above, with the adopted values as expected values: the table
id is compared too, the code sha must equal the adopted one or the artifact of a valid completed deploy receipt,
env is the key-name set only, and a resource discovered now but not at adoption is a difference
(`discovered-resource-set`). Blocking reasons: `ambiguous-discovery`, `read-error`, `stack-present`,
`inventory-stale`, `target-mismatch`, `cf-owned-resource`. `--resolution` is refused (there is no receipt). The
result carries `baseline: first-observation`, `runReceipt: none`, `notProven`, `scope` and `notCompared`, and is
written to `.observed/inspections/<inventory-stamp>.reconcile-<UTC-stamp>.json`.

### Limits of a first-observation baseline

-   It proves nothing about the state at migration time: the first observation is only what was live at that
    moment, adopted by an owner decision (`notProven`). It is not the T4 approval and authorizes no write.
-   Stage attribution relies on stage words in resource names. A resource of our stage whose name has no stage word
    and that no function leads to blocks the discovery; the owner must resolve that outside the tool.
-   The tag rule, the `--resource-type-filters` strings and the `sns list-subscriptions` filter follow the AWS CLI
    and the canonical script; they are not yet confirmed against a live account. A rejected filter or call is a read
    error (`observed-with-errors`), which adoption refuses (fail-closed).
-   Env values cannot be compared (no backup); only key names.

## Private records

| Record     | Path (under `<runsDir>/<stack>/`)                          | Kind                             |
| ---------- | ---------------------------------------------------------- | -------------------------------- |
| inventory  | `inspections/<UTC-stamp>.json`                             | `lemon-lambda-migrate/inventory` |
| reconcile  | `inspections/<inventory-stamp>.reconcile-<UTC-stamp>.json` | `lemon-lambda-migrate/reconcile` |
| resolution | `resolutions/<UTC-stamp>.json`                             | `local-attestation`              |

B27-b, without run state (under `<runsDir>/<stack>.observed/`): `inspections/<UTC-stamp>.json` (discover inventory,
`mode: discover`), `inspections/<inventory-stamp>.reconcile-<UTC-stamp>.json` (`mode: first-observation`), and
`baseline.json` (`local-attestation`, `provenance: first-observation`), with the same file rules.

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

`bin/lib/migrate-inspect.spec.mjs` (22): the 4 compat locks above, and — with a fake `aws` CLI (an injected
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
argument errors. B27-b (4): discovery from all five sources with prod resources of the same tag excluded (not
ambiguous) and a stage-less table attributed by its wiring; ambiguous cases (no stage word, several stage words, a
conflict with the wiring, an extra function, two REST APIs of the stage) blocked; `--discover` refused with run state; adopt refusals (read
error, stack present, ambiguous, unmanaged / not Active function, stale) and the append-only baseline; reconcile
against it (`verified-no-op`, a new code sha with and without a deploy receipt, a new resource and env keys, stale,
ambiguous, `--resolution` refused); no `<runsDir>/<stack>/` after all commands and a later `plan` phase still starts.
Every case asserts the read-only allowlist (no write verb, no `get-function`, no `invoke`), the
scrubbed environment and the absence of env values, ARNs, the account and credentials on stdout/stderr.
