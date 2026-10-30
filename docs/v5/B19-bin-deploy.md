# v5 B19-b — build / local-run / deploy / migrate tools (`lemon-lambda-*`)

Status: implemented on `feat/v5-b19-bin-deploy` (base `v5` @ `ddd5223f`, lemon-core 5.0.12). The tools were
written in lemon-templates-api `bin/` (snapshot `d57dc5b`). They move to lemon-core so that every service runs the
same, reviewed code through an npm `bin` instead of a copy. The invoke / observe tools (`lambda-invoke`, `logs`,
`perf`, `fields-admin`, `loop-check`) are B19-a; see `docs/v5/B19-bin-tools.md`.

## Tools

| bin                       | source (templates-api) | does                                                                                   |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| `lemon-lambda-pack`       | `bin/pack.mjs`         | build a verified Lambda ZIP + `manifest.json` in Docker; no AWS credentials            |
| `lemon-lambda-local`      | `bin/lambda-local.mjs` | run a pack artifact (or a compiled handler dir) in local Node child processes          |
| `lemon-lambda-deploy`     | `bin/deploy.mjs`       | offline deployment plan by default; `--apply` deploys through the deploy-service tools |
| `lemon-lambda-deploy-dev` | `bin/deploy-dev.mjs`   | the guarded dev release of the migrated dev target (code only)                         |
| `lemon-lambda-migrate`    | `bin/migrate.mjs`      | one guarded phase of a reviewed stack migration; offline plan by default               |

All five run from the **service root**: relative paths (`--config`, `--artifact`, `--output`, `pack.config.json`)
resolve against `process.cwd()`. Only the tools' own files (the forked `deploy-credentials.mjs`,
`migrate-process.mjs` and `local-runtime.mjs` workers) are located from `import.meta.url`, so they work from
`node_modules/lemon-core/bin/lib/`.

Consumer `package.json` (same script names as templates-api, so its docs and habits still apply):

```json
{
    "scripts": {
        "pack": "lemon-lambda-pack",
        "lambda:local": "lemon-lambda-local",
        "lambda:deploy": "lemon-lambda-deploy",
        "lambda:deploy:dev": "lemon-lambda-deploy-dev",
        "lambda:migrate": "lemon-lambda-migrate"
    }
}
```

`npm run lambda:deploy -- --help` (or `npx lemon-lambda-deploy --help`) prints the usage. Every tool exits `0` on
`--help`.

### Optional peers

| tool                              | needs                                                       | when                                           |
| --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `pack`, `local`, `migrate` (plan) | nothing beyond Node ≥ 24 (`pack` also needs Git and Docker) | always                                         |
| `deploy`, `deploy-dev` (plan)     | nothing                                                     | offline plan never loads an SDK or credentials |
| `deploy`, `deploy-dev` `--apply`  | `@aws-sdk/client-lambda`, `@aws-sdk/credential-providers`   | loaded on `--apply` only                       |

Both are existing optional `peerDependencies` of lemon-core (`^3.1159.0`). When one is missing, `--apply` stops
before any request with `{"status":"failed","code":"MISSING_PEER","message":"Optional peer <pkg> is missing; run: npm i -D <pkg>"}` (exit 1). SigV4 signing uses `@smithy/signature-v4`, already a lemon-core dependency, with a
`node:crypto` SHA-256 (the same as `NodeSha256` in `src/cores/aws/kms-fetch.ts`); the templates-api imports
`@smithy/protocol-http` and `@aws-crypto/sha256-js` are not needed.

## `lemon-lambda-pack`

```text
lemon-lambda-pack [--runtime nodejs24.x] [--architecture x86_64|arm64] [--output <new dir>] [--config <file>]
```

-   Config: `pack.config.json` in the service root (`--config` to change). Keys: `schemaVersion: 1`, `runtime`
    (`nodejs24.x` only), `architecture` (`x86_64`|`arm64`), `image` (the public Lambda Node 24 image, optionally
    digest pinned), `sourcePaths` (must include `package.json`, `package-lock.json`), `runtimePaths` (must include the
    handler file), `handler: { file, export }` (file at the ZIP root), `buildScript` (npm script name), `outputRoot`,
    `maxZipBytes` (default 50 MiB), `maxUncompressedBytes` (default 250 MiB).
-   Builds from a source snapshot of the listed paths (no symlinks, no `.git`/`.env`/`env`/secret-like files, no
    host `node_modules` or `dist`), runs `npm ci` + the build script + `npm ci --omit=dev` in the selected Linux
    image, writes `lambda.zip` and `manifest.json` (file hashes, lockfile hash, Git SHA, dirty flag, image digest).
-   Publishes the result only after ZIP extraction and an offline handler-export smoke in the same image.
-   Local lock entries (`link`, `file:` / `link:` / relative / absolute `resolved`) are rejected, except a dev-only
    in-repo link such as a `file:` devDependency stand-in (B24-b, `docs/v5/B24-migration-targets.md` § B24-b). Such a
    link and its target never reach the ZIP.
-   Exit `1` with `[pack] failed: <message>` on any failure.

## `lemon-lambda-local`

```text
lemon-lambda-local --artifact <pack-result-dir> --event <json-file> [options]
lemon-lambda-local --root <compiled-handler-dir> --event <json-file> [options]
```

Options: `--mode cold|warm` (default `cold`), `--runs N`, `--timeout-ms N` (default 3000, includes cold init),
`--handler-file F --handler-export N` (together), `--env-file F` (JSON object of strings), `--function-name`,
`--function-version`, `--function-arn` (default: a synthetic local ARN with account `000000000000`),
`--memory-size MB` (reported only), `--max-log-bytes N` (default 65536 per stream), `--network deny|allow`
(default `deny`, a Node guard, not a sandbox), `--json`.

-   Verifies the artifact ZIP against `manifest.json` (SHA-256, file list) before running it.
-   Trusted code only. Host credentials, `HOME`, `NODE_OPTIONS` and `NODE_PATH` are not inherited.
-   No Lambda IAM, VPC, CPU/memory allocation, freeze/thaw or cloud cold-start emulation.
-   Exit `0` when every run succeeds, `1` when a run fails, `2` on invalid input.

## `lemon-lambda-deploy`

```text
lemon-lambda-deploy --config <config.json> --artifact <pack-directory> [--apply] [--receipt-dir <dir>]
```

Config (JSON, placeholders):

```json
{
    "schemaVersion": 1,
    "mode": "code",
    "project": "<name>-api",
    "stage": "dev",
    "region": "<region>",
    "account": "<12-digit account>",
    "endpoint": "https://<api-id>.execute-api.<region>.amazonaws.com/<stage>",
    "profile": "<aws profile>",
    "artifactBucket": "<bucket>",
    "keyPrefix": "<name>-api/dev"
}
```

`mode: "bootstrap"` also needs `environmentFile` (sibling JSON of string values), `deletionProtection` (boolean),
`routes` (path / `httpMethod` / `authorizationType` `NONE`|`AWS_IAM` / `cors`; a public `GET /` is required) and
may set `policy` (`kmsKeyArn`, `kmsDecryptKeyArn`, `kmsEncryptKeyArn`, `identityPoolId`, `bucket`). Optional in
both modes: `expect` (exact expected `GET /` payload), `requestTimeoutMs`, `pollIntervalMs`, `maxPolls`,
`routeDelayMs`. Unknown keys are rejected.

Safety model:

-   **Dry run by default.** Without `--apply` the tool validates the config and the pack artifact (ZIP and manifest
    hashes, `nodejs24.x`/`x86_64`, ≤ 50,000,000 bytes) and prints the plan JSON. It reads no credentials and makes no
    request.
-   **`--apply`** resolves credentials in a forked worker with a deadline (POSIX process group, killed on timeout or
    parent exit), checks the live function (`lambda:GetFunctionConfiguration` + `ListTags`: managed, Active,
    Node 24, x86_64, packaged handler, configured account/region) before opening a deployment round, then calls the
    deploy-service tools (`<endpoint>/tools/<namespace>.<tool>@1`, SigV4 `execute-api`) in order: resolve names /
    policy, begin, presigned conditional ZIP PUT, functions (+ bootstrap resources), end. Every returned ARN / URL must
    match the configured account and region.
-   **Receipts.** Each step is written to a private receipt (`--receipt-dir`, default `.artifacts/deploy`, dir 0700,
    file 0600, atomic rename) without environment values or policy statements. A failure after begin aborts the round
    (`end` with a reason); an unconfirmed outcome is reported as `unknown`.
-   Output: plan or result JSON on stdout; one JSON error line on stderr (`status`, `code`, `message`, `receipt`,
    `deployId`). Exit `0` done, `1` failed, `2` invalid input/arguments, `3` unknown outcome (inspect the receipt).

## `lemon-lambda-deploy-dev`

```text
lemon-lambda-deploy-dev --config <dev-code-config> --artifact <pack-directory>
                        [--migration-receipt <verified-receipt>] [--apply] [--receipt-dir <dir>]
```

The `lemon-lambda-deploy` flow with extra guards: only the `dev` stage of a reviewed migration target (B24 registry,
`docs/v5/B24-migration-targets.md`) in `code` mode;
the config is copied to a private temp file first (later edits of the original cannot change the run);
`--migration-receipt` must be a completed, integrity-checked migration receipt whose snapshots still match;
`--apply` rejects placeholder accounts and `example`/`placeholder`/`changeme` values. Default is the offline plan.

## `lemon-lambda-migrate`

```text
lemon-lambda-migrate <plan|retain|remove|tag|apply|verify> --config <file>
                     [--execute] [--allow-sensitive-backup] [--confirm-stack <stack>]
```

Runs one phase of the canonical migration script of a pinned external checkout (`migrationRepo` in the config).
Config keys: `schemaVersion: 1`, `project`, `stage`, `stack` (must equal one reviewed target; B24), `migrationRepo`,
`migrationRevision` (must equal that target's pinned revision), `region`, `account`, `profile`, `endpoint`,
`artifactBucket`, optional `kmsDecryptKeyArn`, `kmsEncryptKeyArn`, `runtime` (`nodejs24.x`), `timeoutMs`.

Safety model:

-   **Offline plan by default**, for every phase: prints the command, the phase effect and the required flags.
-   **`--execute`** runs the phase. `plan --execute` also needs `--allow-sensitive-backup` (it stores an environment
    backup); `remove --execute` needs `--confirm-stack <stack>`. There is no all-phases option; phases must run in
    order (`plan → retain → remove → tag → apply → verify`).
-   **Pinned checkout.** The checkout must be at the pinned revision, with the canonical `origin`, no tracked changes,
    and its entry/import files byte-identical to the pinned Git blobs (no symlink redirection).
-   **Guarded run.** STS confirms the configured account first; the child runs with a scrubbed environment
    (no inherited AWS keys, `GIT_*`, `NODE_OPTIONS`); private state (0700/0600, owner tag, lock file) and snapshot
    hashes are checked before and after each phase. Each phase writes an integrity-checked receipt.
-   Exit `0` done, `1` failed, `2` invalid input / missing confirmation, `3` unknown outcome (manual review).

## Org-specific defaults

lemon-core is a public package. Per-installation values (account, region, endpoint, profile, bucket, project, stage)
come only from the consumer's config file; no hostname, account number, ARN or token is in the tools. The
organisation's deploy-service contract and the reviewed migration targets are pinned in one block,
`ORG_DEFAULTS` in `bin/lib/org-defaults.mjs`:

| key                                                                        | value                                                                                     | used by                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| `deploy.serviceName`                                                       | `eureka-deploy`                                                                           | `deploy` help text                       |
| `deploy.reservedProjectPrefix`                                             | `eureka-deploy`                                                                           | a `project` may not start with it        |
| `deploy.toolNamespace`                                                     | `lemon.deploy`                                                                            | tool names `lemon.deploy.<tool>@1`       |
| `deploy.policyProfile`                                                     | `lemon-standard`                                                                          | `resolve-policy` profile; bootstrap plan |
| `deploy.abortReasonPrefix`                                                 | `lemon-lambda-deploy` (B24; was `templates-cli`)                                          | abort reason `<prefix>:<code>`           |
| `deploy.abortReasonPrefixes`                                               | `{ "lemon-templates-api": "templates-cli" }` (B24)                                        | per-project abort prefix, wins           |
| `deploy.docRef`                                                            | this document                                                                             | error / help references                  |
| `migration.targets`                                                        | reviewed registry (B24): `lemon-templates-api` dev, `lemon-hello-api` dev                 | migrate, deploy-dev                      |
| `migration.targets[].revision`                                             | pinned 40-hex commit                                                                      | `migrationRevision`, checkout HEAD       |
| `migration.targets[].receiptFile` / `ownerFile` / `lockFile` / `ownerTool` | templates: the B19 `templates-*` names; others: `migrate-*`, owner `lemon-lambda-migrate` | private run state                        |
| `migration.targets[].devConfigPrefix`                                      | templates: `templates-dev-config-`; others: `lemon-dev-config-`                           | temp copy of the dev config              |
| `migration.origin`                                                         | `lemoncloud-io/eureka-deploy-api`                                                         | checkout `origin`                        |
| `migration.entry` / `imports` / `runsDir`                                  | `scripts/migrate/migrate.mjs` / `scripts/agt/common.mjs` / `scripts/migrate/runs`         | checkout layout                          |

B24 replaced the single `migration.target` / `migration.revision` / state-name keys with `migration.targets`
(`docs/v5/B24-migration-targets.md`). The templates values are unchanged.

How to override: the per-installation values are the config file. The pins above are part of the reviewed safety
contract and are intentionally not overridable from a config file or a flag (a config that matches no entry of
`migration.targets`, or names another revision, is rejected). `validateRepository(config, { revision, origin })`
takes both as parameters for programmatic use (default: the matched entry's revision). Another target, revision or
deploy-service namespace is a lemon-core change (add a reviewed entry to `ORG_DEFAULTS` and release; see B24).

## Differences from the templates-api source

-   Root = `process.cwd()` (the source already resolved paths against the working directory).
-   "Run when main": `isMain(import.meta.url)` (`bin/lib/is-main.mjs`) compares against
    `realpathSync(process.argv[1])`, so the entries also run through the npm `node_modules/.bin/<name>` symlink. The
    source's `path.resolve(process.argv[1])` check printed nothing there.
-   `deploy-client` signs a plain request object with `@smithy/signature-v4` + a `node:crypto` SHA-256 (independent
    HMAC test unchanged); a missing optional peer fails with `MISSING_PEER` and the `npm i -D` hint.
-   Doc references in help / error text point to this document instead of templates-api `docs/lambda-*.md`.

## Tests

`bin/lib/*.spec.mjs` (vitest, `npm test`): the six templates-api `node:test` files ported case by case
(`pack` 12, `local-runner` 17, `deploy` 27, `dev-release` 9, `migrate-core` 18, `migrate-diagnostic` 12) plus
`bin-entries.spec.mjs` (`--help` per entry, the bin-symlink main check, forks from a copied
`node_modules/lemon-core/bin/lib`, optional peers, signing without extra deps, `ORG_DEFAULTS`). Offline: temp dirs
under `os.tmpdir()`, stubbed deploy client / child processes / local `credential_process` helpers, no Docker, no
`serverless`, no AWS. Test-only fixtures: `bin/fixtures/local/` and `bin/fixtures/deploy/` (placeholder example
config and a trimmed route list), `bin/lib/migrate-test-fixture.mjs`; none of them is shipped.
