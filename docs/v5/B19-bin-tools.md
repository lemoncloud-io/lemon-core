# v5 B19 — invoke / observe tools (`lemon-lambda-invoke`, `lemon-lambda-logs`, `lemon-lambda-perf`, `lemon-fields-admin`, `lemon-loop-check`)

Status: B19-a. The command-line tools that invoke and observe a deployed lemon-core service moved from
lemon-templates-api (`bin/`, snapshot `d57dc5b`) into lemon-core. Every service that depends on lemon-core now
gets them as installed bins. A service no longer copies `bin/` from the template.

The behaviour, flags and output are the same as in the source, with one change: the **service root is the
consumer's current directory** (`process.cwd()`), not the directory of the tool. npm runs package scripts from
the package root, so `npm run lambda:invoke` keeps working. `--cwd <dir>` points the tools at another root.

## Files

| Source (templates-api `bin/`)                                                                             | lemon-core                    | Bin                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------- |
| `lambda-invoke.mjs`                                                                                       | `bin/lemon-lambda-invoke.mjs` | `lemon-lambda-invoke` |
| `lambda-logs.mjs`                                                                                         | `bin/lemon-lambda-logs.mjs`   | `lemon-lambda-logs`   |
| `perf-lambda.mjs`                                                                                         | `bin/lemon-lambda-perf.mjs`   | `lemon-lambda-perf`   |
| `fields-admin.mjs`                                                                                        | `bin/lemon-fields-admin.mjs`  | `lemon-fields-admin`  |
| `loop-check.mjs`                                                                                          | `bin/lemon-loop-check.mjs`    | `lemon-loop-check`    |
| `lib/common.mjs`, `event.mjs`, `invoke.mjs`, `logs.mjs`, `perf.mjs`, `fields-admin.mjs`, `loop-check.mjs` | `bin/lib/` (same names)       |                       |
| `lib/*.test.mjs` (node:test)                                                                              | `bin/lib/*.spec.mjs` (vitest) |                       |

The lib modules are in the published `files`; the specs and `bin/lib/fixtures/consumer.mjs` (a temp consumer
root for the specs) are not.

## Consumer setup

`package.json` of a service:

```json
{
    "port": 8800,
    "scripts": {
        "lambda:invoke": "lemon-lambda-invoke",
        "lambda:logs": "lemon-lambda-logs",
        "perf:lambda": "lemon-lambda-perf",
        "fields:admin": "lemon-fields-admin",
        "loop:check": "lemon-loop-check"
    },
    "devDependencies": {
        "@aws-sdk/client-cloudwatch-logs": "^3.1159.0",
        "@aws-sdk/client-lambda": "^3.1159.0",
        "@aws-sdk/client-sts": "^3.1159.0",
        "@aws-sdk/credential-providers": "^3.1159.0"
    }
}
```

Then `npm run lambda:invoke -- --path /hello/0` or `npx lemon-lambda-invoke --path /hello/0`.

What the tools read under the service root (`--cwd <dir>`, else the current directory):

-   `serverless.yml`: only the top-level `service:` line. The target function name is `<service>-<stage>-<fn>`
    (Serverless default). `--name <function-name>` skips this file.
-   `package.json`: only `"port"` (default URL / port of the `express` targets of `lemon-fields-admin` and
    `lemon-loop-check`).
-   `src/modules/mock/fields-admin.expected.json`: the default `--expect` of `lemon-fields-admin --type mocks`.

Nothing reads `env/*.yml`, `env/config.js`, or the `custom:` / `environment:` blocks of `serverless.yml`.
Relative file arguments (`--body @file`, `--file`, `--expect`) stay relative to the process directory.

### Optional peers

The AWS SDK packages are optional peers of lemon-core (`peerDependenciesMeta.optional`). lemon-core does not
install them for the consumer. `--help`, `--dry` and the `express` targets work without them. A call that needs
a missing one stops with exit 1 and one line, for example:

```text
ERROR: missing optional peer @aws-sdk/client-cloudwatch-logs: install it with `npm i -D @aws-sdk/client-cloudwatch-logs`
```

| Tool                                 | Needs                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `lemon-lambda-invoke`                | `@aws-sdk/client-lambda`, `@aws-sdk/client-sts`                                                       |
| `lemon-lambda-logs`                  | `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-sts`                                              |
| `lemon-lambda-perf`                  | `@aws-sdk/client-lambda`, `@aws-sdk/client-sts`; with `--logs` also `@aws-sdk/client-cloudwatch-logs` |
| `lemon-fields-admin --target lambda` | `@aws-sdk/client-lambda`, `@aws-sdk/client-sts`                                                       |
| `lemon-loop-check --target lambda`   | `@aws-sdk/client-lambda`, `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-sts`                    |
| any tool with `--profile <name>`     | `@aws-sdk/credential-providers`                                                                       |

`@aws-sdk/client-cloudwatch-logs` is new in B19 (devDependency and optional peer at `^3.1159.0`, like the others).

## Credentials

-   `--profile <name>` uses that named profile from `~/.aws`.
-   Without `--profile`, the AWS SDK default chain applies: `AWS_PROFILE`, `AWS_ACCESS_KEY_ID` /
    `AWS_SECRET_ACCESS_KEY`, SSO, instance role.
-   Region: `--region`, else `AWS_REGION`, else `ap-northeast-2`.

## Common target options

Shared by `lemon-lambda-invoke`, `lemon-lambda-logs`, `lemon-lambda-perf` and `lemon-fields-admin --target lambda`:

| Option                    | Default                          | Meaning                                                                               |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `--stage <stage>`         | `dev`                            | Deploy stage. Any other stage needs `--confirm-stage`.                                |
| `--confirm-stage <stage>` |                                  | The same value as the stage.                                                          |
| `--function`, `--fn <fn>` | `lambda`                         | `lambda` or `backend`.                                                                |
| `--name <name>`           |                                  | Full function name. Overrides `<service>-<stage>-<fn>`. Goes through the stage guard. |
| `--cwd <dir>`             | current directory                | Service root (see [Consumer setup](#consumer-setup)). New in B19.                     |
| `--region <region>`       | `AWS_REGION` or `ap-northeast-2` | AWS region.                                                                           |
| `--profile <name>`        | SDK default chain                | Named profile.                                                                        |
| `--raw`                   |                                  | Do not redact the output. Control stripping and the size cap stay.                    |
| `--max-bytes <n>`         | `65536`                          | Cap for one printed text. `0` means no cap.                                           |
| `--help`                  |                                  | Show help (works with any other argument).                                            |

## `lemon-lambda-invoke`

Invokes the deployed function with a generated event (web, cron, SNS, SQS, or a raw JSON file).
Script: `"lambda:invoke": "lemon-lambda-invoke"`.

| Option                                 | Default         | Meaning                                                                                                               |
| -------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--event <kind>`                       | `web`           | `web`, `cron`, `sns`, `sqs`, or `raw`.                                                                                |
| `--method <METHOD>`                    | `GET`           | HTTP method (web).                                                                                                    |
| `--path <path>`                        | `/`             | HTTP path (web). A `?a=1` part goes into the query.                                                                   |
| `--query k=v`, `--header k:v`          |                 | Query parameter / header (web). Repeatable.                                                                           |
| `--internal`                           |                 | Web only. No `Host` header, like a direct `lambda:Invoke`; lemon-core treats the call as internal.                    |
| `--identity <json>`                    |                 | Web only. `x-lemon-identity` header, sent verbatim (honoured on internal calls only; a warning without `--internal`). |
| `--body <json>` or `--body @file.json` |                 | Body (web), SNS `Message`, or SQS `body` (default `{}`).                                                              |
| `--subject <text>`                     | `lambda-invoke` | SNS `Subject`.                                                                                                        |
| `--cron-name <name>`                   | `1MIN`          | `cron.name` (cron).                                                                                                   |
| `--file <event.json>` or `--file -`    |                 | Event JSON (raw). `-` reads stdin.                                                                                    |
| `--dry`                                |                 | Print the target and the event JSON. No AWS call (no STS either). Sensitive headers print as `<redacted>`.            |
| `--tail`                               |                 | Request the log tail (last 4 KB) and print it.                                                                        |
| `--async`                              |                 | `InvocationType=Event`. No payload comes back.                                                                        |
| `--json`                               |                 | Print the raw response payload only (string values redacted, structure kept).                                         |

Web events are API Gateway REST (v1) proxy events. `resource` and `pathParameters` follow `/{type}/{id}/{cmd}`:
`/hello/0` becomes `resource=/hello/{id}`, `pathParameters={ id: '0' }`. Default headers are `Host: localhost`,
`Accept: application/json`, `User-Agent: lambda-invoke`, and `Content-Type: application/json` with a body.

```sh
lemon-lambda-invoke --profile <name> --path /hello/0 --tail
lemon-lambda-invoke --internal --path /mocks/fields/admin
lemon-lambda-invoke --event sqs --fn backend --body @event-body.json
lemon-lambda-invoke --event raw --file event.json --dry
```

Exit codes: 0 = `StatusCode` 2xx and no `FunctionError` (also `--dry`, `--help`); 1 = otherwise, an AWS error,
or no AWS identity; 2 = bad arguments, an unknown option, or the stage guard. An `http 4xx/5xx` of the web
handler still exits 0; check the printed `http` line.

## `lemon-lambda-logs`

Prints (or follows) the CloudWatch logs of the deployed function by polling `FilterLogEvents`.
Script: `"lambda:logs": "lemon-lambda-logs"`.

| Option                | Default              | Meaning                                                                      |
| --------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `--group <log-group>` | `/aws/lambda/<name>` | Log group override. Goes through the stage guard by the function name in it. |
| `--since <t>`         | `5m`                 | `30s`, `5m`, `2h`, `1d`, or an ISO date.                                     |
| `--follow`, `-f`      |                      | Keep polling until Ctrl-C.                                                   |
| `--interval <sec>`    | `2`                  | Poll interval with `--follow`.                                               |
| `--filter <pattern>`  |                      | CloudWatch filter pattern (server side).                                     |
| `--grep <regex>`      |                      | Case-insensitive regex on the message (client side).                         |
| `--perf`              |                      | Shortcut for `--grep 'PERF:'`.                                               |
| `--json`              |                      | One JSON object per line: `{ ts, stream, message }`.                         |

Each line is `YYYY-MM-DD HH:mm:ss.SSS <last 8 chars of the stream> <message>` (local time). In follow mode
each poll re-scans the last 10 seconds and skips event ids already printed.

```sh
lemon-lambda-logs --since 30m
lemon-lambda-logs -f --perf
lemon-lambda-logs --fn backend --filter '"ERROR"' --json --since 2026-10-30T00:00:00Z
```

Exit codes: 0 = ok (also Ctrl-C); 1 = AWS error or no AWS identity; 2 = bad arguments, the stage guard, or the
log group does not exist.

## `lemon-lambda-perf`

Invokes the deployed function `--runs` times with a web event and the log tail, parses the Lambda `REPORT`
line and the lemon-core `PERF: >` lines, and summarizes cold / warm timings. With `--logs` it reads the full
CloudWatch log of each request (by request id) instead of the 4 KB tail.
Script: `"perf:lambda": "lemon-lambda-perf"`.

| Option                                          | Default    | Meaning                                                       |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------- |
| `--path <path>`                                 | `/hello/0` | HTTP path.                                                    |
| `--method`, `--query`, `--header`, `--internal` |            | As in `lemon-lambda-invoke` (web only).                       |
| `--runs <n>`                                    | `5`        | Number of invokes, `1`–`100`.                                 |
| `--interval <ms>`                               | `0`        | Pause between invokes, `0`–`60000`.                           |
| `--logs`                                        |            | Parse the full log of each run. Needs `logs:FilterLogEvents`. |
| `--logs-wait <ms>`                              | `20000`    | Longest wait per run for the `REPORT` line, `1000`–`120000`.  |
| `--dry`                                         |            | Print the target, the runs and the first event. No AWS call.  |
| `--json`                                        |            | Print `{ target, runs, summary }` only.                       |

Parsed: `REPORT` (`Duration`, `Billed Duration`, `Memory Size`, `Max Memory Used`, `Init Duration` on a cold
run), `PERF: > loaded lemon-core`, `loaded engine`, `initialize`, `handle`, and `request` (with `context`,
`param`, `handler`, `response`). A run is cold when its `REPORT` has `Init Duration` (else the `cold=1` flag).
With `--logs`, a cold run also reads the INIT-phase `loaded …` lines of the same log stream (filter
`"PERF:" "loaded"`). A log that does not arrive in time is filled from the tail; a Logs error falls back to the
tail with one `WARN:` line.

```sh
lemon-lambda-perf --runs 5
lemon-lambda-perf --internal --runs 20 --interval 1000 --json
lemon-lambda-perf --logs --dry
```

Exit codes: 0 = every run `http` 2xx with no `FunctionError` (also `--dry`, `--help`); 1 = otherwise, an AWS
error, or no AWS identity; 2 = bad arguments or the stage guard.

## `lemon-fields-admin`

Checks `GET /<type>/fields/admin` (the lemon-core v5 field report of a CRUD controller) on a local express
server or the deployed Lambda with `checkFieldsAdmin()` of lemon-core, the one verifier of that report.
Script: `"fields:admin": "lemon-fields-admin"`. Inside lemon-core the verifier is loaded from
`dist/extended/cores/fields-admin.js` (a sibling of `bin/` in the package).

| Option                  | Default                                     | Meaning                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--target <t>`          |                                             | Required. `express` or `lambda`.                                                                                                                                                          |
| `--type <type>`         | `mocks`                                     | API type (one path segment).                                                                                                                                                              |
| `--expect <file>`       | the fixture for `mocks`                     | Expected values (JSON object with any of `type`, `model`, `source`, `counts`, `extra`, `core`, `lemonCore`). Another type without `--expect` runs the structural and content checks only. |
| `--json`                |                                             | Print `{ target, type, status, report, check, gate }` only.                                                                                                                               |
| `--url <base>`          | `http://127.0.0.1:<"port" of package.json>` | `express` only.                                                                                                                                                                           |
| `--stage` … `--profile` |                                             | `lambda` only (see [Common target options](#common-target-options)).                                                                                                                      |
| `--dry`                 |                                             | `lambda` only. Print the target and both events. No AWS call.                                                                                                                             |
| `--no-gate`             |                                             | `lambda` only. Skip the gate check.                                                                                                                                                       |

-   `express`: `GET <base>/<type>/fields/admin`; expects HTTP 200 and `runtime: { local: true, lambda: false }`.
    The server is one you started with `LOCAL_MODE=1`; the tool does not start it.
-   `lambda`: (1) an internal web event (no `Host`), expects `statusCode` 200 and
    `runtime: { local: false, external: false, lambda: <function name> }`; (2) the gate: the external event (with
    `Host`) must answer 403 (`gate=closed(403)`).

Output: one summary line
`fields/admin target=<t> type=<type> http=<code> ok=<bool> source=<s> counts=<core>/<fields>/<extra> runtime=<…> lemon-core=<v> issues=<n>`,
one ` - <issue>` line per issue, and for `lambda` the gate line.

```sh
lemon-fields-admin --target express
lemon-fields-admin --target lambda --dry
lemon-fields-admin --target lambda --type pets --expect pets.expected.json --json
```

Exit codes: 0 = HTTP 200, `ok`, and the gate closed (or skipped); 1 = any of those failed, a transport or AWS
error; 2 = bad arguments or the stage guard.

## `lemon-loop-check`

Checks the SNS / SQS / protocol / notify / enqueue loop test of a deployed service from its CloudWatch log
lines, or of a local server with `--target express`. It expects the service to expose the loop trigger
`POST /callback/<kind>/loop` on its `lambda` function and to log `[LOOP] send …` / `[LOOP] recv …` lines (the
callback module of lemon-templates-api).
Script: `"loop:check": "lemon-loop-check"`.

| Option                                                | Default                    | Meaning                                                                       |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `--target <t>`                                        | `lambda`                   | `lambda` (the deployed service) or `express` (a local server).                |
| `--kind <k>`                                          | `all`                      | `sns`, `sqs`, `protocol`, `notify`, `enqueue`, or `all` (in this order).      |
| `--cwd <dir>`                                         | current directory          | Service root. Both targets.                                                   |
| `--json`                                              |                            | `{ stage, functions, results }` (express: `{ target, url, results }`) only.   |
| `--stage`, `--confirm-stage`, `--region`, `--profile` |                            | `lambda` only.                                                                |
| `--timeout <ms>`                                      | `60000`                    | `lambda` only. Longest wait for the log lines per kind, `1000`–`600000`.      |
| `--dry`                                               |                            | `lambda` only. Print the targets, the log groups and the events. No AWS call. |
| `--port <n>`                                          | `"port"` of `package.json` | `express` only. Server port on `127.0.0.1`.                                   |

Per kind (`lambda`): one internal admin invoke of `<service>-<stage>-lambda` (identity
`{"sid":"loop-check","roles":["admin"]}`), then a poll of `FilterLogEvents` with the filter `"<loopId>"` until
both lines are seen or `--timeout` passes (no retry of the invoke). The send line is read from the `lambda` log
group; the recv line from the `backend` log group (`sns`, `sqs`, `notify`, `enqueue`) or the `lambda` log group
(`protocol`). For the relay kinds (`protocol`, `notify`, `enqueue`) the recv line must carry the same `tid` as
the send line (lemon-core B14 trace).

`express`: one `POST http://127.0.0.1:<port>/callback/<kind>/loop` per kind against a server run with
`LOCAL_MODE=1` and `LOCAL_TRANSPORT=mock`; the answer must be HTTP 200 with `mock: true` and exactly one `recv`
with the same `loopId`. No AWS call.

```text
loop-check stage=dev lambda=<service>-dev-lambda backend=<service>-dev-backend
loop kind=sns loop=<loopId> send=ok recv=ok latency=120 tid=<tid>
loop kind=protocol loop=<loopId> send=ok recv=ok latency=7 tid=<tid> recv-tid=same
```

```sh
lemon-loop-check
lemon-loop-check --kind sqs --timeout 120000 --json
lemon-loop-check --target express --kind notify
```

Exit codes: 0 = every kind received; 1 = a line missing, a timeout, a non-200 answer, a failed invoke, a `tid`
mismatch, an AWS error, or no AWS identity; 2 = bad arguments or the stage guard.

## Safety

The same rules as in the source:

1. **Strict options.** An unknown option or an extra positional argument stops the run (exit 2).
2. **Stage guard.** Only `dev` runs without `--confirm-stage <stage>`. A `--name` / `--group` gives the stage
   when it has the shape `<service>-<stage>-<fn>`; otherwise `--stage` and `--confirm-stage` are both required.
   The guard runs before `--dry`.
3. **Identity line.** Before any AWS call, STS `GetCallerIdentity` prints one stderr line
   `account=****<last4> region=<region> credentials=<source> function=<name>`. The ARN is never printed.
4. **Redaction** (on by default, `--raw` turns it off): account ids, ARNs, access key ids, sensitive headers
   and secret-like keys, bearer tokens, JWTs, IPv4 addresses, URL paths and emails. Control characters and ANSI
   escapes are always stripped.
5. **Size cap.** 64 KB per printed text (`--max-bytes`).
6. **Header echo.** `--dry` prints sensitive header values as `<redacted>`.

## Tests

`npm test` runs `bin/lib/*.spec.mjs` with vitest, offline: fake `fetch`, fake invokers and log fetches, and the
AWS SDK stubbed at `Client.prototype.send`. Every case of the six source test files is kept (130), plus 18 for
B19: the service root (process cwd and `--cwd`, missing `serverless.yml` / `port`), the optional-peer loader,
the SDK clients with a stubbed `send`, and one `--help` spawn per bin from a temp consumer root. The cases that
check a 200 report with `checkFieldsAdmin()` need `dist/` (`npm run build`) and are skipped without it.

## Build and deploy tools

See `docs/v5/B19-bin-deploy.md`.
