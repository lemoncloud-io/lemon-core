# v5 B2-b — Search: OpenSearch client, ES names out, lazy `$OS2`

Status: implemented and measured 2026-10-27 on `feat/v5-b2-b-search` (base `v5` @ `b0dc74c2`). Second part of B2. Design: SPEC § 3.4 (vault). Measured facts behind the design: `docs/v5/B2-b-inventory.md`. Consumer side: `lemon-templates-api` `feat/v5-b2-b-search` (base `v5` @ `37034d7`).

## Scope

- **Client swap.** `@elastic/elasticsearch` 7.12 → `@opensearch-project/opensearch` `^3.9.0` (3.9.0 installed). Same wrapped response shape. No other dependency change. The package is a type-only import at module top and is `require`d by a memoized loader on the first client creation (`OS2ClientService.newClient()`), so it is not on the import path.
- **Typeless calls.** No call sends a doc `type`; `searchType` goes out as `search_type`; `mget` sends `{ index, body: { docs } }` only. `prepareSettings()` always returns the typeless mapping; the `standard` filter branch is gone; one `createIndex()` for every instance.
- **No version detection.** `EngineType`, `ParsedVersion`, `parseVersion`, `parsedVersion`, `getVersion`, `executeSelfTest`, `saveInfoToFile`, `isOldES6`, `isOldES71`, `isLatestOS2`, the `version` getter and the `data/samples/*/info.json` dump path are removed.
- **`$ERROR.asError`** reads the type from `meta.body.error.type`; the message form is unchanged. The ES 6.2 `E.response` branch is removed.
- **Names** (SPEC § 3.4.2): 9 renames, 5 public deletions plus the L1 instance family (`Elastic6Proxy`, `$X.createHttpSearchProxy`, `ES6_*` env reads) and the L2 `$ES6`. `createSyncToElastic6` → `createSyncToOS2`. File names unchanged.
- **Lazy** (S-25): `src/lib/lazy.ts` `lazyInstance()`; `$OS2 === $ES6Routed` (one Proxy); `OS2ClientService.client` is created by `createClient()` on first access; `OS2Service.createClient()` reads the master `auth` from config at that time (both uid and pwd, else none); `AbstractOS2Instance` constructor is empty; `OS2Instance` builds one fgac/elastic/query/synchronizer set only when `endpoint && indexName`; `MyCoreManager` uses `$OS2.synchronizer?.…`.
- **Carried bug fixed.** `OS2Service.pushItem` reads `res._id`/`res._version` (FGAC result is the body).

## Files

| File | Change |
| --- | --- |
| `package.json`, `package-lock.json` | `@elastic/elasticsearch` out, `@opensearch-project/opensearch ^3.9.0` in |
| `src/cores/elastic/elastic6-service.ts` | `OS2ClientService` (lazy client; `newClient(extra)` + memoized package loader), `OS2CoreService`, `OS2BaseOption`, `OS2Item`; typeless calls; version code removed; `prepareSettings` typeless; `$ERROR.asError` on `meta.body.error.type`; `DummyElastic6Service` and the `elasticsearch` re-export removed |
| `src/cores/elastic/elastic6-query-service.ts` | `OS2QueryService` |
| `src/cores/lambda/lambda-dynamo-stream-handler.ts` | `createSyncToOS2` |
| `src/extended/abstract-service.ts` | `OS2Synchronizer`, `OS2ConstructParams`, `OS2SearchParams`, `AbstractOS2Instance` (empty ctor, `client` getter, typeless `createIndex`/`mget`); `Elastic6Instance`, `Elastic6Proxy`, `$X`, `_ES6`, `$ES6` removed |
| `src/extended/cores/abstract-services.ts` | `OS2Service` (`createClient()` = `newClient(auth)` with late master `auth`; type-only client import; no eager client in `bulkItems`), `OS2Instance extends AbstractOS2Instance`, `_OS2` without version/doc-type env, `$OS2 = lazyInstance(() => _OS2())`, `$ES6Routed = $OS2`; `hasOS2` and L2 `$ES6` removed; manager code uses `$OS2` |
| `src/index.ts` | `$ES6` dropped from the explicit L1 line |
| `src/lib/lazy.ts`, `src/lib/lazy.spec.ts` | new (4 tests). Not in the `lib` barrel |
| `src/cores/elastic/os2-client.spec.ts` | new (5 tests, local `http.createServer`) |
| `src/cores/elastic/elastic6-service.spec.ts` | 10 → 6 (SPEC § 3.4.5); spec-local `DummyOS2Service` |
| `src/cores/elastic/elastic6-query-service.spec.ts` | OS blocks only |
| `src/cores/lambda/lambda-dynamo-stream-handler.spec.ts` | in-memory `MemoryOS2Service`; no search-spec import |
| `src/extended/abstract-service.spec.ts` | `should pass $OS2`, `should pass _OS2 factory`; proxy test removed |
| `src/extended/cores/abstract-services.spec.ts` | `should pass lazy $OS2` |
| `src/extended/cores/abstract-controllers.spec.ts`, `src/controllers/general-api-controller.spec.ts` | renamed imports; options shape without doc-type/version |
| `scripts/os2-lazy-probe.cjs` | new. Load probe (gate 2); module counts from a clean child process |
| `etc/api-names.allow.txt` | B2-b block |
| `HOW_TO_UPGRADE_V5.md` | § 7 and checklist lines |

## Checklist (PLAN T5)

| # | Item | Result |
| --- | --- | --- |
| T5-1 | client swap, typeless calls, options cleanup | done. `npx tsc --noEmit` clean. `grep -rn "@elastic/elasticsearch\|isOldES\|docType\|esVersion" src` → 0. `searchType` still appears as the lemon-core parameter name (`searchRaw(body, searchType)`, `OS2SearchParams.searchType`, `generateSearchResult`), never as a client key (see Deviations) |
| T5-2 | version code out, `$ERROR` rewrite, `pushItem` fix | done. `$ERROR/es7.1` passes with the spec block unchanged; new `$ERROR/os2.13` passes. `grep "getVersion\|parseVersion\|executeSelfTest" src` → only `ConfigService.getVersion()` (package version, unrelated) |
| T5-3 | renames, deletions, allow block | done. `npm run build` exit 0. `api:check` exit 0, 303 → 294 (see Deviations). `grep "Elastic6\|ElasticIndexService\|ElasticOption\|ElasticItem\|_ES6\b" src` → only `Elastic6SimpleQueriable` (`lemon-model`, K5 exception) |
| T5-4 | lazy | done. `lazy.spec.ts` 4/4. Probe: see gate 2 |
| T5-5 | `os2-client.spec.ts` | done. 5/5, local server only. N = 5 |
| T5-6 | spec cleanup | done. See test count |
| T5-7 | load and smoke | done. `names=136`, `--check` same/same |
| T5-8 | templates-api | done (separate PR). `npm run build` exit 0, `npm test` 97/92/5 same names |
| T5-9 | harness | done (coordinator, 2026-10-27). templates-api B2-b worktree linked to this worktree, `npm run express.lemon`: boot 36 s · 35 s (two runs; the B2-a harness booted in 33 s under the same machine state — Docker running — so the delta is the machine, not the code). `GET /`, `/hello/0`, `/mocks`, `/search/?ipp=1`, `/search/echo/query` all 200; the search list came back with 1 item and a non-zero total from dev OpenSearch (FGAC path). Boot log: 2 `OS2ClientService(` lines (two instances: `$ES6Routed` and `SearchService`), 0 `@elastic` lines. Local Docker OpenSearch 2.17.0: see § Local Docker OpenSearch check (coordinator rerun, same results) |
| T5-10 | docs | this file, `HOW_TO_UPGRADE_V5.md` § 7, `docs/v5/B2-b-inventory.md` |
| T5-11 | 1-line comments | new files and changed functions (`createClient`, `client`, `asError`, `prepareSettings`, `OS2Instance` ctor, `AbstractOS2Instance`, `_OS2`, `lazyInstance` traps, spec helpers) |

## Gates (SPEC § 3.4.7)

| # | Gate | Measured | Result |
| --- | --- | --- | --- |
| 1 | packages | `npm ls --omit=dev @elastic/elasticsearch` → `(empty)` (full tree also `(empty)`). `npm ls @opensearch-project/opensearch` → `3.9.0` | pass |
| 2 | load probe (`env -i … OS2_ENDPOINT=<fake host> node scripts/os2-lazy-probe.cjs`) | clients at import 0 · `@elastic/` modules 0 · listeners at import 0 · `$OS2 === $ES6Routed` · after `$OS2.hello()`: listeners 1, clients 0 · after `$OS2.elastic.client`: clients 1 (second access 1). Without `OS2_ENDPOINT`: listeners 0 after `hello()`, no client. Modules after a plain `require('./dist/index')`: **736** (B2-a 830), `@opensearch-project` 0, `@elastic` 0. The client package (546 files) loads on the first client creation | pass |
| 3 | public names | `npm run api:check` exit 0, base 304 / current 294, removed 21 (B2-a 3 + B2-b 18), added 11 (B2-a 2 + B2-b 9), not-allowed 0 | pass (−18 +9, see Deviations) |
| 4 | tests | `npm test < /dev/null`: 499 tests, 495 passed, 4 failed (`encodeIdentityJWT` ×3, `doReportError() - account id` ×1), 51 files | pass |
| 5 | ESM | `npm run esm:smoke` → `ok names=136 subpaths=4`; `gen-esm-wrapper --check` same/same | pass |
| 6 | harness | boot 36 s / 35 s vs B2-a 33 s in the same session (baseline 24 s was measured without Docker). Five GET routes 200. Dev master path untestable (no `OS2_MASTER_*`); master path verified on local Docker OpenSearch 2.17.0 instead: `createIndex(plain)` 200, `describe`, `mget`, `search`, `client.bulk` 200, `elastic.deleteIndex` 200; default `createIndex` 400 unknown tokenizer in `$ERROR` form; 404/409 paths in `$ERROR` form | pass |
| 7 | templates-api | `npm run build` (tsc, no `skipLibCheck`) exit 0. `npm test`: 17 suites (6 failed), 97 tests (92 passed, 5 failed). Same failures as baseline: 3 suites TS2345 (`_date`), `GET /0/hello` ×2 + `GET /hello/0` + `POST /hello/0` (`CredentialsProviderError`), CallbackAPIController CRUD. `grep "Elastic6\|_ES6\|ES6_VERSION" src` → 0 | pass |
| 8 | docs | this file, `HOW_TO_UPGRADE_V5.md` § 7, inventory copy. No env values, hosts, accounts or local paths | pass |
| 9 | 1-line comments | see T5-11 | pass |

### Test count (SPEC § 3.4.5)

```
523  B2-a result (519 passed + 4 failed)
 -4  elastic6-service.spec.ts 10 → 6 (−$ERROR/es6.2, −4 ES real servers, +$ERROR/os2.13)
-20  elastic6-query-service.spec.ts 38 → 18 (−4 ES blocks × 4, −4 re-registered)
-10  lambda-dynamo-stream-handler.spec.ts 18 → 8 (no elastic6-service.spec import)
 -1  abstract-service.spec.ts 14 → 13 (proxy test removed)
 +1  abstract-services.spec.ts (lazy $OS2)
 +1  abstract-controllers.spec.ts (re-registers abstract-services.spec)
 +4  src/lib/lazy.spec.ts
 +5  src/cores/elastic/os2-client.spec.ts (N = 5)
----
499  expected = actual 499 (495 passed + 4 failed), files 49 + 2 = 51
```

One run showed a 5th failure, `test-helper.spec.ts > waited() by 200msec` (205 ms, timing); it passes alone and in the final full run.

### Local Docker OpenSearch check (SPEC § 7.3-(h), 2.17.0)

Ad-hoc script against the built `dist` (not part of `npm test`; plugin-free analysis because the local image has no `seunjeon` plugin):

| Call | Result |
| --- | --- |
| `createIndex()` default settings | `400 ILLEGAL ARGUMENT - Unknown tokenizer type [seunjeon_tokenizer] for [hangul]` (expected; `$ERROR` form) |
| `createIndex(plain)` / again | 200 / `400 IN USE` |
| `describe()`, `getIndexMapping()` | ok; mapping keys `dynamic_templates`,`properties`, no `_doc` |
| `saveItem` / same id again (409 → `index`) / `readItem` | v1 / v2 / v2 |
| `readItem`, `updateItem`, `deleteItem` on a missing id | `404 NOT FOUND - id:…` |
| `pushItem`, `updateItem` (increments) | ok (auto id, version) |
| `refreshIndex`, `flushIndex`, `listIndices` | ok, 0 failed shards, index found |
| `searchRaw(…, 'dfs_query_then_fetch')`, `search()` | ok |
| `OS2Instance` (master client): `describeIndex`, `mget`, `client.bulk`, `search`, `elastic.deleteIndex` | ok, bulk 200 `errors=false`, deleteIndex 200 |
| `destroyIndex()` after delete | `404 NOT FOUND - index:…` |

## Deviations from SPEC § 3.4

1. **`EngineType` and `ParsedVersion` are removed and added to the allow block.** § 3.4.1 deletes the version detection including both types, but the § 3.4.2 block (−16 +9, 303 → 296) does not list them. They are root type names, so the gate needs `-EngineType -ParsedVersion`: **−18 +9, 303 → 294**. `esm:smoke` `names=136` is unchanged (type names).
2. **`$ERROR` type source falls back to `message`.** `meta.body.error.type` is used when present. The `es7.1` sample `create-index.err.json` has a `meta` with no body and expects `RESOURCE ALREADY EXISTS` from the message. Without a fallback the spec could not pass unchanged. When the body has no error type, `message` is used as in v4 (for the OpenSearch client that message is then `Response Error` or a connection message, which yield the same result as v4).
3. **`searchType` stays as the lemon-core parameter name.** `OS2SearchParams.searchType` is an HTTP-facing parameter in templates-api (`NextHandler<OS2SearchParams>`) and § 3.4.6 lists no change. Only the client key changed (`search_type`). So the T5-1 grep is not 0 for `searchType`.
4. **`saveItem`/`pushItem` lose their `type` parameter** and `prepareSettings` loses `docType`/`version`. Not listed in § 3.4.6 as separate rows; they follow from "no `type` anywhere". Recorded in the upgrade guide.
5. **`AbstractOS2Instance.createIndex()` sends `prepareSettings({ idName })` as-is** (the `OS2Instance` v4 behaviour). The v4 L1 `score_` (`half_float`) addition is not kept; its only user was the removed L1 instance.
6. **`hello()` strings** of the services are `os2-core-service:<index>` and `os2-query-service:<index>` (v4 `elastic6-service:<index>:<version>`; the version option is gone).
7. **The lazy spec counts clients with a spy on `createClient()`**, not by wrapping the `Client` constructor: vitest loads the client package as ESM (`index.mjs` copies `Client` at load), so the constructor cannot be swapped there. `createClient()` is the only place that builds a client. The probe script wraps the constructor (CJS build).
8. **`prepareSettings({ timeSeries: true })` fixed**: v4 deleted keys from `ES_SETTINGS.properties` (missing) in the typeless branch and threw.
9. templates-api `SearchService.isProxy()` now returns `false` directly (the v4 check looked for the `Elastic6Proxy` hello string, which an `OS2Instance` never had).
10. Spec counts: `os2-client.spec` has 5 tests; the `_OS2 factory` test is gated to the lemon profile and sends no request.
11. **The client package is loaded on first use, not at import** (coordinator decision after the first report). With a static import, `require('lemon-core')` loaded 1289 modules (546 from the client package) although no client was built. Now the package is `import type` at module top and a memoized loader `require`s it in `OS2ClientService.newClient()` (used by both `createClient()` overrides). `$ERROR` already duck-types on `meta`, so no `errors` value is needed at runtime. Result: 736 modules at import. The load probe takes its module counts from a clean child process, because the probe itself loads the package to swap `Client`.

## Open points (for the coordinator)

- Index management and `bulk` against dev still need `OS2_MASTER_*` in config; dev has none (401 expected in the harness). Decision D39 (vault): verify that path on a local Docker OpenSearch instead of adding dev credentials.
- Coordinator reruns (2026-10-27): `npm test` 499/495/4 twice (one earlier run had two extra timing failures, `general-controller` CRUD socket hang up and `my_sequence()` equal timestamps, both pass alone and in the clean rerun); `api:check` 303 → 294 not-allowed 0; `esm:smoke` names=136; probe 736 / 0 / 0 / 0 → 1 listener → 1 client; templates-api `tsc` exit 0, tests 97/92/5 same names.
