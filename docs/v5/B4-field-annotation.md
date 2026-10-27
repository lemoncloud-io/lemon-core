# v5 B4 — field annotations: `@field()` in lemon-model, generated registry removed, named lemon-model re-exports

Status: implemented and measured 2026-10-28 on `feat/v5-b4-field-annotation` in three repos — lemon-model (base `v5` @ `c22f049`), lemon-core (base `v5` @ `71522c0a`), lemon-templates-api (base `v5` @ `fb18688e`). Design: SPEC § 5 (vault). Measured facts and experiments behind the design: `docs/v5/B4-inventory.md`. User-facing changes: `HOW_TO_UPGRADE_V5.md` § 10.

## Scope

- **lemon-model 5.0.0.** New module `src/fields/` with the dual-mode decorator `field()`, `fieldsOf()`, `specsOf()`, `FIELDS_KEY` and the types `FieldKind`, `FieldOptions`, `FieldSpec`, `FieldQuery`. `CoreModel` is a class with 16 annotated fields. `CORE_FIELDS` is derived (14, same order).
- **lemon-core.** `src/generated/` and the `fields:*` scripts removed; `CORE_FIELDS` (L2, module-local) = `fieldsOf(CoreModel)`; manager constructors take `string[]` or a model class; the root re-exports the 32 v4 lemon-model names by name.
- **lemon-templates-api.** `MockModel` is the only converted model (class + annotations + parity spec). The other 10 registry entries stay on the generator during the transition.

## Method

- **Execution mode: legacy decorators.** All three repos keep `experimentalDecorators: true`. TS 5 standard decorators do not run under lemon-core's vitest (Oxc passes them through, inventory J-X2). `field()` still accepts both call shapes: legacy `(prototype, key)` and standard `(undefined, context)`. Only the legacy path is exercised by the tests.
- **Polyfill.** The first statement of `src/fields/index.ts` is `(Symbol as any).metadata ??= Symbol.for('Symbol.metadata')`. Node 24 has no `Symbol.metadata` (J-X1); every model file imports `field`, so the line runs before the first decorated class. `Symbol.for` makes two module copies agree. It is unconditional and needs no `declare global` (a cast avoids a clash with TS 5.2+ `lib.esnext.decorators`).
- **Store.** Each class gets its **own** non-enumerable list under `Symbol.for('lemon-model:fields:v1')` (`FIELDS_KEY`). Legacy writes to the constructor, standard writes to `context.metadata`. No module-level `WeakMap`: the CJS and the ESM build are two module copies, and only a key on the class is visible to both (J-X6). Each entry keeps the options **as written** (`{ name, opts }`); defaults are applied at read time.
- **Read: chain merge.** `specsOf(cls)` walks the constructor chain root → leaf and reads both stores of each constructor (legacy first, then standard). A name seen again keeps its first (parent) position (`Map.set` on an existing key), and the options merge as `{ ...parent, ...child }` (child wins per key). So `@field({ group: 'head' }) declare id?: string` keeps `kind: 'internal'` from `CoreModel`. `kind` defaults to `data`; `group` becomes a `string[]`; `own` is true when the queried class itself declares the name. `fieldsOf(cls, { group?, kinds? })` filters `specsOf()` and returns the names.
- **Order** is declaration order, parent first. The generator listed own fields first. All runtime consumers check inclusion only (whitelist, `.meta` folding, search params) or sort (`listProjections`), so behaviour does not change; specs compare sets.
- **`declare`.** A narrowed or grouped redeclaration of an inherited field uses `declare` + `@field(…)`. From target ES2022 a plain redeclaration is TS2612 (J-X7); legacy decorators accept `declare` fields (standard ones do not — TS1206).
- **No metadata.** `design:type` is not read; there is no `reflect-metadata` dependency.

## Root boundary (SPEC § 5.5)

`src/cores/index.ts` had `export * from 'lemon-model'`. With lemon-model 5.0.0 that line would add 179 names to the lemon-core root. It is replaced by named re-exports of **exactly the 32 names lemon-model 1.1.1 put on the root** (`api-names` current root ∩ lemon-model 1.1.1 exports): values `AbstractTransformer`, `CORE_FIELDS`, `CoreModel`; 29 types. `CoreModel` changes kind type → value+type (one allow entry). The new lemon-model names (`field`, `fieldsOf`, `specsOf`, `FIELDS_KEY`, and the 1.2–1.5 additions) are **not** on the lemon-core root: consumers declare `lemon-model` `^5.0.0` and `import … from 'lemon-model'`.

`ModelClass` and `resolveFields()` live in `src/cores/storage/model-fields.ts`, which the storage barrel does not export, so the root stays at 294 names (deep path `lemon-core/dist/cores/storage/model-fields`).

## Files

lemon-model:

| File | Change |
| --- | --- |
| `src/fields/index.ts` (new) | polyfill line, `FIELDS_KEY`, `field()` (dual mode), `specsOf()`, `fieldsOf()`, types `FieldKind`, `FieldOptions`, `FieldSpec`, `FieldQuery` |
| `src/fields/index.spec.ts` (new) | 8 tests: legacy registration, inheritance merge, redeclare (parent position, per-key option merge), `group`, `kinds`, `own`, `CoreModel`/`CORE_FIELDS`, CJS/ESM cross-read against `dist` (child `node` process; skipped without a build) |
| `src/types/core-storage.ts` | `CoreModel` interface → class (16 `@field()`: `$` view, `id`/`_id` internal), `CORE_FIELDS = fieldsOf(CoreModel, { kinds: ['view', 'data'] })` |
| `src/index.ts` | `export * from './fields'` |
| `scripts/check-package-exports.cjs` | `field`, `fieldsOf`, `specsOf`, `FIELDS_KEY` and a class value `CoreModel` must be on both the CJS and the ESM root |
| `package.json` | version 1.5.1 → 5.0.0 (major aligned with lemon-core v5, D43) |
| `.eslintrc.js` | `root: true` |
| `README.md` | `## Fields`, `fields` row in the package map |

lemon-core:

| File | Change |
| --- | --- |
| `src/generated/field-registry.ts` | deleted (folder removed) |
| `package.json` | `lemon-model` `^5.0.0`; scripts `fields:migrate`/`fields:gen`/`fields:check`/`fields:guard-common` deleted; `build` and `test:watch` prefixes removed; `lemon-devkit` kept |
| `src/cores/index.ts` | `export *` → named re-exports of the 32 v4 names |
| `src/cores/storage/model-fields.ts` (new) | `ModelClass`, `resolveFields()` (not in the barrel) |
| `src/cores/storage/model-manager.ts` | `AbstractManager` `fields: string[] \| ModelClass`, resolved once; the storage gets the same list (`this.FIELDS`) |
| `src/extended/abstract-service.ts` | `CoreManager` `fields: string[] \| ModelClass` |
| `src/extended/cores/abstract-services.ts` | `CORE_FIELDS = fieldsOf(CoreModel)` (16); `MyCoreManager` `fields: string[] \| ModelClass` |
| `src/extended/abstract-service.spec.ts` | `TestModel` class + `@field()`; `TEST_FIELDS = filterFields(fieldsOf(TestModel))`; order asserts → sorted (set) + `base` first |
| `src/extended/cores/abstract-services.spec.ts` | `MyTestModel` class + `@field()`; set asserts; `ClassFieldsManager` (class passed to `MyCoreManager`) and a new test: L1 14, L2 16 = L1 + `id`, `_id`, class-resolved `FIELDS`, `listProjections()` |
| `etc/api-names.allow.txt` | `-CoreModel` / `+CoreModel` (one kind change) |
| `HOW_TO_UPGRADE_V5.md` | § 10, checklist |
| `docs/v5/B4-field-annotation.md` | this file |

lemon-templates-api:

| File | Change |
| --- | --- |
| `src/modules/mock/model.ts` | `class MockModel<T = string> extends CoreModel<ModelType> implements MockHead`; `aliasId` `@field()`; `declare` + `@field({ group: 'head' })` on `id`, `name`, `stereo`; `declare` + `@field()` on `meta`; `$HEAD.mock`/`$FIELD.mock` from `fieldsOf()` |
| `src/modules/mock/model.spec.ts` (new) | parity: `$FIELD.mock` = v4 `mockModel` 16 (set), `$HEAD.mock` = `{id, name, stereo}`, `fieldsOf(MockModel)` ⊇ 16 core + `aliasId` |
| `src/generated/field-registry.ts` | regenerated by `fields:gen`: 12 → 10 entries (`mockHead`, `mockModel` gone) |
| `package.json` | `lemon-model` `^5.0.0` (generator, scripts and `lemon-devkit` kept) |

## Gates (SPEC § 5.10, 1–9)

| # | Gate | Measured |
| --- | --- | --- |
| 1 | lemon-model | `npm run build` 0; `npm test` 21 suites / **293** pass (285 + 8); `npm run test:package-exports` → `package exports smoke test passed`; `tsc --noEmit` 0; `eslint '*/**/*.{js,ts,jsx,tsx}'` 0 errors, 53 warnings (baseline count, 0 in new files); `npm pack` → `lemon-model-5.0.0.tgz` (234 files) |
| 2 | lemon-core build | `npm run build` 0 (no `fields:gen`); `gen-esm-wrapper: dist/esm/index.mjs <- dist/index.d.ts: 136 named + default`, `testing.mjs: 10 named`; `--check` render-twice=same disk=same |
| 3 | root names | `api-check: base=304 current=294 added=12 removed=22 allow=34 not-allowed=0`; `api-names` before/after diff = 1 line (`CoreModel type` → `CoreModel value+type`) |
| 4 | ESM | `esm-smoke: ok names=137 subpaths=4` |
| 5 | tests | `npm test < /dev/null` ×2: `Tests 4 failed \| 499 passed (503)`, `Test Files 4 failed \| 48 passed (52)`; the same 4 failures |
| 6 | generator traces | `grep -rn 'fieldKeys\|field-registry\|lemon-fields' src package.json` 0; `src/generated` absent; `npm ls lemon-devkit` → `lemon-devkit@0.0.11` |
| 7 | load / definitions / identity | `aws-lazy-probe`: `dist/index import: total=290`, all four AWS scopes 0 (`dist/engine` 131, `dist/tools` 30, `dist/helpers` 275); `dup-decls: files=84 decls=356 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0`; `l1l2-probe: checks=28 fails=0 root-keys=137` |
| 8 | core fields | `require('lemon-model').CORE_FIELDS.length` 14; `fieldsOf(CoreModel)` 16 = 14 + `id`, `_id` (spec assertion in `abstract-services.spec.ts`); lemon-core root `CORE_FIELDS` 14, root `fieldsOf` undefined |
| 9 | templates-api (linked) | `npm run build` 0; `npm test`: `Tests 5 failed, 94 passed, 99 total`, `Test Suites 6 failed, 11 passed, 17 total`, the same 5 failures; parity spec 3/3; `grep -rnE 'fieldKeys\.mock(Head\|Model)\b' src` 0; registry 10 entries |

### Test count

- lemon-model: 285 + 8 (`src/fields/index.spec.ts`) = **293**.
- lemon-core: 501 + 1 new test = **503**: the new test sits in `abstract-services.spec.ts`, whose `describe` also runs inside `abstract-controllers.spec.ts` (it imports that spec), so it counts twice. 499 pass, 4 fail: `encodeIdentityJWT and verifyToken tests` ×3 (`lambda-sns`/`sqs`/`web-handler.spec.ts`), `engine.spec doReportError() - account id` — the B3 names.
- templates-api: 96 + 3 (`mock/model.spec.ts`) = **99**; 94 pass, 5 fail: `CallbackAPIController › should pass basic CRUD`, `CallbackAPIController › should pass express route: GET /0/hello`, `SearchController › should pass express route: GET /0/hello`, `hello-api › should pass GET /hello/0`, `hello-api › should pass POST /hello/0` — the B3 names. Suites 16 → 17. No existing spec compared a `MockModel` field array by order; none was changed.

## Choices (SPEC left open)

- **Raw options stored, merged at read.** Entries keep the options as written, so a child that gives only `group` keeps the parent `kind` (per-key merge). Normalized specs at write time would have reset `kind` to `data`.
- **Constructor widening by a union parameter**, not separate overload signatures: a subclass forwards its `fields` to `super()`, and a union cannot be passed to a set of `string[]`-only / `ModelClass`-only overloads. Existing calls compile unchanged.
- **`AbstractManager` resolves once** and gives `this.FIELDS` to `makeStorageService()`, so the filter and the storage share one array as before.
- **`ModelClass`/`resolveFields` off the root** (`cores/storage/model-fields.ts`, not in the barrel) to keep 294 names.
- **Class-fed manager in a separate spec class** (`ClassFieldsManager`, `enableSync: false`), so the main `TestModelManager` and the B2-b lazy `$OS2` counts are untouched.
- **View fields stay undecorated** in the spec models (`Model`, `$model`, `$identity`) — `filterFields` gives the same set either way (J-X8).
- **CJS/ESM cross-read test** runs a child `node --input-type=module` that loads `dist/index.js` and `dist/esm/index.js`, so the ESM copy is real ESM (jest would transpile it into a second CJS copy).
- **Parity spec imports `expect2` from `lemon-core`**, not `test-helpers/commons.spec` (that import would also run its 4 tests inside the new file).

## Deviations from SPEC § 5

1. **`api:check` counts.** SPEC § 5.10 gate 3 expects `added=11 removed=21` with one allow line. `api-check.cjs` prints a kind change as one `-` and one `+` line and matches the allow list per sign, so the `CoreModel` kind change gives `added=12 removed=22` and needs two allow lines (`-CoreModel`, `+CoreModel`, one comment). `current=294`, `not-allowed=0` as expected; the `api-names` diff is the one `CoreModel` line.
2. **Load probe 290, not 265 ± 1–2.** `require('lemon-model')` 1.6.0 loads 31 modules (1.1.1: 6): the 1.2–1.5 runtime modules (`socket`, `genai`, `buffer`, `sync`, `progress`, `logtrace`: 24) plus `fields` (1). In lemon-core: + `cores/storage/model-fields` (1), − `generated/field-registry` (1). 265 + 25 = 290. No third-party module is added; AWS scopes 0. Named re-exports do not reduce it (a CJS `require` of the root loads the whole lemon-model barrel; lemon-model has no `./types` subpath).
3. **Gate 9 grep.** `grep -rn 'fieldKeys.mock' src` returns 2 lines in templates-api: `fieldKeys.mockTestModel` (`TestModel`) and `fieldKeys.mockTransformerModel` (transformer spec). Both are out of scope (SPEC § 5.6: `TestModel` stays on the generator). The two removed calls are gone: `grep -rnE 'fieldKeys\.mock(Head|Model)\b' src` 0.
4. **lemon-core test count +2 for one new test** (see Test count).

## Release order (SPEC § 5.8)

lemon-model PR → `v5` → **npm publish 5.0.0** → lemon-core and templates-api `^5.0.0` + lockfile update → merge. Until the publish both consumer lockfiles still pin lemon-model 1.1.1, so `npm ci` installs 1.1.1 and the B4 sources do not compile against it; verification is by link and by tarball install (`npm pack`).

## Notes for review

- lemon-core's `.eslintrc.js` has no `root: true` either; in a worktree plain `eslint` loads the parent checkout's config and fails on a duplicate `prettier` plugin. `eslint --no-eslintrc -c .eslintrc.js` on the changed files: 0 errors.
- `listProjections()` with a class-fed manager drops `$`, `id`, `_id` because L2 `CORE_FIELDS` is 16; with the 14 L1 list it would keep `id` and `_id`.

## Coordinator rerun (2026-10-28, SPEC § 5.10 gates 1–12)

Rerun by the coordinator on the three linked worktrees; the implementer's values above were reproduced exactly.

| # | Gate | Value |
| --- | --- | --- |
| 1 | lemon-model | `npm run build` 0 · `npm test` 21 suites, **293/293** (285 + 8) · `test:package-exports` passed · `tsc --noEmit` 0 · eslint (`--no-eslintrc -c .eslintrc.js`) 0 errors · version 1.6.0 · `CORE_FIELDS` 14 in the former order, `fieldsOf(CoreModel)` 16 |
| 2 | lemon-core build | exit 0 without `fields:gen`; `gen-esm-wrapper` **136 named + default**, `testing.mjs` 10 named |
| 3 | root names | `api-check: base=304 current=294 added=12 removed=22 allow=34 not-allowed=0` (kind change = one `-` + one `+` line) |
| 4 | ESM | `esm-smoke: ok names=137 subpaths=4` |
| 5 | tests | `npm test` ×2: `Test Files 4 failed \| 48 passed (52)`, `Tests 4 failed \| 499 passed (503)` both runs; the 4 failures are the pre-existing `doReportError() - account id` and `encodeIdentityJWT and verifyToken tests` ×3 |
| 6 | generator traces | `grep -rn 'fieldKeys\|field-registry\|lemon-fields' src package.json` 0 · `src/generated` absent · `npm ls lemon-devkit` → 0.0.11 |
| 7 | probes | `dup-decls: files=84 decls=356 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0` · `l1l2-probe: checks=28 fails=0 root-keys=137` · load probe `dist/index import: total=290 @aws-sdk=0 @smithy=0 @aws-crypto=0 @aws=0` (265 + 25, see Deviations 2) |
| 8 | core fields | lemon-model `CORE_FIELDS` 14 (`$,ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error`); lemon-core L2 16 = 14 + `id`, `_id` (spec) |
| 9 | templates-api (linked) | `npm run build` 0 · `npm test` **99 total / 94 passed / 5 failed** (B3: 96/91/5; the 5 names are the same) · parity spec 3/3 · `grep -rnE 'fieldKeys\.mock(Head\|Model)\b' src` 0 · registry 10 entries |
| 10 | packed install | `npm pack` → `lemon-model-5.0.0.tgz`, `lemon-core-4.3.0.tgz`; installed into a scratch copy of templates-api (lockfile kept, no link): `npm ls` shows one `lemon-model@5.0.0` (deduped under lemon-core) · `require('lemon-core')` ok, 137 keys · `tsc --noEmit` 0 · jest 99/94/5, same 5 names |
| 11 | harness `express.lemon` | default mode: `GET /` 200 in 32 s, `/hello/0` `/mocks` `/search/?ipp=1` `/search/echo/query` 200, PERF 6 lines (`loaded lemon-core`, `instance $OS2`, `lazy-load @aws-sdk/client-kms` 31.9 ms, `lazy-load @aws-sdk/credential-providers`, `client KMS` 1.8 ms, `initialize` 122.7 ms). Mock-storage mode (`MY_DYNAMO_TABLE=dummy-data.yml`, `OS2_ENDPOINT=`): boots in 31 s, `POST /mocks/0` → `GET /mocks/<id>` 200 (the mock API round-trips the body through `.meta` by design, so it cannot show the fold); the fold itself was measured with a temporary spec on the annotated manager: `$mock.save('b4gate', { name, stereo, zzUnknownKey })` → stored item keys `_id,createdAt,deletedAt,id,meta,name,ns,stereo,type,updatedAt`, `meta = { zzUnknownKey }`, no top-level `zzUnknownKey`. `GET /mocks` 400 `NO DYNAMO` as in B0-a (its error report loads `client-sns`, PERF 7th line) |
| 12 | docs / leaks | `HOW_TO_UPGRADE_V5.md` § 10, this file, `docs/v5/B4-inventory.md`, lemon-model README § Fields; scan for absolute paths, accounts, ARNs, env values: 0 |

`fieldsOf()` returns a fresh `string[]` on every call (no cache; the list is registered once at class definition time); 10,000 calls ≈ 34 ms. Consumers compute their lists once (`$FIELD`/`$HEAD` module constants, manager `this.FIELDS`).
