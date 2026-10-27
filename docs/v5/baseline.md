# v5 B0-a — Baseline

Status: measured 2026-10-27. Source of truth for the B0-a gate (`docs/v5/B0-local-harness.md`).

## Conditions

| Item | Value |
| --- | --- |
| Date | 2026-10-27 |
| lemon-core | `develop` @ `e4ba0c9b` + B0 docs, version 4.3.0, working copy built with `npm ci` (runs `prepare` → `npm run build`) |
| lemon-templates-api | `develop` @ `e56d55e` + B0-a script cleanup |
| Node | v24.20.0 |
| Link | templates-api `npm link ../lemon-core` (sibling working copies) |

No env values, secrets, or account numbers are recorded here. Env keys are named only.

## 1. Link state

Command (templates-api): `npm ls lemon-core lemon-devkit lemon-model`

```text
lemon-templates-api@0.26.901
+-- lemon-core@4.3.0 -> ./../lemon-core
| +-- lemon-devkit@0.0.11
| `-- lemon-model@1.1.1
`-- lemon-devkit@0.2.0
```

`require.resolve` from each side:

| Module | From templates-api | From lemon-core (linked) |
| --- | --- | --- |
| `lemon-core` | `../lemon-core/dist/index.js` (the link) | — |
| `lemon-devkit` | templates-api copy, 0.2.0 | lemon-core copy, **0.0.11** |
| `lemon-model` | **not resolvable** | lemon-core copy, 1.1.1 |

- Confirmed: lemon-core's delegated `require('lemon-devkit')` (`loadEnviron`, `loadProfile`, `buildExpress`) resolves to lemon-core's own 0.0.11, not the consumer's 0.2.0.
- Refuted: "lemon-model may exist twice". Before the link, templates-api had a hoisted `node_modules/lemon-model` (1.1.1, lockfile). `npm link` removes it, because templates-api does not declare `lemon-model` itself. After the link there is **one** copy and the consumer cannot reach it.

## 2. Harness boot (`npm run express.lemon`)

### 2.1 Blocker under the canonical command

With the link alone, `npm run express.lemon` stops in `npm run build`:

- `ttsc` fails with `TS2307: Cannot find module 'lemon-model'` in 7 consumer files (`src/service/backend-model.ts`, `backend-session.ts`, `backend-types.ts`, `src/modules/{mock,callback}/{model,views}.ts`) plus cascading `TS2339`/`TS2345` errors.
- `lemon-fields gen` does not fail, but silently drops the inherited `CoreModel` fields from `src/generated/field-registry.ts` (4 entries become `[]`, the others lose the base fields). The file must not be committed in that state.

Runs 1-8 below were measured with a **temporary** `node_modules/lemon-model` symlink to lemon-core's copy (not tracked by git, removed afterwards). With it, `lemon-fields gen` reports "no change" and `ttsc` reports 0 errors.

**Fix (B0-a, same day).** The consumer imports `lemon-model` directly in 8 files but did not declare it, so it only worked while npm hoisted lemon-core's copy. templates-api now declares `lemon-model: ^1.1.1` (same range as lemon-core, lockfile 1.1.1). After the fix `npm ls` shows two copies of the same version (consumer `lemon-model@1.1.1`, linked lemon-core `lemon-model@1.1.1`), `npm run build` passes, and the canonical command boots without the symlink (run 9: 22 s, `GET /` 200, `GET /hello/0` 200, `GET /hello` 404, `GET /mocks` 200). Two copies of one version is the state B1 (registry) and B4 (class attachment) must tolerate.

### 2.2 Boot and smoke

Boot time = start of `npm run express.lemon` to the first `GET /` 200, polled every 1 s. It includes `npm run build` (fields gen + ttsc).

| Run | Mode | Boot (s) | `GET /` | `GET /hello/0` | Other |
| --- | --- | --- | --- | --- | --- |
| 1 | default | 28 | 200 | 200 `{"hello":"hello-api-controller:hello-lemon"}` | — |
| 2 | default | 24 | 200 | 200 | — |
| 3 | default | 24 | 200 | 200 | — |
| 4 | default (after exec-cli removal) | 24 | 200 | 200 | — |
| 5 | default | 23 | 200 | 200 | `GET /hello` 404, `GET /mocks` 200 `{"total":0,"limit":10,"page":0,"list":[]}` |
| 6 | `OS2_ENDPOINT=` | 25 | 200 | 200 | — |
| 7 | `MY_DYNAMO_TABLE=dummy-data.yml OS2_ENDPOINT=` | 27 | 200 | 200 | `GET /mocks` 400 `NO DYNAMO`, `GET /mocks/hello` 200 |
| 8 | `MY_DYNAMO_TABLE=dummy-test.yml` | — | crash | — | see § 3 |

- **Boot median (runs 1-3): 24 s.**
- `GET /hello` (SPEC § 7.3 (a)) is **404** `LIST /hello/`: `HelloAPIController` has no LIST handler. The ready probe is `GET /` and the hello smoke is `GET /hello/0`.
- Mock LIST `GET /mocks` is 200 only in default mode (it reads dev search). In mock-storage mode it is 400 `NO DYNAMO` (the dummy storage has no query/scan).
- `GET /` prints env lines; one of them is an ARN with an account number. Do not paste that response into docs or PRs.
- The final `STAGE` is `develop`, not `local` (`env/lemon.yml` local section forces `STAGE` with `!`). Log: `Server[lemon:develop] is listening on Port:8800`.

### 2.3 Init path (X18)

`$engine.initialize()` runs at boot. lemon-devkit 0.0.11 `buildExpress` calls it in the `listening` callback (`node_modules/lemon-devkit/dist/tools/express.js:370`). Log order: `ConfigService()...` (construct) → `listening on Port:8800` → `KMSS: decrypt(...)` → `CFGS: >> inited... config.len= 139`. So the default boot calls KMS once per `*`-prefixed env value (3 keys in the local section: `OS2_SECRET_KEY`, `OS2_ACCESS_KEY`, `OS2_SIGNATURE`).

Note: `ConfigService.init()` logs the first 12 characters of each decrypted value (`src/cores/config/config-service.ts`, `_log(NS, '> config[...] :=' ...)`). Boot logs must not be shared verbatim.

## 3. Run modes (SPEC § 7.3 (c)·(d))

Override rule (lemon-devkit 0.0.11 `dist/environ.js:110`): a yml value is applied only when `process.env[key] === undefined`; `!`-prefixed values always win.

| Mode | Result | Evidence |
| --- | --- | --- |
| `MY_DYNAMO_TABLE=<name>.yml` | Applied. `BackendService(dummy-test.yml, TT)` → `DummyStorageService(dummy-test.yml)` | boot log |
| — data file missing | **Crash at boot**, not an empty table: `404 NOT FOUND - data-file:./data/dummy-test.yml` | `src/tools/tools.ts:55` (`loadDataYml`), called from `src/cores/storage/storage-service.ts:409` |
| — data file present (`data/dummy-data.yml`) | Boots. Single read works; LIST is 400 `NO DYNAMO` | run 7 |
| `OS2_ENDPOINT=` (empty) | Applied: empty counts as "set". The 6 `Elastic6Service(...)` lines of the default boot disappear | runs 1 vs 6 |

## 4. lemon-core tests

Command: `npm test` (= `LS=1 vitest run`), run twice.

| Run | Test files | Tests | Skipped | Duration |
| --- | --- | --- | --- | --- |
| 1 | 4 failed / 44 passed (48) | 4 failed / 526 passed (530) | 0 | 55.75 s |
| 2 | 4 failed / 44 passed (48) | 4 failed / 526 passed (530) | 0 | 37.26 s |

Both runs are equal, so this is the baseline: **530 tests, 526 pass, 4 fail, 0 skipped.**

Failing tests (same in both runs):

| Test | Cause |
| --- | --- |
| `src/cores/lambda/lambda-web-handler.spec.ts` > LambdaWEBHandler > should pass encodeIdentityJWT and verifyToken tests | expiry message time differs by 9 h (expected `20:00:00`, received `11:00:00`) — time-zone dependent assertion (`:700`) |
| `src/cores/lambda/lambda-sns-handler.spec.ts` > same name | same |
| `src/cores/lambda/lambda-sqs-handler.spec.ts` > same name | same |
| `src/engine/engine.spec.ts` > test the 'core/engine.ts' > test doReportError() - account id | message differs: expected `!err - .accountId is missing`, received `!err - .accountId[] is missing - getHelloArn(RPTE:)` (`:172`) |

Guard skips: vitest reports 0 skipped. Guarded `it` blocks return early and count as **passed**, so the static count (27 early-return · 7 partial · 6 hooks, C § 4-3) cannot be checked from the runtime numbers. The older records 451/455 and 450/455 are not comparable: the suite now has 530 tests.

## 5. templates-api tests (linked)

Command (templates-api): `npm test` (= `npm run fields:gen && LS=1 jest --config=jest.config.json`), with the temporary `lemon-model` symlink of § 2.1.

| Suites | Tests | Time |
| --- | --- | --- |
| 6 failed / 11 passed (17) | 5 failed / 92 passed (97) | 24.9 s |

| Failure | Cause |
| --- | --- |
| `src/service/backend-proxy.spec.ts`, `src/modules/mock/api-mocks.spec.ts`, `src/modules/mock/api-tests.spec.ts` | suite does not compile: `TS2345` `'_date' does not exist in type 'TestModel'` (`src/service/backend-proxy.spec.ts:75`) |
| hello-api GET/POST `/hello/0`, CallbackAPIController GET `/0/hello`, SearchController GET `/0/hello` (4) | `CredentialsProviderError: Could not resolve credentials using profile: [none]` — lemon-devkit **0.0.11** `buildExpress` (lemon-core's copy) loads AWS credentials for profile `none` |
| CallbackAPIController › basic CRUD (1) | message differs: expected `404 NOT FOUND - proxy/callback/id:1`, received `404 NOT FOUND - not found @doGet(callback/1)` |

A non-linked control run (registry lemon-core 4.3.0) was not made.

## 6. Public names and AWS SDK load

| Item | Command | Value |
| --- | --- | --- |
| Root public names | `node scripts/api-names.cjs` → `etc/api-names.v4.txt` (TypeScript compiler API over `dist/index.d.ts`, `name<TAB>value\|type\|value+type`, sorted) | **304** = value 71 + value+type 72 + type 161 |
| — by origin | same program, declaration file of each export | lemon-core 272, lemon-model re-exports 32 |
| — runtime keys | `node -e "Object.keys(require('./dist')).length"` | 143 (= value 71 + value+type 72) |
| AWS SDK on `require('lemon-core')` | `require.cache` keys containing `/@aws-sdk/` | 377 files, 44 packages, 9 of them `client-*` (dynamodb, dynamodb-streams, iam, kms, lambda, s3, sns, sqs, sts) |

Survey A counted 277 names by regex with lemon-model re-exports as 0. The compiler count of lemon-core's own names is 272.

## 7. Pitfalls found in B0-a

1. **Generated file diff after build.** `npm run build` (and `npm ci` through `prepare`) regenerates `src/generated/field-registry.ts` with lemon-devkit 0.0.11 `lemon-fields gen`. The generator writes one-line arrays with double quotes; the committed file is prettier-formatted. After `prettier` the two are identical. Revert the file after every build (`git checkout -- src/generated/field-registry.ts`) and do not commit the generator output.
2. **`lemon-model` unreachable under `npm link`** (§ 2.1). Build fails and the consumer's field registry loses inherited fields. Fixed by declaring `lemon-model` in the consumer; any consumer that imports `lemon-model` directly needs the same declaration.
3. **`GET /hello` is 404** (§ 2.2). Use `GET /` and `GET /hello/0`.
4. **Mock mode needs the data file** (§ 3). A missing `data/<name>.yml` crashes the boot.
5. **Default boot calls KMS** (§ 2.3) and logs a prefix of decrypted values.

## 8. Reference consumer cleanup (templates-api, B0-a)

- `package.json`: removed `!server`, `server`, `server-local`, `server.lemon` (serverless-offline path).
- `src/index.ts`: removed the `exec-cli` batch branch (`require('lemon-core/dist/exec-cli')`, the `process.argv.length` condition, and the `node . -ep …` usage lines). The main runner now always starts express.
- `README.md`: no mention of these paths; unchanged.
- lemon-core: no `exec-cli` source, script, or `bin` entry exists (only an example commit scope in `CONTRIBUTING.md`).
- After the cleanup: `npm run build` passes and `express.lemon` boots (run 4), with the § 2.1 symlink.
