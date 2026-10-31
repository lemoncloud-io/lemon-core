# v5 B26 — Lambda environment from the env file (`lemon-lambda-env`)

Status: P0 implemented on `feat/v5-b26-lambda-env` (base `v5` @ `16d38a92`, lemon-core 5.0.16). Not released; no
version bump. P1 and P2 are an outlook only (§ Outlook).

## Why

Services removed the Serverless Framework (B25). On `sls deploy`, Serverless merged the `<stage>` section of the
service env file (for example `env/<stage>.yml`) into the Lambda environment. The lemon-core deploy tools in `code`
mode change the code only, never the environment (`docs/v5/B19-bin-deploy.md`). So a change in the env file has no
path to the deployed functions any more.

B26 adds that path in steps:

| Step | What                                                                                                   | Changes AWS |
| ---- | ------------------------------------------------------------------------------------------------------ | ----------- |
| P0   | `lemon-lambda-env build` (env file → JSON string map, offline) and `diff` (map vs live, by key name)   | no          |
| P1   | `lemon-lambda-deploy` `code` mode sends the built map to the deploy service (`environmentMode: merge`) | yes         |
| P2   | removal of keys (`--drop`)                                                                             | yes         |

## Rules (Serverless-equivalent)

`build` reproduces what Serverless put into the Lambda environment:

-   Only the top-level `<stage>` mapping of the env file is used. Other stages are not merged in. A missing stage, or
    a stage that is not a mapping, is an error that names the stage only.
-   A string is kept **as it is**. A leading `!` is **not** stripped (`'!abc'` stays `!abc`).
-   A number or a boolean becomes `String(v)` (`8080` → `"8080"`, `true` → `"true"`, `1.50` → `"1.5"`). Quote a value
    when its text matters (`"007"`, `"1.50"`).
-   `null` (also an empty value), an object, an array, a YAML timestamp (`2026-01-01`) or binary value is an error
    that names the keys only. A Lambda environment holds strings only.
-   A key must match `^[A-Za-z][A-Za-z0-9_]+$` (the same rule as the bootstrap `environmentFile` check of
    `lemon-lambda-deploy`); other keys are an error that names the keys.
-   The file is parsed with lemon-core's `js-yaml` (4.x default schema: safe, no JS types; merge keys `<<` work;
    duplicate keys are an error). A parse error reports the line number only, never the source text.

### Why not `loadEnviron()`

`loadEnviron()` (`src/environ.ts`) is for local runs. Its rules differ from the deployed environment: it strips a
leading `!`, joins arrays, and keeps keys that already exist in `process.env`. A map built with it would not be the
environment Serverless deployed. `build` therefore has its own converter and never calls `loadEnviron()`.

## Commands

```text
lemon-lambda-env build --env-file <env/<stage>.yml> --stage <stage> --output <file.json>
lemon-lambda-env diff --config <deploy-config.json> --env <built.json>
```

Consumer `package.json`: `"lambda:env": "lemon-lambda-env"`, then for example
`npm run lambda:env -- build --env-file env/dev.yml --stage dev --output .artifacts/env/dev.json`.
`--help` prints the usage (exit `0`).

### `build`

-   Runs from the service root (`process.cwd()`), offline. No credentials, no network.
-   `--env-file`: a `.yml` / `.yaml` regular file inside the service root. A `..` escape, an absolute path outside the
    root and a symlinked file or directory that leads outside are refused (exit `2`). Maximum 1 MiB.
-   `--stage`: `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.
-   `--output`: a file inside the service root, never a symlink, never the env file. Missing parent directories are
    created with mode `0700`. The file is written with mode `0600` through a temp file and an atomic rename. Keys are
    sorted. Keep it out of Git (for example under `.artifacts/`): it holds the values.
-   Exit `0` done, `1` failed (unreadable file, YAML error, missing stage, invalid keys or values, write error),
    `2` invalid arguments.

stdout (fake fixture):

```json
{
    "envFile": "env/dev.yml",
    "stage": "dev",
    "count": 5,
    "keys": ["BANG", "ENABLED", "ENC_KEY", "NAME", "PORT"],
    "encryptedKeys": ["ENC_KEY"],
    "output": ".artifacts/env/dev.json"
}
```

`encryptedKeys` are the keys whose value starts with `*AQIC` (a KMS ciphertext; the same rule as the bootstrap
`policy.kmsDecryptKeyArn` check).

### `diff`

-   `--config`: a `lemon-lambda-deploy` config, validated by the deploy loader (`validateConfig`); `mode` must be
    `code`. The target functions are `plannedFunctionNames(config)`: `<project>-<stage>-lambda` and
    `<project>-<stage>-backend`.
-   `--env`: a built map (JSON object, string values, valid key names).
-   **Read-only.** One `lambda:GetFunctionConfiguration` per function, nothing else. Credentials come from the config
    `profile` / `region`, resolved in the forked credential worker of the deploy tools (`boundedCredentialProvider`,
    deadline `requestTimeoutMs`). Needs the optional peers `@aws-sdk/client-lambda` and
    `@aws-sdk/credential-providers` (else `MISSING_PEER` with the `npm i -D` hint).
-   The live function ARN must be in the configured account and region (else `TARGET_MISMATCH`).
-   Per key: `same`, `changed`, `new` (in the file, not live), `liveOnly` (live, not in the file). Keys the deploy
    service sets (for example `STAGE`) show up as `liveOnly`.
-   `encryptedKeys` lists the same categories for keys whose file or live value starts with `*AQIC`. A KMS ciphertext
    differs on every encryption, so `changed` for an encrypted key may only mean "encrypted again".
-   Exit `0` when the comparison ran (differences are not failures), `1` failed (function missing, read failed,
    other account, unreadable live environment), `2` invalid arguments or input.

stdout (fake fixture, one function shown):

```json
{
    "schemaVersion": 1,
    "execution": "read-only",
    "target": { "project": "lemon-templates-api", "stage": "dev", "region": "ap-northeast-2" },
    "env": ".artifacts/env/dev.json",
    "count": 5,
    "encryptedKeys": ["ENC_CHANGED", "ENC_SAME"],
    "functions": {
        "lambda": {
            "name": "lemon-templates-api-dev-lambda",
            "counts": { "same": 2, "changed": 2, "new": 1, "liveOnly": 2 },
            "same": ["ENC_SAME", "SAME"],
            "changed": ["CHANGED", "ENC_CHANGED"],
            "new": ["NEW_KEY"],
            "liveOnly": ["ENC_LIVE", "STAGE"],
            "encryptedKeys": { "same": ["ENC_SAME"], "changed": ["ENC_CHANGED"], "new": [], "liveOnly": ["ENC_LIVE"] }
        },
        "backend": {
            "name": "lemon-templates-api-dev-backend",
            "counts": { "same": 2, "changed": 0, "new": 3, "liveOnly": 1 }
        }
    }
}
```

(The `backend` entry has the same fields as `lambda`; shortened here.)

### Errors

One JSON line on stderr: `{"status":"failed","code":"<CODE>","message":"<text>"}`. Codes: `INVALID_ARGS`,
`INVALID_INPUT`, `ENV_FILE_NOT_FOUND`, `ENV_FILE_TOO_LARGE`, `ENV_FILE_INVALID`, `STAGE_NOT_FOUND`, `INVALID_KEYS`,
`UNSUPPORTED_VALUES`, `OUTPUT_WRITE_FAILED`, `MISSING_PEER`, `FUNCTION_NOT_FOUND`, `READ_FAILED`, `TARGET_MISMATCH`,
`ENVIRONMENT_UNREADABLE`, `UNEXPECTED_ERROR`.

## Safety

-   **No values, no hashes.** stdout, stderr and every error message carry key names, counts, stage and function
    names and relative paths only. No value is printed, and no hash of a value either: a short value is easy to guess
    from its hash. The values exist only in the `0600` output file.
-   A YAML parser message (it quotes the source line) and an AWS SDK error message (it may hold ARNs) are never
    passed on: only the line number, or the SDK error name (for example `AccessDeniedException`).
-   `diff` never writes: no deploy-service call, no `UpdateFunctionConfiguration`.
-   The tests use fake env files only, with a marker value that must never appear on stdout or stderr.

## Outlook (not in P0)

-   **P1** — `lemon-lambda-deploy` `code` mode takes an optional `environmentFile` (a built map). The deploy service
    tool `aws.lambda.ensure-function@1` already accepts `environment` (string map) and
    `environmentMode: 'merge' | 'replace'`, and returns key names only. P1 sends the map with `merge`: file keys are
    set, live keys outside the file stay (as with Serverless). The plan lists key names; `diff` is the review step
    before `--apply`.
-   **P2** — removing keys that left the env file: an explicit `--drop <KEY>` (or a reviewed `replace`), never
    implicit.

## Tests

`bin/lib/lambda-env.spec.mjs` (vitest, offline, temp dirs under `os.tmpdir()`, stubbed `LambdaClient`):
Serverless conversion (`!` kept, number/boolean stringified, other stage not merged), rejected null / object /
array / timestamp values and bad key names (names only), missing or non-mapping stage, YAML errors without source
text, path escapes of `--env-file` and `--output` (`..`, absolute, symlinked file / directory), output symlink and
directory refused, modes `0600` / `0700`, atomic replace, argument errors, a process run, the four `diff` categories
for both functions, `GetFunctionConfiguration` as the only command, config / map validation, read failures. Every
case checks that the marker value never appears on stdout or stderr. `bin/lib/bin-entries.spec.mjs` covers `--help`
and the npm `bin` symlink start.
