# lemon-core v5 B3 (L1/L2 integration) — measured inventory

- Trees: `<lemon-core>` = the B3 lemon-core worktree (branch `feat/v5-b3-l1-l2`, v5 `4e46d0dc`). `<templates-api>` = the B3 templates-api worktree (branch `feat/v5-b3-l1-l2`, v5 `6aa50073`; its `node_modules/lemon-core` is the registry 4.3.0 copy).
- `<scratch>` = the investigator's scratch folder (outside the repo, not committed). Scripts and raw outputs are in `<scratch>/b3/`.
- Tags: **[measured]** = a command or script was run and its output is quoted. **[code]** = read from source (file:line).
- No git command was run. No file under `<lemon-core>/src` or `<templates-api>` was edited. The only write into `<lemon-core>` outside `dist/` is the `field-registry.ts` restore in § 10.
- Line numbers are on the current tree (after B2-c). They differ from the M1 doc A line numbers (example: L1 `sourceToItem` is now `extended/abstract-service.ts:1155`, not `:1260`).

## 1. Duplicate pairs

Method: a TS-AST scan of every top-level `export` declaration in non-spec `src/**/*.ts` (82 files, 377 declarations), grouped by name (`<scratch>/b3/dup-decls.cjs` → `dup-decls.txt`, `decls-all.tsv`). Behaviour probes run against the built `dist/` (`probe-T.cjs`, `probe-dups.cjs`). [measured]

### 1 (a) Types 13 — `helpers/types.ts` (L1, 237 lines) vs `extended/cores/types.ts` (L2, 255 lines)

`diff helpers/types.ts extended/cores/types.ts`: 4 hunks, 2 lines `<`, 20 lines `>` (`<scratch>/b3/diff-types.txt`). [measured]

| name | L1 | L2 | difference |
| --- | --- | --- | --- |
| `IdentityTokenSite` | `helpers/types.ts:20` | `extended/cores/types.ts:20` | none |
| `IdentityTokenUser` | `:28` | `:28` | none |
| `IdentityTokenGroup` | `:40` | `:40` | none |
| `IdentityToken` | `:53` | `:53` | L2 adds **required** `cid: string` (`:64`) and optional `did?: string` (`:103`). Both keep the `@deprecated iid?` field (L1 `:103`, L2 `:117`) |
| `ListResult` | `:122` | `:136` | `aggr?: R[]` (L1 `:147`) vs `aggr?: R \| R[]` (L2 `:161`) |
| `AggrKeyCount` | `:150` | `:168` | none |
| `PaginatedListResult` | `:160` | `:178` | none in its own body; inherits the `aggr` difference through `extends ListResult` |
| `ListParam` | `:170` | `:188` | none |
| `PaginateParam` | `:187` | `:205` | none |
| `BulkUpdateBody` | `:209` | `:227` | none |
| `BulkBody` | `:219` | `:237` | none |
| `BodyList` | `:226` | `:244` | none |
| `BulkItemsResult` | `:233` | `:251` | none |
| `AggrResult` | — | `:164` | L2 only. At the root via `export *` (§ 2). References in lemon-core: 0 [measured: `refs.cjs`] |
| re-export of `CoreModel`, `View`, `Body` | `export { … }` `:17` | `export type { … }` `:17` | same lemon-model symbols; not a collision (§ 2) |

- Count: exactly 13 duplicated type names. 11 have text-identical bodies. 2 differ (`IdentityToken`, `ListResult`). This matches SPEC § 4.1 "타입 13종" and M1 doc B § 2-1. [measured]
- Both sides are plain `export interface` (not `export type`). Only the `CoreModel/View/Body` re-export line differs in `export` vs `export type`. [code]

### 1 (b) `$T` — `helpers/helpers.ts:97-498` (L1, 402 lines) vs `extended/cores/commons.ts:97-205` (L2, 109 lines)

Structure [code]: L2 is not an independent copy. It is `export const $T = { ..._T, <overrides> }` with `import { $T as _T } from '../../helpers/'` (`extended/cores/commons.ts:20`, `:97-98`). The root `$T` is the L2 object (`root.$T === L2.$T` → `true`). [measured]

Runtime member table (`probe-T.cjs`, `Object.keys` on `dist/helpers/helpers` and `dist/extended/cores/commons`): **L1 31 members, L2 32 members** — SPEC § 4.1 numbers confirmed. [measured]

| member | L1 | L2 | same function object? | text identical? | behaviour |
| --- | --- | --- | --- | --- | --- |
| `S` | yes | yes | yes (spread) | — | same |
| `S2` | yes | yes | no (override) | no | **differs**: L2 `(v, def)` ignores a 3rd `delim` argument and always collapses whitespace to one space. `S2('a b  c','','-')` → L1 `a-b-c`, L2 `a b c` |
| `SS` | yes | yes | no (override) | no | **differs**: L2 `(v)` ignores `def` (`SS(null,['x'])` → L1 `["x"]`, L2 `[]`; same for `''` and `[]`); L2 collapses inner whitespace of array items (`SS([' a  b '])` → L1 `["a  b"]`, L2 `["a b"]`) |
| `P` | yes | yes | yes | — | same |
| `N` | yes | yes | no (override) | no | same behaviour (L2 calls L1 `N`; only the parameter type widens to `unknown`) — 6 probes same |
| `NN`, `F`, `FF`, `F3` | yes | yes | yes | — | same |
| `B`, `BN` | yes | yes | no (own copy) | yes | same (4 probes for `B`) |
| `T`, `D`, `DT`, `EX`, `simples`, `catch`, `merge`, `template`, `makeRandomCode` | yes | yes | yes | — | same |
| `clear` | yes | yes | no (own copy) | yes | same |
| `nul2str` | yes | yes | no (override) | no (`$T.S` vs `_T.S`) | same (4 probes) |
| `normal`, `asMap` | yes | yes | yes | — | same |
| `asLut`, `asMeta` | yes | yes | no (own copy) | yes | same |
| `diff`, `perf`, `parseMeta` | yes | yes | yes | — | same |
| `onlyDefined` | yes | yes | yes — both are the `common/test-helper.ts:58` function | — | same |
| `reduceAggr` | yes | yes | no (own copy) | yes | same (1 probe) |
| `US` | — | yes | — | — | L2 only (dedupe string array) |

Totals [measured]: 21 members are the L1 function object reused by spread. 11 are defined in L2: 10 overrides (`S2`, `SS`, `N`, `B`, `BN`, `clear`, `nul2str`, `asLut`, `asMeta`, `reduceAggr`) + 1 addition (`US`). Of the 10 overrides, 2 change behaviour (`S2`, `SS`) and 8 do not. This matches M1 E-52 ("8 members behave the same").

- Inside the L1 `$T` body, the only self-call that an override would capture is `SS → $T.S2(_)` with one argument (`helpers/helpers.ts:112`). With one argument L1 and L2 `S2` agree. So merging all 32 members into one object does not change the 21 spread members. [code]
- E-54 confirmed on both sides: `S2('', 'x')` returns `''`, not `'x'`. [measured]

### 1 (c) `parseListParam` / `parsePaginateParam`

- L1 `helpers/helpers.ts:53-58` / `:63-92`. L2 `extended/cores/commons.ts:52-57` / `:62-91`. [code]
- `diff`: 4 changed lines per side, all `$T.` → `_T.` (`<scratch>/b3` command in § Artifacts). L2 `_T` **is** L1 `$T`, and the remaining `$T.N` calls in L2 (`:75`, `:80-81`) hit L2 `N`, which delegates to L1 `N`. [measured + code]
- Probe: 11 inputs (empty, whitespace sort, bad limit, default limit, boolean limit, page, offset, `limit:-1`, page beyond `MAX_LIMIT`, options) → **0 differences**. [measured]

### 1 (d) `onlyDefined` — `common/test-helper.ts:58-64` vs `extended/cores/commons.ts:40-46`

- Bodies are **text-identical** (`diff` of the two 7-line ranges is empty). Same signature `(N)`. No `$def` parameter on either side. [measured]
- Probe, 12 inputs: flat object, nested object (nested `undefined` kept — first level only), array (`[1,undefined,3]` → `{"0":1,"2":3}`), `null`/`''` values kept, `null`, `undefined`, `''`, `0`, `'x'` → all `null`; `{}` → `{}`; `Date` → `{}`; a 2nd argument is ignored → **0 differences**. [measured]
- Identity: root `onlyDefined` === test-helper copy; L1 `$T.onlyDefined` and L2 `$T.onlyDefined` are both the test-helper copy. [measured]
- The pin comment `src/index.ts:40` ("signature compat (`(N, $def)`)") does not match the code — there is no `$def` in either version. `HOW_TO_UPGRADE_V4.md:177` says `onlyDefined`/`sourceToItem` are "not exported at root"; they are (L1 pins). [code]

### 1 (e) `sourceToItem` — `extended/abstract-service.ts:1155-1162` vs `extended/cores/abstract-services.ts:2450-2457`

- Bodies identical. Only the signature text differs: `idName: string = '$id'` vs `idName = '$id'` (same inferred type). [code]
- Probe, 8 inputs (`$id`, custom id, no id, `null`, `undefined`, existing `_id`, array, string) → **0 differences**. [measured]
- References: L1 1 internal call (`extended/abstract-service.ts:1114`, inside `AbstractOS2Instance`) + root pin. L2: **0 references anywhere** (not even inside `abstract-services.ts`). [measured: `refs.cjs`]

### 1 (f) `Filter` / `marshal` — `common/test-helper.ts:128-166` vs `cores/config/config-service.ts:30-68`

- 42-line ranges text-identical (`diff` empty). Probe 2 inputs → same. [measured]
- The config-service copy is not on the root (no barrel re-exports `config-service.ts`; `cores/config/index.ts:13` imports only `MyConfigService`). Root `Filter`/`marshal` = test-helper. [code + measured: `root-pins.cjs`]
- Config copy users: `config-service.ts:170,173` (internal) and `config-service.spec.ts:18`. Test-helper copy users: `test-helper.spec.ts:13` only (non-spec 0). [measured: `import-map.tsv`]

### 1 (g) Every other exported name defined in ≥2 non-spec files [measured: `dup-decls.txt`, 25 names total]

| name | locations | L1/L2? | root |
| --- | --- | --- | --- |
| the 13 types, `$T`, `parseListParam`, `parsePaginateParam`, `onlyDefined`, `sourceToItem`, `Filter`, `marshal` | § 1 (a)–(f) | yes | § 2 |
| `ConfigService` (type alias of `CoreConfigService`) | `cores/config/config-service.ts:25`, `cores/lambda/lambda-handler.ts:31` | no (both L1) | root = lambda-handler copy (via `cores/lambda/index.ts:16`); identical alias |
| `buildResponse`, `success`, `failure`, `notfound` | `cores/lambda/lambda-web-handler.ts:108,147,155,151`, `cores/lambda/lambda-wss-handler.ts:17,35,43,39` | no (both L1) | root `success`/`failure` = web copy (`cores/lambda/index.ts:24`); `buildResponse`/`notfound` not at root. The wss copies are older, different bodies (no options, no CORS headers) |

- Non-exported duplicates (not in the table): `ElasticParams`/`ElasticSearchParams` interfaces in `cores/elastic/elastic6-service.ts:102,122` and `extended/cores/abstract-services.ts:1595,1614`; local `_B`/`BoolFlag` in both `helpers.ts:35-42` and `commons.ts:26-34`. [code]

## 2. Root export structure (`src/index.ts`)

Method: TS checker on `src/index.ts`; for every `export *` source, the exported names and their final declarations; then collisions and pins (`root-pins.cjs` → `root-pins.txt`). [measured]

### 2.1 Star sources

| line | source | names |
| --- | --- | --- |
| 15 | `./common/types` | 5 |
| 16 | `./common/test-helper` | 11 (incl. `Filter` type) |
| 17 | `./engine/` | 30 |
| 18 | `./cores/` | 168 (incl. lemon-model re-export) |
| 19 | `./tools/` | 10 |
| 20 | `./controllers/` | 4 |
| 34 | `./helpers/` | 31 |
| 35 | `./extended/` | 14 |
| 38 | `./extended/cores/` | 46 |

Root total: **294 names** (= `api:names` output). [measured]

### 2.2 Named exports in `src/index.ts` (22 names on 7 lines)

| line | names | collision it resolves | winner (root resolves to) | hidden copy |
| --- | --- | --- | --- | --- |
| 33 | `lib`, `tools` (namespaces) | none | — | — |
| 39 | `$T` | `./helpers/` (L34) vs `./extended/cores/` (L38) | L2 `extended/cores/commons.ts:97` | L1 `helpers/helpers.ts:97` |
| 40 | `onlyDefined` | `./common/test-helper` (L16) vs `./extended/cores/` (L38) | L1 `common/test-helper.ts:58` | L2 `extended/cores/commons.ts:40` |
| 41 | `sourceToItem` | `./extended/` (L35) vs `./extended/cores/` (L38) | L1 `extended/abstract-service.ts:1155` | L2 `extended/cores/abstract-services.ts:2450` |
| 42 | `withBrowserCache` | none (not in the L2 barrel) | `extended/cores/browser-cache.ts:14` | — |
| 43 | `$ES6Routed` | none (also exported by L38 star; same symbol) | `extended/cores/abstract-services.ts:2556` | — |
| 50-64 | 13 types (`export type {}`) | `./helpers/` (L34) vs `./extended/cores/` (L38), each | L2 `extended/cores/types.ts` | L1 `helpers/types.ts` |
| 66 | `parseListParam`, `parsePaginateParam` | L34 vs L38 | L2 `extended/cores/commons.ts:52,62` | L1 `helpers/helpers.ts:53,63` |

- **Collision pins today: 18, not 19.** `$T` 1 + types 13 + parse 2 + `onlyDefined` 1 + `sourceToItem` 1. The 19th (root `$ES6`) was removed in B2-b. The checker reports one more star "collision", `default` (`engine/index.ts:23` vs `cores/index.ts:34`), but `export *` never re-exports `default`, so it is not a pin case. [measured]
- 6 names come from more than one star with the **same** symbol (no conflict). Among them `CoreModel`/`View`/`Body` (lemon-model through both type files and `cores/`) and `$ES6Routed`. [measured]
- Rule "루트에서 지금 보이는 쪽이 이긴다" per name: L2 wins for `$T`, the 13 types, `parseListParam`, `parsePaginateParam`; L1 wins for `onlyDefined`, `sourceToItem`. Because the `onlyDefined`/`sourceToItem`/parse/`Filter`/`marshal` pairs are identical (§ 1), the winning side only decides the **file** that keeps the definition, not behaviour. Only `$T` (`S2`/`SS`) and the 2 types (`IdentityToken`, `ListResult`) carry behaviour or shape. [measured]

### 2.3 Effect of deleting the losing copies on the root names [measured: simulation]

Simulation in a scratch copy (`<scratch>/b3/sim/`, `sim-apply.cjs`; `node_modules` symlinked): (a) `helpers/types.ts` → `export * from '../extended/cores/types'`; (b) L1 `parseListParam`/`parsePaginateParam` deleted; (c) L2 `onlyDefined` replaced by a re-export of the test-helper one; (d) L2 `sourceToItem` replaced by a re-export of the L1 one; (e) config-service `Filter`/`marshal` replaced by imports from test-helper; (f) all pins except `$T` removed. `$T` was left as is.

- `tsc` exit 0. `api-names` 294 → 294, `diff` empty (**no name appears or disappears, no kind change**). Runtime `Object.keys(require('dist/index'))` 136 = 136, identical lists. The only star collision left is `$T`. [measured]
- Deep-path side effect in the same simulation: `dist/helpers/helpers` no longer has `parseListParam`/`parsePaginateParam` (`undefined`). `dist/extended/cores` still has `onlyDefined` and `sourceToItem` (re-exports). [measured]
- For `$T`: if the 21 spread members move into the single definition, the root object keeps 32 keys (§ 1 (b)). If instead L1 won, the root would lose `$T.US` (templates-api uses it in a spec, § 4) and the types would lose `cid`/`did`/`AggrResult`. [code]

### 2.4 Deep paths that reach a losing copy today [measured: `require()` self-reference through the `exports` map]

| specifier | resolves | duplicated names it exposes |
| --- | --- | --- |
| `lemon-core/dist/helpers/types` | yes (`./dist/*`) | L1 13 types (types only, 0 runtime keys) |
| `lemon-core/dist/helpers/helpers` | yes | L1 `$T`, `parseListParam`, `parsePaginateParam` (15 runtime keys) |
| `lemon-core/dist/helpers/index` | yes | same as above |
| `lemon-core/dist/helpers` | **no** (`MODULE_NOT_FOUND`, directory paths blocked since B1) | — |
| `lemon-core/dist/common/test-helper` and `lemon-core/testing` | yes | `onlyDefined`, `marshal`, `Filter` (10 runtime keys) |
| `lemon-core/dist/extended/cores` (explicit entry) | yes | L2 `$T`, `onlyDefined`, `sourceToItem`, parse×2, 13 types |
| `lemon-core/dist/extended/cores/commons` | yes | L2 `$T`, `onlyDefined`, parse×2 |
| `lemon-core/dist/extended/cores/types` | yes | L2 types |
| `lemon-core/dist/extended/cores/abstract-services` | yes | L2 `sourceToItem` |
| `lemon-core/dist/extended/abstract-service` | yes | L1 `sourceToItem` |
| `lemon-core/dist/cores/config/config-service` | yes | config `marshal`, `Filter` |

- `package.json` `exports` lists `./testing` → `dist/common/test-helper` and `./dist/extended/cores` explicitly; `scripts/gen-esm-wrapper.cjs:32-33` generates `dist/esm/index.mjs` and `dist/esm/testing.mjs` from `dist/index.d.ts` and `dist/common/test-helper.d.ts`; `scripts/esm-smoke.mjs:55-57` checks the subpaths `dist/environ`, `dist/extended/cores`, `dist/cores/lambda/lambda-web-handler`. Moving or emptying `common/test-helper.ts` or the L2 barrel changes these. [code]

## 3. Internal consumers (lemon-core)

Method: TS checker resolves every named import in `src/**/*.ts` (spec and non-spec, 1253 rows) to its final declaration (`import-map.cjs` → `import-map.tsv`, filtered in `imports-of-interest.txt`); language-service `findReferences` for call counts (`refs.cjs` → `refs.txt`). [measured]

### 3.1 Importers of each losing copy

| losing copy | non-spec importers (file:line) | spec importers |
| --- | --- | --- |
| L1 types `helpers/types.ts` | `helpers/helpers.ts:30` (`ListParam`, `PaginateParam` only). The other 11 L1 types: 0 references outside `helpers/types.ts` | 0 |
| L1 `$T` `helpers/helpers.ts:97` | `extended/abstract-service.ts:44` (uses `asMap` `:249`, `S` `:294`,`:829`, `diff` `:635` — all spread members, same behaviour), `extended/cores/commons.ts:20` (as the spread base). Self-uses in `helpers.ts` after the `$T` body: `B` ×1, `N` ×6, `onlyDefined` ×1 | `helpers/helpers.spec.ts:16` |
| L1 `parseListParam` | none outside `helpers.ts` (used once by L1 `parsePaginateParam` `:71`) | 0 |
| L1 `parsePaginateParam` | none | `helpers/helpers.spec.ts:16` (12 refs) |
| L2 `onlyDefined` `extended/cores/commons.ts:40` | `extended/cores/abstract-rest-apis.ts:17`, `extended/cores/abstract-services.ts:79` (19 refs incl. commons self-use) | 0 |
| L1 `onlyDefined` `common/test-helper.ts:58` | `helpers/helpers.ts:24`, `tools/tools.ts:23`, `cores/protocol/aws-lambda-helper.ts:2`, `cores/lambda/lambda-web-handler.ts:31`, `extended/abstract-service.ts:43`, `extended/cores/abstract-controllers.ts:38` (6 files, 18 refs) | `tools/tools.spec.ts:14` |
| L2 `sourceToItem` | 0 | 0 |
| config `Filter`/`marshal` | `config-service.ts:170,173` (same file) | `cores/config/config-service.spec.ts:18` |
| test-helper `Filter`/`marshal` | 0 | `common/test-helper.spec.ts:13` |
| test-helper `GETERR` | 13 files | 30 files |
| test-helper `NUL404` | `controllers/general-api-controller.ts:15`, `cores/storage/proxy-storage-service.ts:15`, `extended/abstract-service.ts:43`, `extended/cores/abstract-services.ts:51` | `common/test-helper.spec.ts:13` |

### 3.2 Non-spec files that import the test harness `common/test-helper.ts` — **18** (A § 3.2 confirmed) [measured: `testhelper-nonspec-importers.txt`]

| file:line | names |
| --- | --- |
| `controllers/general-api-controller.ts:15` | `NUL404` |
| `controllers/general-controller.ts:14` | `GETERR` |
| `cores/aws/aws-kms-service.ts:24` | `GETERR` |
| `cores/aws/aws-s3-service.ts:25` | `GETERR` |
| `cores/aws/aws-sns-service.ts:19` | `asErrorPayload` |
| `cores/elastic/elastic6-service.ts:19` | `GETERR`, `waited` |
| `cores/lambda/lambda-handler.ts:27` | `GETERR` |
| `cores/lambda/lambda-web-handler.ts:31` | `GETERR`, `onlyDefined` |
| `cores/protocol/aws-lambda-helper.ts:2` | `onlyDefined` |
| `cores/storage/proxy-storage-service.ts:15` | `GETERR`, `NUL404` |
| `environ.ts:25` | `GETERR` |
| `extended/abstract-service.ts:43` | `GETERR`, `NUL404`, `onlyDefined` |
| `extended/cores/abstract-controllers.ts:38` | `onlyDefined` |
| `extended/cores/abstract-services.ts:51` | `GETERR`, `GETERR$`, `NUL404`, `waited` |
| `helpers/helpers.ts:24` | `GETERR`, `onlyDefined` |
| `lib/http-fetch.ts:12` | `GETERR` |
| `tools/express.ts:27` | `GETERR` |
| `tools/tools.ts:23` | `onlyDefined` |

- Names used by non-spec code: `GETERR` 13, `onlyDefined` 6, `NUL404` 4, `waited` 2, `GETERR$` 1, `asErrorPayload` 1. `expect2`, `_it`, `environ`, `marshal`, `Filter`: non-spec 0. Spec importers of the harness: 45 files. [measured]
- `extended/cores/abstract-controllers.ts` imports `onlyDefined` from the test harness (`:38`) while its sibling files import the L2 copy (`abstract-services.ts:79`, `abstract-rest-apis.ts:17`). [code]

## 4. External consumers (`<templates-api>`)

Method: TS-AST scan of every named import / `require` of `lemon-core*` in `<templates-api>/src` (`ta-imports.cjs` → `ta-imports.tsv`, 223 rows: 215 from `lemon-core`, 8 from `lemon-core/dist/environ`). [measured]

| name / path | used? | where (file:line) |
| --- | --- | --- |
| `$T` | **yes**, 13 non-spec files + 1 spec | `api/crons-api.ts:23`, `modules/callback/{api-callback.ts:14, proxy.ts:13, transformer.ts:12}`, `modules/mock/{api-mocks.ts:11, api-tests.ts:11, proxy.ts:11, service.ts:12, transformer.ts:11}`, `modules/search/{api-search.ts:15, service.ts:25}`, `service/backend-proxy.ts:12`, `view/transformer.ts:10`; spec `test-helpers/commons.spec.ts:12` |
| `$T` members | N 22, S2 17, S 14, asLut 13, B 9, US 8 (all in `test-helpers/commons.spec.ts:154-160`), BN 5, SS 3, perf 1, nul2str 1 | no 3-argument `S2` and no `SS(…, def)` call found (regex over `src`) |
| 13 types (`IdentityToken*`, `ListResult`, …) | **no** | — (`CoreModel` 3, `Body` 1 — lemon-model symbols, not part of the 13) |
| `parseListParam` | no | — |
| `parsePaginateParam` | spec only | `test-helpers/commons.spec.ts:12` |
| `onlyDefined` | yes | non-spec `modules/callback/api-callback.ts:14`, `modules/callback/proxy.ts:13`; spec `modules/mock/transformer.spec.ts:16`, `service/backend-service.spec.ts:14` |
| `sourceToItem`, `Filter`, `marshal`, `AggrResult` | no | — |
| `GETERR` / `GETERR$` / `NUL404` | yes | non-spec: `GETERR` 4, `GETERR$` 2, `NUL404` 1 (`modules/search/api-search.ts:15`); spec: 4 / 1 / 1 |
| `$X` (consumer copy of `$T`, S-03) | defined in `view/transformer.ts:15-52` (11 members: `S2`, `SS`, `B`, `BN`, `N`, `F`, `clear`, `nul2str`, `asLut`, `asMeta`, `reduceAggr`) | used only by `view/transformer.spec.ts:13` (non-spec consumers 0). `$X.B`/`$X.BN`/`$X.N`/`$X.F` have different semantics from `$T` (return `undefined` on non-number). Built on root `$T` (L2) |
| `isUseSssion` | **yes** | `api/hello-api.ts:64` (`this.service.isUseSssion()`; `BackendService extends MyCoreService`) |
| `@deprecated` members | yes | `isUseSssion` (above); `loadEnviron` as the default import `environ` from `lemon-core/dist/environ` (`express.ts:20`, called `:23`); 3 spec overrides of `fetchIdentityAccess` (`service/backend-proxy.spec.ts:26`, `modules/mock/service.spec.ts:28`, `modules/mock/proxy.spec.ts:28`) |
| deep `lemon-core/dist/...` | only `dist/environ` | `express.ts:20` (default) + 7 specs (`loadProfile`). No deep import of `dist/helpers/*`, `dist/common/*`, `dist/extended/*`, `dist/cores/*` |
| `parrallel` names | yes | `my_parrallel` (`api/crons-api.ts:23`, `modules/mock/proxy.ts:11`), `do_parrallel` (spec `modules/search/service.spec.ts:15`) |
| `CrendentialForAWS` | no | — |

- `<templates-api>` has no `src/cores` copy any more. The only consumer-side copy of the `$T` helpers is `$X`. [measured: `grep -rln '\$X' src`]

## 5. Inheritance map L2 → L1 [measured: `inherit.cjs` → `inherit.txt`, checker-resolved `extends`]

Note: `extended/abstract-service.ts` itself is the older L1-style layer (C1 of doc A). Both levels are listed.

| class (file:line) | extends (file:line) |
| --- | --- |
| `CoreService` `extended/abstract-service.ts:109` | `GeneralKeyMaker` `cores/storage/proxy-storage-service.ts:109` |
| `CoreManager` `extended/abstract-service.ts:164` | `AbstractManager` `cores/storage/model-manager.ts:23` |
| `ManagerProxy` `:393`, `AbstractProxy` `:646`, `OS2Synchronizer` `:918`, `AbstractOS2Instance` `:1037` | — |
| `MyCoreService` `extended/cores/abstract-services.ts:168` | `CoreService` `extended/abstract-service.ts:109` |
| `MyCoreManager` `:244` | `CoreManager` `extended/abstract-service.ts:164` |
| `MyCoreProxy` `:911` | `AbstractProxy` `extended/abstract-service.ts:646` |
| `MyManagerProxy` `:1269` | `ManagerProxy` `extended/abstract-service.ts:393` |
| `OS2Service` `:1635` | `OS2CoreService` `cores/elastic/elastic6-service.ts:291` |
| `OS2Instance` `:2256` | `AbstractOS2Instance` `extended/abstract-service.ts:1037` |
| `AbstractCRUDController` `extended/cores/abstract-controllers.ts:76` | `GeneralWEBController` `controllers/general-controller.ts:102` |
| `DummyRestAPI` `extended/cores/abstract-rest-apis.ts:147` | `RestAPI` `:25` (same file) |

No class under `src/extended/**` extends anything under `src/helpers/**`. [measured]

Shadowed members (same name redefined in the subclass; body text compared after removing comments/whitespace):

| subclass.member | subclass location | base location | body |
| --- | --- | --- | --- |
| `CoreManager.hello` | `extended/abstract-service.ts:180` | `cores/storage/model-manager.ts:53` | differs |
| `CoreManager.prepare` | `:275` | `model-manager.ts:87` | differs |
| `CoreManager.insert` (`@deprecated`) | `:293` | `model-manager.ts:103` | differs |
| `CoreManager.update` | `:318` | `model-manager.ts:141` | differs |
| `CoreManager.updateOrCreate` | `:333` | `model-manager.ts:152` | differs |
| `CoreManager.delete` | `:348` | `model-manager.ts:162` | differs |
| `CoreManager.prepareDefault` | `:364` | `model-manager.ts:68` | differs |
| `AbstractCRUDController.hello` | `extended/cores/abstract-controllers.ts:261` | `controllers/general-controller.ts:122` | differs |
| `MyCoreProxy.register` | `extended/cores/abstract-services.ts:933` | `extended/abstract-service.ts:692` | differs |
| `MyCoreProxy.fetchIdentityAccess` (`@deprecated`, throws `400 NOT SUPPORTED`) | `:964` | `extended/abstract-service.ts:828` | differs |
| `MyManagerProxy.normal` | `:1282` | `extended/abstract-service.ts:471` | differs |
| `MyManagerProxy.mget` | `:1502` | `:512` | differs |
| `MyManagerProxy.mset` | `:1576` | `:588` | differs |
| `OS2Service.createClient` | `:1649` | `cores/elastic/elastic6-service.ts:187` (`OS2ClientService`) | differs |
| `OS2Service.describe` | `:1661` | `elastic6-service.ts:496` | **identical** |
| `OS2Service.createIndex` | `:1696` | `elastic6-service.ts:378` | **identical** |
| `OS2Service.saveItem` / `pushItem` / `readItem` / `deleteItem` / `updateItem` / `searchRaw` | `:1757` / `:1871` / `:1908` / `:1951` / `:1990` / `:2007` | `elastic6-service.ts:535` / `:580` / `:616` / `:659` / `:699` / `:790` | differ |
| `OS2Service.search` | `:2033` | `elastic6-service.ts:825` | **identical** |
| `OS2Instance.elastic` / `query` / `synchronizer` (re-declared fields, no initializer) | `:2257-2259` | `extended/abstract-service.ts:1041-1049` | identical (type narrowing only) |
| `OS2Instance.hello` | `:2298` | `:1058` | differs |
| `OS2Instance.options` (getter) | `:2300` | `:1070` | **identical** |
| `OS2Instance.describeIndex` | `:2312` | `:1095` | **identical** |
| `OS2Instance.search` | `:2319` | `:1122` | differs |
| `DummyRestAPI.hello/read/insert/update/delete` | `abstract-rest-apis.ts:158-184` | `:59-71` | differ (intended stub) |

- Pure duplicate overrides (identical bodies, removable without behaviour change): `OS2Service.describe`, `.createIndex`, `.search`; `OS2Instance.options`, `.describeIndex`. [measured]

## 6. `isUseSssion` and other typos

| item | definition | correct name | consumers |
| --- | --- | --- | --- |
| `isUseSssion()` | `extended/cores/abstract-services.ts:224-226` (`@deprecated` `:222`, returns `this.isUseSession()`) | `isUseSession()` `:216` | lemon-core non-spec 0, spec 0; **templates-api non-spec 1** (`api/hello-api.ts:64`). `isUseSession` refs: `abstract-services.ts:225,1449`, `abstract-controllers.ts:146` |

Out of B3 (SPEC § 4.1), locations only [measured]:

- `parrallel`: identifiers `my_parrallel` (`helpers/helpers.ts:843` = alias of `my_parallel` `:757`, root, 8 non-spec + 12 spec refs; templates-api 2 non-spec), `do_parrallel` (`engine/engine.ts:391` = alias of `do_parallel`, root, 6 non-spec + 12 spec refs; templates-api 1 spec), plus `_parrallel` ×2 and the word in comments. 10 non-spec files contain the string.
- `CrendentialForAWS`: `environ.ts:45` (interface), used `environ.ts:131`, `tools/tools.ts:20,91,93`, `extended/cores/abstract-services.ts:80,2494`. Not at the root (deep `dist/environ` only). templates-api 0.

## 7. `@deprecated` public members (non-spec `src`) — 14 tags [measured: `deprecated.cjs`, `refs.cjs`, grep for templates-api]

| # | member (file:line) | root / deep | lc non-spec refs | lc spec refs | templates-api | candidate |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `Utilities.crypto` (`engine/utilities.ts:750`) | via root `$U` | 0 | 2 (`utilities.spec.ts:114-115`) | 0 | **소비 0** |
| 2-3 | `crypto().encrypt` / `.decrypt` (`:783`, `:796`, inner class of #1) | via #1 | 0 | 3 / 3 (`utilities.spec.ts:117-120`) | 0 | goes with #1 |
| 4 | `loadEnviron` (`environ.ts:90`, also `export default` `:137`) | deep `dist/environ` | 1 (the default export line) | 4 | **1** (`express.ts:20,23` default import) | keep |
| 5 | `credentials` (`environ.ts:131`, always throws) | deep `dist/environ` | 0 | 4 (`environ.spec.ts:13,33-35`) | 0 (only a log string `express.ts:37`) | **소비 0** |
| 6 | `CoreManager.insert` (`extended/abstract-service.ts:293`) | class member | 0 callers | 0 (the `insert` calls in specs are `ModelManager`/`RestAPI`) | 0 | 소비 0, **but** it overrides `AbstractManager.insert` (`model-manager.ts:103`); deleting it switches `CoreManager` instances to the base implementation (behaviour change, invisible to `api:check`) |
| 7 | `AbstractProxy.fetchIdentityAccess` (`:828`) | class member | 2 (`:866` call; L2 override `:964`) | 0 | 3 spec overrides | cluster 7-10 |
| 8 | `AbstractProxy._identity` (`:849`) | protected field | 2 (`:863`, `:867`) | 0 | 0 | cluster |
| 9 | `AbstractProxy.getIdentity$` (`:860`) | class member | 1 (`:888`, from #10) | 0 | 0 | cluster |
| 10 | `AbstractProxy.getCurrentIdentity$` (`:885`) | class member | **0** | 0 | 0 | **소비 0** — removing it leaves 7-9 used only by each other |
| 11 | `MyCoreService.isUseSssion` (`extended/cores/abstract-services.ts:224`) | class member | 0 | 0 | **1** | already K7 |
| 12 | `MyCoreProxy.fetchIdentityAccess` (`:964`, throws) | class member | override of #7 | 0 | 3 spec overrides | cluster |
| 13 | `IdentityToken.iid` (L2 `extended/cores/types.ts:117`) | root type field | 0 | 0 | 0 (templates-api declares its own `iid?` in `service/backend-session.ts:53`) | **소비 0** |
| 14 | `IdentityToken.iid` (L1 `helpers/types.ts:103`) | deep only | 0 | 0 | 0 | goes with L1 types |

- "비spec 14곳" of doc A C26 confirmed (14 `@deprecated` lines). Of these, clean "소비 0" in both repos' non-spec code: #1-3, #5, #10, #13-14; #6 is 소비 0 but not removal-neutral. #4 and #11 have a templates-api consumer. [measured]

## 8. `cores/elastic/` names with ES traces (deferred from B2-b)

| file | lines | exported names [measured] | rename idea (not a decision) |
| --- | --- | --- | --- |
| `elastic6-service.ts` | 1199 | `SearchType`, `SearchResponse`, `OS2BaseOption`, `OS2Item`, `RetryOptions`, `OS2ClientService`, `OS2CoreService`, `$ERROR` | `os2-service.ts` |
| `elastic6-query-service.ts` | 483 | `OS2QueryService` | `os2-query-service.ts` |
| `hangul-service.ts` | 213 | `HangulService` (+ default `$hangul`) | unchanged |
| `index.ts` | 12 | barrel (`export *` of the 3 files, `:10-12`) | — |
| specs | `elastic6-service.spec.ts` 1878, `elastic6-query-service.spec.ts` 242, `hangul-service.spec.ts` 129, `os2-client.spec.ts` 225 | — | spec names follow |

Import paths that would change on a file rename [measured: grep of `src`, `scripts`, configs]:

- non-spec: `cores/elastic/index.ts:10-11`, `cores/elastic/elastic6-query-service.ts:22` (`./elastic6-service`). Other folders import the folder barrel only: `cores/index.ts:23` (`./elastic/`), `cores/lambda/lambda-dynamo-stream-handler.ts:17` (`../elastic/`). A folder rename would also touch these two.
- spec: `elastic6-query-service.spec.ts:16-18`, `elastic6-service.spec.ts:19`, `os2-client.spec.ts:16`; `cores/lambda/lambda-dynamo-stream-handler.spec.ts:20` (folder).
- `src/index.ts`: none (reaches elastic through `./cores/`).
- `package.json` `exports`/`files`, `scripts/gen-esm-wrapper.cjs`, `scripts/esm-smoke.mjs`, `dist/esm/*.mjs`: **no reference** to elastic paths. Only `./dist/*` makes `lemon-core/dist/cores/elastic/elastic6-service` and `…/elastic6-query-service` resolvable (both measured OK); `lemon-core/dist/cores/elastic` (directory) does not resolve.
- templates-api: 0 references to `elastic6`, `cores/elastic`, `hangul`.
- Docs: `HOW_TO_UPGRADE_V5.md:264` states "File names (`cores/elastic/elastic6-service.ts` and the others) are unchanged in v5, so `lemon-core/dist/...` file deep imports still resolve." `README.md:221-223` (changelog lines). A rename contradicts the V5 guide line (§ 11).
- Other remaining ES identifiers (not file names): non-exported interfaces `ElasticParams`, `ElasticSearchParams`, `ElasticSearchAllParams` (§ 1 (g)); root type `Elastic6SimpleQueriable` is a lemon-model re-export (`controllers/general-api-controller.ts:14`, `cores/storage/proxy-storage-service.ts:14`) → S-06 boundary, out of B3; root `$ES6Routed` (kept by B2-b).

## 9. Folder facts for the merge direction

### 9.1 Sizes [measured: `find`/`wc -l`]

| folder (depth 1) | non-spec files | non-spec lines | spec files | spec lines |
| --- | ---: | ---: | ---: | ---: |
| `src/helpers` | 3 (`helpers.ts` 994, `types.ts` 237, `index.ts` 11) | 1242 | 1 | 712 |
| `src/common` | 2 (`test-helper.ts` 244, `types.ts` 104) | 348 | 1 | 248 |
| `src/extended` (top: `abstract-service.ts` 1178, `index.ts` 10) | 2 | 1188 | 1 | 1468 |
| `src/extended/cores` | 7 (`abstract-services.ts` 2556, `abstract-controllers.ts` 622, `abstract-rest-apis.ts` 224, `commons.ts` 205, `types.ts` 255, `browser-cache.ts` 34, `index.ts` 15) | 3911 | 6 | 2607 |
| `src/extended/libs` | 1 (`sig-v4.ts` 311) | 311 | 1 | 91 |
| `src/lib` | 5 | 356 | 3 | 299 |
| `src/cores/elastic` | 4 | 1907 | 4 | 2474 |

### 9.2 What `helpers/helpers.ts` exports besides `$T` [measured: decls + import map + ta-imports]

All 15 are at the root (via `export * from './helpers/'`).

| name | line | lc non-spec importers | lc spec | ta non-spec | ta spec |
| --- | --- | --- | --- | --- | --- |
| `parseListParam` | :53 | 0 | 0 | 0 | 0 |
| `parsePaginateParam` | :63 | 0 | 1 | 0 | 1 (root = L2) |
| `$T` | :97 | `extended/abstract-service.ts`, `extended/cores/commons.ts` | 1 | 13 (root = L2) | 1 |
| `$rand` | :503 | 0 | 3 | 0 | 0 |
| `$protocol` | :533 | `extended/abstract-service.ts`, `extended/cores/abstract-rest-apis.ts` | 1 | 5 | 0 |
| `$info` | :615 | 0 | 1 | 2 | 4 |
| `$slack` | :631 | `extended/abstract-service.ts` | 0 | 4 | 0 |
| `$event` | :681 | 0 | 0 | 0 | 0 |
| `getIdentityId` | :695 | `extended/cores/abstract-services.ts` | 1 | 1 | 0 |
| `isUserAuthorized` | :712 | 0 | 1 | 0 | 0 |
| `parseRange` | :731 | 0 | 1 | 0 | 0 |
| `my_parallel` | :757 | 0 | 0 | 0 | 0 |
| `my_parrallel` | :843 | `extended/abstract-service.ts`, `extended/cores/abstract-controllers.ts`, `extended/cores/abstract-services.ts` | 2 | 2 | 0 |
| `my_sequence` | :854 | `extended/cores/abstract-controllers.ts`, `extended/cores/abstract-services.ts` | 1 | 0 | 0 |
| `createSigV4Proxy` | :871 | `extended/cores/abstract-services.ts` | 2 | 0 | 0 |

### 9.3 Dependency edges among `helpers` / `common` / `extended` (non-spec import statements, folder level) [measured: `raw-imports.txt`]

| edge | count | sites |
| --- | ---: | --- |
| `extended/cores → helpers` | 4 | `commons.ts:20` (`$T` base), `abstract-services.ts:53`, `abstract-rest-apis.ts:15`, `abstract-controllers.ts:36` |
| `extended (abstract-service.ts) → helpers` | 1 | `extended/abstract-service.ts:44` |
| `extended/cores → extended (abstract-service.ts)` | 1 | `abstract-services.ts:63` |
| `helpers → extended/libs` (reverse edge, A § 3.5) | 1 | `helpers/helpers.ts:25` (`sigV4Client`, `sigV4ClientConfig`) |
| `helpers → cores` | 2 | `helpers/helpers.ts:21`, `:22` |
| `helpers → engine` | 1 | `:23` |
| `helpers → common` | 1 | `:24` |
| `helpers → lib` | 1 | `:28` |
| `extended/cores → common` | 2 | `abstract-services.ts:51`, `abstract-controllers.ts:38` |
| `cores → common` | 8 | the 8 `cores/**` files in § 3.2 |

- `extended/cores/commons.ts` depends on `helpers/` for the whole `$T` base (`:20`) and on `engine` `$U` (`:21`). It does not depend on `helpers/types` (it imports `./types`). [code]
- `helpers/` does not import `extended/cores`. So "move L1 `$T` body into `extended/cores/commons.ts`" would make `helpers/helpers.ts` (`$protocol`, `parseRange`, `my_parallel`, … use `$T.N`/`$T.B`/`$T.onlyDefined`) import from `extended/cores` — a new `helpers → extended/cores` edge — unless the single `$T` lives in `helpers/` or a lower folder. [code]
- The B3-relevant reverse edge is only `helpers/helpers.ts:25` (`helpers → extended/libs`). [measured]

## 10. Gate inputs on the untouched tree [measured]

- Start state of `src/generated/field-registry.ts`: sha256 `bf38c1b4…`. This is already the **post-build** form (the same hash as the B2-c `after build` value); the committed form in B2-c was `39adf249…`. `npm ci` ran `prepare` → `npm run build` (dist and the file have the `npm ci` timestamp). I saved this state to `<scratch>/b3/field-registry.ts.start` before building and copied it back after; `diff` empty. **The coordinator should restore the committed version with git before committing in this worktree.**
- `npm run build` → exit 0; `gen-esm-wrapper: dist/esm/index.mjs <- dist/index.d.ts: 135 named + default`, `testing.mjs: 10 named` (`build.log`).
- `npm run api:check` → exit 0: `base=304 current=294 added=11 removed=21 allow=32 not-allowed=0` (`api-check.log`).
- `npm run esm:smoke` → exit 0: `esm-smoke: ok names=136 subpaths=4`.
- `npm test < /dev/null` → `Test Files 4 failed | 48 passed (52)`, `Tests 4 failed | 499 passed (503)`. Failures: `encodeIdentityJWT and verifyToken tests` ×3 (`lambda-sns/sqs/web-handler.spec.ts`), `engine.spec doReportError() - account id` ×1. Same as the B2-c baseline (`test.log`).
- Load probe `env -i PATH=$PATH HOME=$HOME node scripts/aws-lazy-probe.cjs`, first line: `dist/index import: total=265 @aws-sdk=0 @smithy=0 @aws-crypto=0 @aws=0`.
- After the run: `diff src/generated/field-registry.ts <scratch>/b3/field-registry.ts.start` → empty.

## 11. Risks, contradictions, owner decisions

### 11.1 Contradictions with SPEC § 4 / earlier docs

1. **"루트 핀 19개"** → today **18** collision pins (`$T`, 13 types, parse ×2, `onlyDefined`, `sourceToItem`). B2-b removed the 19th (`$ES6`). `src/index.ts` also has 2 non-collision named exports (`withBrowserCache`, `$ES6Routed`) and `lib`/`tools`. SPEC § 0.1 근거 "A § 루트 핀 19개" is stale. [measured]
2. **"`$T` 두 벌"** → L2 is an extension object `{ ...L1, 11 own members }`, not a second full copy. "`$T` 정의가 1개" (§ 4.1 완료 판정) therefore means moving the 21 spread members into the single definition, not deleting one file. [measured]
3. **§ 4.1 선행 조건 "`onlyDefined`·`sourceToItem` 두 구현 대조(차이가 있으면 § 9)"** → no difference: text-identical bodies, 12 + 8 probe inputs equal. The § 9 item "두 구현이 다를 때 어느 쪽을 남길지" has nothing to decide. [measured]
4. `src/index.ts:40` comment "signature compat (`(N, $def)`)" is wrong for the current code (no `$def`). `HOW_TO_UPGRADE_V4.md:177` ("not exported at root") is stale. [code]
5. SPEC § 3.10 defers "`cores/elastic/` 파일·폴더 이름" to B3, but § 4.1 **excludes** "폴더 이름 변경(S-01 일부)", and `HOW_TO_UPGRADE_V5.md:264` already tells users the elastic file names are unchanged in v5. File renames inside the folder are possible (templates-api 0 references, no packaging/script reference); the folder rename conflicts with § 4.1. [measured + code]
6. "소비 0이 확인된 `@deprecated` 멤버 제거": `isUseSssion` is **not** 소비 0 (templates-api `api/hello-api.ts:64`). It is removed anyway under K7, so the templates-api change belongs to the same bundle (like B2). `loadEnviron` is consumed by templates-api (`express.ts:20,23`). [measured]
7. `api:check` cannot see two kinds of B3 change: (a) removing `CoreManager.insert` changes behaviour (falls back to `AbstractManager.insert`) with no name change; (b) deep-path content changes (`dist/helpers/helpers` losing parse ×2, `dist/helpers/types`, `dist/cores/config/config-service`, `dist/common/test-helper`/`./testing`) are outside the root-name gate. [measured: simulation § 2.3]

### 11.2 Where "L2 wins" changes behaviour for L1-only consumers

- Only `$T.S2` (3rd `delim` argument ignored) and `$T.SS` (`def` ignored; array items whitespace-collapsed) differ, plus the type shape `IdentityToken` (`cid` required) and `ListResult.aggr`. [measured]
- Inside lemon-core, the L1-`$T` consumers (`extended/abstract-service.ts`, `helpers.ts` self-uses) call only `asMap`, `S`, `diff`, `N`, `B`, `onlyDefined` → no behaviour change. No lemon-core code uses L1 types except `ListParam`/`PaginateParam` (identical). [measured]
- templates-api already gets L2 at the root and uses no deep path to L1. The only exposure is an unknown consumer of `lemon-core/dist/helpers/helpers` or `/types` (DoU X3 deep-import census, B6). [measured]
- Root-name effect of deleting all losing copies except `$T`: **0 names added or removed** (simulation, § 2.3). [measured]

### 11.3 Other risks

- `extended/cores/commons.ts:20` imports the `$T` base from `helpers/`; a single `$T` placed in `extended/cores` creates a `helpers → extended/cores` edge (§ 9.3).
- The test harness is a runtime dependency of 18 non-spec files and the root `onlyDefined` is the harness copy. B3 scope (§ 4.1) does not include C7 (moving `GETERR`/`NUL404`/`onlyDefined` out of `common/test-helper.ts`). If the L2 `onlyDefined` is deleted, `dist/extended/cores` loses `onlyDefined` unless it re-exports the harness one.
- `CoreManager.insert` removal: see 11.1-7.
- `OS2Service`/`OS2Instance` have 5 identical-body overrides (§ 5) — safe deletions, not required by B3.

### 11.4 Owner value decisions (minimal)

None of the measured facts needs a new owner value decision for the core B3 merge: the winner per name is already fixed by "루트에서 지금 보이는 쪽이 이긴다", identical pairs make `onlyDefined`/`sourceToItem` moot, and `./dist/*` stays through v5 (§ 2.3-b, § 9). Two items touch earlier owner text and may need a yes/no:

1. **`cores/elastic/` file renames in v5** — § 3.10 defers them to B3; § 4.1 excludes folder renames; `HOW_TO_UPGRADE_V5.md:264` promises unchanged file names. Choose: rename files in B3 (and fix the guide), or close the § 3.10 item as "not in v5".
2. **`CoreManager.insert` (`@deprecated`, 소비 0)** — removing it is a silent behaviour change (base `AbstractManager.insert` takes over). Recommendation: keep it out of the "소비 0 제거" list, or remove only together with the whole `@deprecated` `AbstractProxy` identity cluster (#7-10) after DoU X1.

## Artifacts in `<scratch>/b3/`

| file | what |
| --- | --- |
| `dup-decls.cjs` → `dup-decls.txt`, `decls-all.tsv` | exported top-level declarations, names defined in ≥2 files |
| `root-pins.cjs` → `root-pins.txt` | star sources, collisions, pins, winning declaration |
| `probe-T.cjs` → `probe-T.txt` | `$T` member table (L1 vs L2, function identity, source text) |
| `probe-dups.cjs` → `probe-dups.txt` | behaviour probes: `onlyDefined`, `sourceToItem`, parse ×2, `marshal`, `$T.S2/SS/N/nul2str/B/reduceAggr` (62 rows, 5 differences, all in `S2`/`SS`) |
| `import-map.cjs` → `import-map.tsv`, `imports-of-interest.txt`, `testhelper-nonspec-importers.txt` | every named import resolved to its declaration |
| `refs.cjs` + `ref-targets.txt` → `refs.txt` | language-service references for 47 targets |
| `inherit.cjs` → `inherit.txt` | L2 → L1 `extends` and shadowed members |
| `deprecated.cjs` → `deprecated.tsv` | `@deprecated` JSDoc tags |
| `ta-imports.cjs` → `ta-imports.tsv`, `ta-imports-of-interest.txt` | templates-api imports from `lemon-core*` |
| `raw-imports.txt` | non-spec relative imports used for § 9.3 |
| `diff-types.txt` | `diff helpers/types.ts extended/cores/types.ts` |
| `sim-apply.cjs`, `sim/`, `sim-tsc.log`, `api-names.sim.txt` | deletion simulation (§ 2.3) in a scratch copy |
| `api-names.current.txt`, `api-check.log`, `esm-smoke.log`, `aws-probe.log`, `build.log`, `test.log` | § 10 gate outputs |
| `field-registry.ts.start` | the start-state copy used for the restore |
