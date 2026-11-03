# v5 B2-c — AWS SDK: optional peers, lazy loading, local types, `PERF` lines

Status: implemented and measured 2026-10-27/28 on `feat/v5-b2-c-aws-sdk` (base `v5` @ `c80f02c4`). Third part of B2. Design: SPEC § 3.5 (vault) plus D41 (DynamoDB is the required storage). Measured facts behind the design: `docs/v5/B2-c-inventory.md`. Consumer side: `lemon-templates-api` `feat/v5-b2-c-aws-sdk` (base `v5` @ `15c2b6c9`).

## Scope

- **No SDK at import.** Every runtime `@aws-sdk` value import is gone from the 11 source files; only `import type` remains. Each file has its own module-private loader (`load<Pkg>()`, a module cache variable, one `PERF` line on the first call). No shared loader module; `engine/engine.ts` is unchanged.
- **Packages (D41).** `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` stay in `dependencies` (storage is required). The other **8** (`client-kms`, `client-s3`, `client-sns`, `client-sqs`, `client-iam`, `client-sts`, `client-lambda`, `credential-providers`) are optional `peerDependencies` (`^3.971.0`) and stay in `devDependencies`. Removed: `@aws-sdk/client-dynamodb-streams`, dev `@aws-sdk/types`, dev `@smithy/util-stream`.
- **Caches.** `DynamoService.instance()` writes `_dynamo[region]` (one low-level client per region; was 2 new clients per call) and no longer returns `dynamostr` (`_dynamostr` removed). The S3 module `instance()` caches one client per region (was one per call).
- **Types.** No `@aws-sdk`/`@smithy` string in any `.d.ts`. Same public names, local structural types (`HOW_TO_UPGRADE_V5.md` § 8.4).
- **`PERF` lines (D40).** `src/lib/perf.ts` (`nowMs`, `measure`, `measureAsync`; logger injected, no engine import, not in the `lib` barrel). Checkpoints: `loaded lemon-core`, `initialize`, `lazy-load <package>`, `client KMS|S3|DYNAMO|DYNAMO-DOC`, and the B2-b retrofit `instance $OS2`, `lazy-load @opensearch-project/opensearch`, `client OS2`.

## Files

| File | Change |
| --- | --- |
| `package.json`, `package-lock.json` | D41 split: Dynamo 2 in `dependencies`; 8 optional peers + dev; 3 packages removed |
| `src/lib/perf.ts`, `src/lib/perf.spec.ts` | new (3 tests). Not in the `lib` barrel |
| `src/index.ts` | `PERF > loaded lemon-core` (process uptime) at the end |
| `src/engine/builder.ts` | `PERF > initialize`, inline `process.hrtime.bigint()` (no value import), the engine's own `inf` and `U.NS` |
| `src/tools/tools.ts` | `loadCredentialProviders()` (sync); `awsConfig()` loads it only with a profile and logs through `engine.inf`/`engine.U.NS`; `asyncCredentials()` uses it without a logger; local `AwsCredentialProvider` (not exported) |
| `src/cores/aws/aws-kms-service.ts` | `loadKms()` (sync); `PERF > client KMS`; local `MySigningAlgorithm` union and `KmsClientLike` |
| `src/cores/aws/aws-s3-service.ts` | `loadS3()` (sync); per-region client cache + `PERF > client S3`; local `S3Object` interface and `S3ClientLike` |
| `src/cores/aws/aws-sns-service.ts` | `loadSns()`, `loadIam()`, `loadSts()` (async `import()`); `accountID` awaits IAM+STS before its Promise executor |
| `src/cores/aws/aws-sqs-service.ts` | `loadSqs()` (async) in 4 methods |
| `src/cores/dynamo/dynamo-service.ts` | `loadDynamo()`, `loadDynamoDoc()` (sync); `_dynamo[region]` written, `dynamostr`/`_dynamostr` removed, `PERF > client DYNAMO`/`client DYNAMO-DOC`; `StreamViewType` literal; local `DynamoClientLike`, `DynamoDocClientLike`, `KeySchemaElementLike`, `TableCommandOutput` |
| `src/cores/dynamo/dynamo-query-service.ts`, `dynamo-scan-service.ts` | own `loadDynamoDoc()` (async) |
| `src/cores/lambda/lambda-web-handler.ts` | `loadSts()` (async) in the `getAccountId` IIFE |
| `src/cores/protocol/aws-lambda-helper.ts` | `loadLambda()` — `await import()` (the spec's `vi.mock` keeps working) |
| `src/cores/protocol/protocol-service.ts` | own `loadSns()`, `loadSqs()` (async); local `MySNSEventParam`, `SQSEventParam`, `MyMessageAttributeValue` |
| `src/cores/elastic/elastic6-service.ts` | B2-b retrofit: `PERF` in `loadOpenSearch()` and `newClient()` |
| `src/extended/cores/abstract-services.ts` | B2-b retrofit: `$OS2` factory wrapped in `measure(… 'instance $OS2' …)` |
| `src/cores/dynamo/dynamo-service.spec.ts` | +1 test: `instance('r')` twice → same `dynamo` |
| `scripts/aws-lazy-probe.cjs` | new. Load probe (gate 2) |
| `HOW_TO_UPGRADE_V5.md` | § 8 and 3 checklist lines |
| `docs/v5/B2-c-aws.md` (this file), `docs/v5/B2-c-inventory.md` (copy, unchanged) | docs |

### Loaders

| File | Loader | Form |
| --- | --- | --- |
| `tools/tools.ts` | `loadCredentialProviders` | sync `require` |
| `cores/aws/aws-kms-service.ts` | `loadKms` | sync `require` |
| `cores/aws/aws-s3-service.ts` | `loadS3` | sync `require` |
| `cores/dynamo/dynamo-service.ts` | `loadDynamo`, `loadDynamoDoc` | sync `require` |
| `cores/aws/aws-sns-service.ts` | `loadSns`, `loadIam`, `loadSts` | `await import()` |
| `cores/aws/aws-sqs-service.ts` | `loadSqs` | `await import()` |
| `cores/dynamo/dynamo-query-service.ts`, `dynamo-scan-service.ts` | `loadDynamoDoc` | `await import()` |
| `cores/lambda/lambda-web-handler.ts` | `loadSts` | `await import()` |
| `cores/protocol/aws-lambda-helper.ts` | `loadLambda` | `await import()` |
| `cores/protocol/protocol-service.ts` | `loadSns`, `loadSqs` | `await import()` |

## Gates (SPEC § 3.5.9, with D41)

| # | Gate | Measured | Result |
| --- | --- | --- | --- |
| 1 | packages | `npm ls --omit=dev` top level: `@aws-sdk/client-dynamodb@3.971.0`, `@aws-sdk/lib-dynamodb@3.971.0` only (2 lines). Full prod tree: other `@aws-sdk/*` are their transitive packages (`client-sso` via the default credential chain, `types`, …); no other `client-*`, no `credential-providers`. `peerDependencies` 8 + `peerDependenciesMeta` 8 optional. `client-dynamodb-streams`: 0 in `package.json` and lockfile; `@aws-sdk/types`, `@smithy/util-stream`: 0 in `package.json` | pass (D41 form) |
| 2 | load probe (`env -i PATH=$PATH HOME=$HOME node scripts/aws-lazy-probe.cjs`) | see § Probe | pass |
| 3 | names, `.d.ts` | `api:check` exit 0: base 304 / current **294**, added 11 / removed 21 (the same B2-a+B2-b sets), not-allowed 0 → B2-c delta 0. `grep -rn -e "@aws-sdk" -e "@smithy" dist --include='*.d.ts'` → 0 lines | pass |
| 4 | tests | `npm test < /dev/null` twice: **503 / 499 / 4** both runs, the 4 baseline names (§ Test count) | pass |
| 5 | ESM | `esm:smoke` → `ok names=136 subpaths=4`; `gen-esm-wrapper --check` same/same (both outputs) | pass |
| 6 | harness | see § Harness | pass (see Deviations 5) |
| 7a | templates-api (link) | `npm run build` (tsc, no `skipLibCheck`) exit 0. `npm test`: 17 suites (6 failed), 97 tests (92 passed, 5 failed), the same names as B2-b: 3 suites TS2345 (`_date`), `GET /0/hello` ×2, `GET /hello/0`, `POST /hello/0` (`CredentialsProviderError`), CallbackAPIController CRUD. `Cannot find module` 0 | pass |
| 7b | packed install | `npm pack` → scratch copy of the templates-api worktree, `npm install`, then `npm install <tgz>` (not link): `npx tsc --noEmit` exit 0; `node -e "require('lemon-core')"` ok (267 modules, `@aws-sdk` 0); `npm ls @aws-sdk/client-kms` → the copy's own top-level `client-kms@3.983.0` (lemon-core's peer `deduped`); `npm ls @aws-sdk/client-dynamodb` → through `lemon-core` (3.972.0). Copy and tgz deleted | pass |
| 8 | local Docker OpenSearch | coordinator (not run here) | — |
| 9 | docs | this file, `HOW_TO_UPGRADE_V5.md` § 8, inventory copy. No env values, hosts, accounts or local paths | pass |
| 10 | 1-line comments | loaders, local types, `perf.ts` functions, probe script blocks, B2-b retrofit points, changed `instance()` methods | pass |

Other checks: `grep -rn "from '@aws-sdk" src --include='*.ts' | grep -v 'import type' | grep -v '\.spec\.' | grep -v example` → 0 lines. `LS=1 node -e "require('./dist/index')"` → 0 lines; without `LS` → 1 line (`loaded lemon-core`).

### Probe

`env -i PATH=$PATH HOME=$HOME node scripts/aws-lazy-probe.cjs`. Each entry in a fresh child process. Counts are files whose path contains the scope segment.

| Step | total modules | `@aws-sdk` | `@smithy` | `@aws-crypto` | `@aws` |
| --- | --- | --- | --- | --- | --- |
| `dist/index` import (was 737) | **265** | 0 | 0 | 0 | 0 |
| `dist/index` + `$U.NS('x')` | 265 | 0 | 0 | 0 | 0 |
| `dist/engine` import (was 338) | **131** | 0 | 0 | 0 | 0 |
| `dist/engine` + `$U.NS('x')` | 131 | 0 | 0 | 0 | 0 |
| `dist/tools` import (was 137) | **30** | 0 | 0 | 0 | 0 |
| `dist/tools` + `$U.NS('x')` (loads `dist/engine` for `$U`) | 131 | 0 | 0 | 0 | 0 |
| `dist/helpers` import (was 721) | **249** | 0 | 0 | 0 | 0 |
| `dist/helpers` + `$U.NS('x')` | 249 | 0 | 0 | 0 | 0 |
| `dist/index` + `new AWSKMSService().instance()` (no profile) | 360 | 27 | 67 | 0 | 1 |
| … + again with a dummy profile name (`fromIni` built, not called) | 413 | 79 | 85 | 0 | 1 |

`client-*` packages loaded after the KMS step: `client-kms` only (both runs). Without a profile, `credential-providers` is not loaded (`awsConfig()` builds no provider: the `tools.spec.ts` contract); with a profile name it is (`credential-providers` present, 21 `@aws-sdk` packages, still only `client-kms`). The numbers match the inventory's stub projection (265 · 131 · 30 · 249).

### Test count

```
499  B2-b baseline (495 passed + 4 failed)
+3   src/lib/perf.spec.ts
+1   src/cores/dynamo/dynamo-service.spec.ts  should cache instance() per region
503  expected = actual 503 (499 passed + 4 failed), files 51 + 1 = 52
```

Failures (both runs): `engine.spec doReportError() - account id`; `encodeIdentityJWT and verifyToken tests` in `lambda-sns-handler`, `lambda-sqs-handler`, `lambda-web-handler`. `aws-lambda-helper.spec.ts` 9/9 (the `vi.mock` still applies to `import()`), `tools.spec.ts` 4/4 (`credentials` `undefined` without profile), `perf.spec.ts` 3/3, `dynamo-service.spec.ts` 7/7. `helpers.spec my_sequence()` did not flake in these runs (load average 15–17).

### Harness

templates-api B2-c worktree linked to this worktree, `npm run express.lemon` (AWS profile allowed by D29). First `200` on `GET /` after **35 s** from start (the command includes `npm run build`; B2-b: 36 s · 35 s). `GET /`, `/hello/0`, `/mocks`, `/search/?ipp=1`, `/search/echo/query` → 200. The KMS decrypt ran at boot (1 `CFGS: >> inited... config.len=` line). 6 `PERF` lines in the whole run (2 more requests added none):

| Label | ms |
| --- | --- |
| `loaded lemon-core` | 28216.6 (process uptime under `ts-node`: includes the compile of the service source) |
| `instance $OS2` | 0.6 |
| `lazy-load @aws-sdk/client-kms` | 50.9 |
| `lazy-load @aws-sdk/credential-providers` | 0.1 (already loaded by `lemon-devkit`) |
| `client KMS` | 2.0 |
| `initialize` | 157.3 |

Not printed in this run: `lazy-load @opensearch-project/opensearch` and `client OS2` (the `/search` routes use the FGAC `fetch` path, which builds no client — HOW_TO § 7.5), and no Dynamo/SNS lines (the five routes made no DynamoDB call and no error report).

## Choices (SPEC "구현자 선택")

- `AWSSNSService.accountID`: the IAM and STS packages are awaited **before** the Promise executor; the executor is unchanged.
- `AWSKMSService._instance` / `instance()`: local `KmsClientLike = { send: (command: any) => Promise<any> }` (not exported). Same form for S3 and Dynamo clients.
- Local types are **not exported** (`AwsCredentialProvider`, `KmsClientLike`, `S3ClientLike`, `DynamoClientLike`, `DynamoDocClientLike`, `KeySchemaElementLike`, `TableCommandOutput`, `SQSEventParam`, `MyMessageAttributeValue`): `.d.ts` declares them locally, and `api:check` sees no new name. `S3Object` and `MySNSEventParam` keep their exported names (interfaces now).
- Command classes are read from the loader inside each method (`const { DecryptCommand } = loadKms();`), so a method loads the package even when the client is cached.

## Deviations from SPEC § 3.5

1. **D41 (owner):** Dynamo 2 packages stay in `dependencies`; 8 optional peers, not 10. Gate 1 and templates-api (8 peers added) follow D41. Lazy loading of Dynamo is unchanged.
2. **`initialize` logger:** `initialize()` lives in `MyEngineModules`, whose type has no `inf`/`U`. The line uses `this` cast to the engine type (`inf`, `U.NS`; the runtime object is the engine). It is printed on the normal path only (not on the internal `getLevels` early return).
3. **Probe KMS step:** with no AWS env there is no profile, so `credential-providers` does not load (SPEC expected it). The probe adds a second step with a dummy profile name to show it; neither step sends a request.
4. **Per-file loaders print per file:** the same package can show two `lazy-load` lines (e.g. `lib-dynamodb` from `dynamo-service` and from query/scan); the later one is ~0 ms.
5. **Harness labels:** `lazy-load @opensearch-project/opensearch` and `client OS2` did not appear (no client is built on these routes). They are covered by `os2-client.spec.ts` and the B2-b probe path.
6. **`S3Object`** carries all 9 SDK `_Object` fields (`ChecksumAlgorithm`, `ChecksumType`, `RestoreStatus` beyond the 6 listed), "SDK 필드 그대로".
7. **`getObjectTagging`** keeps an `import type` result annotation (`GetObjectTaggingCommandOutput`) because `send()` now returns `any` (a typed `reduce` needs it). Type-only; not in `.d.ts`.
8. **`npm pack --ignore-scripts`** for gate 7b: `dist/` was already built from the same tree (`prepare` would only rebuild it).

## Coordinator rerun (2026-10-28)

Every gate was rerun by the coordinator on the same worktrees; values match the implementer's.

| # | rerun value |
| --- | --- |
| 1 | `npm ls --omit=dev --depth=0`: `client-dynamodb@3.971.0`, `lib-dynamodb@3.971.0` only; full prod tree `client-*` = `client-dynamodb`, `client-sso` (transitive); peers 8 / optional 8; `client-dynamodb-streams` 0 in lockfile |
| 2 | probe: index 265 · engine 131 · tools 30 · helpers 249, all four scopes 0; after NS 0; after KMS `instance()` only `client-kms` (12 `@aws-sdk` packages), with a dummy profile `credential-providers` too (21) |
| 3 | `api:check` base 304 / current 294, added 11 / removed 21, not-allowed 0; `.d.ts` SDK strings 0; value-import grep 0 |
| 4 | `npm test` ×2: 503 / 499 / 4, the 4 baseline names both runs |
| 5 | `esm:smoke names=136 subpaths=4`; `gen-esm-wrapper --check` same/same |
| 6 | harness: first 200 after 32 s (B2-b 36 · 35 s); 5 routes 200; 1 `inited... config.len=` line; 6 `PERF:` lines — `loaded lemon-core` 26343.1 · `instance $OS2` 0.5 · `lazy-load @aws-sdk/client-kms` 39.1 · `lazy-load @aws-sdk/credential-providers` 0.2 · `client KMS` 2.3 · `initialize` 134.5 (ms); no listener left |
| 7a | templates-api linked: build 0; test 97 / 92 / 5, same 5 names |
| 7b | packed install (scratch copy, tarball not link): `tsc --noEmit` 0; `require('lemon-core')` 267 modules, `@aws-sdk` 0; `client-kms` resolves from the copy, `client-dynamodb` through lemon-core |
| 8 | local Docker OpenSearch 2.17.0 (D39) master path: 20 ok / 6 expected errors (seunjeon 400, index in use 400, four 404 negatives) — same as B2-b |
| 9 | leak scan of docs and new code: 0 |
| 10 | 1-line comments present on loaders, local types, `perf.ts`, probe, retrofit points |
