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
    the writer calls the same tool again with the same input. Throttling: `error.message` or `error.code` matches
    `too many requests` / `TooManyRequests…`, `throttl…` or `Rate exceeded`, a code `429`, an `HTTP 429` / `status 429`
    in the message, or a 429 status field (`statusCode`, `httpStatusCode`, `status`). Backoff 2 s, 4 s, 8 s, 16 s
    (`THROTTLE_RETRY_DELAYS_MS`, four retries at most, five attempts).
    -   Only idempotent tools: the tool's action starts with `ensure-` or `resolve-` (`isRetryableTool`). Not
        `begin@1`, `end@1`, `presign-put@1`, the upload, `subscribe@1`, `deploy-stage@1`, and never a status lookup
        (`GET`, `POLL_UNKNOWN` stays immediate). The tools carry no "kind" field, so the action name is the rule.
    -   Only inside the round: a retry starts only when the wait **plus one full request** (`requestTimeoutMs`) ends
        before the round deadline (20 minutes, and the lease minus 60 s after `begin`). So a known `TOOL_FAILED` is
        never traded for an unknown request deadline. An abort (`SIGINT` / `SIGTERM`) ends the wait at once and the
        run stops as `INTERRUPTED`, as in the route pacing wait.
    -   Any other failure is `TOOL_FAILED` at once, as before.
    -   The retried step stays one receipt step (same `index`, `startedAt`; `durationMs` spans every attempt and wait)
        and gets `attempts` (total attempts) and `retried: "throttle"`. A step without a retry has no new field;
        `schemaVersion` stays 1.
    -   `routeDelayMs` keeps its default 1500 (same plan and pacing as before; the retry absorbs a 429). 4000 also
        passed in the observed runs and remains a config option (1000..10000).
-   **D-2 the tool's error text (F2).** A `TOOL_FAILED` / `POLL_UNKNOWN` error carries the tool's `error.message` as
    `errorMessage` and `error.code` as `toolErrorCode`; the failed receipt step and the CLI stderr line
    (`lemon-lambda-deploy`, `lemon-lambda-deploy-dev`) show both when present. The fixed `message` and the `code` stay
    as they are, and so does the abort reason sent to the deploy service.
    -   `errorMessage` = local absolute paths hidden (`<path>`: system, home and temp roots, `~/`, `file://`, a
        Windows drive; API routes such as `/hello/{id}` stay), then `scrub()` of `bin/lib/migrate-guard.mjs`
        (12-digit and dashed account ids, ARNs, `arn%3A…`, keys, tokens, URLs, secret-like words), one line, 300
        characters (`toolErrorText`, `TOOL_ERROR_MESSAGE_MAX`).
    -   `toolErrorCode` is kept only when it is still a short identifier (`[A-Za-z0-9_.:-]{1,64}`) after `scrub()`.
-   **D-3 (eureka-deploy-api, F3).** `aws.lambda.ensure-function@1` treats an `InvalidParameterValueException` with
    "cannot be assumed", "does not refer to a valid principal" or "KMS key is invalid for CreateGrant" as the
    execution role still propagating (same 15 s budget, 1 s interval). Other `InvalidParameterValueException`s
    (handler, runtime, ZIP) still fail at once.

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

-   Additive only: `attempts`, `retried`, `errorMessage`, `toolErrorCode` are new optional fields; no existing field,
    value or order changes. A run without throttling and without tool error text writes the same receipt as before.
-   New exports of `bin/lib/deploy-runner.mjs` (not a package entry): `THROTTLE_RETRY_DELAYS_MS`,
    `TOOL_ERROR_MESSAGE_MAX`, `isRetryableTool`, `isThrottleError`, `toolErrorText`, `toolErrorFields`. The root
    public API (`npm run api:check`) is unchanged.
-   No existing spec asserted "no retry"; every existing deploy, guard-writer and dev-release spec passes unchanged.

## Limits

-   When another deploy runs in the same account at the same time, no pacing (`routeDelayMs`) and no backoff is a
    guarantee: the API Gateway control-plane limit is per account and region. Five attempts over about 30 s of
    backoff then still end in `TOOL_FAILED`; rerun later.
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
line, 300 characters); the receipt step and the CLI stderr line. `bin/lib/guard-writers.spec.mjs`: the deploy-dev
stderr line.
