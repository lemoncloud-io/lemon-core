# v5 B0 — Local harness

Status: draft (2026-10-27). First bundle of the lemon-core v5 program. This bundle changes no runtime code in lemon-core (B0-a); it makes the local run path the verification gate for every later bundle.

## Goal

A consumer service (reference: `lemon-templates-api`) runs locally against a working copy of lemon-core, and every later v5 bundle is verified through this path before anything is deployed.

## Canonical commands (consumer repo)

```bash
npm link ../lemon-core      # link the working copy of lemon-core
npm run express.lemon       # ENV=lemon STAGE=local npm run start
```

- Lambda deployment is out of scope for every bundle until the last one.
- `npm run server` / `server.lemon` (serverless-offline) and the `lemon-core/dist/exec-cli` batch path are not part of the harness; both are currently broken and are removed from the reference consumer in B0-a.

## B0-a — harness without lemon-core code changes

1. Verify link state: which `lemon-devkit` copy resolves under `npm link`, and which env overrides apply (`MY_DYNAMO_TABLE=*.yml` mock mode, `OS2_ENDPOINT=` search-off mode).
2. Record a baseline in `docs/v5/baseline.md`: vitest pass / skipped-by-guard counts, express boot time, request smoke (1 route), public export names (`scripts/api-names.cjs` output).
3. Clean the reference consumer: remove dead `server*` scripts; keep `express.lemon` as the only local run path.

## B0-b — move the five devkit functions (after owner decision)

`loadEnviron`, `loadProfile`, `buildExpress` and their two internal helpers move from `lemon-devkit` into lemon-core (`./local` subpath). Starts only after the per-feature decision on devkit is recorded.

## Gate for later bundles

| Bundle | Gate through this harness |
| --- | --- |
| B1 packaging (dual CJS/ESM, exports, singleton) | consumer boots under CJS and under an ESM sample; one engine instance |
| B2 dependencies (drop 4 packages, OpenSearch only, AWS SDK optional peer) | `$U`/`$T` import with no AWS env; search via local OpenSearch or mock |
| B3 L1/L2 merge | public-name diff is empty outside the declared breaking list |
| B4 field annotations | one consumer model migrated; save and query pass |
| B5 trust boundary and failure propagation | external header does not change identity; SQS failure propagates and the handler stays alive |
