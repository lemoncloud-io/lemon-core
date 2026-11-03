# v5 B5 — trust boundary and behaviour contract

Status: implemented and measured 2026-10-28 on `feat/v5-b5-trust-boundary` in two repos — lemon-core (base `v5` @ `fd4d8404`) and lemon-templates-api (base `v5` @ `ac969025`). lemon-model is unchanged. Design: SPEC § 6 (vault). Measured facts and experiments behind the design: `docs/v5/B5-inventory.md`. User-facing changes: `HOW_TO_UPGRADE_V5.md` § 11.

## Scope

- **Protocol context.** An external web request (`host` header present) never supplies its context. Internal calls (protocol web, SNS, SQS) are signed with HMAC-SHA256 and verified by the receiver under a mode `off | warn | enforce`.
- **Local mode.** One runtime switch, `$U.isLocalMode()`, replaces the request-controlled `domain === 'localhost'` checks and the `STAGE === 'local'` checks.
- **Failure propagation.** `LambdaHandler.handle` never rejects. SQS and DynamoDB Stream return `batchItemFailures`. SNS and cron report and resolve.
- **Errors.** Root class `LemonError` with a typed `status`; `mxNextFailure` reads it first. Proxies accept any 2xx and time out after 25 s.
- **Contracts.** `guardProxy` saves on error only by opt-in, `enableSync` defaults to false, `canDo` closes updates/deletes of `sid`-less records, `$U.dt`/`$U.ts` default to timeZone 9 without host TZ or DST.

## 1. Protocol signature

### Format

| Item | Value |
| --- | --- |
| Key | env `PROTOCOL_SIGN_KEY`, read through the config service (a `*<base64>` value is KMS-decrypted at init), cached in the module after the first non-empty read. Before the config is initialized a plain env value is used; an encrypted `*…` value never is |
| Carrier (web) | header `x-protocol-signature` |
| Carrier (SNS, SQS) | message attribute `signature` (String) |
| Value | `v1.<ts>.<sig>` — `ts` = signing time in epoch seconds, `sig` = base64url(HMAC-SHA256(key, canonical)) |
| Compare | constant time (`crypto.timingSafeEqual`) |

### Canonical strings

| Transport | Canonical string | Freshness |
| --- | --- | --- |
| web | `v1\n<ts>\n<contextJson>\n<sha256hex(body ?? '')>` | 300 s (`abs(now - ts) <= 300`) |
| SNS | `v1\n<ts>\n<sha256hex(message)>` — `message` = the `Records[].Sns.Message` string (the `default` value the sender published) | none |
| SQS | same, `message` = `Records[].body` | none |

`contextJson` is the header string exactly as received, and `body` is the event `body` string exactly as received (`null` → empty string). The receiver never re-serializes: a parse and `JSON.stringify` would change key order or spacing and fail every time. SNS and SQS have no freshness window because queue delay, retries and DLQ redrive exceed any window; a replay is the same as at-least-once delivery.

### Where it is signed and checked

| Side | Site |
| --- | --- |
| sign | `WEBProtocolTransformer.transformToEvent` (header), `SNSProtocolTransformer.transformToEvent` and `SQSProtocolTransformer.transformToEvent` (attribute). No key → no signature |
| check (web) | `LambdaWEBHandler.packContext` STEP.1. A `host` key (any case) → external: `x-protocol-context` and `x-protocol-signature` are ignored and the context is built from the request. No `host` and an `x-protocol-context` or a JSON `x-lemon-identity` → verify, then apply the mode. A bad context header → `400 INVALID CONTEXT - …` |
| check (SQS) | `LambdaSQSHandler`, before a `x-protocol-service` record is dispatched. `enforce` failure → the record is in `batchItemFailures` |
| check (SNS) | `LambdaSNSHandler`, same place. `enforce` failure → the record is reported and not dispatched; the handler resolves |

Module: `src/cores/protocol/protocol-sign.ts` (deep path `lemon-core/dist/cores/protocol/protocol-sign`, not on the root): `signContext`, `verifyContext`, `signMessage`, `verifyMessage`, `readVerifyMode`, `assertSigned`, `readSignKey`, `resetProtocolSign` (tests), `logSignKeyState` (called by the protocol module init).

### Modes

| `PROTOCOL_VERIFY` | Unsigned or mismatched host-less call | Log |
| --- | --- | --- |
| `off` | accepted, not checked | none |
| `warn` | accepted | one `PROTOCOL unsigned <source> (<reason>)` line per call |
| `enforce` | web: `403 NOT ALLOWED - unsigned protocol context`; SQS: record failure; SNS: reported record | the report of the error |
| unset | `warn` if `PROTOCOL_SIGN_KEY` is set, else `off` | init line `PROTOCOL sign key not set — contexts unsigned` when no key |

A web request with `host` is external in every mode. The mode only decides what happens to host-less calls.

### Transition

| Direction | Effect |
| --- | --- |
| v4 caller → v5 receiver | unsigned. Accepted in `warn` with a log line; rejected in `enforce`. Run `warn` until all callers are on v5, then `enforce` |
| v5 caller → v4 receiver | one extra header or attribute; v4 does not read it |
| external client → any v5 service | the protocol header is dropped, always |
| `lemon-templates-api` callback proxy | the outgoing context claims `roles: [..., 'admin']` instead of `domain: 'localhost'`; the signature makes the claim trustworthy |

## 2. Local mode

`$U.isLocalMode()` = `process.env.LOCAL_MODE === '1' && !process.env.AWS_LAMBDA_FUNCTION_NAME`, read on every call. It is never derived from the event, the headers or the context. It is a member of `$U`, so the root name count does not change.

| Site | v4 test | v5 |
| --- | --- | --- |
| `AbstractCRUDController.confUseSession` | `STAGE === 'local'` | local mode → no session |
| `AbstractCRUDController.modelAsView` (show `sid/gid/uid`) | `STAGE === 'local'` | local mode |
| `AbstractCRUDController.doPost` (custom `id`) | `$ctx.domain === 'localhost'` | local mode |
| `AbstractCRUDController.doDelete` (`?destroy`) | `$ctx.domain === 'localhost'` | local mode |
| `MyCoreProxy.getCurrentSession` (decode `identity.meta`, skip `403 IDENTITY-TOKEN`) | `context.domain === 'localhost'` | local mode |
| `getCurrentSession`: `LOCAL_ACCOUNT`, `USE_SESSION=<file>.json` | always honoured | honoured only in local mode |
| `MyCoreProxy.asCurrentIdentityId` (`LOCAL_ACCOUNT`) | `context.domain === 'localhost'` | local mode |
| `MyCoreProxy.assertContext({ isLocal })` → `hasAdminRole()` | `context.domain === 'localhost'` | local mode |
| `MyManagerProxy.packSearchParam` (drop the session `sid` pin) | `$ctx.domain === 'localhost'` | local mode |
| `getIdentityId()` (`LOCAL_ACCOUNT`), `isUserAuthorized()` (identity from params) | `context.domain === 'localhost'` | local mode |
| templates-api `getSearchHello`, `doPostMigrate`, callback `doPost`/`doPostRequest` | `$ctx.domain === 'localhost'` | local mode |

Not changed (not trust gates): `ConfigService.getStage()`, the protocol `local` → `-dev` target names, the log colour in `builder.ts`, the OS2 tunnel detection, `$protocol` `NS === 'SS'`, `doReportError`'s `source === 'express'` skip, and the ALB handler's `domain = Host` (the domain no longer grants anything). `domain` is still filled for logs and `myProtocolURI`.

| Where it runs | `LOCAL_MODE` | Result |
| --- | --- | --- |
| express harness with the `local` env section | `'1'` | local mode on (admin, session file, `?destroy`, no `sid` pin) |
| Lambda | any | off (`AWS_LAMBDA_FUNCTION_NAME` is set) |
| unit tests | unset unless a spec sets it | off |

## 3. Failure propagation

| Point | v4 | v5 |
| --- | --- | --- |
| `LambdaHandler.handle` | reported, rethrew | never rejects: `asFailure()` reports once, then web → the HTTP failure response by the `mxNextFailure` rules (`asFailureResult()`, no second report); `sqs` → every record by `messageId`; `dds` → every record by `dynamodb.SequenceNumber`; anything else (unknown event, no event, sns, cron, …) → `{ error: <message> }` |
| `LambdaModule` init failure | rejected | the same `asFailure()` result |
| SQS records | each failure swallowed, `undefined` | listener reject, protocol reject or signature rejection → `{ itemIdentifier: messageId }`; returns `{ batchItemFailures }` (empty if all succeeded) |
| DynamoDB Stream records | same as SQS | `{ itemIdentifier: dynamodb.SequenceNumber }` |
| SNS records | reported, resolved | unchanged (no partial response exists for SNS; a reject means two retries and the DLQ) |
| cron listeners | `Promise.all` rejection reached the top | each listener caught (a sync throw too) and reported; resolves `void` |
| cognito | rejected | cognito: rethrow (response contract) — `asFailure()` reports, then rethrows the original error (the message reaches the client) |
| notification, wss | — | unchanged |

`batchItemFailures` is used only when the event source mapping has `FunctionResponseTypes: [ReportBatchItemFailures]`. Without it the value is ignored (v4 behaviour). That setting is deployment work, outside this bundle.

## 4. Errors and status

- `LemonError(status, code, detail?)` in `src/common/lemon-error.ts`, exported by name from the root (+1 → 295). `message` = `<status> <code> - <detail>` or `<status> <code>`. An internal helper `asLemonError(status, message)` keeps a relayed message exactly and reads `code` from the prefix; it is not on the root.
- `asFailureResult(e)` (new, in `lambda-web-handler.ts`, reachable as `$web.asFailureResult`) holds the `mxNextFailure` rules without side effects: `404 NOT FOUND` prefix → 404 unreported; typed `status` (100–599) first, else a `3xx`–`5xx` message prefix; 301/302 with ` - <loc>` → redirect; `400 SIGNATURE` → unreported; other statuses, `.name` (400) and `@name` (400) → reported; else 503 reported.
- `http-fetch`: any 2xx is a success; 200/201 keep the v4 body rules, another 2xx without a body (204) → `null`. A non-2xx → `LemonError` with the peer status and the same message string as v4. Timeout `AbortSignal.timeout(req.timeout ?? 25000)`; on timeout the message is `ETIMEDOUT timeout after <ms> ms` (errno first, like the other network errors).
- `invokeLambda`: the same 2xx and `LemonError` rules on the callee's status.
- The 381 `throw new Error('NNN …')` sites are unchanged.

## 5. guardProxy, enableSync, canDo

- `guardProxy(context, callback, options?: { saveOnError?: boolean })`: success path unchanged; on an exception it saves pending updates only with `saveOnError: true`, then rethrows.
- `MyCoreManager` `enableSync` defaults to `false`; `$OS2` is built by the first manager with `enableSync: true`.
- `MyManagerProxy.canDo`: `update`/`delete` on a record without `sid` → not allowed unless admin. `list`/`read`/`create` unchanged; guests still get 403.
  - Configurable via `SID_LEGACY_ACCESS` (`admin` default, `open` = v4, `deny` = nobody, not even admin; read/list stay open).
- `GeneralAPIController` and its five handlers are `@deprecated` (no authorization; removal in v6). No behaviour change.

## 6. `$U.dt` / `$U.ts` contract

`DEFAULT_TIME_ZONE = 9` is defined in `engine/utilities.ts`; `engine/engine.ts` imports and re-exports it (the root name is unchanged).

| Input | v4 | v5 |
| --- | --- | --- |
| timeZone omitted | 0 | 9; explicit 0 = UTC |
| string, date only | noon, host offset at call time | noon of `timeZone` |
| string with time | host offset at call time (DST error) | `Date.UTC(y, m - 1, d, h, i, s) - tz h` (host TZ and DST free) |
| number, `undefined` | instant, timeZone ignored | unchanged |
| `dt(Date)` | the same reference | a copy |
| `ts(Date, tz)` | changed the argument | unchanged argument; wall clock of `tz` |
| `ts(N)` | UTC wall clock | KST wall clock |
| `convDate`, `convDateToTS`, `convDateToTime` | `dt(…, 9)`; mutated a `Date` | same results, no mutation; `convDate(str)` equals `dt(str)` |

- timeZone omitted: configurable via `DEFAULT_TIME_ZONE` (hours, default 9; `defaultTimeZone()` in `engine/utilities.ts`).
- date only: configurable via `DATE_ONLY_CLOCK` (`noon` default, `midnight` = 00:00:00).

The engine logger stamps lines with `Utilities.timestamp()`, so log time stamps are KST wall clock too.

## Files

lemon-core:

| File | Change |
| --- | --- |
| `src/common/lemon-error.ts` (new) | `LemonError`, internal `asLemonError()` |
| `src/index.ts` | `export { LemonError }` |
| `etc/api-names.allow.txt` | `+LemonError` |
| `src/cores/protocol/protocol-sign.ts` (new) | sign/verify web and message, mode, key cache, init line |
| `src/cores/protocol/protocol-service.ts` | sign in the web/SNS/SQS transformers |
| `src/cores/protocol/index.ts` | init line after the config init |
| `src/cores/lambda/lambda-web-handler.ts` | `host` rule and verification in `packContext`, `400 INVALID CONTEXT`, `isExternal()` by key presence, `asFailureResult()`, `mxNextFailure` on top of it |
| `src/cores/lambda/lambda-handler.ts` | `handle()` → `handleEvent()` + `asFailure()`; `SQSHandler`/`DynamoStreamHandler` return types |
| `src/cores/lambda/index.ts` | init failure → `asFailure()` |
| `src/cores/lambda/lambda-sqs-handler.ts`, `lambda-dynamo-stream-handler.ts` | `batchItemFailures`; SQS signature check |
| `src/cores/lambda/lambda-sns-handler.ts` | signature check |
| `src/cores/lambda/lambda-cron-handler.ts` | per-listener catch |
| `src/lib/http-fetch.ts`, `src/cores/protocol/aws-lambda-helper.ts` | 2xx, `LemonError`, timeout |
| `src/engine/utilities.ts` | `isLocalMode()`, `DEFAULT_TIME_ZONE`, `timestamp`/`datetime` |
| `src/engine/engine.ts` | `DEFAULT_TIME_ZONE` re-export |
| `src/extended/cores/abstract-controllers.ts`, `abstract-services.ts`, `src/helpers/helpers.ts` | local mode; `canDo`; `guardProxy`; `enableSync` |
| `src/extended/cores/abstract-rest-apis.ts` | doc example uses the role claim |
| `src/controllers/general-api-controller.ts` | `@deprecated` |
| specs | see the bundle report: flipped pins and new specs (`protocol-sign.spec.ts` new) |
| `HOW_TO_UPGRADE_V5.md` | § 11 and checklist |

lemon-templates-api:

| File | Change |
| --- | --- |
| `env/lemon.yml` | `local`: `LOCAL_MODE: '1'` |
| `src/modules/search/api-search.ts`, `src/modules/callback/api-callback.ts` | `$U.isLocalMode()` |
| `src/modules/callback/proxy.ts` | admin role claim in the outgoing context |
| `src/modules/mock/service.ts`, `src/modules/callback/service.ts` | `{ enableSync: true }` on three managers |

## Coordinator rerun (2026-10-28)

Rerun from a clean shell on the same worktree; values equal the implementer's report.

| Gate | Value |
| --- | --- |
| `npm run build` | 0, `gen-esm-wrapper` 137 named + default |
| `npm run api:check` | `base=304 current=295 added=13 removed=22 allow=35 not-allowed=0` |
| `npm run esm:smoke` | `ok names=138 subpaths=4` |
| `npm run dup:check` | `files=86 decls=380 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0` |
| `npm run l1l2:probe` | `checks=28 fails=0 root-keys=138` |
| `aws-lazy-probe` | `dist/index` total=292, `@aws-sdk`/`@smithy`/`@aws-crypto`/`@aws` = 0 |
| `npm test` ×3 | 526 total, 525 pass, 1 fail (`engine.spec` "test doReportError() - account id", pre-existing) |
| grep `domain === 'localhost'` / `STAGE === 'local'` | 1 line left (`builder.ts` log colour, by design) |
| protocol probe (A1–A8, D1–D4, C1) | forged header with `Host` ignored (any case); SQS/DDS resolve `batchItemFailures`; SNS and unknown events resolve; `hasAdminRole(domain=localhost)` false |
| signing probe | `enforce`: signed host-less 200, unsigned/tampered body/tampered context/stale 301 s → 403, signed + `Host` → external, signed bad JSON → `400 INVALID CONTEXT`; `warn`: unsigned and tampered pass; no key → `off`, no signature emitted |
| dt table (TZ = UTC, Asia/Seoul, America/New_York) | the three outputs are identical; `dt(Date)` is a copy; `ts(Date, 9)` and `convDateToTS(Date)` leave the argument unchanged |
| templates-api (linked) | build 0; jest 99 total, 94 pass, 5 fail (same 5 as the baseline); no `localhost` trust gate; `enableSync: true` ×3 |
| harness (`express.lemon`, default) | ready in 24 s; 5 routes 200; `GET /hello/echo` identity identical with and without a forged `x-protocol-context` (lower and mixed case); 10 PERF lines; 1 `PROTOCOL` init line |
| harness (mock mode) | `POST /mocks/0` → `DELETE ?destroy` 200 → `GET` 404 (local mode on) |
