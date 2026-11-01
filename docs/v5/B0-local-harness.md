# v5 B0 — Local harness

Status: B0-a done, B0-b dropped (2026-10-27). First bundle of the lemon-core v5 program. This bundle changes no runtime code in lemon-core; it makes the local run path the verification gate for every later bundle.

## Goal

A consumer service (reference: `lemon-templates-api`) runs locally against a working copy of lemon-core, and every later v5 bundle is verified through this path before anything is deployed.

## Canonical commands (consumer repo)

```bash
npm link ../lemon-core      # link the working copy of lemon-core
npm run express.lemon       # ENV=lemon STAGE=local npm run start
```

- Lambda deployment is out of scope for every bundle until the last one.
- `npm run server` / `server.lemon` (serverless-offline) and the `lemon-core/dist/exec-cli` batch path are not part of the harness; both were broken and are removed from the reference consumer in B0-a (exec-cli dropped by owner decision, 2026-10-27).
- Ready probe is `GET /` and the hello smoke is `GET /hello/0`. `GET /hello` is 404 (no LIST handler).

## B0-a — harness without lemon-core code changes

1. Verify link state: which `lemon-devkit` copy resolves under `npm link`, and which env overrides apply (`MY_DYNAMO_TABLE=*.yml` mock mode, `OS2_ENDPOINT=` search-off mode).
2. Record a baseline in `docs/v5/baseline.md`: vitest pass / skipped-by-guard counts, express boot time, request smoke (1 route), public export names (`scripts/api-names.cjs` output).
3. Clean the reference consumer: remove dead `server*` scripts; keep `express.lemon` as the only local run path.

### B0-a checklist (measured 2026-10-27, details in `docs/v5/baseline.md`)

- [x] Link state recorded — ✔ lemon-core's `require('lemon-devkit')` resolves to its own 0.0.11 (consumer has 0.2.0). ✘ `lemon-model` is not resolvable from the consumer under `npm link` (one copy, inside lemon-core).
- [x] Canonical command boots as is — ✔ after declaring `lemon-model` in the consumer (`^1.1.1`, same as lemon-core). Before the fix `npm run build` failed with `TS2307 lemon-model` under the link (baseline § 2.1).
- [x] Boot time — ✔ median 24 s (3 runs, to first `GET /` 200, includes build).
- [x] Request smoke — ✔ `GET /hello/0` 200; ✘ `GET /hello` 404 (spec command wrong); ✔ mock LIST `GET /mocks` 200 in default mode (dev search).
- [x] Init path (X18) — ✔ `$engine.initialize()` runs on `listening` (devkit 0.0.11); config init decrypts 3 `*` keys via KMS at boot.
- [x] Mock storage mode — ✔ `MY_DYNAMO_TABLE=<name>.yml` selects `DummyStorageService`; ✘ a missing `data/<name>.yml` crashes the boot (not an empty table); LIST is 400 `NO DYNAMO`.
- [x] Search-off mode — ✔ `OS2_ENDPOINT=` (empty) is kept; the Elastic6 services are not created.
- [x] lemon-core `npm test` twice — ✔ equal: 530 tests, 526 pass, 4 fail, 0 skipped (48 files). Guard early-returns count as pass, so 27·7·6 cannot be checked at runtime.
- [x] templates-api `npm test` (linked) — ✔ recorded: 97 tests, 92 pass, 5 fail; 6 of 17 suites fail (3 do not compile).
- [x] Public names — ✔ `scripts/api-names.cjs` → `etc/api-names.v4.txt`: 304 (lemon-core 272 + lemon-model 32); runtime keys 143.
- [x] AWS SDK load — ✔ `require('lemon-core')` loads 377 `@aws-sdk` files from 44 packages (9 clients).
- [x] Consumer cleanup — ✔ `server`, `server-local`, `server.lemon` scripts and the `exec-cli` branch removed; build and boot pass after it.
- [x] Generated file — ✔ build rewrites `src/generated/field-registry.ts` (format only); revert after each build.

## B0-b — dropped (owner decision, 2026-10-27)

`loadEnviron`, `loadProfile`, `buildExpress` and their two internal helpers stay in `lemon-devkit`: they are local-development-only, so moving them into lemon-core is not part of v5. lemon-core keeps its dynamic `require('lemon-devkit')` delegation and the circular devDependency. B0 is complete with B0-a.

2026-10-31: reversed by B20 (D80) — `loadEnviron`, `loadProfile` and `buildExpress` now live in lemon-core, and `lemon-devkit` is no longer a devDependency (`docs/v5/B20-local-gateway.md`).

## Gate for later bundles

| Bundle | Gate through this harness |
| --- | --- |
| B1 packaging (dual CJS/ESM, exports, singleton) | consumer boots under CJS and under an ESM sample; one engine instance |
| B2 dependencies (drop 4 packages, OpenSearch only, AWS SDK optional peer) | `$U`/`$T` import with no AWS env; search via local OpenSearch or mock |
| B3 L1/L2 merge | public-name diff is empty outside the declared breaking list |
| B4 field annotations | one consumer model migrated; save and query pass |
| B5 trust boundary and failure propagation | external header does not change identity; SQS failure propagates and the handler stays alive |
