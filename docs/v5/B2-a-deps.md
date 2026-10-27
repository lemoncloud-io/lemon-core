# v5 B2-a — Dependencies out: `request`, `lodash`, `ioredis`, `memcached`

Status: implemented and measured 2026-10-27 on `feat/v5-b2-deps` (base `v5` @ `f21182d8`). First part of B2 (dependencies and coupling). Measured facts behind the design: `docs/v5/B2-inventory.md`.

## Scope

- **`request` → built-in `fetch`.** The three http proxy factories (`createSigV4Proxy`, `$X.createHttpSearchProxy`, `createHttpWebProxy`) keep URL building, signing and header relay, and call one internal module `src/lib/http-fetch.ts` (not exported from any barrel) for send, status check, error format and body parse. Same contract as v4: success on `200`·`201` only, v4 error message formats, `json` body parse of any text, network errors carry the errno in the message.
- **`lodash` → `src/cores/dynamo/tools/lang.ts`** (internal): `isPlainObject`, `isObject`, `isEmpty`, `merge`, `mapValues`, `omitBy`. The other 14 functions are native at the call site. The dead tools functions and the `async` dependency stay (B3).
- **`ioredis`·`memcached` out.** `RedisBackend`, `MemcachedBackend`, `RedisStorageService`, `DummyRedisStorageService`, `RedisOptions` and the `AbstractProxy` `CACHE_ENDPOINT=redis:` branch are removed. `CacheBackend` and `ItemEntry` are exported. `CacheService.create()` uses `options.backend`, else an in-process `node-cache` backend (the v4 default was Redis).
- **`package.json`**: `ioredis`, `@types/ioredis`, `lodash`, `memcached`, `request` out of `dependencies`; `@types/lodash`, `@types/memcached`, `@types/request` out of `devDependencies`. Lock refreshed with `npm install` (no other dependency change).
- **`api:check` allow list** `etc/api-names.allow.txt`: the gate passes when the diff against `etc/api-names.v4.txt` is a subset of the list.
- **1-line comments** retrofitted on the B1 files (`scripts/gen-esm-wrapper.cjs`, `scripts/esm-smoke.mjs`, `scripts/api-check.cjs`, `src/engine/builder.ts` B1 lines). Comments only, except the new allow-list logic in `api-check.cjs`.

## Files

| File | Change |
| --- | --- |
| `src/lib/http-fetch.ts` | new. `fetchProxyBody()` and its parts (`toPayload`, `isJsonBody`, `buildHeaders`, `sendRequest`, `parseResponseText`, `reparseBody`, `asStatusError`, `asFetchError`) |
| `src/lib/http-fetch.spec.ts` | new. 12 tests against a local `http.createServer` (no external network) |
| `src/helpers/helpers.ts` | `createSigV4Proxy`: body serialized once, the same string is signed and sent; transport via `fetchProxyBody` |
| `src/extended/abstract-service.ts` | `$X.createHttpSearchProxy` same as above; `AbstractProxy` no longer creates a Redis cache (`cache?` stays as a type) |
| `src/cores/api/api-service.ts` | `createHttpWebProxy` transport via `fetchProxyBody` |
| `src/cores/dynamo/tools/lang.ts` | new. lodash replacements |
| `src/cores/dynamo/tools/lang.spec.ts` | new. 7 tests (plain-object detection, nested copy, `undefined` skip, array copy, `Set`/`Buffer` by reference) |
| `src/cores/dynamo/tools/{expressions,query,scan,serializer,utils}.ts` | lodash calls replaced |
| `src/cores/cache/cache-service.ts` | Redis/Memcached backends removed; `CacheOptions` = `{ type?: 'node'; backend?; ns?; defTimeout? }`; `CacheBackend`, `ItemEntry` exported |
| `src/cores/cache/cache-service.spec.ts` | Redis/Memcached blocks and `isLocalCacheAvailable` removed; 1 injection test (fake backend, default, v4 `redis` type rejected) |
| `src/cores/storage/redis-storage-service.ts`, `.spec.ts` | deleted |
| `src/cores/storage/index.ts` | barrel line removed |
| `scripts/api-check.cjs` | allow list (`--allow`, default `etc/api-names.allow.txt`) + 1-line comments |
| `etc/api-names.allow.txt` | new. B2-a: 5 lines |
| `scripts/gen-esm-wrapper.cjs`, `scripts/esm-smoke.mjs`, `src/engine/builder.ts` | 1-line comments only |
| `package.json`, `package-lock.json` | 8 packages removed |
| `HOW_TO_UPGRADE_V5.md` | section 6 (B2-a) and checklist lines |

## Gates (SPEC § 3.7)

| # | Gate | Command | Measured | Result |
| --- | --- | --- | --- | --- |
| 1 | packages gone | `npm ls ioredis lodash memcached request @types/ioredis` | production tree (`--omit=dev`): `(empty)`. Full tree: 2 dev-only transitive entries remain, `concurrently@5.3.0 → lodash@4.18.1` and `lemon-devkit@0.0.11 → request@2.88.2`. In the lock, `request` and its transitive packages (`ajv`, `sshpk`, `har-schema`, `tough-cookie`) and `lodash` are now `"dev": true`; `ioredis`, `memcached`, `@ioredis/commands`, `redis-parser`, `denque`, `hashring` etc. are removed | pass for consumers. The literal `(empty)` on the full tree needs a dev-tool change (see Open points) |
| 2 | clean-env load | `env -i PATH=$PATH HOME=$HOME node -e "require('./dist/index'); …"` | 831 modules (base 1066), ioredis 0, memcached 0, request 0, lodash 0 (by owning package). About 280–350 ms on the measuring machine (base about 585 ms, different run) | pass |
| 3 | public names | `npm run api:check` | exit 0. `-DummyRedisStorageService`, `-RedisOptions`, `-RedisStorageService`, `+CacheBackend`, `+ItemEntry` (base 304, current 303, not-allowed 0). With an empty allow list (`--allow /dev/null`): exit 1 | pass |
| 4 | tests | `npm test < /dev/null` | 523 tests: 519 passed, 4 failed (the known 4: `encodeIdentityJWT` ×3, `doReportError() - account id` ×1). 49 files | pass |
| 5 | ESM | `npm run esm:smoke`; `node scripts/gen-esm-wrapper.cjs --check` | `names=141`, subpaths 4; check `same`/`same` for both wrappers | pass (141, not 142 — see below) |
| 6 | harness boot, `GET /`·`/hello/0`·`/mocks`, search GET | coordinator (T4-10), templates-api v5 worktree linked to this tree, `npm run express.lemon` | boot 39 s (first boot after relink) · 30 s (second). `GET /` 200, `/hello/0` 200, `/mocks` 200, `/search/?ipp=1` 200 (list via `searchSimple` → OS2 FGAC proxy → `fetch`, 39 hits from dev OpenSearch), `/search/echo/query` 200. Boot time is above the 24 s baseline ±20 %; the machine was running two test suites and another build at the time, and this bundle removes 236 modules, so it is not attributed to the code. Re-measure at B2-b start | pass |
| 7 | templates-api `npm test` (link) 97·92·5 | coordinator (T4-10) | 6 failed / 11 passed suites (17), 5 failed / 92 passed tests (97). Same failures as baseline: 3 suites TS2345 (`_date` on `TestModel`), 4 `CredentialsProviderError` hello/callback/search `GET /0/hello`, 1 CallbackAPIController CRUD message. 89 s (baseline 24.9 s; machine under load) | pass |
| 8 | upgrade guide | `HOW_TO_UPGRADE_V5.md` § 6 | cache default, `backend` injection with a consumer Redis sketch, `RedisStorageService` removal, `fetch` port, 300 s undici timeout | pass |
| 9 | B1 comments, values unchanged | `git diff` of the 4 B1 files; `esm:smoke`, `api:check` | `gen-esm-wrapper.cjs`, `esm-smoke.mjs`, `builder.ts`: added comment lines only. `api-check.cjs`: comments + allow-list logic. Values: see gates 3 and 5 | pass |

### Test count

```
533  baseline (v5 @ f21182d8: 529 passed + 4 failed, 48 files)
-20  redis-storage-service.spec.ts deleted (3 own + 17 re-registered from cache-service.spec.ts)
-10  cache-service.spec.ts: Memcached block (4 it + 1 _it) and Redis block (4 it + 1 _it)
 +1  cache-service.spec.ts: injected backend
+12  src/lib/http-fetch.spec.ts
 +7  src/cores/dynamo/tools/lang.spec.ts
----
523  expected   = actual 523 (519 passed + 4 failed), files 48 - 1 + 2 = 49
```

### `esm:smoke` names

`names` counts runtime keys (value names + `default`). B1 had 143 (142 named + `default`). B2-a removes two runtime values (`RedisStorageService`, `DummyRedisStorageService`). `RedisOptions`, `CacheBackend` and `ItemEntry` are type-only, so they do not change the count: 143 − 2 = **141**. The SPEC § 3.7 figure 142 (143 − 3 + 2) counted type names.

### Load probe (clean env, built `dist`, owning-package count)

| Probe | Modules | `@aws-sdk` files (owner / path) | `@aws-sdk` pkgs / `client-*` | `@smithy` | `@elastic` | `ioredis` | `memcached` | `request` | `lodash` | `node-cache` | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `require('./dist/index')` | 831 (base 1066) | 288 / 377 | 44 / 9 | 144 | 84 | 0 (33) | 0 (4) | 0 (13) | 0 (1) | 2 | about 280–350 ms |
| `require('./dist/engine')` | 338 (base 338) | 113 / 137 | 23 / 3 | 85 | 0 | 0 | 0 | 0 | 0 | 0 | about 120 ms |

- Numbers in brackets are the B2 inventory baseline.
- The PLAN T4-7 one-liner matches by path substring (`node_modules/lodash`). It reports `lodash` 7: these are `lodash.includes`, `lodash.isboolean`, `lodash.isinteger`, `lodash.isnumber`, `lodash.isplainobject`, `lodash.isstring`, `lodash.once` — single-function packages of `jsonwebtoken`, not `lodash`. Match `node_modules/lodash/` for the gate.

## `request` parity notes

| Item | v4 (`request`) | v5 (`fetch`) |
| --- | --- | --- |
| success | 200·201 | same |
| 204 and other 2xx | rejected | same (`204 No Content - No Content`) |
| 400·404 message | `<code> <TITLE> - <msg>`, `404 NOT FOUND ...` kept | same, `statusMessage` = `res.statusText` |
| other errors | `<code> <statusMessage or FAILURE> - <msg>` | same |
| network error | `Error` from the socket (`connect ECONNREFUSED ...`) | `new Error(`${cause.code ?? 'FETCH_FAILED'} ${cause.message ?? e.message}`)` → `ECONNREFUSED connect ECONNREFUSED ...` |
| `json:true` response | `JSON.parse` of any text, else the text; empty → `undefined` | same (`"123"` → `123`) |
| `json:false` response | text; empty → `''` | same |
| `{`/`[` re-parse | yes | same |
| request body | `safeStringify(body)` sent, `JSON.stringify(body)` signed | `JSON.stringify(body)` once, the same string signed and sent |
| `accept` / `content-type` | set when absent (`json:true`; content-type only with a body) | same, case-insensitive |
| `GET`/`HEAD` with a body | body sent | body dropped (`fetch` rejects it; SigV4 signs an empty body for `GET` anyway) |
| timeout | none | none set; undici default 300 s (headers, body) |
| compression | not requested | `fetch` requests and decodes gzip/br |

## Open points (for the coordinator)

- Gate 1 literal: the full `npm ls` still shows `lodash` under `concurrently` and `request` under `lemon-devkit` (both devDependencies, `"dev": true` in the lock, not installed for consumers). Making the full tree empty needs a change of those dev tools, which is outside "no other dependency changes".
- `CacheService.create({ type: 'redis' })` without `backend` now throws instead of silently using the in-process cache.
- `package-lock.json` root `version` moved 4.2.6 → 4.3.0 (npm synced it with `package.json`).
