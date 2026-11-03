# B5 inventory — trust boundary and behaviour contract

Trees: `<lemon-core>` = B5 worktree at `v5` `fd4d8404` (branch `feat/v5-b5-trust-boundary`). `<templates-api>` = B5 worktree at `v5` `ac969025`. lemon-model 5.0.0 (installed copy and the `<lemon-model>` B5 worktree have the same `NextContext`). Node 24.20, TS 5.9.3, vitest 4.1.4. Tags: `[measured]` = run in this session; `[code]` = read from the current tree. Line numbers are the current trees. Scripts and outputs: `<scratch>/b5/`.

Repos were not changed. The tests ran in `<lemon-core>` and created a gitignored `logs/` folder, which was then deleted. A file-hash snapshot taken before and after shows no other change. The templates-api tests ran in `<scratch>/b5/ta-scratch`, a copy whose `node_modules/lemon-core` is a link to `<lemon-core>`.

---

## A. Protocol context (`x-protocol-context`) — S-29, S-30, W-10/W-19, D2-1, D2-2

### A.1 Readers (what is trusted)

| # | Site | What it does | Trusted fields |
| --- | --- | --- | --- |
| R1 | `<lemon-core>/src/cores/lambda/lambda-web-handler.ts:435-440` `packContext` | If `headers['x-protocol-context']` is present (exact lowercase key), it returns `transformToParam(event).context` **as is** and skips identity parsing (`:443-457`). It does not call `prepareContext`, so `domain`, `clientIp`, `requestId` and `accountId` are not overwritten from `requestContext`. | All `NextContext` fields: `identity` (`sid`, `uid`, `gid`, `roles`, `accessKey`, `identityId`, `identityPoolId`, `userAgent`, …), `domain`, `source`, `depth`, `cookie`, `clientIp`, `userAgent`, `requestId`, `accountId`, `authorization`, `origin`, `referer` `[code][measured A1]` |
| R2 | `<lemon-core>/src/cores/protocol/protocol-service.ts:580-649` `WEBProtocolTransformer.transformToParam` | Parses the header JSON (`:589-603`). It checks `requestContext.accountId`/`requestId` against the context **only when the context carries them** (`:641-644`). A forged context that leaves both out passes. | same `[measured A1, A3]` |
| R3 | `lambda-web-handler.ts:170-181` `promised` → `transformToParam(event, $ctx)` | Uses the context that `packContext` returned. | — |
| R4 | `lambda-web-handler.ts:641-645` `isExternal` and `:661-675` `parseIdentityHeader` | When **no `host` header** is present, `x-lemon-identity` holding a JSON object is accepted unverified (`parseIdentityJson`, `:689-697`, only `sid` is required). With `host`, only a JWT is parsed and its signature is verified. | `identity.*` on host-less web events `[measured A6, A7]` |
| R5 | `protocol-service.ts:701-726` SNS `transformToParam`, `:783-810` SQS | The context comes from the message body (`param.context`). The `accountId`/`requestId` message attributes must equal the body copies, and the caller sets both. There is no signature. | all `NextContext` fields `[code]` |
| R6 | `lambda-sns-handler.ts:61-88`, `lambda-sqs-handler.ts:69-96` | Call `lambda.handleProtocol(param)` with that context. A same-service callback raises `depth` (`:77`/`:85`). | — |
| R7 | lemon-devkit 0.2.0 (`<templates-api>/node_modules/lemon-devkit/dist/tools/express.js:298-308`; 0.0.11 in `<lemon-core>` is the same at `:307`) | Express calls `$web.packContext(req.$event, …)`, so R1 applies. Node lowercases the headers, and `host` is always present. | same |
| R8 | `lambda-alb-handler.ts:137-171` | Does not read the protocol header. It sets **`domain` = `Host` header** (`:150`), which the client controls, and `prepareContext` (`:47-51`) does not overwrite it. | `domain` (so a client can send `localhost` → see B) `[code]` |
| R9 | `lambda-notification-handler.ts:114-130` | `domain = requestContext.domainName ‖ Host` (in the API Gateway case API Gateway sets it). | — |

The header name can be overridden with env `HEADER_PROTOCOL_CONTEXT` (`protocol-service.ts:73`).

**Exploit chain `[measured A1]`.** Take the real REST API fixture (`data/samples/events/sample.event.web.api.json`, which has `Host`) and add a lowercase `x-protocol-context: {"identity":{…,"roles":["admin"],"accessKey":"x"},"domain":"localhost"}`. The handler sees exactly that identity and `domain: 'localhost'`. With `domain: 'localhost'`, `hasAdminRole()` returns true (`[measured C1]`, `abstract-services.ts:1168`). So did `identity.accessKey` (`:1169`) and `identity.roles:['admin']` (`:1172`). A mixed-case `X-Protocol-Context` is **not** trusted (exact-key lookup) `[measured A2]`. HTTP/2 clients and HTTP API v2 always lowercase, so the lowercase path can always be reached.

In templates-api, `/mocks`, `/mocks/{id}` (GET, POST) and `/hello*` have **no authorizer** (`<templates-api>/serverless.yml:232-270`). `/{type}…` uses `aws_iam` (`:276-310`). So an anonymous caller can reach `MockAPIController` with a forged admin/localhost context.

### A.2 Writers (outgoing)

| Transport | Site | Carrier | Serialization |
| --- | --- | --- | --- |
| web (Lambda invoke) | `protocol-service.ts:535-574` `transformToEvent`, sent by `execute` `:362-382` → `aws-lambda-helper.ts:36-108` `invokeLambda` | header `x-protocol-context` (the only header) | `$U.json(context)`: plain JSON, not base64. Sample context 1,045 B `[measured hmac-cost]` |
| SNS | `protocol-service.ts:665-695` (`notify` `:391-420`) | `Message = JSON.stringify({default: $U.json(param)})`; attributes `accountId`, `requestId`, `callback` | JSON inside JSON |
| SQS | `protocol-service.ts:751-777` (`enqueue` `:430-469`) | `MessageBody = $U.json(param)`; attributes `Subject`, `accountId`, `requestId`, `callback` | JSON |
| oauth verify | `lambda-web-handler.ts:921-933` (`verifyToken` → `execute` with `context: {}`) | web | empty context |
| SNS/SQS callback to another service | `lambda-sns-handler.ts:86`, `lambda-sqs-handler.ts:94` → `execute(proto)` | web | context of the inbound message |
| `$protocol()` helper | `helpers.ts:553-630` (`fromURL` copies the caller's context, `:337`) | all three | — |

SNS/SQS message-attribute use today: SNS ≤ 3, SQS ≤ 4 of the 10 allowed, so one more attribute (signature) fits `[code]`.

### A.3 Telling the event origin apart (decision table)

`findService` order: `lambda-handler.ts:192-231`. The protocol-built event comes from `[measured A5]`. The REST shape comes from the fixture `[measured A8]`.

| Origin | `findService` | Discriminating fields (present / absent) | Can a caller forge the shape? |
| --- | --- | --- | --- |
| API Gateway REST v1 | `web` | present: `resource`, `multiValueHeaders`, `requestContext.apiId`, `.domainName`, `.resourceId`, `.requestTimeEpoch`, `.identity.sourceIp`, header `Host` | — (set by AWS) |
| Protocol web invoke (in-cloud) | `web` | top keys only `body, headers, httpMethod, path, pathParameters, queryStringParameters, requestContext`. Headers = **only** `x-protocol-context`, so **no `host`**. `requestContext` keys = `accountId, httpMethod, identity(null), path, requestId, stage`. No `resource`, `multiValueHeaders`, `apiId` or `domainName`. | yes — anyone with `lambda:InvokeFunction` can send exactly this |
| Hand-made direct invoke | `web` if `requestContext` + `pathParameters !== undefined` | anything | yes. **Shape cannot authenticate; only a signature can** (S-30) |
| devkit express | `web` | `requestContext.source: 'express'`, `domainName = host`; headers lowercased with `host`; `url`; `connection: null` (`express.js:170-194`) | n/a (local) |
| HTTP SNS subscription | `notification` | `requestContext` + 3 `x-amz-sns-*` headers | — |
| WSS | `wss` | `requestContext.eventType` | — |
| ALB | `alb` | `requestContext.elb.targetGroupArn` | — |
| cron | `cron` | `event.cron` (EventBridge input) | — |
| SNS / SQS / DDS | `sns` / `sqs` / `dds` | `Records[].Sns` / `eventSource=='aws:sqs'` / `Records[].dynamodb` | message content: anyone with Publish/SendMessage |
| HTTP API v2 | none (`requestContext.http`/`rawPath` read nowhere) | → `400 UNKNOWN EVENT` | — (C3 confirmed `[code]`) |

Rule that follows: **`host` present ⇒ external**. This is reliable: API Gateway, ALB and Function URLs always add it, and the protocol transformer never adds it. **`host` absent ⇒ internal is not reliable**, so a host-less web event must carry a valid signature.

### A.4 Signature design inputs

- **Secret material already available `[code]`.** `config-service.ts:121-168` decrypts every env value of the form `*<base64>` through KMS once in `initialize()`. Values are read with `$cores.config.config.get(name)` (`config-service.ts:78`), not with `$U.env`. The harness boots with 3 such keys (§ 7.8). `$U.hmac(data, key, alg, enc)` already exists (`utilities.ts:692-697`). The same file has `crypto2` (`:754`) and `crypto3` (`:799`, nonce plus timestamp IV), and `$U.jwt()` (`:884`). `MyHttpHeaderTool.signToken`/`verifyToken` (`lambda-web-handler.ts:883-967`) already do HS256 with `$U.hmac` and KMS RS256 (`AWSKMSService.sign/verify`).
- **`NextContext` (lemon-model 5.0.0 `src/types/core-types.ts:214`)** has a closed field set: `identity, source, clientIp, userAgent, requestId, accountId, domain, cookie, authorization, referer, origin, depth`. It has no index signature, so a `signature` field would need a lemon-model change. Recommendation: carry the signature **outside** the context (header `x-protocol-signature` for web, message attribute `signature` for SNS/SQS). That needs no lemon-model change.
- **Cost `[measured hmac-cost, 3 runs]`.** Context JSON 1,045 B. HMAC-SHA256 base64url = 43 chars (≈57 B with timestamp and separator). Sign (stringify + HMAC) **12.2–13.0 µs**. Verify (stringify + HMAC + `timingSafeEqual`, loop includes one extra sign) 25.8–29.9 µs. `JSON.parse` baseline 1.4 µs.
- **KMS sign/verify per call (reasoned, no AWS call).** Harness `PERF` lines (SPEC § 3.5 gate 6): `initialize` 134.5 ms (3 parallel KMS decrypts plus config), `lazy-load @aws-sdk/client-kms` 39.1 ms, `client KMS` 2.3 ms. One KMS round trip is tens of ms. A protocol hop would add 2 calls (caller sign, callee verify), which is 3–4 orders of magnitude above HMAC. It also adds per-call KMS quota and throttling exposure and needs `kms:Sign/Verify` IAM on every service.
- **Recommendation: HMAC-SHA256 with one install-wide secret from a `*`-encrypted env (name only, e.g. `PROTOCOL_SIGN_KEY`).** Reason: µs cost, and it reuses the existing init-time KMS decrypt. Canonical string (proposal): `v1.<ts>.<method>.<type>/<id>/<cmd>.<sha256(body)>.<contextJson>` for web, and `v1.<ts>.<sha256(Message|MessageBody)>` for SNS/SQS, with a freshness window. Note: `requestContext.requestId` gives no binding today, because the caller writes both copies (`protocol-service.ts:546-568`).

### A.5 Transition (v4 ↔ v5)

| Direction | Code path | Today | What a flag must do |
| --- | --- | --- | --- |
| v4 caller → v5 callee, web | v4 `execute` → host-less event, unsigned header | trusted | `PROTOCOL_VERIFY=warn` (proposal): accept unsigned and log one `PROTOCOL` line with `source`. `enforce`: reject with 403 |
| v4 → v5, SNS | v4 `notify`, record `Subject=x-protocol-service` | trusted | same, per record |
| v4 → v5, SQS | v4 `enqueue` | trusted | same, per record (a rejected record is a failure → `batchItemFailures`) |
| v4 → v5, callbacks | v4 SNS/SQS handler `execute(proto)` (`lambda-sns-handler.ts:86`) | trusted | same as web |
| v4 → v5, oauth `verify-token` | `execute` with `context:{}` | trusted | same as web. An empty context still needs a signature in `enforce` |
| v5 → v4 | extra header or attribute | — | none. v4 reads only `x-protocol-context` and named attributes (`protocol-service.ts:591`, `:710-714`, `:794-798` are the same in v4) `[code]` |
| external (host present), any version | REST, ALB, Function URL | trusted (R1) | **always drop** the header, case-insensitively, with no flag. No legitimate caller sends it with `host` `[measured A5]` |
| templates-api callback | `<templates-api>/src/modules/callback/proxy.ts:177` sets `domain: 'localhost'` in its **outgoing** context to raise the target's rights | works (cross-service admin) | breaks under B5. Needs an explicit signed claim instead of `domain` (see B) |

Specs that pin the forgeable path (they will flip by design): `lambda-web-handler.spec.ts` "should pass packContext(public) via lambda protocol" (`:496`) and "…(authed)…" (`:571`). Both add the header to `Host`-bearing fixtures and expect it to be trusted. "should pass packContext() via lambda protocol" (`:612`) passes the context directly and is unaffected.

---

## B. Local-mode switches — S-31, C10, C11, E-31

### B.1 Every runtime "local" test `[code]`

| Site (`<lemon-core>` unless noted) | Test | Gates | Request-influenced? |
| --- | --- | --- | --- |
| `extended/cores/abstract-controllers.ts:144-145` | `STAGE === 'local'` | `confUseSession` → false (no session `sid` filter or `sid` stamping) | no (env) |
| `abstract-controllers.ts:161-163` | `STAGE === 'local'` | `modelAsView` shows `sid/gid/uid` | no |
| `abstract-controllers.ts:413,416` | `$ctx.domain === 'localhost'` | `doPost` accepts a caller-chosen `id`, so `makeModel` overwrites an existing record (`abstract-services.ts:1423-1434`) | **yes** |
| `abstract-controllers.ts:599,613` | `domain === 'localhost'` | `doDelete ?destroy` = hard delete | **yes** |
| `extended/cores/abstract-services.ts:1002,1024-1027` | `domain === 'localhost'` | `getCurrentSession` decodes `identity.meta` as an **unverified JWT** (`$U.jwt('').decode`) | **yes** |
| `abstract-services.ts:995,1037` | `LOCAL_ACCOUNT` env | session = `_default()` | env, but only matters together with the request path |
| `abstract-services.ts:996,1038-1049` | `USE_SESSION` env (`*.json` → load file) | session from a file | env |
| `abstract-services.ts:1056` | `!isLocal` | skips all `403 IDENTITY-TOKEN` checks | **yes** |
| `abstract-services.ts:1085-1087` | `domain === 'localhost'` | `asCurrentIdentityId` → `LOCAL_ACCOUNT` | **yes** |
| `abstract-services.ts:1122,1134,1168` | `domain === 'localhost'` | `assertContext({isLocal})` → **`hasAdminRole` true** `[measured C1]` | **yes** |
| `abstract-services.ts:1325,1351` | `domain === 'localhost'` | `packSearchParam` drops the session `sid` pin (lists every site) | **yes** |
| `abstract-services.ts:222-225` | `USE_SESSION` truthy | `isUseSession()` | no |
| `helpers/helpers.ts:717-719` | `domain === 'localhost'` | `getIdentityId` → `LOCAL_ACCOUNT` | **yes** |
| `helpers.ts:735-743` | `domain === 'localhost'` | `isUserAuthorized` **replaces `context.identity` with caller `params`** | **yes** |
| `helpers.ts:570` | `NS === 'SS'` | `$protocol` `isProd` | no |
| `engine/engine.ts:85` | `context.source === 'express' ‖ accountId === ''` | `doReportError` silently skips the report | **yes** (forged context hides errors) |
| `cores/config/config-service.ts:110-115` | anything but dev/prod → `'local'` | `getStage()` | no |
| `cores/protocol/protocol-service.ts:187,238-245` | stage default `'local'`; `'local'` → `-dev` names | protocol targets. **There is no loopback**: `local` calls the real `-dev` functions (C11 code moved here from v4 ~198-203) | no |
| `engine/builder.ts:229` | `STAGE local/express` | log colour only | no |
| `abstract-services.ts:2365` | URL host `localhost` | OS2 tunnel detection | no (config) |
| `tools/tools.ts:60-62` | `AWS_LAMBDA_FUNCTION_NAME` | `isLambda()` (root name). Set by the Lambda runtime, so not request-influenced | no |
| `lambda-alb-handler.ts:150` | — | `domain = Host` header → **any ALB client can send `Host: localhost`** | **yes** |
| `<templates-api>/src/modules/search/api-search.ts:91-92,639-640` | `domain === 'localhost'` | `/search/{id}/hello`, `/search/0/migrate` | **yes** |
| `<templates-api>/src/modules/callback/api-callback.ts:104-105,156-159` | `domain === 'localhost'` | custom `id` on POST | **yes** |
| `<templates-api>/src/modules/callback/proxy.ts:177` | sets `domain:'localhost'` | outgoing elevation (A.5) | — |

### B.2 Harness vs Lambda

`<templates-api>/package.json:23` `express.lemon` = `ENV=lemon STAGE=local npm run start`. `env/lemon.yml` keys: `default_env` has `LS, LC, TS, NAME, BACKBONE_API, USE_SESSION, REPORT_ERROR, OS2_ENDPOINT, OS2_INDEX, OS2_SECRET_KEY, OS2_ACCESS_KEY, OS2_JWT_TOKEN, OS2_SIGNATURE, OS2_MESSAGE`. `local` adds `REPORT_ERROR_ARN, STAGE (:45, `!`-forced), NS, MY_DYNAMO_TABLE, USE_SESSION (:48)`. `dev`/`prod` set `STAGE` (and `NS`, `TS`). Value shapes only: `default_env.USE_SESSION` is a truthy 1-char flag, and `local.USE_SESSION` is a path to an existing `*.json` session file `[measured]`. `LOCAL_ACCOUNT` is not set anywhere in templates-api.

| Branch | Harness (express) | Lambda |
| --- | --- | --- |
| `STAGE === 'local'` | **off** (final `STAGE` = develop, § 7.8) | off |
| `domain === 'localhost'` | **on** for every request to `localhost` (domain = `host`) → admin, no 403, no `sid` pin | off unless forged (A1), via ALB `Host`, or a host-less direct invoke |
| `USE_SESSION=*.json` | on: identity from the session file when the express identity has no `apiKey` (`abstract-services.ts:1028-1045`) | `'1'` → `_default()` |
| `LOCAL_ACCOUNT` | unset | unset |

### B.3 Proposal: one runtime setting (not implemented)

`LOCAL_MODE` (env, read once at init; proposal) → `isLocalMode = LOCAL_MODE==='1' && !isLambda()`. Expose it as a member of the existing root value `$U` (e.g. `$U.isLocalMode()`), so the root count stays at 294. It is never derived from the event. The devkit `buildExpress` path (or the `local` section of `env/lemon.yml`) sets it. Consumer lines that change:

- lemon-core: `abstract-controllers.ts:144-145, 161-163, 413-416, 599-613`; `abstract-services.ts:1002, 1024, 1037, 1041-1049, 1056, 1085-1087, 1122, 1134, 1168, 1325, 1351`; `helpers.ts:717-719, 735-743`; `engine.ts:85` (use `isLocalMode`, not `context.source`); `lambda-alb-handler.ts:150` (stop deriving `domain` trust from `Host`).
- Not changed (not trust gates): `config-service.ts:110-115`, `protocol-service.ts:187,238-245`, `builder.ts:229`, `abstract-services.ts:2365`, `helpers.ts:570`.
- templates-api: `api-search.ts:91-92, 639-640`, `api-callback.ts:104-105, 156-159, 183`, `callback/proxy.ts:177` (replace the outgoing `domain:'localhost'` with a signed internal claim).
- `LOCAL_ACCOUNT` and `USE_SESSION=*.json` are honoured only when `isLocalMode`.

Specs that pin `domain:'localhost'` semantics: lemon-core `abstract-controllers.spec.ts:470` "should pass doList(session)" (localhost variant), `abstract-services.spec.ts:864` "should pass ManagerProxy(session + local)", `helpers.spec.ts:628` "should pass isUserAuthorized()", `:635` "should pass getIdentityId()". templates-api: none.

---

## C. Default CRUD and `sid` scope — S-37, E-34, E-35

Inherited handlers (`abstract-controllers.ts`, routed by `GeneralController.asFuncName/asFuncNameByDo`, `controllers/general-controller.ts:54-95`) `[code]`:

| Route | Handler | Check | `sid` behaviour |
| --- | --- | --- | --- |
| LIST `/{type}` | `doList` `:270-302` | **no `canDo`** | `packSearchParam` (`abstract-services.ts:1306-1366`): with session and not local, pinned to the session `sid` (an admin may pick any `sid`). **Without session (`USE_SESSION` off, or `STAGE=local`) there is no `sid` filter**, so it lists every site |
| GET `/{type}/0/list` | `doGetList` `:311-328` | → `doList` | same |
| GET `/{type}/{id}/admin` | `doGetAdmin` `:333-368` | `hasAdminRole` only if `id`; `initialize?save` reseeds data | — |
| GET `/{type}/{id}` | `doGet` `:376-398` | `canDo('read')` | — |
| POST `/{type}/0` | `doPost` `:407-436` | `canDo('create')`; custom id only local | `sid/uid` come from the session only when `confUseSession` (`:181-199` → `abstract-services.ts:1218-1245`). Otherwise the record is saved **without `sid`** |
| POST array / `bulk` | `doPostBulk` `:445-480` | `canDo('create')` per item | **sequential** saves (`my_sequence`, `:473`) (E-35 confirmed) |
| PUT `/{type}/{id}` | `doPut` `:488-517` | `canDo('update')` | — |
| PUT bulk | `doPutBulk` `:525-585` | `canDo('update')` per item; parallel 10 | — |
| DELETE `/{type}/{id}` | `doDelete` `:593-617` | `canDo('delete')`; `destroy` only local | — |

`MyManagerProxy.canDo` (`abstract-services.ts:1447-1495`): admin → true (`:1463-1465`, where admin includes local, signed and the roles shortcut). The `switch` sits **inside `if (hasRole)`** (`:1472-1490`), so a guest (empty `roles`) always gets 403, even to read a `sid`-less record (E-35 confirmed). For any caller with a role, **`!M.sid` → allowed for list/read/create/update/delete** (`:1478`, `:1484`). Combined with "no `sid` stamped when session is off", records are open to every role holder. `throwable` defaults to true, so the `return null` branches in the controllers run only when a subclass passes `throwable:false`.

`GeneralAPIController` (`controllers/general-api-controller.ts:68-152`): `listBase/getBase/putBase/postBase/deleteBase(destroy)` with **no authorization at all** `[code]`. templates-api does not use it.

templates-api usage: `MockAPIController` (`mocks`, overrides `doGet`/`doPost`, inherits list/put/delete/bulk/admin; route **unauthenticated**). `TestAPIController` (`tests`, `useSession:false`, inherits everything). `CallbackAPIController` (overrides `doPost`, `doGetList`).

Spec coverage that would break or need review:
- lemon-core `abstract-controllers.spec.ts`: "should pass doList(authed)" `:122`, "doList(session)" `:141`, "doList(session/admin)" `:306`, "doList(offsite/admin)" `:390`, "doList(session)" (localhost) `:470`, "should normal CRUD: tests/1" `:570`, "should pass findLookup$()" `:710`.
- lemon-core `abstract-services.spec.ts` (61 `canDo/hasAdminRole/assertContext` references): "packSearchParam(session)" `:542`, "ManagerProxy(authed)" `:812`, "(signed)" `:830`, "(session)" `:848`, "(session + local)" `:864`.
- templates-api: `api-mocks.spec` (2 tests), `api-tests.spec` "should pass basic CRUD", "validate routine for POST/PUT", `api-callback.spec` "should pass basic CRUD".

---

## D. Failure propagation — S-35, C5, E-36, D7

Top level `[code][measured]`. `LambdaModule.lambda.handle` = `engine.initialize().then(super.handle)` (`cores/lambda/index.ts:64-69`). `LambdaHandler.handle` (`lambda-handler.ts:239-316`) catches, reports when `REPORT_ERROR` (default `'1'`, `:155`), and **rethrows** (`:300-315`). **D7's "top level catches everything" is therefore not current behaviour.** A rejection becomes a Lambda invocation error (the process survives, the invocation fails). Measured rejections: invalid header JSON → `packContext` rejects → `handle()` rejects, so API Gateway gets an integration error, not a 400 `[A4]`. Unknown event → `400 UNKNOWN EVENT` reject `[D4]`. Cron listener error → reject `[cron E1]`.

| Source | Dispatch | On listener or handler rejection | `[measured]` |
| --- | --- | --- | --- |
| web | `promised → mxNextHandler → mxNextFailure` (`lambda-web-handler.ts:328-339`) | HTTP response (E) | — |
| SQS | `lambda-sqs-handler.ts:47-127`, `do_parrallel(…,1)` | per-listener `.catch($doReportError)` (`:112`), per-protocol `.catch` (`:96`), per-record `.catch` (`:121`) → **resolves `undefined`** | `resolved undefined` (D1) |
| SNS | `lambda-sns-handler.ts:47-129`, `do_parrallel(…,5)` | same (`:88`, `:114`, `:123`) | `resolved undefined` (D2) |
| DDS | `lambda-dynamo-stream-handler.ts:89-137`, `do_parrallel(…,1)` | same (`:125`, `:134`) | `resolved undefined` (D3) |
| cron | `lambda-cron-handler.ts:51-58` `Promise.all` without catch | **propagates** to the top → reject | `rejected: boom-cron` |
| notification | `lambda-notification-handler.ts:88-107` | per-listener catch → 200 | — |
| wss | `lambda-wss-handler.ts:75-86` | always `success('ok')` (stub) | — |

`batchItemFailures` appears 0 times in `src` `[code]`. `buildReportError` (`lambda-handler.ts:141-147`) returns `GETERR(e)` after optional `doReportError`. `doReportError` (`engine/engine.ts:82-…`) publishes `{service, message, context:{…, event}, data}` to SNS `REPORT_ERROR_ARN` through the lazy `AWSSNSService` (`engine.ts:40`). It is skipped when `context.source==='express'` or `accountId===''`.

- **SQS.** Return `{ batchItemFailures: [{ itemIdentifier: record.messageId }] }`. It takes effect only when the event source mapping has `FunctionResponseTypes: [ReportBatchItemFailures]`; without it the return value is ignored and every message is deleted (= v4 behaviour). That makes the return shape safe by default. **Deployment (eureka-deploy lane):** set the flag. templates-api uses `batchSize: 1` (`serverless.yml:207-213`). If the handler throws while the flag is on, the whole batch is retried.
- **DDS.** The same shape with `itemIdentifier = dynamodb.SequenceNumber`. With the flag on and no `MaximumRetryAttempts`/`BisectBatchOnFunctionError`, a poison record blocks the shard until it expires. Deployment must pair them. `prev` contract `[measured D3]`: MODIFY `prev` holds only keys in `diff` (`{"meta":"none"}` for diff `["meta","type"]`; a key that was absent in the old image disappears). REMOVE: `diff=[]`, `prev={}` (old data only in `node`, `:111`). INSERT: `prev={}` (`:110-115`). E-36 confirmed.
- **SNS.** SNS→Lambda is an async invoke. A rejection makes Lambda retry twice (default) and then send it to the DLQ/on-failure destination if one is configured. SNS itself saw delivery as successful. So "rethrow" means up to 3 executions and duplicate side effects. **Recommend: no rethrow — report and resolve (today's behaviour), return a per-record summary, and make "rethrow" an explicit opt-in per handler.** Reason: D7 forbids failure via throw, and SNS has no partial-batch response.
- **v4 consumers relying on "swallow and resolve":** every `addListener` user of SQS/SNS/DDS, and the protocol SQS/SNS path. Once the deploy flag is on, the semantics change from "message deleted" to "message redelivered", so listeners must be idempotent.

Specs that pin current behaviour: `lambda-sqs-handler.spec.ts` "should pass handle protocol with web (default)" (`:37`, expects `undefined` plus `lastResult` `['404 NOT FOUND …']`); `lambda-sns-handler.spec.ts` same (`:37`); `lambda-dynamo-stream-handler.spec.ts` "should pass handler listener" (`:71`), "should pass createSyncToOS2()" (`:100`) (`toEqual(undefined)`); `lambda-cron-handler.spec.ts` "should pass handler listener" (`:33`); `lambda-handler.spec.ts` "should pass success w/ callback + error" (`:97`), "…promised + error" (`:111`) (pin the top-level reject).

---

## E. Error → status mapping — S-33, S-34

`mxNextFailure` (`lambda-web-handler.ts:215-262`) `[code]`:
1. message starts with `404 NOT FOUND` → 404, **not reported** (`:218`)
2. `/^[1-9][0-9]{2} [A-Z ]+/` → status = first 3 digits (`:222-223`). This accepts `200`…`999`: a thrown `"200 OK - …"` produces a 200 response with an error body.
3. 301/302 with ` - <loc>` → redirect (`:225-228`)
4. `400 SIGNATURE…` → 400, not reported (`:230-232`)
5. any other status → **reported** (including every 4xx) → `failure(message, status)` (`:235-239`)
6. `.name…` → 400 reported (`:240-246`); `@name…` → 400 reported (`:247-253`)
7. else → reported → `failure()` default **503** (`:155-157`, `:257-261`). A non-`Error` object is returned as the body.

Error classes: lemon-core exports **none** with `status`. There are two local `class MyError extends Error` without status (`extended/abstract-service.ts:740`, `helpers/helpers.ts:832`) and an OS2-only `$ERROR` helper (`cores/elastic/os2-service.ts:1106`).

Throw sites `[measured count-throws.sh]` (non-spec `src`):

| | total `throw new Error(` | `NNN TEXT` | `.name` | `@name` | other |
| --- | --- | --- | --- | --- | --- |
| lemon-core | 381 | 78 (`404 NOT FOUND` 44, `400 INVALID CONTEXT` 6, `400 INVALID DATA` 5, …) | 56 | 174 | 73 |
| templates-api | 86 | 16 (`404 NOT FOUND` 7, `403 NOT ALLOWED` 3, `301/302 REDIRECT` 2, …) | 22 | 45 | 3 |

String-prefix consumers: lemon-core 53 non-spec sites (`startsWith('NNN…')` or `NUL404`, e.g. `extended/abstract-service.ts:200,211,228,270`, `cores/storage/*`, `os2-service.ts` 20+, `aws-lambda-helper.ts:99-101`, `http-fetch.ts:118`). templates-api 2 (`search/service.ts:305`, `api-search.ts:518`). Spec literals `toEqual('NNN …')`: lemon-core 150, templates-api 14.

**The message prefix is also a wire contract.** `invokeLambda` turns the callee's HTTP status and body back into `Error(message)` (`aws-lambda-helper.ts:99-103`), and v4 peers compare strings. Design input: a status-carrying class must keep `message = "<status> <CODE> - <detail>"`, and `mxNextFailure` reads `e.status` first and then falls back to the string rules. A new root error class makes the root count 295.

Leftovers that fit B5: only 200/201 count as success in `http-fetch.ts:131` and `aws-lambda-helper.ts:84,100` (§ 3.10 "204"). `fetch` has **no timeout** (`http-fetch.ts:92`, no `signal`). A default under the API Gateway 29 s limit (templates-api `lambda` timeout 30 s, `serverless.yml:217`) follows from those limits.

---

## F. `guardProxy` and `enableSync` — S-71, D2-5

- `MyCoreService.guardProxy` (`abstract-services.ts:192-205`): on success it runs `saveAllUpdates()`. On exception it **also** runs `saveAllUpdates()` (errors swallowed by `GETERR$`) and then rethrows (`:199-204`, "force to save models even for exception @240613").
- `MyCoreManager` constructor (`:257-276`): `enableSync = options?.enableSync ?? true` (`:272`), so `$OS2.synchronizer?.enableSynchronization(type)` runs at construction. The first manager builds the lazy `$OS2`.
- templates-api subclasses relying on the defaults: `MockModelManager` (`modules/mock/service.ts:30`), `TestModelManager` (`:138`), `CallbackModelManager` (`modules/callback/service.ts:42`). **None passes `options`** (0 `enableSync` references), so all 3 rely on sync=on. `guardProxy` callers: `hello-api.ts:152`, `api-mocks.ts:104,123`, `api-search.ts:271`, `api-callback.ts:65,81,123,163,187,210`, plus every inherited CRUD handler (C).
- Specs: **0 specs pin save-on-exception.** templates-api `backend-service.spec.ts` "guardProxy()" (`:97`) pins save-on-**success** (and the `get(id, {})` default-save trap, S-72, out of scope). lemon-core `extended/abstract-service.spec.ts:75` defines its own local `guardProxy` without the catch.

---

## G. `$U.dt` / `$U.ts` — S-51, E-45…E-48, D8

Code `[code]`: `Utilities.timestamp` (`engine/utilities.ts:177-196`), `Utilities.datetime` (`:201-267`), `ts`/`dt` (`:269-274`). `convDate = $U.dt(dt, DEFAULT_TIME_ZONE=9)` (`engine/engine.ts:394-397`), `convDateToTime` (`:404-408`), `convDateToTS` (`:416-419`).

Behaviour `[measured dt-table, TZ = UTC / Asia/Seoul / America/New_York (EDT at run time)]`:

| Input | timeZone | v4 result | Note |
| --- | --- | --- | --- |
| `'2026-07-15'` (date only, also `20260715`, `26-07-15`) | absent / 0 | `…T12:00Z` (all 3 zones) | date only → **noon**; absent = 0 = **UTC** (E-45) |
| same | 9 | `…T03:00Z` | KST noon |
| `'2026-07-15 09:30:00'` | absent | `09:30Z` | string read as UTC |
| `'2026-01-15'` (winter) | absent | UTC/KST `12:00Z`, **New York `13:00Z`** | **DST bug**: offset from call time (EDT), not the target date (EST). `:205`. E-46 confirmed |
| `'2026-01-15 09:30'` | 9 | UTC/KST `00:30Z`, **NY `01:30Z`** | same bug |
| number | absent / 9 | same instant | dt ignores timeZone for number/Date/undefined (`:257-262`) |
| `Date` | any | **same reference** | E-47 confirmed |
| `ts(N)` | absent | `2026-07-15 00:30:00` (UTC wall) on UTC and KST hosts | default output is UTC regardless of process TZ |
| `ts(N, 9)` | 9 | `09:30:00`; winter `ts(W,9)` NY → **`08:30`** (−1 h) | DST bug in ts too (`:180`) |
| `ts(DateObj, 9)` | — | **mutates the caller's Date**: +9 h on a UTC host, 0 on KST, +13 h on NY | **new (not in M1)**: `:178,182` `setSeconds` on the passed object |
| `convDateToTS(DateObj)` | — | correct string, but mutates the argument (convDate returns the same reference, then ts mutates it): +9 h on UTC hosts | E-47 × the mutation |
| `convDate('2026-07-15 09:30:00')` vs `dt(…)` | — | `00:30Z` vs `09:30Z` | E-48 confirmed (9 h apart) |

E-48 TZ override: `<templates-api>/handler.js:26` is `$env.TZ = 'Asia/Seoul';`. lemon-core has no `handler.js` and sets `TZ` nowhere in `src`. In Lambda, then, `getTimezoneOffset()` = −540, and `ts(DateObj, 9)` happens not to mutate there.

The 3 pre-existing failures "should pass encodeIdentityJWT and verifyToken tests" (web/sns/sqs) are **this contract**. The spec expects `.exp[2026-02-13 20:00:00]` (KST wall). `lambda-web-handler.ts:816` prints `$U.ts(exp*1000)` → `11:00:00` (UTC wall). The table shows the output is identical on UTC and KST hosts, so on those hosts the failure is deterministic, not "time-zone dependent". A v5 default of timeZone 9 would make them pass.

Call sites: lemon-core non-spec `$U.ts(` 8, `$U.dt(` 4 (e.g. `helpers.ts:197,200` in `$T` parsing, `aws-s3-service.ts:267` passes a Date and so mutates it, `api-service.ts:361,412`, `abstract-controllers.ts:395`), `convDate(` 2. templates-api `$U.ts(` 2, `$U.dt(` 1 (`crons-api.ts:112-113`).

Specs pinning outputs: `utilities.characterization.spec.ts` 16 `it`/`it.each` in `describe('dt()')` and `describe('now()')` (:57-249). Among them, "Date input returns the same object reference … preserved" (`:161`), "DST-dependent offset source … preserved" (`:199`), "dt(undefined, 9) ignores timeZone" (`:232`), and the "timeZone 0 and timeZone omitted produce identical output" row (`:101`). `utilities.spec.ts` "check datetime()" (`:76`, 7 expectations), "check JWTHelper()" (`:270`, `ts(current)` UTC wall `:276`). `engine.spec.ts` convDate × 3 (`:149-151`). `lambda-web-handler.spec.ts` uses `$U.dt(…, 9)` as inputs (`:153,178,648`) and the 3 failing expectations. Also `abstract-controllers.spec.ts:694` and `api-service.spec.ts:54`.

---

## H. Baselines

Run in `<lemon-core>` under the host TZ (KST) `[measured]`:

| Gate | Value |
| --- | --- |
| `npm run build` | exit 0. gen-esm-wrapper `index.mjs` **136 named + default**, `testing.mjs` 10 named |
| `npm run api:check` | `base=304 current=294 added=12 removed=22 allow=34 not-allowed=0` |
| `npm run esm:smoke` | `ok names=137 subpaths=4` |
| `npm run dup:check` | `files=84 decls=356 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0` |
| `npm run l1l2:probe` | `checks=28 fails=0 root-keys=137` |
| `node scripts/aws-lazy-probe.cjs` | `dist/index` import **total=290**, `@aws-sdk`/`@smithy`/`@aws-crypto`/`@aws` = 0. After a KMS instance 385 (27/67/0/1); with profile 438. `dist/engine` 131, `dist/tools` 30 (131 after NS), `dist/helpers` 275 |
| `npm test` | **503 total, 499 pass, 4 fail** (52 files, 4 failed). Failures: `engine.spec.ts` "test doReportError() - account id"; `lambda-web-handler.spec.ts`, `lambda-sns-handler.spec.ts`, `lambda-sqs-handler.spec.ts` "should pass encodeIdentityJWT and verifyToken tests" |

templates-api (`<scratch>/b5/ta-scratch`, `lemon-core` linked to `<lemon-core>`; `npm test` runs `fields:gen` first) `[measured]`:

- **99 total, 94 pass, 5 fail.** Suites: 17, of which 6 failed.
- 3 suites fail to compile (`backend-proxy.spec.ts:75,78` TS2345 `_date`): `api-mocks.spec`, `backend-proxy.spec`, `api-tests.spec`.
- 4 failures are `CredentialsProviderError … profile: [none]` (devkit `asyncCredentials`): `hello-api` "GET /hello/0" and "POST /hello/0", `CallbackAPIController` "express route: GET /0/hello", `SearchController` "express route: GET /0/hello".
- 1 is a message mismatch: `CallbackAPIController` "should pass basic CRUD" expects `404 NOT FOUND - proxy/callback/id:1` but gets `404 NOT FOUND - not found @doGet(callback/1)`. This spec pins error text (E).

---

## I. Public-API impact

Root names whose signature or behaviour changes (count stays 294 unless the design allows one error class, which makes 295):

| Change | Root names (behaviour / signature) | Deep paths |
| --- | --- | --- |
| Header drop and signature (A) | `LambdaWEBHandler` (packContext), `LambdaSNSHandler`, `LambdaSQSHandler`, `ProtocolModule`, `$protocol` (outgoing sign) | `./dist/cores/protocol/protocol-service` (`MyProtocolService`, `WEB/SNS/SQSProtocolTransformer`, `HEADER_PROTOCOL_CONTEXT`); `./dist/cores/lambda/lambda-web-handler` (explicit subpath: `MyHttpHeaderTool.parseIdentityHeader/isExternal`, `mxNextFailure`); `./dist/cores/protocol/aws-lambda-helper` |
| Local mode (B) | `$U` (+ member), `MyCoreProxy` (`getCurrentSession`, `asCurrentIdentityId`, `assertContext`, `hasAdminRole`), `MyManagerProxy` (`packSearchParam`, `canDo`), `AbstractCRUDController` (`confUseSession`, `modelAsView`, `doPost`, `doDelete`), `getIdentityId`, `isUserAuthorized`, `doReportError`, `LambdaALBHandler` | `./dist/extended/cores` (explicit subpath) |
| CRUD `sid` scope (C) | `AbstractCRUDController` (`doList`, `doGet`, `doPut`, `doDelete`, `doPostBulk`), `MyManagerProxy.canDo`, `CanDoOptions` (maybe), `GeneralAPIController` (if gated or deprecated) | `./dist/extended/cores/abstract-controllers` |
| Failure propagation (D) | `LambdaHandler` (`handle` top-level catch), `LambdaSQSHandler`/`SQSHandler` (`void` → batch response type), `LambdaDynamoStreamHandler`/`DynamoStreamHandler` (same), `LambdaSNSHandler`/`SNSHandler` (summary), `LambdaCronHandler` is not root (deep `./dist/cores/lambda/lambda-cron-handler`), `CronHandler`, `buildReportError`, `DynamoStreamBody` (`prev` doc) | `./dist/cores/lambda/*` |
| Status mapping (E) | `failure`, `success` (2xx), +1 error class | `./dist/lib/http-fetch` (2xx, timeout) |
| guardProxy and enableSync (F) | `MyCoreService` (`guardProxy`), `MyCoreManager` (constructor default) | `./dist/extended/cores/abstract-services` |
| dt/ts (G) | `$U` (`ts`, `dt`, `now`), `convDate`, `convDateToTS`, `convDateToTime`, `DEFAULT_TIME_ZONE` (value may become the default), `$T` (`helpers.ts:197,200` parse via `$U.dt`) | `./dist/engine/utilities` (`Utilities.timestamp/datetime`) |

---

## Experiments

All in `<scratch>/b5/exp/`. They run against the built `<lemon-core>/dist` with `LS=1 REPORT_ERROR=0`, and cwd is a scratch folder holding a stub `package.json`. No network.

| Script | What | Output file | Key result |
| --- | --- | --- | --- |
| `protocol-probe.cjs` | A1–A8 trust and origin, D1–D4 record failures, C1 `hasAdminRole` | `protocol-probe.out.txt` | A1 forged identity and `domain:localhost` accepted on a REST fixture (200). A2 mixed case not trusted. A3 mismatched `accountId` → 400. A4 bad JSON → top-level **reject**. A5 protocol event has no `host`. A6 JSON `x-lemon-identity` accepted without `host`. A7 ignored with `host`. D1/D2/D3 resolve `undefined`. D4 reject. C1 admin = true for localhost / `accessKey` / `roles:[admin]` |
| `cron-probe.cjs` | cron listener failure | `cron-probe.out.txt` | `rejected: boom-cron` |
| `dt-table.cjs` | dt/ts/convDate table × 3 TZ | `dt-table.out.txt` | G table (DST ±1 h; Date mutation +9/0/+13 h) |
| `hmac-cost.cjs` | HMAC cost, 1000 iterations × 3 runs | `hmac-cost.out.txt` | 1,045 B context; 43-char sig; ~12–13 µs sign |
| `../count-throws.sh` | throw-site counts | `../count-throws.{lc,ta}.txt` | E table |
| baselines | build, gates, test | `../baseline-lc.log`, `../baseline-ta.log` | H |

---

## Contradictions with the M1 claims

1. **D7 / SPEC § 10 "the top-level handler catches everything"** is the target, not current code. `LambdaHandler.handle` rethrows (`lambda-handler.ts:300-315`). Measured rejections: bad protocol header, unknown event, cron listener error.
2. **C11 "protocol loopback at `protocol-service.ts:198-203`"**: no loopback exists in v5. `'local'` maps to the `-dev` names at `:238-245`, and the default stage is `'local'` at `:187`. The claim that local goes to the real `-dev` functions still holds. The anchor moved.
3. **C1 "API Gateway may or may not pass the header"**: refined. Only the exact lowercase key is trusted (`[measured A2]`), and lowercase is always sendable. So injection holds for any client that reaches the route, including unauthenticated `/mocks` in templates-api.
4. **E-34 "inherited routes pass only `canDo`"**: `doList` has **no** `canDo`. `GeneralAPIController` has no check at all.
5. **E-45 "number/Date/undefined ignore timeZone"**: true for `dt` only. `ts(number, tz)` honours `tz`.
6. **New, not in M1**: `ts(Date, tz)` mutates its argument (`utilities.ts:178,182`), and so does `convDateToTS(Date)`. The ALB handler takes `domain` from the client `Host` header (`lambda-alb-handler.ts:150`), which makes `localhost` elevation reachable through an ALB. `doReportError` skips reports for a forged `source:'express'` or empty `accountId` (`engine.ts:85`). `getCurrentSession` decodes `identity.meta` as an unverified JWT when local (`abstract-services.ts:1024-1027`). templates-api uses `domain:'localhost'` as an outgoing elevation token (`callback/proxy.ts:177`). Cron failures are **not** swallowed (they propagate), unlike SNS/SQS/DDS.
7. **SPEC § 7.8 "the 4 failures are 9 h apart, time-zone dependent"**: 3 of them come from `$U.ts` defaulting to UTC wall-clock, which gives the same output on UTC and KST hosts. They are deterministic there. They pin the KST contract that G decides.
8. Anchor drift only (claims hold): S-29 `lambda-web-handler.ts:423-427` → `:435-440`. S-33 `:202-249` → `:215-262`. S-34 `:142-144` → `:155-157`. C10 `abstract-services.ts:1003,1038-1049` → `:1002,1037-1051`. S-30 `lambda-handler.ts:204-206` and S-35 `:141-147` are unchanged. S-71 `abstract-services.ts:193` → `:192-205`.

---

## Owner decisions

These are value judgements. Each has a recommendation.

1. **`$U.dt`/`$U.ts` default timeZone** (§ 9 K11): keep 0 (UTC) or default to `DEFAULT_TIME_ZONE` = 9. **Recommend 9.** It matches `convDate` and `handler.js` KST, it is host-independent, and the 3 failing specs already expect it. Cost: every `$U.ts()` string without an argument shifts +9 h from v4 (call sites in G).
2. **Date-only string time**: **recommend keeping noon.** Noon survives ±12 h zone shifts without changing the date, and midnight would move stored epochs by 12 h. The rest (DST from the target date, `Date` copy and no mutation, instants ignore timeZone in `dt`) can be derived and needs no decision.
3. **Signature transition default** (§ 9 K10): v5.0 ships with `PROTOCOL_VERIFY=warn` (accept unsigned v4 contexts and log them), or with `enforce`. **Recommend `warn` until the DoU services are on v5 (B6), then `enforce`.** Header drop on `host` is unconditional either way. Key scope: **recommend one install-wide secret.** Every service can already invoke every other in a user-cloud install (D6).
4. **`sid`-less records under session mode** (`canDo` `!M.sid → true`). **Recommend: read and list stay open to role holders, but update and delete of `sid`-less records become admin-only.** This closes the write hole without hiding legacy data. Stamping `sid` on create when the session is off stays as is.
5. **`GeneralAPIController` (no authorization)**: gate it or deprecate it. **Recommend `@deprecated` in v5 with a doc note "consumer must gate", removal in v6.** templates-api does not use it, and DoU usage is unknown until B6 X1.
6. **SNS failure semantics** (§ 9 draft): **recommend no rethrow (report and resolve), opt-in rethrow per handler.** This follows from D7 and SNS async retry; confirm it as a closing note rather than a new decision.
