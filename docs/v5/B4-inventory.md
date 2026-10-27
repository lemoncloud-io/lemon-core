# lemon-core v5 B4 (field annotations) — measured inventory and experiments

- Trees: `<lemon-core>` = the B4 lemon-core worktree (branch `feat/v5-b4-field-annotation`, v5 tip after B3). `<templates-api>` = the B4 templates-api worktree (same branch, v5 tip; its `node_modules/lemon-core` is the **registry 4.3.0** copy, a real directory, not a link). `<lemon-model>` = the B4 lemon-model worktree (same branch, at the `develop` tip).
- `<scratch>` = the investigator's scratch folder (outside every repo, not committed). Scripts, scratch copies and raw outputs are in `<scratch>/b4/`.
- Tags: **[measured]** = a command or script ran and its output is quoted. **[code]** = read from source (`file:line`, current trees).
- No git or gh command was run. No file under the worktrees' `src/`, `package.json` or tsconfig was edited. All experiments ran on scratch copies (`rsync` copies with a `node_modules` symlink or a symlink farm).
- Worktree side effects and their undo (§ 8): `npm run build` in `<lemon-core>` rewrote `src/generated/field-registry.ts` (committed form sha256 `39adf249…` → post-build form `bf38c1b4…`); the start copy was copied back, `diff` empty. Run outputs that did not exist before (`<lemon-core>/logs`, `<templates-api>/coverage`, `<templates-api>/dist`, `<lemon-model>/coverage`) were removed; all are gitignored. `<lemon-model>/dist` and `<lemon-core>/dist` were rebuilt from unchanged sources.

## 1. Current `fieldKeys` pipeline (post-B3)

### 1.1 Generated registries [code + measured]

`<lemon-core>/src/generated/field-registry.ts` (committed form, 87 lines, prettier-formatted): 3 entries.

| entry | source (registry comment) | fields | lines |
| --- | --- | --- | --- |
| `coreModel` | `src/extended/cores/abstract-services.ts#CoreModel` | 16: `$, ns, type, stereo, sid, uid, gid, lock, next, meta, createdAt, updatedAt, deletedAt, error, id, _id` | `:4-23` |
| `myTestModel` | `src/extended/cores/abstract-services.spec.ts#MyTestModel` (**spec**) | 21 | `:24-48` |
| `testModel` | `src/extended/abstract-service.spec.ts#TestModel` (**spec**) | 26 | `:49-78` |

- Meta `concrete`, `schemaVersion 1`, `entryCount 3`, checksum `f00dc1d624f9c0a3` (`:81-87`). `npm run build` reports `3 entries` with the same checksum and rewrites the file in raw one-line form (G problem 1, still true) [measured: `gates/lc-build.txt`].
- The spec entries ship: `require('<lemon-core>/dist/generated/field-registry.js').fieldKeys` has keys `coreModel, myTestModel, testModel` [measured]. The file is reachable as a deep path through the `./dist/*` export (`package.json:38-43`).

`<templates-api>/src/generated/field-registry.ts` (49 lines): **12 entries** (was 13 before B3 deleted `view/transformer.spec.ts`).

| entry | source | fields | spec? |
| --- | --- | --- | --- |
| `callbackHead` | `callback/model.ts#CallbackHead` | 3 | |
| `callbackModel` | `callback/model.ts#CallbackModel` | 33 | |
| `callbackServiceModel` | `callback/service.spec.ts#Model` | 16 | **spec** (`:11-13`) |
| `callbackTransformerModel` | `callback/transformer.spec.ts#Model` | 16 | **spec** (`:14-16`) |
| `mockHead` | `mock/model.ts#MockHead` | 3 | |
| `mockModel` | `mock/model.ts#MockModel` | 18 | |
| `mockTestModel` | `mock/model.ts#TestModel` | 28 | |
| `mockTransformerModel` | `mock/transformer.spec.ts#Model` | 16 | **spec** (`:26-28`) |
| `searchBatchModel` | `search/model.ts#SearchBatchModel` | 26 | |
| `searchModel` | `search/model.ts#SearchModel` | 17 | |
| `searchQueryModel` | `search/model.ts#SearchQueryModel` | 21 | |
| `testHead` | `mock/model.ts#TestHead` | 4 | |

- 3 spec-origin entries (all three are `CoreModel<ModelType>` aliases = the 16 core fields). Meta `entryCount 12`, checksum `0f0e6844e68ed5f1` (`:43-49`). `npm test` → `lemon-fields gen — 12 entries, no change` [measured: `gates/ta-test.txt`].

### 1.2 Consumers of `fieldKeys` and `CORE_FIELDS` [code]

| repo | file:line | what |
| --- | --- | --- |
| lemon-core | `src/extended/cores/abstract-services.ts:83`, `:90` | `const CORE_FIELDS: string[] = fieldKeys.coreModel<CoreModel>()` (L2, 16, module-local) |
| lemon-core | `src/extended/cores/abstract-services.ts:709` | `listProjections` → `_notIn(this.FIELDS, CORE_FIELDS)` (sorted by default, `:707`/`:710`) |
| lemon-core | `src/extended/abstract-service.spec.ts:19`, `:51` | `TEST_FIELDS = filterFields(fieldKeys.testModel<TestModel>())`; order-sensitive `.join(',')` asserts at `:170-175` |
| lemon-core | `src/extended/cores/abstract-services.spec.ts:31`, `:60` | `filterFields(fieldKeys.myTestModel<MyTestModel>())` |
| lemon-core | `src/cores/storage/proxy-storage-service.ts:14`, `:866` | L1 `CORE_FIELDS` from lemon-model (14) prepended in `makeStorageService` |
| lemon-core | `src/cores/storage/proxy-storage-service.spec.ts:14`, `:133`, `:153` | asserts `CORE_FIELDS.length === 14` |
| lemon-core | `src/cores/index.ts:13` | `export * from 'lemon-model'` → root `CORE_FIELDS` (value, 14) [measured: `require(dist).CORE_FIELDS.length` = 14] |
| templates-api | `mock/model.ts:14`, `:132-133`, `:138-139` | `$HEAD.mock/test`, `$FIELD.mock/test` |
| templates-api | `callback/model.ts:15`, `:138`, `:143` | `$HEAD.callback`, `$FIELD.callback` |
| templates-api | `search/model.ts:119`, `:121`, `:141-142` | `FIELDS` (drops `_*`), `$FIELD.$query/$batch` via `extendsFields` (`:129-136`) |
| templates-api spec | `mock/transformer.spec.ts:15,18` · `callback/transformer.spec.ts:15,17` · `callback/service.spec.ts:17,19` | spec-only registry entries |

- Call counts [measured, grep]: templates-api `fieldKeys.` non-spec 9, spec 3; lemon-core non-spec 1, spec 2. `CORE_FIELDS` is not referenced in templates-api.
- `$FIELD`/`$HEAD` users in templates-api: managers `mock/service.ts:32` (`MockModelManager`), `:140` (`TestModelManager`), `callback/service.ts:48`, `search/service.ts:401`, `:474`; head projection `mock/transformer.ts:77`, `:129`, `callback/transformer.ts:74`. `service/backend-model.ts:40-48` holds empty `$HEAD`/`$FIELD` placeholders and a 4th `filterFields` copy (`:28`).

### 1.3 Constructors that take `string[]` fields [code]

| class | file:line | signature → where `fields` goes |
| --- | --- | --- |
| `MyCoreManager` (L2) | `extended/cores/abstract-services.ts:253-266` | `(type, parent, fields: string[], options?)` → `super(type, parent, fields, options?.uniqueField)` |
| `CoreManager` (L1) | `extended/abstract-service.ts:173-174` | `(type, parent, fields: string[], uniqueField?)` → `AbstractManager` |
| `AbstractManager` | `cores/storage/model-manager.ts:41-46` | `super(fields)` (→ `GeneralModelFilter`) and `parent.makeStorageService(type, fields, this)` |
| `GeneralModelFilter` | `cores/storage/proxy-storage-service.ts:136-137` | `this.FIELDS = fields`; `beforeSave` folds unknown keys into `.meta` (`:183-193`) |
| `CoreService.makeStorageService` | `extended/abstract-service.ts:150-153` | → `new ProxyStorageService(this, tableName, fields, filter, idName)` |
| `ProxyStorageService` | `cores/storage/proxy-storage-service.ts:311-323`, static `:851-869` | `clearDuplicated(CORE_FIELDS.concat(fields))` (L1 14) → `DynamoStorageService` |
| `DynamoStorageService` | `cores/storage/storage-service.ts:171-175` | whitelist `clearDuplicated(['id','type','stereo','meta', idName].concat(fields))` |
| readers of `$mgr.FIELDS` | `extended/abstract-service.ts:486` (`override`), `extended/cores/abstract-services.ts:1280` (`normal`), `:1335` (search params) | inclusion checks only |

### 1.4 L1 14 vs L2 16 [measured]

- L1 `CORE_FIELDS` (lemon-model `src/types/core-storage.ts:133-148`, installed 1.1.1 identical): `$, ns, type, stereo, sid, uid, gid, lock, next, meta, createdAt, updatedAt, deletedAt, error`.
- L2 `fieldKeys.coreModel` = the same 14 in the same order **+ `id`, `_id`** at the end. Exact difference: `{id, _id}`.
- Why it does not show today: `DynamoStorageService` adds `id` and `idName` (`_id` by default) itself (`storage-service.ts:175`); every `filterFields` drops `_id`.

### 1.5 `filterFields` variants and what they drop [code]

| copy | rule | drops (examples from the registries) | keeps |
| --- | --- | --- | --- |
| lemon-core `extended/abstract-service.ts:60-69` | `/^[a-z]+/` or `/^[A-Z_]+$/` | `$`, `_id`, `_idx`, `Model`, `$model` | `A`, `AB`, `A_B`, `object$` |
| templates-api `mock/model.ts:119-128` (same in `callback/model.ts:125-134`, `service/backend-model.ts:28-37`) | `field !== '_id' && /^[a-z_][a-zA-Z_]+/` (not end-anchored) | `$`, `_id`, `Model`, `Query`, `$request`, `$mock`, `$mocks`, `$identity`, any 1-char name, `A`, `AB` | `_idx`, `_date`, `mock$`, `mock$$`, `parent$` |
| templates-api `search/model.ts:121` + `extendsFields` `:129-136` | drop `_*`; then only `^[a-z]` | `_id`, `Query` | — |

- The two main rules disagree on `_x` (core drops, templates keeps) and on upper-case constants (core keeps, templates drops) [code].
- `GeneralModelFilter.beforeSave` (`proxy-storage-service.ts:185-189`): keys starting with `_` or `$` are dropped from the save payload; `createdAt/updatedAt/deletedAt` skipped; PascalCase keys (not `A_B` constants) skipped; `meta` handled apart; any other key not in `FIELDS` (and not `*key`) goes into `.meta`.

### 1.6 Spec guard blocks [measured]

- `checkAllKeys` (the `guard-common` target): templates-api **2 definitions** (`mock/transformer.spec.ts:26`, `callback/transformer.spec.ts:25`), 5 mentions in 2 files. G counted 3; the third (`view/transformer.spec.ts`) was deleted in B3. lemon-core: 0.
- Each block hard-codes the 14 data core names as a sorted string (`mock/transformer.spec.ts:32-37`).

## 2. templates-api models

### 2.1 Interfaces in `src/modules/*/model.ts` — 11 [measured: grep `^export interface` = 11]

| interface | file:line | own fields | extends | redeclared parent fields |
| --- | --- | --- | --- | --- |
| `MockHead` | `mock/model.ts:30` | 3 (`id, name, stereo`) | — | — |
| `MockModel<T>` | `mock/model.ts:43` | 4 (`name, stereo, aliasId, meta`) | **`MockHead, Model`** (multi) | `name` (same), `stereo` (narrowed `MockStereo \| ModelType`), `meta` (narrowed to `T`) |
| `MockModelExt<T>` | `mock/model.ts:54` | index signature | `MockModel<T>` | — |
| `TestHead` | `mock/model.ts:62` | 4 (`id, name, stereo, _idx`) | — | — |
| `TestModel` | `mock/model.ts:76` | 12 (`name, stereo, count, extra, mockId, mock$, mockIds, mock$$`, readonly `Model, $mock, $mocks, $identity`) | **`Model, TestHead`** (multi) | `name`, `stereo` (narrowed `TestStereo`) |
| `CallbackRequest` | `callback/model.ts:33` | 6 (not a stored model) | — | — |
| `CallbackHead` | `callback/model.ts:52` | 3 | — | — |
| `CallbackModel` | `callback/model.ts:66` | 20 (incl. readonly `$request`) | **`Model, CallbackHead`** (multi) | `id`, `stereo` (narrowed), `name`, `meta` (narrowed to `string`) |
| `SearchModel` | `search/model.ts:35` | 2 (`id, name`) | `CoreModel<SearchModelType>` (imported from **lemon-core**, `:14`) | `id` |
| `SearchQueryModel` | `search/model.ts:49` | 4 (incl. readonly `Query`) | `SearchModel` | — |
| `SearchBatchModel` | `search/model.ts:71` | 11 | `SearchModel` | `meta` (same type), `error` (same type) |

- Multiple-interface `extends`: 3 (`MockModel`, `TestModel`, `CallbackModel`) [code].
- `new <X>Model(`: **0** in templates-api `src` [measured]. lemon-core: 0 as well.

### 2.2 The "mock model" of SPEC § 5.1 [code]

- Class to convert: **`MockModel`** (`mock/model.ts:43-52`), managed by `MockModelManager` (`mock/service.ts:30-33`, type `'mock'`).
- Head: `$HEAD.mock = filterFields(fieldKeys.mockHead<MockHead>())` = `id, name, stereo` (3). Body: `$FIELD.mock = filterFields(fieldKeys.mockModel<MockModel>(), ['meta'])` = 16 names: `meta, name, stereo, aliasId, id, ns, type, sid, uid, gid, lock, next, createdAt, updatedAt, deletedAt, error` [measured: J-X8].
- The same file also holds `TestModel` (`TestModelManager`, type `'test'`); its `FIELDS` order is what 8 templates-api assertions check (§ 6 J-X7 jest).

## 3. lemon-model

| item | value | evidence |
| --- | --- | --- |
| `CoreModel` | `export interface CoreModel<ModelType extends string = string> extends StorageModel, InternalModel` with 14 own members (`$` readonly, `ns`, `type?: ModelType`, `stereo`, `sid`, `uid`, `gid`, `lock`, `next`, `meta`, `createdAt`, `updatedAt`, `deletedAt`, `error`); inherits `id`, `type`, `stereo`, `meta`, `_id` (`StorageModel`/`InternalKey`, `:17-36`) and `sid/uid/gid/_id` (`InternalModel`, `:61-66`) | [code] `src/types/core-storage.ts:72-130` |
| `CORE_FIELDS` | `string[]` literal, 14 | [code] `:133-148` |
| `main` / `module` / `types` | `dist/index.js` / `dist/esm/index.js` / `dist/index.d.ts` | [code] `package.json:5-7` |
| `exports` | `.` + 8 subpaths (`genai/testing`, `buffer/testing`, `progress/testing`, `socket/testing`, `logtrace/testing`, `upload`, `upload/testing`, `upload/engine`) + `./package.json`; `typesVersions` for 3 upload paths | [code] `:8-71` |
| dual build | `build` = `build-ts` (`tsc`, CJS) + `build-esm` (`tsc -p tsconfig.esm.json` module ES2020 → `dist/esm`, then `fix-esm-build.cjs` adds `.js`/`/index.js` to relative specifiers and writes `dist/esm/package.json {type: module}`) | [code] `:73-75`, `scripts/fix-esm-build.cjs:20-64`, `tsconfig.esm.json` |
| export smoke | `test:package-exports` = build + `scripts/check-package-exports.cjs` (CJS `require` vs ESM `import` name sets for 9 entries; root must not leak testing/upload/engine names) | [code] `:84`, script `:9-122` |
| TS | declared `^4.6.2` (`:134`), installed **4.7.4** | [measured] `tsc -v` in build log |
| tsconfig | `experimentalDecorators: true` (`:4`), `emitDecoratorMetadata: true` (`:9`), `target: es6` (`:10`) → `useDefineForClassFields` effective **false**; no `strict` | [code] |
| jest | jest 27 + ts-jest, `compiler: ttypescript`, `tsconfig.json`, runner `jest-jasmine2` | [code] `jest.config.json` |
| lint / format | `lint` = `tsc --noEmit && eslint … --fix`; `format` = `prettier --write src/**/*.ts` | [code] `:80-81` |
| `prepare` / `prepublishOnly` | `npm run build` / `npm test && npm run lint && npm run format` | [code] `:87-88` |
| release path | no `.github/` (no workflow), `scripts/` has only the two build/check scripts; README "VERSION INFO" stops at 1.0.6 (stale); CONTRIBUTING says releases are plain version-bump commits (`v1.2.3`). Publishing is a manual `npm publish` from a maintainer machine (inferred: nothing else exists) | [code] `README.md:123-131`, `CONTRIBUTING.md:58-61` |
| version | `package.json` on develop = **1.5.1**; npm `latest` = 1.5.1 (published 2026-09-30); 1.2.4 published 2026-07-15; versions after 1.1.1: 1.2.0-1.2.4, 1.4.0, 1.5.0, 1.5.1. No local tags in the clone (tag check not possible without git) | [measured] `npm view lemon-model versions/time/dist-tags` |
| `engines` | `node >= 18.19.0` | [code] `:104-106` |
| `src` layout | `buffer/ cores/ genai/ logtrace/ progress/ socket/ sync/ types/ upload/` + `index.ts` (8 `export *`). A new `src/fields/index.ts` exported from `src/index.ts` fits the layout (tested in J-X5). `src/socket/decorators.ts` exists but is a **wrapper pattern** (`createReconnectingNetwork`), not TS decorators — avoid the name `decorators` for B4 | [code] |
| baseline | `npm test` → 20 suites / **285 tests** pass; `npm run test:package-exports` → `package exports smoke test passed` | [measured] § 8 |

Installed lemon-model in the consumers [measured: `node_modules/lemon-model/package.json` + lockfiles]:

| repo | declared | installed / lockfile |
| --- | --- | --- |
| `<lemon-core>` | `"lemon-model": "^1.1.1"` (`package.json:108`, `dependencies`) | 1.1.1 (registry tarball) |
| `<templates-api>` | `"lemon-model": "^1.1.1"` (`package.json:66`, `dependencies`) | 1.1.1 (registry tarball); `lemon-core` 4.3.0 registry |

## 4. lemon-core uses of `CoreModel` as a type

- Non-spec references: 54 lines; `extends CoreModel` 19 (all generic constraints or `interface … extends`), spec `interface … extends CoreModel`: 3 (`model-manager.spec.ts:25`, `proxy-storage-service.spec.ts:31`, `abstract-rest-apis.spec.ts:19`) [measured: grep → `<scratch>/b4/lc-coremodel-refs.txt`].
- `implements CoreModel`: 0. `new CoreModel`: 0. Object literals typed as `CoreModel` exist (`proxy-storage-service.ts:631`, `:1193`, `:1207`; `general-api-controller.ts:106`, `:122`) — they stay valid only if the class has **no methods and no private/protected members** [code].
- Re-exports: `helpers/types.ts:19` and `extended/cores/types.ts:16` use `export type { CoreModel }`; `extended/cores/abstract-controllers.ts:44` uses a value `export { CoreModel, … }`; the root gets it via `cores/index.ts:13` `export *`. With a class, the root name changes from `CoreModel type` to `value+type` in `api-names` [code].
- **Compatibility test [measured]:** lemon-core typechecked against the J-X5 class build of lemon-model (scratch tsconfig with `paths: lemon-model → class build`, TS 5.9.3): non-spec **0 errors** (same as the 1.1.1 interface); with specs, 123 errors in both cases and the normalized error sets are **identical** (all pre-existing: vitest globals and module-resolution of vitest types). Class conversion adds 0 errors (`jx5/lc-check/`).

## 5. lemon-devkit after B4

### 5.1 lemon-core [code + measured]

- Dynamic `require('lemon-devkit')` sites: `src/environ.ts:92` (`loadEnviron`), `:114` (`loadProfile`), `src/tools/express.ts:100` (`buildExpress`). These are D33's kept functions.
- Specs that reach them: **24 files** (`loadProfile` in 20 incl. `environ.spec.ts`; `loadEnviron` in `tools.spec.ts`; `buildExpress` in `express.spec.ts`, `dummy-controller.spec.ts`, `general-controller.spec.ts`, `general-api-controller.spec.ts`). `express.spec.ts:93` asserts `devDependencies['lemon-devkit'] === '^0.0.11'`.
- **Experiment (removal):** scratch copy of `<lemon-core>` with a `node_modules` symlink farm minus `lemon-devkit` and a `package.json` without the devkit devDependency and `fields:*` scripts → `vitest run`: **Test Files 26 failed | 26 passed (52); Tests 9 failed | 251 passed | 4 skipped (264)**, vs baseline 4 failed | 48 passed. Cause: `loadProfile(function) is required (npm i -D lemon-devkit)` (36 hits) thrown at module scope [measured: `jdev/vitest-nodevkit.log`].
- Conclusion: **`lemon-devkit` must stay a devDependency of lemon-core** (local harness, D33). What B4 removes in lemon-core: scripts `fields:migrate`, `fields:gen`, `fields:check`, `fields:guard-common` (`package.json:55-58`); the `npm run fields:gen &&` prefix of `build` (`:47`); the `lemon-fields guard-common &&` prefix of `test:watch` (`:70`); `src/generated/field-registry.ts` and its 3 imports (§ 1.2); the header comment references to the generator. The `lemon-fields` bin stays installed (comes with devkit 0.0.11, together with `ts-morph` ≈ 14 MB), it is just no longer called.

### 5.2 templates-api [code]

- `buildExpress` (`src/express.ts:31-33`) and `loadProfile` from `lemon-core/dist/environ` in 8 specs delegate to lemon-core's `require('lemon-devkit')`. With an installed (non-linked) lemon-core, that `require` resolves from the consumer's `node_modules`, so **templates-api must keep its own `lemon-devkit` devDependency** (`package.json:83`, `^0.2.0`).
- Removed in B4 (only after every model uses `fieldsOf`): scripts `fields:migrate`, `fields:gen`, `fields:report`, `fields:check` (`:13-16`); the `npm run fields:gen &&` prefix of `build` (`:10`), `test` (`:44`), `test:dev` (`:45`), `test:watch` (`:46`); `src/generated/field-registry.ts`. While any spec still imports `fieldKeys` (3 spec entries), the file and the `test` pre-step must stay.

## 6. Experiments

All run on Node v24.20.0. Tool versions in `<lemon-core>/node_modules`: typescript 5.9.3, vitest 4.1.4, vite 8.0.9, rolldown 1.0.0-rc.16, `@oxc-project/types` 0.126.0 (no `esbuild`). `<templates-api>` and `<lemon-model>`: typescript 4.7.4 [measured].

The dual-mode helper used everywhere is `<scratch>/b4/lib/field.ts` (≈100 lines): the legacy call `(prototype, key)` pushes onto an own, non-enumerable list at `ctor[Symbol.for('lemon-model:fields:v1')]`; the standard call `(undefined, context)` pushes onto `context.metadata[sameKey]`; `fieldsOf(cls, {group, kinds})` walks the constructor chain root → leaf, merges both stores, and keeps a redeclared name at the **parent position** with the child's options. An env flag (`B4_POLYFILL=1`) enables `Symbol.metadata ??= Symbol.for('Symbol.metadata')` for the experiments.

| # | setup | result |
| --- | --- | --- |
| J-X3 | `jx3/`: lemon-core tsconfig copy (flags true, ES2024), vitest 4.1.4 via the lemon-core `node_modules`, spec imports decorated `CoreModel`/`MockModel` | **Runs.** `fieldsOf(CoreModel)` = the 16 L2 names in order; `MockModel` = 16 + `name, aliasId`; `head` = `name`. A spy on `Reflect.metadata` is called **18 times** (`design:type=Object/String…`), so `design:type` **is emitted**. Direct Oxc transform (`rolldown/utils.transformSync`, the call Vite 8 makes, `oxc-dump.mjs`) shows `_decorate([...], CoreModel.prototype, "$", void 0)` and `_decorateMetadata("design:type", Object)` — Oxc uses its own runtime helpers (`@oxc-project/runtime/helpers/decorate`), **not** tsc's inline `__decorate` |
| J-X2 | `jx2/`: same, tsconfig `experimentalDecorators: false` | **Fails.** Module load error `Invalid or unexpected token`: Oxc passes `@field()` through untouched (`rawAt: true` in the dump) and Node 24 cannot parse decorators. Polyfill does not matter. Oxc's `DecoratorOptions` has only `legacy` and `emitDecoratorMetadata` (`rolldown/dist/shared/binding-*.d.mts:757-778`). Standard decorators cannot run under lemon-core's vitest today |
| J-X1 | `jx4/`: tsc 5.9.3, flag false, targets ES2024/ES2022/es6, run with Node | `typeof Symbol.metadata` = `undefined` on Node 24.20 (before any polyfill). Without polyfill every standard variant throws at class definition (`context.metadata` is `undefined`; the helper raises `needs Symbol.metadata`). With the one-line polyfill all three targets give the same lists as legacy |
| J-X4 | `jx4/`: one source, 6 tsc builds (legacy/standard × ES2024/ES2022/es6) | With polyfill: `core`, `mock`, `head` strings **identical in all 6** (`jx4-results.txt`). Legacy stores on `Symbol(lemon-model:fields:v1)` of the class; standard on `Symbol(Symbol.metadata)`. **Mixed** (legacy-compiled `CoreModel` es6 + standard-compiled child ES2024, `out-mix/`): `fieldsOf(MockModel)` = 16 core + `name, aliasId`, specs tagged `legacy` for the parent and `standard` for the child — the chain walk merges both stores |
| J-X5 | `jx5/lemon-model`: scratch copy; `src/fields/index.ts` (field/fieldsOf/specsOf/FIELDS_KEY), `CoreModel` → `class CoreModel<ModelType> implements StorageModel, InternalModel` with 16 decorated fields (`$` view, `id`/`_id` internal), `CORE_FIELDS = fieldsOf(CoreModel, {kinds: ['view','data']})`, `export * from './fields'` | TS **4.7.4** compiles legacy decorators on class fields: `tsc --noEmit` 0 errors; `npm run build` exit 0; `check-package-exports.cjs` → `passed`; `__decorate` 17 lines in both `dist/types/core-storage.js` and `dist/esm/types/core-storage.js`, `design:type` 16. jest: **20 suites / 285 tests pass** (unchanged). CJS and ESM `fieldsOf(CoreModel)` equal (16, L2 order); `CORE_FIELDS` CJS = ESM = the exact L1 14. New root names: `CoreModel` (now a value), `FIELDS_KEY`, `field`, `fieldsOf`, `specsOf` (+ types `FieldOptions`, `FieldSpec`, `FieldQuery`). TS 4.6 was not installed (not measured; legacy field decorators predate 4.6) |
| J-X6 | one Node process loads `dist/index.js` (CJS) and `dist/esm/index.js` (ESM) of the scratch build (`cjs-esm.mjs`) | `cjs.CoreModel === esm.CoreModel` → **false** (two classes). **`Symbol.for` store:** class decorated with the CJS `field`, read with the ESM `fieldsOf` → `…_id,name`, head `name`; reverse also works; 17/17 names. **Module `WeakMap` store** (`jx6/lemon-model-weakmap`, same code with a module-level `WeakMap`): cross reads return **empty lists** (`crossParent 0/0`) — every field would fold into `.meta` |
| J-X7 | `jx7/ta`: scratch copy of `<templates-api>`; `node_modules` symlink farm with `lemon-core` → `<lemon-core>` (v5 build) and `lemon-model` → J-X5 class build; `mock` (`MockModel`, `TestModel`), `callback` (`CallbackModel`), `search` (3 models) converted to `class … extends CoreModel<…> implements <Head>` with `@field()` on 50 fields (heads stay interfaces; head fields get `{group: 'head'}`; readonly view fields undecorated); `$HEAD/$FIELD/FIELDS` built from `fieldsOf` with the existing `filterFields` | `tsc --noEmit`, TS 4.7.4: unconverted (1.1.1 or class `CoreModel`) **0 errors** non-spec, 2 with specs (pre-existing `_date` TS2345); converted **es6: 0 / 2 (same)**; converted **ES2022: 13 errors, all TS2612**, of which **11 are new** (redeclared `id`, `stereo`, `meta`, `error` on the 6 classes) and 2 pre-existing (`service` in `callback/proxy.ts:24`, `mock/proxy.ts:36`; baseline ES2022 = those 2). Adding `declare` to the 11 redeclared fields (legacy decorators accept it): ES2022 back to the 2 pre-existing. With TS 5.9.3 the same counts (+1 pre-existing TS7011 in `api/crons-api.ts:90`). Standard decorators reject `declare` fields: `TS1206 Decorators are not valid here` (`jx4/mix2.log`) |
| J-X7 jest | same scratch, `LS=1 jest` with linked v5 lemon-core | original interfaces: **96 / 91 / 5** (the B3 numbers). Converted: **96 / 83 / 13** = the same 5 + **8 new**, all `should pass basic function` array asserts on `$test.FIELDS` / `$mgr.FIELDS` (`- Expected -8 / + Received +8`: the same names, different order). With `declare`: identical. Transformer specs (incl. `checkAllKeys` and `$HEAD` reduce) pass |
| J-X8 | `jx7/ta/src/b4-parity.ts` compiled and run: for each of the 12 registry entries `fieldsOf(<class>, q)` vs `fieldKeys.<entry>()` | Raw sets: 8 entries equal; 3 differ only by undecorated view fields — `callbackModel` (`$request`), `mockTestModel` (`Model, $mock, $mocks, $identity`), `searchQueryModel` (`Query`); spec-only entries map to `CoreModel` and are equal. **After `filterFields`: all 12 equal as sets.** The 7 module constants (`$FIELD.mock/test`, `$HEAD.mock/test`, `$FIELD.callback`, `$HEAD.callback`, search `FIELDS`) are **set-equal, order-different** (example `$HEAD.mock`: `stereo,id,name` vs `id,name,stereo`) |
| J-X10 | `jx4` builds, `Object.keys(new X())` | legacy ES2024 / ES2022: `CoreModel` 16, `MockModel` 19 (includes the undecorated `$mock`); legacy **es6: 0**; standard (any target, polyfilled): 16 / 19 — TS's standard-decorator emit defines the fields even at es6 |

J-X9 (`defineFields` helper) was not run.

## 7. Design-relevant findings

1. **Store on the class, not in the module.** Only the `Symbol.for` attachment survives the CJS/ESM double load (J-X6). This matters in practice: `<lemon-model>` is a true dual package (separate ESM files), `<lemon-core>` requires its CJS build, and an ESM consumer that imports `lemon-model` directly gets the ESM copy [measured: two distinct `CoreModel` classes]. `instanceof CoreModel` is unreliable for the same reason; the design must not rely on it.
2. **Inheritance.** Keep one own list per class and merge along the prototype chain at read time (J-X4 mixed case works this way). This avoids copying the parent list and also merges a legacy-compiled parent with a standard-compiled child. If the copy-on-first-write draft of J § 3 is used instead, it cannot merge across the two stores.
3. **Order.** Declaration order is stable across legacy/standard, all targets, and CJS/ESM [measured]. But it is **parent-first**; the generator emits **own-first, then bases in `extends` order**. The two cannot match in general (multi-interface `extends` has no class equivalent). Consumers that compare arrays break: 8 templates-api tests (J-X7) and, if the lemon-core spec models are converted, `abstract-service.spec.ts:170-175`. `listProjections` sorts by default; whitelist and `.meta` folding use inclusion only.
4. **Name collisions.** A redeclared name keeps the parent position; the child options win (`{group:'head'}` on a redeclared `stereo` puts it into the head list). Under `useDefineForClassFields` (lemon-core ES2024, or any consumer that raises its target to ES2022+), redeclaration without `declare` is TS2612; `declare` works only with legacy decorators (J-X7). So a head group over inherited fields means "redeclare with `declare` + `@field({group:'head'})`" in legacy mode, and is impossible in standard mode.
5. **`kind` / `group` actually needed.** `group: 'head'` replaces the `MockHead`/`TestHead`/`CallbackHead` registry entries. `kind` is needed only on `CoreModel`: `$` = `view`, `id`/`_id` = `internal` → L1 14 = `fieldsOf(CoreModel, {kinds: ['view','data']})`, L2 16 = `fieldsOf(CoreModel)` (J-X5 measured both). Consumer view fields (`$request`, `Model`, `$mock`, `Query`, …) need no kind: leaving them undecorated already reproduces `filterFields` (J-X8). The `filterFields` regexes (§ 1.5) can stay as they are for B4 (S-102 is out of scope).
6. **Missing decorators are silent.** J-X10 shows `Object.keys(new X())` lists every declared field only under define semantics (ES2022+ or standard decorators), and it also lists undecorated view fields. An `assertDecorated(cls, {ignore})` spec helper therefore needs an explicit ignore list and does not work for es6 legacy builds (templates-api today).
7. **`Symbol.metadata` polyfill.** Needed only for standard mode. Node 24.20 has none. It must run before the first decorated class is evaluated; the top of the lemon-model `fields` module satisfies that, because every model file imports `field` from it (J-X1/J-X4 measured with exactly that placement). It is a global mutation (`Symbol.metadata ??= Symbol.for('Symbol.metadata')`); `Symbol.for` keeps two module copies consistent.
8. **No metadata needed.** Field names come from the decorator key; `emitDecoratorMetadata` output (J-X3) is unused. Do not depend on `reflect-metadata`.
9. **Class shape rule.** `CoreModel` must stay "public optional fields only" (no methods, no private members), or the object literals typed as `CoreModel` (§ 4) and the `interface X extends CoreModel` in consumers stop compiling.

## 8. Baseline gates on the untouched worktrees [measured]

| repo | command | result |
| --- | --- | --- |
| lemon-core | `npm run build` | exit 0; `gen-esm-wrapper: … 135 named + default`, `testing.mjs: 10 named` (`lemon-fields gen — 3 entries`) |
| lemon-core | `npm run api:check` | exit 0; `base=304 current=294 added=11 removed=21 allow=32 not-allowed=0` |
| lemon-core | `npm run esm:smoke` | exit 0; `esm-smoke: ok names=136 subpaths=4` |
| lemon-core | `npm test < /dev/null` | `Test Files 4 failed \| 48 passed (52)`, `Tests 4 failed \| 497 passed (501)`; failures: `engine.spec doReportError() - account id`, `encodeIdentityJWT and verifyToken tests` × 3 (`lambda-sns/sqs/web-handler.spec.ts`) — the expected 4 |
| lemon-core | `env -i PATH=$PATH HOME=$HOME node scripts/aws-lazy-probe.cjs` (line 1) | `dist/index import: total=265 @aws-sdk=0 @smithy=0 @aws-crypto=0 @aws=0` |
| lemon-core | `node scripts/dup-decls.cjs` | `files=84 decls=356 dup-names=5 not-allowed=0 b3-names=21 b3-not-single=0` |
| lemon-core | `node scripts/l1l2-probe.cjs` | `checks=28 fails=0 root-keys=136` |
| templates-api | `npm run build` | **exit 2**: 5 TS errors (`OS2SearchParams`/`OS2BaseOption` not exported, `synchronizeContents` missing on `Elastic6Instance`, 1 implicit any) — `lemon-core` resolves to the **registry 4.3.0** copy, while the v5 sources need v5 names |
| templates-api | `npm test` (registry 4.3.0) | `Test Suites 12 failed, 4 passed, 16`; `Tests 19 passed, 19` (failed suites do not compile) — **not** 96/91/5 |
| templates-api | `jest` in the scratch copy with `lemon-core` → `<lemon-core>` (link equivalent) | `Tests 5 failed, 91 passed, 96 total`; `Suites 6 failed, 10 passed, 16` — the B3 numbers and names |
| lemon-model | `npm test` | 20 suites / 285 tests pass |
| lemon-model | `npm run test:package-exports` | `package exports smoke test passed` (TS 4.7.4) |
| lemon-model | `npm run lint` (run as `tsc --noEmit` + `eslint` **without `--fix`**, to keep `src` untouched) | `tsc` exit 0. Plain `eslint` **fails in the worktree**: `.eslintrc.js` has no `root: true`, so ESLint also loads the main checkout's `.eslintrc.js` two levels up and cannot find `@typescript-eslint/eslint-plugin` there. With `--no-eslintrc -c .eslintrc.js`: 0 errors, 53 warnings |

## 9. Risks, contradictions, process facts

### 9.1 Contradictions with SPEC § 5.1 / J / G (measured)

1. **§ 5.1 "devkit devDependency 삭제"** contradicts D33 and is false in practice: removing it fails 26/52 lemon-core test files (§ 5.1). Only the `fields:*` scripts, the `build`/`test:watch` pre-steps and the generated file go. templates-api must also keep devkit (§ 5.2).
2. **SPEC excludes standard decorators but § 5.1 asks for a "dual-mode" `field()`.** The standard half only works with the `Symbol.metadata` polyfill and never under lemon-core's vitest (Oxc passes decorators through, J-X2). The dual mode is testable with tsc only.
3. **§ 5.1 완료 판정 "`fieldsOf`와 생성물의 필드 집합이 같다"** holds only after `filterFields` (or with view fields excluded): raw sets differ for 3 entries (J-X8). Order differs for every multi-level model.
4. J § 4 K1 "lemon-core `CoreModel` 19곳" — confirmed 19 `extends` (+ 3 in specs); 0 new type errors (§ 4).
5. J/G "templates 13 entries", "guard blocks 3" → now 12 entries and 2 `checkAllKeys` blocks (B3 deleted `view/transformer.spec.ts`).
6. J sources "lemon-model develop(1.2.4), TS 설치본 없음" → develop is **1.5.1** (= npm `latest`), TS 4.7.4 installed.
7. Coordinator premise "lemon-model has no `v5` branch" → the clone's ref files now contain `refs/heads/v5` and `refs/remotes/origin/v5`, created 01:34 today, both at the `develop` tip (same commit as `feat/v5-b4-field-annotation`). Read from ref files, no git command.
8. Coordinator premise "templates-api 96/91/5 with the registry lemon-core 4.x" → with 4.3.0 the v5 tree does not compile (§ 8); 96/91/5 needs a v5 lemon-core link.
9. G problem 1 (format drift) is live: `npm run build` turns the committed registry (`39adf249…`) into the raw form (`bf38c1b4…`). B4 deletes the file, so the problem ends with it.

### 9.2 Other risks

- **Bumping lemon-model widens the lemon-core root.** `cores/index.ts:13` `export * from 'lemon-model'`: going from 1.1.1 (32 names, 2 runtime) to develop 1.5.1 adds **179 names (52 runtime)** to the lemon-core root, plus the 5–8 B4 names; no collision with existing lemon-core root names [measured: `lm-names.cjs`]. `api:check` will report them as added (not-allowed until allowlisted) and `esm:smoke`'s name count changes. SPEC § 5 does not mention this.
- **Two copies of lemon-model are normal** (lemon-core's and the consumer's own declaration, baseline.md § 2.1; dual CJS/ESM). The `Symbol.for` key must stay stable across versions (`…:v1` in the key; never change `FieldSpec` incompatibly).
- **Order-sensitive specs:** 8 in templates-api (`mock/service.spec.ts:71,73`, `service/backend-service.spec.ts:87,89`, `service/backend-proxy.spec.ts:45`, `callback/service.spec.ts:70,72` and the other suites that repeat the `$test.FIELDS` check); lemon-core `abstract-service.spec.ts:170-175`.
- **Target raise:** any consumer that moves to ES2022+ gets TS2612 on every narrowed redeclaration unless it uses `declare` (legacy only).
- **TS default:** a new TS 5 project has `experimentalDecorators` off → the standard path → needs the polyfill, and vitest(Oxc) cannot run it.

### 9.3 Process facts for the coordinator

- lemon-core `npm ci` installs `lemon-model` from the lockfile: **1.1.1 registry tarball**. `^1.1.1` would accept 1.5.1 on a fresh install, but the lockfile pins 1.1.1. A B4 lemon-core needs a lemon-model that exports `field`/`fieldsOf` and the class `CoreModel`. For CI/`npm ci` to work that version must be **published** and the range + lockfile bumped (e.g. `^1.6.0`). `npm link` and `file:../lemon-model` only work on a machine with sibling checkouts; a git dependency (`github:…#v5`) would build through lemon-model's `prepare` but ties CI to GitHub access and devDependency installs. A prerelease with a non-`latest` dist-tag (e.g. `1.6.0-v5.0` on `next`) unblocks CI without moving `latest`.
- templates-api declares `lemon-model` itself (`^1.1.1`) and imports `field`/`fieldsOf` from it after B4 → the same bump there. Its v5 tree already depends on an unpublished lemon-core v5 (§ 8), so its CI is already link-only for v5.
- The lemon-model change is additive at the type level (0 new errors in lemon-core, 0 in templates-api es6, 285/285 lemon-model tests) [measured].

## Contradictions / owner decisions

Contradictions: § 9.1 items 1, 2, 3 change SPEC § 5.1 text; items 5–9 are stale counts or premises (no decision needed).

Owner (value) decisions — minimal:

1. **lemon-model release for B4** (an outward publish). Options: minor `1.6.0` from develop + B4, or major `2.0.0`, published as a prerelease on a non-`latest` tag first. **Recommendation:** `1.6.0` prerelease on `next`, then `1.6.0` — the change is additive by measurement (§ 9.3).
2. **lemon-core root surface after the lemon-model bump** (179 new names through `export *`). Options: keep `export *` and allowlist the new names, or switch `cores/index.ts:13` to explicit named re-exports (the v4 32 names + the B4 field API). **Recommendation:** explicit named re-exports, so the root does not grow with every lemon-model feature and `api:check` stays meaningful.
3. **Ship the `Symbol.metadata` polyfill in lemon-model** (global side effect in every consumer process) or make standard mode throw a clear error. **Recommendation:** ship the one-line `??=` polyfill at the top of the `fields` module; without it the "dual mode" of § 5.1 is not real, and a TS 5 default project would throw at class definition.

Not owner decisions (derivable; recommendation recorded): keep `lemon-devkit` in both repos (D33, measured); field order = parent-first with order-sensitive specs updated or compared as sets; head groups via `declare` + `@field({group:'head'})`; `kind` only on `CoreModel`; store on the class with `Symbol.for` and merge along the chain; keep `filterFields` unchanged in B4.

## Artifacts in `<scratch>/b4/`

| path | what |
| --- | --- |
| `lc-field-registry.orig.ts`, `ta-field-registry.orig.ts` | start copies of the two registries (restore source; both `diff` empty at the end) |
| `gates/lc-gates.sh` → `lc-build.txt`, `lc-api-check.txt`, `lc-esm-smoke.txt`, `lc-aws-lazy.txt`, `lc-dup-decls.txt`, `lc-l1l2.txt`, `lc-test.txt` | § 8 lemon-core gates |
| `gates/ta-lm-gates.sh` → `ta-build.txt`, `ta-test.txt`, `lm-test.txt`, `lm-pkg-exports.txt`; `lm-lint-nofix.txt`, `lm-eslint-nofix.txt`; `*-ls-before.txt` | § 8 templates-api / lemon-model gates and the top-level listings used for cleanup |
| `lc-coremodel-refs.txt` | § 4 grep of non-spec `CoreModel` lines |
| `lib/field.ts`, `lib/models.ts` | dual-mode helper and test models shared by J-X1..J-X4 |
| `oxc-dump.mjs` | Oxc transform dump (Vite 8 call) |
| `jx3/` (`result-*.json`, `models.oxc.js`, `run-*.log`) | J-X3 legacy under vitest |
| `jx2/` (same files) | J-X2 standard under vitest |
| `jx4/` (`run.cjs`, `jx4-results.txt`, `src-mix/`, `mix-run.cjs`, `mix*.log`, `out-*`) | J-X1, J-X4, J-X10, mixed legacy/standard, `declare` checks |
| `jx5/lemon-model/`, `jx5/{tsc-noemit,build,pkg-exports,jest}.log`, `jx5/cjs-esm.mjs`, `jx5/cjs-esm.json`, `jx5/core-storage.orig.ts`, `jx5/lc-check/` | J-X5 lemon-model scratch (class `CoreModel`) and the lemon-core compatibility typecheck |
| `jx6/lemon-model-weakmap/`, `jx6/cjs-esm-weakmap.json`, `jx6/cjs-esm-symbolfor.json` | J-X6 WeakMap vs `Symbol.for` |
| `jx7/ta` (converted), `jx7/ta-orig`, `jx7/ta-declare`, `jx7/orig-models/`, `jx7/*.log`, `jx7/run-jest.sh`, `jx7/jest-*.log` | J-X7 typecheck (TS 4.7.4 / 5.9.3, es6 / ES2022) and jest runs |
| `jx7/ta/src/b4-parity.ts`, `jx7/jx8-parity.json` | J-X8 parity |
| `jdev/lc`, `jdev/vitest-nodevkit.log` | § 5.1 devkit removal experiment |
| `lm-names.cjs`, `lc-root-names.txt` | § 9.2 lemon-model name growth and collision check |
