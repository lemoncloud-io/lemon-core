# v5 B20 — lemon-devkit removed: env loading in lemon-core and a local API Gateway

Status: implemented 2026-10-31 on `feat/v5-b20-devkit-out` (base 5.0.13): B20-a (env loading, web handler),
B20-b (local gateway), then the e2e spec and the docs. Decision D80 reverses D33 (`docs/v5/B0-local-harness.md` § B0-b).
B21 (D81, base 5.0.14) removes `express`: see § B21 at the end.

## Why

-   lemon-core called `lemon-devkit` through a dynamic `require()` for three local-only functions
    (`loadEnviron`, `loadProfile`, `buildExpress`). That kept a circular devDependency and made every consumer
    install devkit only to start a local server or to run specs.
-   The devkit server did not behave like API Gateway: three hard-coded routes (`/{type}/{id}/{cmd}`), body
    parsers that lost binary bytes, base64 response bodies sent as text, and a rejected handler left the request
    hanging. A service that worked locally could fail after deploy (and the other way round).
-   After B20 a local run follows the routes and binary rules of the deployed REST API (v1).

## What moved

### Env loading (`src/environ.ts`)

`loadEnviron()` and `loadProfile()` are ported from lemon-devkit with the same rules. No `require('lemon-devkit')`
remains.

| Rule            | Value                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| File            | `${ENV_PATH \|\| './env'}/<profile>.yml` — `ENV_PATH` and `ENV` are options; profile = option `ENV`, else env `PROFILE`, else env `ENV`, else `none` |
| Missing file    | throws `FILE NOT FOUND:<path>`                                                                                                                       |
| Group           | `STAGE \|\| NODE_ENV \|\| 'local'` inside the file; an unknown group gives nothing                                                                   |
| `!value`        | overwrites (the `!` is removed)                                                                                                                      |
| Array           | overwrites as `a, b`                                                                                                                                 |
| Other values    | set only when the key is `undefined` (as string, `null` → `''`)                                                                                      |
| `STAGE`         | set when missing                                                                                                                                     |
| `LS=1`          | no log lines                                                                                                                                         |
| `loadProfile()` | `loadEnviron(process)`, then returns `NAME` (`none` → `''`); logs `! PROFILE =` by `options.info` (default `console.info`)                           |

The merge is in place on `process.env` (as before).

### `buildExpress()` → a local REST v1 gateway (`src/tools/local-gateway/`)

The public API of `buildExpress($engine, $web, options)` is unchanged (`{ express, app, createServer }`; since B21
`express` is always `undefined`). New
options: `serverlessFile` (default `serverless.yml` from `process.cwd()`), `binaryMediaTypes` (added to the file's
list), `stage` (default env `STAGE`, else `local`). `prefix` is still accepted and **ignored**: routes come from
`serverless.yml`.

| Topic                                                      | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes                                                     | every `functions.*.events[].http` of `serverless.yml`, string form (`GET /hello/{id}`) and object form (`path`, `method`, `cors`)                                                                                                                                                                                                                                                                                   |
| YAML                                                       | CloudFormation short tags (`!Ref`, `!Sub`, `!GetAtt`, …) are read as data; a whole-value `${self:a.b, fallback}` is resolved; other `${…}` stay strings                                                                                                                                                                                                                                                             |
| Precedence                                                 | per segment: literal > `{param}` > `{proxy+}`; then exact method > `ANY`                                                                                                                                                                                                                                                                                                                                            |
| Unknown path                                               | `403 {"message":"Missing Authentication Token"}`, header `x-amzn-ErrorType: MissingAuthenticationTokenException`                                                                                                                                                                                                                                                                                                    |
| Method not on the resource                                 | the same 403 (API Gateway matches the resource first)                                                                                                                                                                                                                                                                                                                                                               |
| Body over 10 MB                                            | `413 {"message":"Request Too Long"}`                                                                                                                                                                                                                                                                                                                                                                                |
| Handler rejects, or the result has no numeric `statusCode` | `502 {"message":"Internal server error"}` at once                                                                                                                                                                                                                                                                                                                                                                   |
| Event                                                      | REST v1 proxy event: `resource`, `path`, `httpMethod`, `headers` + `multiValueHeaders` (original case, last value wins), `queryStringParameters` + `multiValueQueryStringParameters`, decoded `pathParameters`, `stageVariables: null`, `requestContext` (`stage`, `requestId`, `requestTime`, `identity.sourceIp`, `identity.userAgent`, `domainName`, `accountId` = OS user as before), `body`, `isBase64Encoded` |
| Request body                                               | base64 + `isBase64Encoded: true` when the request `Content-Type` matches `provider.apiGateway.binaryMediaTypes`; else utf8 text (or `null`)                                                                                                                                                                                                                                                                         |
| Response body                                              | `isBase64Encoded: true` is decoded to bytes only when the request `Accept` matches `binaryMediaTypes` (any listed entry); without `Accept`, the result `Content-Type` is matched; otherwise the base64 text is sent, as a deployed API does                                                                                                                                                                         |
| Response headers                                           | `headers` and `multiValueHeaders` merged (multi wins; `Set-Cookie` as repeated lines); default `Content-Type: application/json`; no `X-Powered-By`                                                                                                                                                                                                                                                                  |
| CORS preflight                                             | `OPTIONS` on a resource with route `cors` (and no explicit `OPTIONS` route) is answered like the Serverless mock integration: origin (`*`, or the request origin when listed), headers, the cors-on methods + `OPTIONS` (`ANY` → all), `allowCredentials`, `maxAge`                                                                                                                                                 |
| `GET /`                                                    | the devkit banner text (name/version, lemon-core, modified, env), **only** when `serverless.yml` has no `GET /` route                                                                                                                                                                                                                                                                                               |
| No usable `serverless.yml`                                 | legacy routes `/{type}`, `/{type}/{id}`, `/{type}/{id}/{cmd}` (any method, cors on) and one warning line `! local-gateway: … → legacy routes`                                                                                                                                                                                                                                                                       |
| Your own routes                                            | since B21: the built-in app (no `express`) checks routes added to `app` before the gateway, even when added after `buildExpress()` or after the first request; see § B21 below                                                                                                                                                                                                                                      |

### Web handler (`src/cores/lambda/lambda-web-handler.ts`, `src/cores/protocol/protocol-service.ts`)

These changes apply to deployed Lambdas too.

-   `{proxy+}` → `id` = first segment, `cmd` = the rest joined with `/` (`/{type}/{proxy+}` with `/blobs/a/b/c` gives
    `id: 'a'`, `cmd: 'b/c'`). With `/{type}/{id}/{proxy+}`, `cmd` = the whole proxy. `{cmd+}` is kept as is.
    The same mapping feeds `context.source`.
-   A base64 request body (`isBase64Encoded: true`) is decoded by its content type:
    -   textual (`text/*`, `application/json`, `*+json`, `application/xml`, `*+xml`, `application/javascript`,
        `application/x-www-form-urlencoded`) → string, then parsed as before;
    -   `multipart/form-data` → `{ ...fields, file, files }`; each file is `{ fieldname, originalname, encoding, mimetype, size, buffer }` (`file` only for exactly one file, `files` for one or more; an invalid body → 400);
    -   any other type → `Buffer`.
-   `buildResponse()`: `isBase64Encoded` is set only for a non-textual `contentType` (`application/json` is no longer
    flagged). A `Buffer` result body is sent as base64 with `isBase64Encoded: true` and
    `Content-Type: application/octet-stream` unless a type is given.
-   The `body.len=` log line counts bytes for a `Buffer` or file body.

### Context differences (measured)

`packContext()` of a gateway event against the same request through the devkit server (`event.spec.ts`):

| Field                                                                               | devkit server                               | B20 gateway                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `identity.identityProvider`, `identity.identityId`, `identity.accountId`            | `undefined`                                 | `null` (copied from `requestContext.identity`, as API Gateway sends it)  |
| `clientIp`                                                                          | `::ffff:127.0.0.1` on an IPv4-mapped socket | `127.0.0.1` (prefix removed; first `X-Forwarded-For` entry when present) |
| Everything else (`accountId`, `domain`, `requestId`, `channel`, `cookie`, `source`) | —                                           | same                                                                     |

## End-to-end check

Real server (`createServer()` on port 0), real `LambdaWEBHandler`, a `blobs` handler registered with `setHandler()`,
fixture `src/tools/local-gateway/fixtures/serverless.gateway.yml`. Run by hand with curl, then kept as
`src/tools/local-gateway/e2e.b20.spec.ts` (bytes compared on the wire with sha256 / `Buffer.equals`).

| Request                                                              | Result                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /blobs/a/b/c`                                                   | handler got `id: 'a'`, `cmd: 'b/c'`                                                         |
| `POST /blobs/up/raw`, `application/octet-stream`, 4096 bytes         | handler got a `Buffer` of 4096 bytes, same sha256                                           |
| `POST /blobs/up/form`, multipart (`note` + a png file)               | `{ note, file: { originalname, mimetype, size, buffer } }`, file sha256 equal               |
| `GET /blobs/dl/png`, `Accept: image/png`, handler returns a `Buffer` | 200, `application/octet-stream`, the exact bytes                                            |
| `POST /blobs/j/x`, JSON body                                         | not base64; handler got an object                                                           |
| `GET /nowhere`                                                       | 403 Missing Authentication Token                                                            |
| `DELETE /hello/world` (resource without that method)                 | 403                                                                                         |
| `OPTIONS /hello`                                                     | 200 with the configured CORS headers (origin, headers, `GET,OPTIONS`, credentials, max age) |

Other specs: `routes`, `match`, `event`, `gateway` (`src/tools/local-gateway/*.spec.ts`),
`lambda-web-handler.b20.spec.ts`, `lib/multipart.spec.ts`, and `express.spec.ts` without the devkit gating.

## Dependencies

-   `lemon-devkit` removed from devDependencies (the lock has no `lemon-devkit`).
-   `express` added as an optional peer (`^4.21.2 || ^5.0.0`) and a devDependency (`^4.22.3`, for the specs).
    Removed again in B21 (below).
-   No new `dependencies`.

Consumer steps: `HOW_TO_UPGRADE_V5.md` § 20.

## B21 — no `express` (D81)

Status: implemented 2026-10-31 on `feat/v5-b21-no-express` (base 5.0.14).

### Why

-   The local server is a light local harness, not a service web framework. After B20 every service request goes
    through the local API Gateway, which reads the raw bytes and writes the answer with plain Node `http` objects.
    `express` only carried a few local extension routes (services add one: `POST /echo`).
-   Keeping `express` meant an optional peer, a devDependency in every service, a front body reader, and code that
    moved the gateway to the end of the Express router stack (`_router` in Express 4, `router` in Express 5).

### What changed

-   `buildExpress()` keeps its name, options and result keys. `app` is now a small built-in app
    (`src/tools/local-gateway/app.ts`, internal): a plain Node request listener, so `http.createServer(app)` and
    `supertest(app)` work as before. `express` is always `undefined` (deprecated). `loadModule` is ignored (deprecated).
-   `createServer()` is unchanged: `http.createServer(app).listen(port)` (`--port`/`-port`, `package.json` `port`,
    default 8081) and `$engine.initialize()` on `listening`.
-   The front body reader and the router-stack code are removed. The gateway still reads the raw body itself.

### The app API (the whole list)

| Part            | Supported                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes          | `app.get/post/put/patch/delete/all(path, ...handlers)`; exact path (one trailing `/` allowed, case-sensitive) with `:name` segments → `req.params` (decoded); a `GET` route also answers `HEAD` |
| Middleware      | `app.use(handler)` (every path) and `app.use(path, handler)` (the path and below); `req.url` is not rewritten                                                                                   |
| Order           | layers run in registration order, **before** the gateway; `next()` → the next matching layer, then the gateway; routes added later (even after the first request) are seen                      |
| No match        | the request goes to the gateway untouched (the stream is not read)                                                                                                                              |
| `req`           | Node `IncomingMessage` + `params`, `query` (single values, the last one wins, like `queryStringParameters`), `rawBody` (Buffer), `body`                                                         |
| `req.body`      | `application/json` / `*+json` → parsed value; `application/x-www-form-urlencoded` → single-value map; `text/*` → string; other → Buffer; empty body or bad JSON → `undefined`                   |
| `res`           | Node `ServerResponse` + `status(code)` (chainable), `set(name, value)` / `set({..})` / `header(...)`, `json(value)`, `send(string \| Buffer \| object)`, `sendStatus(code)`                     |
| Content types   | `json` → `application/json; charset=utf-8`; `send(string)` → `text/html; charset=utf-8`; `send(Buffer)` → `application/octet-stream`; `send(object)` → JSON (a type set before wins)            |
| Errors          | a handler that throws or rejects, or `next(err)` → `500 {"message":"Internal server error"}` and an `$engine.err` line (the response is only ended when it already started); never hangs        |
| Body over 10 MB | `413 {"message":"Request Too Long"}` (as the gateway)                                                                                                                                           |
| Body read once  | when a layer matches, the body is read once into `req.rawBody`; the gateway reuses those bytes (binary uploads stay intact behind `app.use()`)                                                  |

Not supported (by design): Express sub-apps and `Router`, `app.listen`/`app.set`, regex or wildcard paths, nested
query parsing (`a[b]=1`), cookies/sessions, `res.render`/`res.redirect`/`res.cookie`/`res.type`, view engines and
static files. Use the gateway (`serverless.yml` routes and handlers) for service behaviour; extension routes are for
local-only helpers.

### Consumers

Remove `express` (and `@types/express`, when only the local server needed it) from `devDependencies`.
`src/express.ts` stays as it is; `app.post('/echo', …)` with `req.method/headers/query/params/body` and
`res.status/json/send/set` keeps working. Steps: `HOW_TO_UPGRADE_V5.md` § 20.

### Dependencies

-   `express` removed from `peerDependencies`, `peerDependenciesMeta` and `devDependencies`; the lock drops 53
    packages and has no `node_modules/express`. `supertest` stays a devDependency (specs only).
-   No new `dependencies`.

### Tests

`src/tools/express.spec.ts` is rewritten for the app (no express): banner and legacy routes, `--port`, an `/echo`
route added after build (method, headers, JSON body, query), `:name` params, `app.all`, `app.use` + `next()`, the
response helpers, body parsing by content type, 500 on a failing handler, 413, and binary uploads that reach the
gateway with the same sha256 (untouched, and behind `app.use()`) on a real listening server.
`src/tools/local-gateway/e2e.b20.spec.ts` is unchanged.
