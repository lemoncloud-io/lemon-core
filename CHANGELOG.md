# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## Unreleased (5.x)

### Features

* **B19 Lambda tools** (`docs/v5/B19-bin-tools.md`, `docs/v5/B19-bin-deploy.md`, `HOW_TO_UPGRADE_V5.md` § 19): the tools services copied from lemon-templates-api `bin/` ship as npm `bin` commands — `lemon-lambda-invoke`, `lemon-lambda-logs`, `lemon-lambda-perf`, `lemon-fields-admin`, `lemon-loop-check`, `lemon-lambda-pack`, `lemon-lambda-local`, `lemon-lambda-deploy`, `lemon-lambda-deploy-dev`, `lemon-lambda-migrate`. Same flags and output; the service root is the working directory; missing optional AWS SDK peers stop with an `npm i -D` hint; the `.bin` symlink start is detected (`realpath`). The node:test suites are ported to vitest (`bin/lib/*.spec.mjs`). No new `dependencies`.
* **B20 local API Gateway** (`docs/v5/B20-local-gateway.md`, `HOW_TO_UPGRADE_V5.md` § 20): `buildExpress()` emulates API Gateway (REST v1) from `serverless.yml` — routes of `functions.*.events[].http` (CloudFormation tags and `${self:…}` tolerated), literal > `{param}` > `{proxy+}`, exact method > `ANY`, REST v1 events, CORS preflight from route `cors`, `binaryMediaTypes` for request and response bodies (download as bytes when `Accept` matches). Same public API; `prefix` is ignored; no `serverless.yml` → the legacy `/{type}/{id}/{cmd}` routes with a warning.
* **B20 `{proxy+}`**: the web handler maps `{proxy+}` to `id` (first segment) and `cmd` (the rest, may hold `/`); `{cmd+}` is kept as is. The same mapping feeds `context.source`.
* **B20 binary bodies**: a base64 request body is decoded by content type — textual → string, `multipart/form-data` → `{ ...fields, file, files }` (each with `buffer`), other → `Buffer`. A `Buffer` result body is sent as base64.
* **B24 reviewed migration targets** (`docs/v5/B24-migration-targets.md`, `HOW_TO_UPGRADE_V5.md` § 19): `lemon-lambda-migrate` / `lemon-lambda-deploy-dev` accept any entry of a frozen, reviewed registry (`ORG_DEFAULTS.migration.targets`) instead of one pinned target; lemon-hello-api dev is the second entry (rehearsed at the pinned revision), with generic state names (`migrate-receipt.json`, `migrate-owner.json`, `migrate.lock`, owner `lemon-lambda-migrate`, temp prefix `lemon-dev-config-`). The config keeps its keys and must match exactly one entry (else `TARGET_MISMATCH`); entries are not overridable by config or flags. lemon-templates-api is byte-identical (fingerprint, offline plan, state paths, owner tag, abort reason, temp prefix, error codes; locked by `bin/lib/migrate-targets.spec.mjs`).
* **B28 eureka-hello-api dev target** (`docs/v5/B24-migration-targets.md` § B28): third entry of `ORG_DEFAULTS.migration.targets` (`eureka-hello-api` / `dev` / `eureka-hello-api-dev`, same pinned revision, generic state names). Its dev stack was migrated directly by owner decision, without a sandbox rehearsal (2026-11-01, `verify` all same). The target lists of the `TARGET_MISMATCH` messages and both `--help` texts name it; lemon-templates-api and lemon-hello-api outputs are byte-identical. Bootstrap mode is still not for a migrated service.

* **B26 `lemon-lambda-env`** (`docs/v5/B26-lambda-env.md`, `HOW_TO_DEPLOY_V5.md`): new bin. `build --env-file <yml> --stage <stage> --output <json>` turns the `<stage>` section of the service env file into the Lambda environment string map the Serverless Framework merged on deploy (strings as they are with a leading `!` kept, number/boolean stringified, null/object/array and bad key names rejected by key name; not `loadEnviron()` rules); the file stays inside the service root (no `..` / symlink escape) and the output is written 0600 (dir 0700) atomically. `diff --config <deploy config> --env <json>` reads the `lambda` / `backend` functions with `GetFunctionConfiguration` only and reports `same` / `changed` / `new` / `liveOnly` (and encrypted `*AQIC` keys) by name. No value or hash of a value is ever printed. P0 only: `code` mode deploys still do not change the environment.
* **B27 `lemon-lambda-migrate inspect | reconcile | resolve`** (`docs/v5/B27-migrate-inspect.md`, `HOW_TO_DEPLOY_V5.md`): read-only follow-up for a stack the phases already migrated. `inspect` is an offline plan by default; `--execute` checks the STS account, then runs only reviewed Describe/Get/List AWS CLI calls (stack, both functions with State/LastUpdateStatus, deploy-\* tags and mappings, the baseline's tables / queues / topics / buckets / log groups / API, and the CloudFormation owner of each retained resource; HTTP probes only with `--http-probe`) and writes a private inventory (0600, `inspections/` of the run, every field with `sourceApi`/`observedAt`; `absent` only for exact not-found answers). Env values are compared in memory with the run's `env.json` (B26 `compareEnvironment`); only key names, categories and counts are stored (`*AQIC` values `notComparable`). `reconcile` (offline) compares with `after.json` / `before.json` and gives `verified-no-op` (with `scope` / `notCompared`), `reconcile-required` (field paths) or `blocked` (`no-baseline`, `stack-present`, `read-error`, `inventory-stale`, `receipt-unknown-unresolved`, `target-mismatch`, `baseline-changed`, `cf-owned-resource`); a completed deploy receipt explains a new code sha; `ItemCount` is an approximate reference only. `resolve` writes an append-only local attestation (`local-attestation`, not an approval) of the exact setting DIFF of a `verify` that ended `unknown`; the receipt, owner file and lock are never changed, and the run stays not resumable. The six phases are byte-identical (help, plans, argument errors, execute outputs and receipts locked by `bin/lib/migrate-inspect.spec.mjs`).
* **B27-b first-observation baseline** (`docs/v5/B27-migrate-inspect.md` § First-observation baseline): for a migrated target without run state in the checkout, `inspect --execute --discover` (refused when run state exists) discovers the functions' mappings, SNS subscriptions (account list filtered by `--query`), log groups and the resources tagged by the canonical `tag` phase (`deploy-managed=true`, `deploy-project=<project without -api>`), attributes each tagged resource to a stage by a stage word in its name (cross-checked with the function wiring; another stage excluded, anything else `blocked: ambiguous-discovery`), observes them with the same read-only reads, and writes to `<runsDir>/<stack>.observed/` (never `<runsDir>/<stack>/`). `adopt-baseline` records the first observation once as `baseline.json` (`local-attestation`, `provenance: first-observation`, `notProven`); `reconcile` compares a newer discover inventory with it (`baseline: first-observation`, `runReceipt: none`).
* **B30 migration guard** (`docs/v5/B30-migration-guard.md`, `HOW_TO_DEPLOY_V5.md`): new library `bin/lib/migrate-guard.mjs`, the common execution base of the reviewed migration targets (P2-a). `classifyTarget` matches project + stage exactly against `ORG_DEFAULTS.migration.targets` (checked on every call; a damaged list is `REGISTRY_INVALID`, fail-closed); a target outside it is `not-applicable` and `guardedWrite` / `guardStatus` do no guard state I/O for it (N14: no install file, root, port or journal). For an applicable target, `guardedWrite` runs installation → host lock → journal → write: the install file outside the root (`LEMON_MIGRATION_GUARD_INSTALL` as an absolute path, else `~/.lemon-core/migration-guard.install.json`; no path argument; root its own real path, root `install.json` bound to root / port / machineId, `MIGRATION_STATE_DIR` must match, sync / mount paths refused best effort plus a recorded `localVolume` confirmation), an exclusive `127.0.0.1` listen on the install port (`LOCK_BUSY` → `blocked: busy`, no fallback, freed by the OS on exit), the journal (`inflight` → `completed` / `unknown`; any unresolved or damaged file → `blocked: journal-unresolved` until `resolveOperation` records a `decision: { ref, digest }` — ref stored byte for byte and refused when it looks like a secret, digest = sha256 of the decision text; a journal write failing after the adapter call → `WRITE_UNKNOWN` with `stateWriteFailed`, file may stay `inflight`) and the registry (`<account>/<region>/<stage>/<project>` with `runStateRef` digest and the enums `runState` / `class` / `baselineKind`; none → `not-registered`, other stack / account / region → `identity-mismatch`, unsettled run → `run-unresolved`; registration is not an approval). `ready` (`guardStatus`) = installation valid, journal idle, entry of the same identity, and a settled run state (`runState` not `unresolved`, `class` `verified-no-op`, `none` only with a `first-observation` baseline). Atomic 0600 writes, fs errors as `MigrationError` without a path; holder and adapter errors are scrubbed (`redact()` + URL-encoded ARNs, dashed account ids, secret-like words, 200 characters). Library only: no writer, CLI command or AWS call is connected yet; existing tools are byte-identical.
* **B31 guard on the writers + `lemon-lambda-guard`** (`docs/v5/B31-guard-writers.md`, `HOW_TO_DEPLOY_V5.md` § Migration guard): `lemon-lambda-deploy --apply`, `lemon-lambda-deploy-dev --apply` and the six `lemon-lambda-migrate` phases with `--execute` run the write of a reviewed target through `guardedWrite` (holders `lemon-lambda-deploy`, `lemon-lambda-deploy-dev`, `lemon-lambda-migrate:<phase>`; input = the validated project / stage (/ stack), expected = the config's account / region). The guard runs first: a blocked write prints one stderr line `{ status: "blocked", code: "GUARD_BLOCKED", reason, message }` (exit 1) and opens no receipt, credential, network or LOCK file; a completed write adds `guard: { operationId, journal: "completed" }` to the stdout result; a write that throws keeps its own line and exit code plus `operationId` (journal `unknown`, later writes `journal-unresolved` until `resolve`); a journal failure after the write is `unknown` / exit 3 with `stateWriteFailed`. Plans of reviewed targets add a read-only `guard` summary (`ready` / `blocked` + reason). A target outside the registry keeps its exact output and does no guard I/O; the migration LOCK / owner files and the read-only commands are unchanged. New bin `lemon-lambda-guard` (`bin/lib/guard-cli.mjs`): `init` (install file 0600, never overwritten, then the root; rolled back if the root setup fails), `register` (from a validated migration or deploy config; enums and an absolute `--run-ref` checked, path stored as sha256), `status` (`guardStatus` as is, exit 1 when blocked), `resolve` (`resolveOperation`); exit 0 / 1 / 2, errors as one scrubbed JSON line. `executeMigration`'s input-only checks moved to `executionPrecheck` (same codes and order) so a missing confirmation flag is refused before the guard.
* **docs:** `HOW_TO_DEPLOY_V5.md` separates the v5 deployment track (pack / deploy / deploy-dev / migrate / env, **in preparation**) from the code upgrade in `HOW_TO_UPGRADE_V5.md`; `lemon-lambda-migrate` belongs to the deployment track (v5 B26).

### Changes

* **B24-b pack dev-only link** (`docs/v5/B24-migration-targets.md` § B24-b): `lemon-lambda-pack` accepts a lock link only when it is a dev-only in-repo target (`node_modules/<pkg>` link, plain relative `resolved` inside the project, target entry and everything under it `dev: true`, no symlink escape) — the `scripts/deepmerge-safe` stand-in of the services. Every other local entry keeps `Local dependency is unsupported`. The link and its target are refused if they reach the runtime files; nothing is added to the snapshot or the ZIP (measured: `npm ci --omit=dev` does not need the target).
* **B24 deploy abort reason and name check**: the abort reason sent to `deploy.end` is `lemon-lambda-deploy:<code>` for every project except lemon-templates-api (keeps `templates-cli:<code>`; per-project map `ORG_DEFAULTS.deploy.abortReasonPrefixes`). `lemon-lambda-deploy` stops with `TARGET_MISMATCH` before `deploy.begin` when the resolved function names are not `<project>-<stage>-lambda` / `-backend`. `ORG_DEFAULTS.migration.target` / `.revision` / state-name keys and the `TARGET` / `REVISION` exports of `bin/lib/migrate-core.mjs` are replaced by `migration.targets` / `TARGETS`; the `TARGET_MISMATCH` / snapshot messages and the two `--help` lines name the reviewed targets.
* **B21 no `express`** (D81, `docs/v5/B20-local-gateway.md` § B21, `HOW_TO_UPGRADE_V5.md` § 20): the local server is a light local harness. `buildExpress()` keeps its API, but `app` is a small built-in request listener (`http.createServer(app)` and `supertest(app)` work) with local extension routes — `app.get/post/put/patch/delete/all`, `app.use`, `:name` params, `req.query/params/body/rawBody`, `res.status/set/header/json/send/sendStatus` — checked in order before the local API Gateway. A failing extension route → `500` (never hangs). The result's `express` is always `undefined` and `loadModule` is ignored (both deprecated). The front body reader and the Express router-stack code are removed.
* **B20 env loading in lemon-core**: `loadEnviron()` / `loadProfile()` are ported from lemon-devkit (same file, stage and merge rules, `FILE NOT FOUND:<path>`, `LS=1`); no `require('lemon-devkit')` remains (D80, reverses D33).
* **B20 response base64 flag**: `buildResponse()` sets `isBase64Encoded` only for a non-textual content type (`application/json`, `application/xml`, `*+json`, `*+xml`, `text/*` … are not flagged).
* **B20 local errors as API Gateway**: an unknown path or a method not on the resource → `403 Missing Authentication Token` (was 404 on the devkit server); a rejected handler → `502` at once (was a hanging request); a body over 10 MB → `413`. `GET /` shows the banner only without a `GET /` route.

### Fixes

* **B22 dynamo `paginatedRequest()`** (`docs/v5/B22-pinned-behaviours.md` § 1): the `async@3` `doWhilst` test now calls its callback, so `Query.exec()` / `Scan.exec()` call back after a success (merged result, `loadAll` pages via `LastEvaluatedKey`) and after a retryable error (one retry). Before, they never called back.
* **B22 OS2 429 retry on page 1** (§ 2): `generateSearchResult()` / `searchAll()` with `retryOptions.do` retries a 429 on any page, page 1 included (before: a 429 on page 1 ended with `[]`). Same `maxRetries` and wait; a retry no longer counts against `limit`.
* **B22 `$source` with a projection** (§ 3): `buildQueryBody()` with `$source: '*'` or an array and a `#field` projection gives `_source: { includes: [...] }` (before: `TypeError: $source.includes.push is not a function`). The object form is unchanged.
* **B22 `OS2Instance.search()` `indexName`** (§ 4): `params.indexName` searches that index (same options and FGAC manager), as `AbstractOS2Instance.search()` does. Before, it was ignored.
* **B22 legacy `$protocol(service, param, body)`** (§ 5): the 2nd argument is the default `param` and the 3rd the default `body` (before: both were the service URL); the 3rd argument no longer sets `isProd`. No caller in the org repos uses the 3-argument legacy form.
* **B22 `loadFromFile()`** (§ 6): documented only — a capitalised object key is read as a plural (`Users` → `user`), so a singular key loses its last letter (`Owner` → `owne`). No behaviour change.

### Dependencies

* `@aws-sdk/client-cloudwatch-logs` `^3.1159.0` added as an optional peer and devDependency (used by the logs tools).
* `lemon-devkit` removed from devDependencies (B20): lemon-core no longer loads it.
* `express` added as an optional peer (`^4.21.2 || ^5.0.0`) and a devDependency (`^4.22.3`), for `buildExpress()` (B20).
* `express` removed again (B21): no optional peer, no `peerDependenciesMeta` entry, no devDependency; the lock drops 53 packages. Services remove `express` from their `devDependencies`.

## 5.0.12 (2026-10-30)

### Dependencies

* `lemon-devkit` `^0.2.1` → `^0.2.3` (B18-f): lemon-devkit 0.2.3 drops the deprecated `request` (Node `http`/`https` in `exec-cli`), so the `request` → `form-data` / `qs` / `tough-cookie` / `uuid` chain leaves the tree. Full `npm audit` 6 → **0**; `--omit=dev` stays 0. devDependencies only.
* `vitest` and `@vitest/coverage-v8` `^4.1.4` → `^4.1.12` (B18-d, `docs/v5/B18-audit-coverage.md`): fixes `@vitest/mocker` (GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8). Full `npm audit` 9 → 6 rows; the 6 left (the `lemon-devkit` → `request` chain) go with the lemon-devkit bump above. devDependencies only; no runtime change.

### Tests

* `src/tools/express.spec.ts`: the pinned `lemon-devkit` range follows the bump (`^0.2.3`).
* **B18 coverage** (`docs/v5/B18-audit-coverage.md` § Coverage): 23 offline `*.b18.spec.ts` files (+256 tests) for dynamo, AWS services, OpenSearch, storage, extended cores, API service, engine and helpers — `npm test` 64 / 880 → 87 / 1136, lines 70.28 % → 96.39 %, branches 63.72 % → 85.87 %. Six current behaviours are pinned and listed for separate fixes. No `src/` change besides one prettier line wrap.

### Repository

* `.npmignore`: the `codecov` (`.codecov.yml`) and `travis` (`.travis.yml`) remnants removed; both files were removed in B17.

## 5.0.11 (2026-10-30)

### Dependencies

* `lemon-model` `5.0.2` → `5.0.4`, exact pin (B17-f, D73 "the pair"): lemon-model 5.0.3 fixes TS2411 on `GeneralItem` / `SimpleSearchParam` (strict consumers of `lemon-core/model` no longer need `skipLibCheck`), 5.0.4 is a devDependencies clean-up. No runtime change in lemon-core.

### Repository

* **B17 repository hygiene** (`docs/v5/B17-repo-hygiene.md`): `.travis.yml` removed (last changed 2022-02, nothing in the repo runs or references it; its Codecov token stays in git history and must be rotated by the owner) and the codecov badge with it; `.github/workflows/docgen.yaml` removed (typedoc, S3 copy and `gh-pages` deploy; the doc scripts went in #225). `CONTRIBUTING.md` gets the `v5` branch flow. No package change.

## 5.0.10 (2026-10-30)

### Fixes

* **B16-b resolution shims** (`docs/v5/B16-model-subpath.md` § Resolution shim, `HOW_TO_UPGRADE_V5.md` § 16): physical `model/package.json` and `testing/package.json` (`main`/`types` into `dist/`) so `lemon-core/model` and `lemon-core/testing` resolve for consumers on TypeScript `moduleResolution: node` and Jest 27, which ignore the `exports` map. The `exports` map is unchanged. Consumers remove the `paths` / `moduleNameMapper` lines they added for 5.0.9.

## 5.0.9 (2026-10-30)

### Features

* **B16 sub-path `lemon-core/model`** (`docs/v5/B16-model-subpath.md`, `HOW_TO_UPGRADE_V5.md` § 16): `export * from 'lemon-model'` — every lemon-model name (`field`, `fieldsOf`, `specsOf`, `FIELDS_KEY`, …) through lemon-core, with an ESM wrapper `dist/esm/model.mjs`. The objects are the lemon-model objects; `CoreModel` is the same class as on the root.

### Dependencies

* `lemon-model` pinned to the exact version `5.0.2` (was `^5.0.2`), D73: the lemon-core version fixes the lemon-model version ("the pair"), so one install holds one lemon-model and one `CoreModel` class. Each release names its lemon-model here.

### Consumers

* Do not declare `lemon-model` in a service. The 32 v4 names from `lemon-core`, every other lemon-model name from `lemon-core/model`.
* No root change: the root keeps the 32 v4 lemon-model names (S-06); `api:check` unchanged.

## 5.0.8 (2026-10-30)

* lemon-model `^5.0.2`.

### Behaviour changes

* **B15 security follow-up** (session on only; `docs/v5/B15-security.md`, `HOW_TO_UPGRADE_V5.md` § 11.7 and § 15.2). Session off and local mode are unchanged.
  1. `doList` reads `?view=`: no view = `mine` (`sid` + `uid`) for a non-admin (was the `site` list; ask `?view=site`), `admin` for an admin-like caller (the B13 admin list). `mine` · `group` · `site` · `admin`; other values → `400 INVALID - view[…] is invalid` unless `resolveListView()` is overridden.
  2. `policy.list` is the widest scope a non-admin may ask for (`owner` < `group` < `site` < `any`; wider → 403); a non-admin `view=admin` → `403 NOT ALLOWED - view[admin] needs admin`.
  3. `?view=` is reserved and never reaches `packSearchParam` as a filter.
  4. A protocol caller (`context.channel === 'internal'`) is admin for the CRUD defaults (`policy.internal: 'admin'`, default); `internal: 'identity'` evaluates it by the relayed identity. An entry without `channel` is not internal. `hasAdminRole()` is unchanged.
  5. `getCurrentSession()` returns the identity as the session under `channel: 'internal'` without `userAgent` (relayed users are no longer `403 IDENTITY-TOKEN`).
  6. The relay whitelist gets `cid` and `aid`.
  7. Cross-cloud (`identity.cid` ≠ own `context.accountId`): `policy.cross` `'accept'` (default), `'identity'`, `'deny'` (403); the `TRACE` line gets ` cross=1`.
  8. `AccessPolicy` / `DEFAULT_ACCESS_POLICY` have 7 keys (`internal: 'admin'`, `cross: 'accept'`); an unknown `internal`/`cross` value → 403.

### Features

* Root types `AccessInternal`, `AccessCross`; `MyCoreProxy.isCrossCloud()` / `isInternalAdmin()`, `MyManagerProxy.isAdminLike()`, `packSearchParam` options `policy`/`asAdmin`, `AbstractCRUDController.resolveListView()` (protected).

## 5.0.7 (2026-10-30)

* Re-publish of 5.0.6 (same source).

## 5.0.6 (2026-10-30)

### Behaviour changes

* **B14 call channel, relay and trace** (`docs/v5/B14-relay-context.md`, `docs/v5/B14-relay-context-impl.md`, `HOW_TO_UPGRADE_V5.md` § 15).
  1. Every entry sets `context.channel` (`external` / `internal` / `local`); `fields/admin` is gated by `channel !== 'external'` instead of `domain`.
  2. Internal hops carry the signed relay `x-lemon-relay` (identity summary + trace) instead of the caller's full context: downstream `$ctx.cookie`, `$ctx.authorization`, `$ctx.clientIp`, `$ctx.domain`, `identity.meta` are `undefined`.
  3. `context.trace` (`tid`, `hop`, `via`, `pid`, `src`) and one `TRACE` log line per entry; `doReportError()` adds `trace`.
  4. Hop cap `PROTOCOL_MAX_HOP` (default 8) → `508 LOOP DETECTED`.
  5. `x-protocol-context` is deprecated: `PROTOCOL_LEGACY_CONTEXT` (`off` default, `send`), `PROTOCOL_LEGACY_ACCEPT` (`warn` default, `accept`, `reject`); `HEADER_PROTOCOL_CONTEXT` `@deprecated`.
  6. lemon-model `^5.0.1` (`NextContext.channel`, `trace`).
* **B13 default data-access policy** of `AbstractCRUDController` (session on only; `docs/v5/B13-access-policy.md`, `HOW_TO_UPGRADE_V5.md` § 11.7). Restore the v5 read rule with `policy: { read: 'site' }`.
  1. A same-site user's `read` of another user's row → 403 (default `read: 'owner'`).
  2. An empty `uid` in the session or the row → 403 for every action (admin excepted).
  3. An offsite session (`sid` empty) `list` → 403 (was: an unfiltered list); `doList` calls `canDo('list')` first.
  4. A `sid`-less row: `read` is admin only like update/delete (`SID_LEGACY_ACCESS=open` keeps v4).
  5. `create` stamps the session `gid` (when the model has none).
  6. Admin is decided before the session: IAM SigV4 callers and `roles: ['admin']` claims pass without `403 IDENTITY-TOKEN`.
  7. `doPostBulk`/`doPutBulk` check every item first and report every denied id (`403 NOT ALLOWED - bulk[<action>] denied ids[…]`); nothing is written on a denial.

### Features

* Root names `AccessScope`, `AccessPolicy`, `DEFAULT_ACCESS_POLICY`; `CanDoOptions.policy`, controller option `policy`, `MyManagerProxy.accessPolicy()` / `effectivePolicy()`, `packSearchParam` option `scope`.


## 5.0.5 (2026-10-30)

* B10: `getHelloArn()` takes a 12-digit account only, own Lambda account first; circular-safe stringify on the error report path; secret header values masked in logs; `PROTOCOL_VERIFY=enforce` runbook and masked decrypted config values in the init log; CLI `lemon-fields-types` (`HOW_TO_UPGRADE_V5.md` § 13.1–§ 13.5).
* `LOCAL_TRANSPORT=mock` opt-in local transport for protocol calls (§ 11.3.1).

## [1.2.0](https://github.com/lemoncloud-io/lemon-core/compare/v1.1.2...v1.2.0) (2019-08-16)


### Bug Fixes

* context null ([5435b9b](https://github.com/lemoncloud-io/lemon-core/commit/5435b9b))
* improve `do_parrallel()` ([1cf5821](https://github.com/lemoncloud-io/lemon-core/commit/1cf5821))
* improve isUpperStr ([ee4a09d](https://github.com/lemoncloud-io/lemon-core/commit/ee4a09d))


### Features

* executeServiceApi() ([113c84a](https://github.com/lemoncloud-io/lemon-core/commit/113c84a))
* kms-service ([0c18c83](https://github.com/lemoncloud-io/lemon-core/commit/0c18c83))
* mod uuid ([bf3deff](https://github.com/lemoncloud-io/lemon-core/commit/bf3deff))
* s3 service ([ef91deb](https://github.com/lemoncloud-io/lemon-core/commit/ef91deb))
* sns-service ([981374a](https://github.com/lemoncloud-io/lemon-core/commit/981374a))
* WSC for web-socket client ([3fd3a15](https://github.com/lemoncloud-io/lemon-core/commit/3fd3a15))
* WSS for web-socket server ([0fc2bad](https://github.com/lemoncloud-io/lemon-core/commit/0fc2bad))


### Tests

* close server ([779d740](https://github.com/lemoncloud-io/lemon-core/commit/779d740))
* optimize test ([891b2e2](https://github.com/lemoncloud-io/lemon-core/commit/891b2e2))



### [1.1.2](https://github.com/lemoncloud-io/lemon-core/compare/v1.1.1...v1.1.2) (2019-08-10)



### 1.1.1 (2019-08-10)


### Bug Fixes

* environ path ([ca2d525](https://github.com/lemoncloud-io/lemon-core/commit/ca2d525))
* node null in parallel ([cab68bb](https://github.com/lemoncloud-io/lemon-core/commit/cab68bb))
* optimize doReportError() ([05f9b70](https://github.com/lemoncloud-io/lemon-core/commit/05f9b70))
* optimize test ([d8ca727](https://github.com/lemoncloud-io/lemon-core/commit/d8ca727))
* test error w/o crendentials ([d0d9984](https://github.com/lemoncloud-io/lemon-core/commit/d0d9984))
* test SQS ([04e7a67](https://github.com/lemoncloud-io/lemon-core/commit/04e7a67))
* type error ([6f01f27](https://github.com/lemoncloud-io/lemon-core/commit/6f01f27))


### Features

* optimize envrion test ([2d02647](https://github.com/lemoncloud-io/lemon-core/commit/2d02647))
* update `lemon-hello-api[#1](https://github.com/lemoncloud-io/lemon-core/issues/1).3.0` ([e0a0173](https://github.com/lemoncloud-io/lemon-core/commit/e0a0173))


### Tests

* **environ:** optimized ([80a6e2b](https://github.com/lemoncloud-io/lemon-core/commit/80a6e2b))
* improve tools ([d95c6ee](https://github.com/lemoncloud-io/lemon-core/commit/d95c6ee))
* optimize express ([21cf2f1](https://github.com/lemoncloud-io/lemon-core/commit/21cf2f1))
