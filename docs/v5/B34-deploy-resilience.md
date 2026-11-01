# v5 B34 — deploy resilience: throttle retry and the tool's error text

Track: v5 deployment (in preparation, `HOW_TO_DEPLOY_V5.md`), not the code upgrade (`HOW_TO_UPGRADE_V5.md`).

Status: implemented on `feat/v5-b34-deploy-resilience` (base `v5`, lemon-core 5.0.21). Not released; no version bump.
Three follow-ups of the dev bootstrap runs of 2026-11-01 (eureka-contents-api and eureka-backend-api). F1 and F2 are
fixed in the deploy writer of lemon-core (`bin/lib/deploy-runner.mjs`); F3 is fixed in the deploy service
(eureka-deploy-api `aws.lambda.ensure-function@1`) and only recorded here.

## Observations (2026-11-01, lemon dev)

| #   | Where                                          | What happened                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | contents bootstrap, rounds 1 and 3             | `aws.apigateway.ensure-route@1` answered `status: failed` on route 4 and route 16 with the tool error `Too Many Requests` (API Gateway control plane, HTTP 429). The deploy service retries `TooManyRequestsException` once after 1 s; the writer did not retry and aborted the round with `TOOL_FAILED`. Failed at `routeDelayMs` 1500; 4000 passed all 18 and 23 routes. |
| F2  | every failed step                              | The receipt step kept `errorCode: TOOL_FAILED` only; the tool's `error.message` was dropped (fixed text "Tool failed or verification failed; see the server deployment record."). The deploy record kept `reason: lemon-lambda-deploy:TOOL_FAILED` only, so the cause had to be read from the deploy service's Lambda logs and CloudTrail.                                 |
| F3  | backend bootstrap, round 1 (`ensure-function`) | 4.9 s after the role was created, CreateFunction failed twice with "The role defined for the function cannot be assumed by Lambda" (retried), then with "the KMS key is invalid for CreateGrant … ARN does not refer to a valid principal" — the same IAM propagation delay with another message, which the retry predicate did not match. A rerun minutes later passed.   |

## Decisions

-   **D-1 throttle retry in the writer (F1).** When a tool answers `status: failed` and its error means throttling,
    the writer calls the same tool again with the same input. Throttling (`isThrottleError`): `error.message` or
    `error.code` matches `too many requests` / `TooManyRequests…`, `Rate exceeded`, or the word `throttled` /
    `throttling` / `ThrottlingException` (not `throttle` alone, so "Invalid throttle burst limit" is not throttling); a
    code `429` (number or string); an `HTTP 429` / `status 429` in the message; or a 429 (number or trimmed string) in
    one of the status fields `statusCode`, `httpStatusCode`, `status`, `http`. Backoff 2 s, 4 s, 8 s, 16 s
    (`THROTTLE_RETRY_DELAYS_MS`, four retries at most, five attempts).
    -   Only idempotent tools: the frozen list `RETRYABLE_TOOLS` (`isRetryableTool`) of the twelve POST tools this
        runner calls that only read or read before they write on the server (checked against the deploy service
        source): `resolve-names`, `resolve-policy`, `ensure-role`, `ensure-table`, `ensure-queue`, `ensure-topic`,
        `ensure-log-group`, `ensure-function`, `ensure-event-source-mapping`, `ensure-schedule`, `ensure-rest-api`,
        `ensure-route`. Any other name (also a new `*.ensure-*`) is not retried. Never `begin@1`, `end@1`,
        `presign-put@1`, the upload, `subscribe@1`, `deploy-stage@1`, or a status lookup (`GET`, `POLL_UNKNOWN` stays
        immediate).
    -   Only inside the round: a retry is planned only when the wait **plus one full request** (`requestTimeoutMs`)
        ends before the round deadline (20 minutes, and the lease minus 60 s after `begin`), and the same test runs
        again after the wait: if the request no longer fits, the original known `TOOL_FAILED` is thrown (the abort
        path runs as for any known failure). So a known failure is never traded for `DEADLINE_UNKNOWN` or an unknown
        request deadline. An abort (`SIGINT` / `SIGTERM`) ends the wait at once (also the default timer, which no
        longer keeps the process alive) and the run stops as `INTERRUPTED`.
    -   Any other failure is `TOOL_FAILED` at once, as before.
    -   The retried step stays one receipt step (same `index`, `startedAt`; `durationMs` spans every attempt and wait)
        and gets `attempts` (total attempts) and `retried: "throttle"`; the previous attempt's outcome moves to
        `previousErrorCode` / `previousErrorMessage`. During the wait the step shows `retried: "throttle"` and
        `nextAttemptAt` (ISO time of the planned attempt; removed when the attempt starts), so a run killed mid-wait is
        readable. A step without a retry has no new field; `schemaVersion` stays 1.
    -   `routeDelayMs` keeps its default 1500 (same plan and pacing as before; the retry absorbs a 429). 4000 also
        passed in the observed runs and remains a config option (1000..10000).
-   **D-2 the tool's error text (F2).** A `TOOL_FAILED` / `POLL_UNKNOWN` error carries the tool's `error.message` as
    `errorMessage` and `error.code` as `toolErrorCode`; the failed receipt step and the CLI stderr line
    (`lemon-lambda-deploy`, `lemon-lambda-deploy-dev`) show both when present. The fixed `message` and the `code` stay
    as they are, and so does the abort reason sent to the deploy service.
    -   `errorMessage` (`toolErrorText`, `TOOL_ERROR_MESSAGE_MAX`), in this order: control characters stripped (so
        `/Us\0ers` or an ANSI escape cannot split a value); every 12-digit run not inside a longer number → `<acct>`
        (also `user_123456789012`); ARNs URL-encoded once or more (`arn%3A…`, `arn%253A…`) → `<arn>`; local
        absolute paths → `<path>` (system, home and temp roots after anything but a letter or digit, so `ENOENT:/…`
        and `path_/…` too; `%2FUsers%2F…` encoded roots; `~/` and `~user/`; `file://`; `C:\` and `C:/` drives; API
        routes such as `/hello/{id}` stay); then `scrub()` of `bin/lib/migrate-guard.mjs` (dashed account ids, ARNs,
        keys, tokens, URLs, secret-like words); one line, 300 characters.
    -   `toolErrorCode` is kept only when it holds no 12 consecutive digits and is still a short identifier
        (`[A-Za-z0-9_.:-]{1,64}`) after `scrub()`.
-   **D-3 (eureka-deploy-api, F3).** `aws.lambda.ensure-function@1` treats an `InvalidParameterValueException` with
    "cannot be assumed" or "does not refer to a valid principal" (the KMS CreateGrant face carries the latter) as the
    execution role still propagating (same 15 s budget, 1 s interval). A CreateGrant failure without the principal
    phrase (key disabled, access denied, invalid state) and other `InvalidParameterValueException`s (handler,
    runtime, ZIP) still fail at once.

## Example

A step that passed on the third attempt:

```json
{
    "index": 21,
    "name": "route-4",
    "tool": "aws.apigateway.ensure-route@1",
    "method": "POST",
    "status": "succeeded",
    "startedAt": "…",
    "deployId": "…",
    "previousErrorCode": "TOOL_FAILED",
    "previousErrorMessage": "Too Many Requests",
    "attempts": 3,
    "retried": "throttle",
    "durationMs": 6420,
    "verified": true,
    "output": {}
}
```

A failed step and its stderr line:

```text
{ "name": "backend-function", "status": "failed", "errorCode": "TOOL_FAILED", "errorMessage": "Lambda was unable to configure access to your environment variables because the KMS key is invalid for CreateGrant. … <arn>", "toolErrorCode": "InvalidParameterValueException" }
{ "status": "failed", "code": "TOOL_FAILED", "message": "Tool failed or verification failed; see the server deployment record.", "receipt": "…", "deployId": "…", "errorMessage": "…", "toolErrorCode": "…" }
```

## Compatibility

-   Additive only: `attempts`, `retried`, `nextAttemptAt`, `previousErrorCode`, `previousErrorMessage`,
    `errorMessage`, `toolErrorCode` are new optional fields; no existing field, value or order changes. A run without throttling and without tool error text writes the same receipt as before.
-   New exports of `bin/lib/deploy-runner.mjs` (not a package entry): `THROTTLE_RETRY_DELAYS_MS`,
    `TOOL_ERROR_MESSAGE_MAX`, `RETRYABLE_TOOLS`, `isRetryableTool`, `isThrottleError`, `toolErrorText`,
    `toolErrorFields`. The root
    public API (`npm run api:check`) is unchanged.
-   No existing spec asserted "no retry"; every existing deploy, guard-writer and dev-release spec passes unchanged.

## Limits

-   When another deploy runs in the same account at the same time, no pacing (`routeDelayMs`) and no backoff is a
    guarantee: the API Gateway control-plane limit is per account and region. Five attempts over about 30 s of
    backoff then still end in `TOOL_FAILED`; rerun later.
-   Retries multiply control-plane reads (each `ensure-*` reads before it writes) and spend lease time (up to about
    30 s of backoff per step). The writer's four retries sit on top of the deploy service's own one retry after 1 s
    (`TooManyRequestsException` in `src/lib/apigateway.ts`), so one route can cost up to ten API Gateway calls.
-   A retried attempt that ends **unknown** (a transport 429 / 504 of the deploy service's API, a request timeout, a
    lost connection) makes the run unknown, as any unknown answer does: no abort is sent, the lease stays held until
    it expires, and the next run stops with `TAKEOVER_UNKNOWN` until the round is reconciled. The step keeps the
    earlier throttle as `previousErrorCode`.
-   The throttle words include `throttling`; an unrelated message such as an API Gateway usage-plan setting error
    that says "throttling" would be retried too. It costs only the backoff (the same failure comes back) and is
    accepted.
-   The retry is for idempotent tools only. A throttled `begin`, `end`, presign, `subscribe` or `deploy-stage`, and a
    throttled status lookup, fail as before.
-   An HTTP 429 of the deploy service's own API (transport level, no tool result) is still `RESPONSE_UNKNOWN`; only a
    tool answer `status: failed` is retried.
-   The deploy record of the deploy service still keeps `reason: <prefix>:TOOL_FAILED` only; the tool text is in the
    local receipt and on stderr.

## Tests

`bin/lib/deploy.spec.mjs` (B34 cases): throttle detection and the idempotent-tool rule; a throttled `ensure-route`
retried twice with the same input and the round completed (one step, `attempts` 3, no leftover failure fields, other
steps without new fields); a throttle over four retries (`attempts` 5, waits 2/4/8/16 s, round aborted with the same
reason); no retry for presign or a non-throttle failure; no retry when the wait and one request do not fit before the
lease deadline; an abort during the wait (`INTERRUPTED`, no further request); a throttled status lookup
(`POLL_UNKNOWN`, one `GET`); `toolErrorText` (12-digit and ARN canaries absent, `arn%3A`, paths, secret words, one
line, 300 characters); the receipt step and the CLI stderr line. Round 2: a wait that ends past the deadline or
leaves no room for a request (`TOOL_FAILED` kept, abort as before); a retried attempt ending `RESPONSE_UNKNOWN`
(`previousErrorCode`); the receipt read from inside the wait (`nextAttemptAt`); the default wait ended by an abort
without a leftover timer; every reviewer path / 12-digit input; numeric and trimmed 429s, "throttle" not
throttling, unknown `*.ensure-*` names not retried. `bin/lib/guard-writers.spec.mjs`: the deploy-dev stderr line.
