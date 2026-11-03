# lemon-core v5 B2-b (search) — measured inventory

Scope: replace `@elastic/elasticsearch` 7.12 with the OpenSearch client, delete ES-only behaviour and ES names, make `$OS2`/`$ES6` lazy.

Trees (read-only):
- `<lemon-core>` = branch `feat/v5-b2-b-search` @ `b0dc74c2` (B2-a merged). `npm ci --ignore-scripts` was run once. `git status` is clean after all runs.
- `<templates-api>` = branch `feat/v5-b2-b-search` @ `37034d7`.
- `<templates-api-b0>` = B2-a harness. Its `node_modules/lemon-core` links to the B2-a lemon-core worktree (`99fa6861`, built `dist`). Used only for § 4 import measurements and § 6.

All line numbers are on the trees above. "non-spec" means `src/**/*.ts` minus `*.spec.ts`, with comment-only lines skipped.

---

## 1. OpenSearch client candidate: `@opensearch-project/opensearch`

### 1.1 Registry facts (`npm view`, `npm pack` into the scratchpad)

| item | value |
|---|---|
| latest | **3.9.0** (published 2026-09-23). Previous: 3.6.0 (2026-04-27), 3.5.1. Last 2.x: 2.13.0 (2024-11-12) |
| engines | `node >=14` (`yarn ^1.22.10` dev only) |
| runtime deps | `aws4`, `debug`, `json11`, `ms`, `secure-json-parse`. No peer deps. `@aws-sdk/types` is a devDependency only |
| unpacked size | 2.5 MB tarball, 5.4 MB extracted, 619 `.d.ts`. For comparison, `@elastic/elasticsearch` 7.12 in node_modules is 1.3 MB |
| `exports` | `.` → `{ types: ./index.d.ts, import: ./index.mjs, require: ./index.js }`, `./*`, `./aws`, `./aws-v3` |
| types | shipped (`types: index.d.ts`). No `@types/*` needed |
| named exports (`index.d.ts:58-76`, `index.mjs`) | `Client`, `Transport`, `ConnectionPool`, `Connection`, `Serializer`, `events`, `errors`, `API`, `Types`, `ApiError`, `ApiResponse`, `ClientOptions`, … `index.mjs` also has `default` |

### 1.2 Typing style: same as elastic 7.x (wrapped)

- Each API returns `TransportRequestPromise<X_Response>`. `X_Response extends ApiResponse { body: X_ResponseBody }` (e.g. `api/_core/info.d.ts`).
- `ApiResponse` = `{ body, statusCode, headers, warnings, meta }` (`lib/Transport.d.ts:86-98`). This is the **7.x shape, not the unwrapped 8.x shape**. Every `res.body.*` / `res.statusCode` read in lemon-core keeps working.
- `errors.ResponseError` (`lib/errors.d.ts:78-86`) has `meta: ApiResponse`, plus `body` / `statusCode` / `headers` getters (`lib/errors.js`). So `E.meta.statusCode` and `E.meta.body.error.*` exist as before.
- **Difference: `ResponseError.message`.**
  - elastic 7.12: `meta.body.error.type`.
  - OpenSearch 3.9: `"<type>: [<root_cause.type>] Reason: <reason>; …"` whenever `root_cause` is an array.
  - See § 8 R1. Measured: the `$ERROR` output changes.
- `Transport.checkCompatibleInfo()` (product check) is defined at `lib/Transport.js:599` and **never called**. There is no product gate like elastic ≥7.14 has.

### 1.3 The APIs lemon-core calls (14 asked + `bulk`)

Signatures are from `api/OpenSearchApi.d.ts`. Request and response types are from `api/<ns>/<name>.d.ts`.

| API (lemon-core call site) | present | params lemon-core passes → accepted? | response fields lemon-core reads → present? |
|---|---|---|---|
| `info()` (elastic6-service.ts:371) | yes (:2151) | none | `body.version.number` yes (`OpenSearchVersionInfo.number`, also `distribution`) |
| `cat.indices({format:'json'})` (:483) | yes (:94) | `format` yes | body = `IndicesRecord[]` yes |
| `indices.getMapping({index})` (:513, :685; abstract-services.ts:1714) | yes (:462) | `index` yes | `body[index].mappings` yes |
| `indices.create({index, body})` (:563; abstract-services.ts:1744) | yes (:557) | yes | `statusCode`, `body.shards_acknowledged` yes |
| `indices.delete({index})` (:593; abstract-services.ts:1769) | yes (:545) | yes | `statusCode`, `body.acknowledged` yes |
| `indices.refresh({index})` (:622) | yes (:476) | yes | `body` yes |
| `indices.flush({index})` (:646) | yes (:426) | yes | `body` yes |
| `indices.getSettings({index})` (:670; abstract-services.ts:1699) | yes (:490) | yes | `body[index].settings` yes |
| `create({index,id,body[,type]})` (:722) | yes (:2287) | `index,id,body,refresh` yes. **`type` is not a param** | `body._version/_id` yes |
| `index({index,id?,body[,type]})` (:732, :766) | yes (:2295) | `type` is not a param | `body._id/_version` yes |
| `get({index,type,id,_source})` (:805) | yes (:2303) | `_source` yes. `type` is not a param | `body._id/_version/_source` yes |
| `delete({index,type,id})` (:841) | yes (:2299) | `type` is not a param | `body._id/_version` yes |
| `update({index,id,body:{upsert,script}[,type]}, {maxRetries})` (:934) | yes (:2335) | body `upsert`/`script` yes. `TransportRequestOptions.maxRetries` yes (`Transport.d.ts:128`). `type` is not a param | `body._id/_version` yes |
| `search({index, body, searchType[, type]})` (:987) | yes (:2244) | **`searchType` is not accepted. The param is `search_type`.** `type` is not a param | `body.hits/aggregations` yes |
| `mget({index, type, body:{docs}})` (abstract-service.ts:1152) | yes (:2183) | `type` is not a param | `body.docs[].found/_source` yes |
| `bulk({body})` (**active** in abstract-services.ts:840 `doSyncScanLast`, not only the commented :1870) | yes | yes | `body.items[].index._id/_version/error/status` |

Param handling that matters:
- The OS client puts **every non-path key into the query string verbatim**.
  - e.g. `api/_core/create.js`: `let { body, id, index, ...querystring } = params`. `get.js` is the same, with path `/{index}/_doc/{id}`.
  - `Serializer.qserialize` (`lib/Serializer.js:160-176`) drops only `undefined` values. It does **no camelCase → snake_case conversion**.
- elastic 7.12 does two things the OS client does not:
  - It maps `searchType` → `search_type` (`node_modules/@elastic/elasticsearch/api/api/search.js:27,39`).
  - It turns `type` into a **path segment** (`get.js:48`, `delete.js:48`, `index.js:48,54` → `/{index}/{type}/{id}`).
- So under the OS client, `type:'_doc'` becomes `?type=_doc`, and `searchType` becomes `?searchType=…`. OpenSearch rejects unknown request parameters with 400.
- `''` is not dropped either. An empty `docType` still sends `type=`.

### 1.4 Constructor options lemon-core passes

| site | options | OS `ClientOptions` |
|---|---|---|
| elastic6-service.ts:206-212 `ElasticIndexService.instance()` | `node: endpoint`, `ssl: { ca: process.env.elasticsearch_certificate, rejectUnauthorized: false }` | `node?: string\|…` (`lib/Client.d.ts:67`), `ssl?: tls.ConnectionOptions` (:83). Same names |
| abstract-services.ts:1655-1665 `OS2Service.instance()` | the above plus `auth: { username: config OS2_MASTER_UID, password: config OS2_MASTER_PWD }` (:1651-1652) | `auth?: BasicAuth \| AwsSigv4Auth` (:91). Same name. `AwsSigv4Signer` is also available (`./aws`, `./aws-v3`) |

---

## 2. ES-only behaviour to delete

### 2.1 Version predicates and engine heuristics (all in `cores/elastic/elastic6-service.ts`)

| item | definition | non-spec uses | spec lines (elastic6-service.spec.ts) |
|---|---|---|---|
| `EngineType = 'os'\|'es'` | :110 | :117 (`ParsedVersion.engine`) | 0 (the type is not imported by specs) |
| `ParsedVersion` | :115-128 | :359, :374, :399-402, :425 | via `getVersion`/`executeSelfTest` expectations |
| `parseVersion()` | :425-450. Heuristic at :441: `engine = major < 6 ? 'os' : 'es'` | :360, :374 | 11 |
| `get parsedVersion` | :359-361 | :340, :347, :354, :379, :384, :399 | — |
| `getVersion()` (calls `client.info()`, can dump to `data/samples/<engine><ver>/info.json`) | :367-390 | :402 | 9 |
| `executeSelfTest()` | :397-417 | — | 9 |
| `saveInfoToFile()` (writes under `data/samples`) | :457-473 | :386 | — |
| `isOldES6` | :339-341 | **:714, :731, :888, :981 only** (confirmed: these 4 plus the definition) | 23 |
| `isOldES71` | :346-348 | none | 17 |
| `isLatestOS2` | :353-355 | none | 1 (:1233) |

`isOldES71` + `isLatestOS2` = 18 spec lines, which matches the prior inventory. The predicates live only in `elastic6-service.spec.ts`. In that file:
- `service.isOldES6 ? … : service.isOldES71 ? … : …` ternaries in `mismatchedTypeTest` (:765-1025, 17 triplets).
- `basicSearchTest` (:457, :501).
- `setupIndex` (:189), `autoIndexingTest` (:738, :1032), `bulkDummyData` (:1233), `totalSummaryTest` (:1560).

### 2.2 Doc `type` / `_doc` / default-version handling

| file:line | behaviour | under the OS client |
|---|---|---|
| elastic6-service.ts:227 and abstract-services.ts:1675 | default options `{ docType: '_doc', idName: '$id', version: '6.8', … }` | With no `version`, `isOldES6` is true, so `type` is sent on save/update/search |
| elastic6-service.ts:710-716, :730-732 (`saveItem`) | `params.type = type` if `isOldES6` | `?type=` → 400 |
| elastic6-service.ts:760 (`pushItem`) | **unconditional** `type` in params | `?type=` → 400 |
| elastic6-service.ts:793 (`readItem`) | **unconditional** `type` | `?type=` → 400 |
| elastic6-service.ts:837 (`deleteItem`) | **unconditional** `type` | `?type=` → 400 |
| elastic6-service.ts:886-890 (`updateItem`) | `type` if `isOldES6` | — |
| elastic6-service.ts:976-983 (`searchRaw`) | `type` if `isOldES6`. Also `searchType` camelCase | `?searchType=` → 400 when set |
| extended/abstract-service.ts:1154 (`AbstractElastic6Instance.mget`) | **unconditional** `type: this.options.docType` | `?type=` → 400 |
| abstract-services.ts:1910, :1943, :1987 (`OS2Service.pushItem/readItem/deleteItem`) | put `type` in params | **dead data**: the FGAC `doFgac*` (:2136-2194) never reads `.type` |
| elastic6-service.ts:1098-1100, :1222, :1228, :1236-1250 (`prepareSettings`) | `version` defaults to `'6.8'`. Typed mapping `{[docType]: ES_MAPPINGS}` and the `standard` filter when `6 ≤ version < 7` | OpenSearch 2.x/3.x reject typed mappings |
| extended/abstract-service.ts:1106-1130 (`AbstractElastic6Instance.createIndex`) | `prepareSettings({docType,idName})` with **no version**, so the mapping is typed. Then `ver < 7.0` puts properties under `mappings[docType]` | For any OS version string (`'2.10'` → 2.1 < 7) it sends a **typed mapping**. Only `OS2Instance.createIndex` (abstract-services.ts:2360-2381) strips `_doc` |
| abstract-services.ts:2148, :2156, :2185, :2193 | FGAC paths use `/_doc/{id}` | Valid OpenSearch endpoint (typeless). Keep |
| elastic6-service.ts:1054; abstract-service.ts:1186 | `body.sort = '_doc'` | Valid sort key. Not a type |
| interfaces `ElasticParams.type?` / `ElasticSearchParams.type?` | elastic6-service.ts:135-177; abstract-services.ts:1596-1637 | — |
| `ElasticOption.docType` / `version` (public type) | elastic6-service.ts:47-62 | Public shape decision |

### 2.3 `$ERROR` (elastic6-service.ts:1304-1407, public value `$ERROR`)

- :1352-1369 is the "from ES7.1" branch. It parses `E.meta`, and `type` is derived from **`E.message`** (:1354). The OS client message format breaks this (§ 8 R1).
- :1371-1385 is the **"from ES6.2" branch** (`E.response`, `root_cause`, `found`, `result`).
  - Neither the 7.12 client nor the FGAC `http-fetch` errors set `.response`. `http-fetch` errors are plain `Error`s with message `"<code> <TITLE> - …"` (`lib/http-fetch.ts:48`, :113-122).
  - The branch is reachable only from spec samples: `data/samples/es6.5/create-index.err-400.json` in test `$ERROR/es6.2`.
- When a FGAC error reaches `$ERROR.handler`, `asError` yields no status, and the handler rethrows the original (:1390-1395). That is pass-through.

### 2.4 Env and re-export

| item | lines |
|---|---|
| `elasticsearch_certificate` (lower-case env, `ssl.ca`) | elastic6-service.ts:209; abstract-services.ts:1658 |
| `export { elasticsearch, $hangul }` (whole client module re-exported, public value `elasticsearch`) | elastic6-service.ts:14 (import), :24 |
| other `@elastic/elasticsearch` imports | extended/abstract-service.ts:51 (type of `AbstractElastic6Instance.client`, :1050); `ApiResponse` at elastic6-service.ts:14, :722, :934 |
| `elasticsearch.Client` type uses | elastic6-service.ts:193, :234; abstract-services.ts:55, :1646, :1680, :2290 |
| package pin | package.json:108 `"@elastic/elasticsearch": "7.12"` |

### 2.5 Spec impact of deleting the above (counts)

`cores/elastic/elastic6-service.spec.ts` has 10 `it`:

| test | fate if ES behaviour is deleted |
|---|---|
| `basic CRUD w/ dummy` | stays |
| `error handler($ERROR/es6.2)` | **goes** (it exercises only the ES6.2 `E.response` branch) |
| `error handler($ERROR/es7.1)` | stays as a sample-JSON test. Its expectations hold only if `asError` keeps the same output from `meta` |
| `real server (6.2)`, `(7.1)`, `(7.2)`, `(7.10)` | **4 go** (ES servers) |
| `open-search server (1.1)`, `(1.2)`, `(2.13)` | **3 need rewriting**. They assert `getVersion()` / `executeSelfTest()` / `parseVersion` engine values. 2.13 already expects `engine:'es', major:7, minor:10` from the root endpoint (:2094-2099). The shared helpers use the `isOldES6`/`isOldES71` ternaries |

- `elastic6-query-service.spec.ts`: `runElastic6QueryServiceTests` × 7 versions (:235-253). 4 of the 7 version blocks (6.2/7.1/7.2/7.10, 16 tests) are ES.
- `abstract-service.spec.ts` / `abstract-services.spec.ts` / `lambda-dynamo-stream-handler.spec.ts` own tests reference none of the predicates.

---

## 3. Name map (`etc/api-names.v4.txt`)

- 35 names match `Elastic|ES6|elasticsearch|OS2|Hangul|Search`. Add `EngineType` and `ParsedVersion`.
- Also listed, because they are defined in `elastic6-service.ts` and leave or change with it: `$ERROR` and `RetryOptions`.
- Columns:
  - `lc non-spec` = lines / files in `<lemon-core>/src`.
  - `lc spec` = lines / files in `*.spec.ts`.
  - `ta` = lines in `<templates-api>/src` (non-spec + spec).
- `lemon-model` = re-exported through `cores/index.ts:13` (`export * from 'lemon-model'`, `lemon-model@1.1.1`, `dist/types/core-types.d.ts`).

| name | kind | defined at | lc non-spec | lc spec | ta (files) |
|---|---|---|---|---|---|
| `$ES6` | value | extended/abstract-service.ts:1525 (L1, root via index.ts:40); extended/cores/abstract-services.ts:2618 (routed, deep import) | 10 / 3 | 17 / 2 | 4 lines. All are the local alias `$ES6Routed as $ES6` (api-search.ts, backend-service.ts, service.spec.ts) |
| `$ES6Routed` | value | abstract-services.ts:2627 (root via index.ts:42) | 2 / 2 | 0 | 2 + 1 (api-search.ts:25, backend-service.ts:15, service.spec.ts:18) |
| `$OS2` | value | abstract-services.ts:2617 (root via `export *` index.ts:37) | 1 / 1 | 0 | **0**. api-search.ts:643 `const $OS2 = _OS2()` is a local |
| `$hangul` | value | hangul-service.ts:213 default, re-exported at elastic6-service.ts:24 | 7 / 2 | 0 | 0 |
| `$ERROR` | value | elastic6-service.ts:1304 | 28 / 2 | 23 / 1 | 0 |
| `_ES6` | value | abstract-service.ts:1470 | 4 / 2 | 3 / 1 | 0 + 2 (service.spec.ts:15, :267) |
| `_OS2` | value | abstract-services.ts:2579 | 3 / 1 | 0 | 4 (service.ts:26, :107; api-search.ts:25, :643) |
| `elasticsearch` | value | elastic6-service.ts:24 | 12 / 3 | 0 | 0 |
| `AbstractElastic6Instance` | value+type | abstract-service.ts:1046 | 2 / 1 | 0 | 0 |
| `DummyElastic6Service` | value+type | elastic6-service.ts:1415 | 2 / 1 | 2 / 1 | 0 |
| `Elastic6Instance` | value+type | abstract-service.ts:1201 | 7 / 2 | 1 / 1 | 2 (service.ts:23, :84) |
| `Elastic6QueryService` | value+type | elastic6-query-service.ts:30 | 7 / 3 | 5 / 2 | 0 |
| `Elastic6Service` | value+type | elastic6-service.ts:318 | 33 / 5 | 16 / 1 | 0 |
| `Elastic6Synchronizer` | value+type | abstract-service.ts:924 | 6 / 2 | 0 | 0 |
| `ElasticIndexService` | value+type | elastic6-service.ts:191 | 4 / 1 | 0 | 0 |
| `HangulService` | value+type | hangul-service.ts:15 | 13 / 1 | 30 / 1 | 0 |
| `OS2FGACManager` | value+type | abstract-services.ts:2091 | 6 / 1 | 0 | 0 |
| `OS2Instance` | value+type | abstract-services.ts:2289 | 4 / 1 | 0 | 0 |
| `OS2Service` | value+type | abstract-services.ts:1644 | 4 / 1 | 0 | 0 |
| `Elastic6ContructParams` | type | abstract-service.ts:1015 | 5 / 1 | 0 | 0 |
| `Elastic6Item` | type | elastic6-service.ts:313 | 6 / 3 | 2 / 1 | 0 |
| `Elastic6Option` | type | elastic6-service.ts:312 | 12 / 3 | 2 / 1 | 5 (service.ts:15, :39 re-export, :103; backend-service.ts:16, :60) |
| `Elastic6SearchParams` | type | abstract-service.ts:1033 | 3 / 1 | 2 / 1 | 7 (service.ts:22, :197, :205, :220; api-search.ts:21, :239, :241) |
| `Elastic6SimpleQueriable` | type | lemon-model `core-types.d.ts:464` | 7 / 3 | 0 | 0 |
| `ElasticItem` | type | elastic6-service.ts:73 | 4 / 1 | 0 | 0 |
| `ElasticOption` | type | elastic6-service.ts:38 | 6 / 1 | 0 | 0 |
| `EngineType` | type | elastic6-service.ts:110 | 2 / 1 | 0 | 0 |
| `ParsedVersion` | type | elastic6-service.ts:115 | 8 / 1 | 0 | 0 |
| `RetryOptions` | type | elastic6-service.ts:86 | 2 / 1 | 0 | 0 |
| `OS2Option` | type | abstract-services.ts:2278 | 4 / 1 | 0 | 0 |
| `AutocompleteSearchParam` | type | lemon-model `core-types.d.ts:432` | 4 / 1 | 0 | 0 |
| `SearchBody` | type | lemon-model `core-types.d.ts:402` | 28 / 4 | 17 / 3 | 19 (api-search.ts, model.ts, service.ts, service.spec.ts) |
| `SearchParam` | type | abstract-services.ts:93 | 6 / 1 | 0 | 0 |
| `SearchProxyBody` | type | abstract-service.ts:1453 | 2 / 1 | 0 | 3 (api-search.ts:22, :239, :241) |
| `SearchQuery` | type | lemon-model `core-types.d.ts:333` | 8 / 1 | 0 | 4 (model.ts, modules/callback/api-callback.ts) |
| `SearchResponse` | type | elastic6-service.ts:28 | 4 / 2 | 8 / 1 | 0 |
| `SearchResult` | type | abstract-service.ts:901 | 6 / 2 | 2 / 1 | 6 (api-search.ts, model.ts, service.ts) |
| `SearchType` | type | elastic6-service.ts:25 | 11 / 3 | 0 | 1 (model.ts, see note) |
| `SimpleSearchParam` | type | lemon-model `core-types.d.ts:416` | 5 / 1 | 0 | 0 |

Notes:
- Counts are token matches (identifier boundary).
- `SearchType` in `<templates-api>/src/modules/search/model.ts` is a hit on the identifier. model.ts imports only `CoreModel, QueryTerm, SortTerm, SearchQuery, SearchBody, _log, _inf, _err, SearchResult` from lemon-core (:14, :16), so it is a local or other-source name.
- The ES config names `ES6_INDEX` / `ES6_VERSION` are also read for display in `<templates-api>/src/api/hello-api.ts:66-67`.

---

## 4. Load-time instances and laziness constraints

### 4.1 Module-top instances

| file:line | statement | builds |
|---|---|---|
| extended/abstract-service.ts:1525 | `export const $ES6 = _ES6()` | env `ES6_ENDPOINT`, `ES6_INDEX`('test-v1'), `ES6_VERSION`('6.8'), `ES6_DOCTYPE`, `MY_DYNAMO_TABLE`('Test'), `ES6_AUTOCOMPLETE_FIELDS`, `ES6_IS_PROXY` (:1481-1491). With an endpoint: `Elastic6Service` (1 client) + `Elastic6QueryService`, or `Elastic6Proxy` (`$X.createHttpSearchProxy`). **Always** `new Elastic6Synchronizer(...)` (:1089) |
| extended/cores/abstract-services.ts:2616 | `const hasOS2 = $U.env('OS2_ENDPOINT','').startsWith('https://')` | env read at load |
| :2617 | `export const $OS2 = _OS2()` | env `OS2_ENDPOINT`, `OS2_INDEX`('test-x1'), `OS2_VERSION`('2.10'), `OS2_DOCTYPE`, `MY_DYNAMO_TABLE`, `OS2_AUTOCOMPLETE_FIELDS` (:2583-2588) |
| :2618 | `export const $ES6 = hasOS2 ? _OS2() : _ES6()` | a **second, separate** OS2Instance (or ES6 instance) |
| :2627 | `export const $ES6Routed = $ES6` | alias (same object) |

What one `OS2Instance` with an endpoint constructs (abstract-services.ts:2297-2336):
1. `super()` (`AbstractElastic6Instance`, abstract-service.ts:1069-1090):
   - `new Elastic6Service` → `ElasticIndexService.instance` (client #1, no auth).
   - `Elastic6QueryService`.
   - `new Elastic6Synchronizer(elastic6Service)` → `$cores.lambda.dynamos.addListener()` (listener #1).
2. `new OS2FGACManager(options)`. Lazy proxy: config `OS2_SIGNATURE`, env `OS2_JWT_TOKEN`/`OS2_MESSAGE` are read on first `.proxy` (:2101-2133).
3. `new OS2Service`:
   - `super(options)` → client #2.
   - Then `OS2Service.instance()` → client #3, with `auth` from **`$cores.config.config.get('OS2_MASTER_UID'/'OS2_MASTER_PWD')`** (:1650-1665).
4. `new Elastic6QueryService(OS2Service)`.
5. `new Elastic6Synchronizer(OS2Service)` → listener #2.

Without an endpoint: only `super()` runs, so no client and 1 listener.

Measured with the built B2-a `dist` (`env -i`, the client constructor counted by wrapping `@elastic/elasticsearch.Client`; fake hosts):

| env at import | ES clients created at import | dynamo-stream listeners at import | `$ES6Routed.hello()` |
|---|---|---|---|
| none | 0 | **3** | `Elastic6Instance` |
| `OS2_ENDPOINT=https://…` | **6** | **5** | `OS2Instance` |
| `OS2_ENDPOINT` + `ES6_ENDPOINT` | 7 | 5 | `OS2Instance` |

- `<templates-api>` adds one more `_OS2($ES6.options)` at import. `backend-service.ts:97` runs `export default new BackendService()`, which calls `SearchService` → `_OS2` (service.ts:107). That is +3 clients and +2 listeners.
- `api-search.ts:643` `doPostMigrate` adds +2 listeners **per request**, which accumulate on the global `$cores.lambda.dynamos`.

Config at import time:
- `MyConfigService.get()` reads `envConfig` (empty until `init()`) and then `this.$env` (unset until `init()`) (`cores/config/config-service.ts:113-118`, :157-162).
- So at module load `OS2_MASTER_UID/PWD` resolve to `undefined`. The master client is built with `auth:{username:undefined,password:undefined}`, and elastic 7.12 then sends **no** `Authorization` header (`lib/Connection.js:334`).
- Measured on dev (§ 6): `$ES6Routed.elastic.client.info()` → `ResponseError 401`.
- `<templates-api>/env/lemon.yml` does not define `OS2_MASTER_UID/PWD` at all (§ 5.3).

### 4.2 `#private` fields

- `grep` for ECMAScript private names (`#name`, `this.#`) over all of `<lemon-core>/src`: **0** outside string literals.
- `OS2Instance`, `OS2Service`, `OS2FGACManager`, `Elastic6Service`, `ElasticIndexService`, `Elastic6QueryService`, `Elastic6Synchronizer`, `Elastic6Instance` and `Elastic6Proxy` use only TS `private`/`protected`/`declare` (e.g. abstract-service.ts:929, :934, :986, :996, :1005, :1221; abstract-services.ts:1645-1647, :2092).
- No `instanceof Elastic6*/OS2*` checks exist in `<lemon-core>/src` or `<templates-api>/src`.
- Members reached by consumers or core code:
  - `.hello()` (arrow-function own property, e.g. :1205, :2338).
  - `.options` (getter).
  - `.elastic`, `.query`, `.client`, `.synchronizer`, `.fgac`.
  - `.$X` (getter abstract-service.ts:1211) and `.$X2` (abstract-services.ts:2345, :2609).
  - `.search()`, `.createIndex()`, `.describeIndex()`, `.destroyIndex()`, `.synchronizeContents()`.

### 4.3 Exports and the ESM snapshot

| layer | line | form |
|---|---|---|
| `src/index.ts` | :34 `export * from './extended/'`; :37 `export * from './extended/cores/'` (brings `$OS2`, `_OS2`, `OS2*`, routed `$ES6`); :40 `export { sourceToItem, $ES6 } from './extended/abstract-service'` (explicit, L1 wins over star); :42 `export { $ES6Routed } from './extended/cores/abstract-services'` | TS source |
| built `dist/index.js` (B2-a tree) | :86 `Object.defineProperty(exports, "$ES6Routed", { enumerable: true, get: function () { return abstract_services_1.$ES6Routed; } })` | CJS root re-exports are **forwarding getters** (also `__exportStar`/`__createBinding`) |
| `scripts/gen-esm-wrapper.cjs` render() | `export const ${n} = cjs.${n};` for every value name from `dist/index.d.ts` | **evaluates `cjs.$OS2` / `cjs.$ES6` / `cjs.$ES6Routed` / `cjs.elasticsearch` once at ESM wrapper load** |
| built `dist/esm/index.mjs` (B2-a tree) | :4 `export const $ES6 = cjs.$ES6;` :5 `$ES6Routed` :6 `$OS2` :12 `$hangul` :91 `_ES6` :92 `_OS2` :115 `elasticsearch` | snapshot |

Consequences:
- A lazy getter on the CJS `exports` stays lazy for `require` consumers. The TS `__createBinding` copies an existing getter descriptor when `m.__esModule`.
- It is **forced at import** for every `import … from 'lemon-core'` ESM consumer. `cjs.$OS2` is read when the wrapper evaluates.
- The ESM value is a frozen binding to whatever the getter returned at that moment.

---

## 5. `<templates-api>` search module

### 5.1 Names used (re-verified on `37034d7`)

| file:line | lemon-core names |
|---|---|
| src/modules/search/model.ts:14, :16 | `CoreModel, QueryTerm, SortTerm, SearchQuery, SearchBody`; `_log, _inf, _err, SearchResult` |
| src/modules/search/service.ts:12 | `$U, _err, _inf, _log, $protocol, SimpleSet, GETERR, NextContext` |
| service.ts:13-24 | `CoreModelFilterable, Elastic6Option, GeneralKeyMaker, GeneralModelFilter, ProxyStorageService, StorageMakeable, TypedStorageService, UniqueFieldManager, Elastic6SearchParams, Elastic6Instance` |
| service.ts:25, :26 | `$T`; `_OS2` |
| service.ts:39 | `export { Elastic6Option }` (re-export consumed by backend-service.ts:16) |
| src/modules/search/api-search.ts:15 | `$T, $U, _log, _inf, _err, NUL404, GETERR, $info, $slack` |
| api-search.ts:16-23 | `NextHandler, GeneralWEBController, loadJsonSync, doReportError, Elastic6SearchParams, SearchProxyBody` |
| api-search.ts:25 | `_OS2, $ES6Routed as $ES6` |
| src/service/backend-service.ts:10, :11, :15 | `$U, _log, _inf, _err`; `NextContext, NextIdentityAccess, $protocol, getIdentityId`; `MyCoreService, $ES6Routed as $ES6` |
| src/modules/search/service.spec.ts:14, :15, :18 | deep `lemon-core/dist/environ` `loadProfile`; `do_parrallel, expect2, GETERR, NUL404, _it, $U, _ES6`; `$ES6Routed as $ES6` |
| src/modules/search/api-search.spec.ts:14, :15 | deep `loadProfile`; `expect2, $U` |

The prior inventory § 4.7 matches. The only addition is `CoreModelFilterable` at service.ts:14.

### 5.2 What `SearchService` / the controller do with the instance

- `SearchService` constructor (service.ts:103-111): `this.instance = _OS2(options)`.
  - `options` comes from `backend-service.ts:49` `createSearchService($ES6.options)`, i.e. `$ES6Routed.options`. That is `null` when not OS2.
  - It is typed as `Elastic6Instance` (:84).
- `options` getter → `this.instance?.elastic?.options` (:114-116).
- `isProxy()` → `this.instance?.hello().startsWith('Elastic6Proxy')` (:130). Always false for an `OS2Instance`.
- `search()` / `searchAll()` / `generateSearchResult()` → `this.instance.search(body, params)` (:197-199, :205, :220).
- `showIndexStat()` → `this.instance.elastic.listIndices()` (:250). This is `cat.indices` on the **master client**.
- api-search.ts:
  - :80-81 `this.search.search(…)`.
  - :96 `runProxy` → `this.search.instance.search(null, {indexName:'#cmd'})`.
  - :97-… `$elastic = this.search?.instance?.elastic` → `createIndex()`.
  - :129 `$ES6.query.searchSimple($param)`. This is the GET `/search` list, and it goes through `Elastic6QueryService` → `OS2Service.searchRaw` → FGAC.
  - :254-296 search proxy: `$es6.elastic.createIndex/destroyIndex/describe` (master client) and `$es6.search()`.
  - :643-650 `_OS2().synchronizeContents(opts)` (new instance per request).
- Members used on the instance: `.hello()`, `.options`, `.elastic.{options,listIndices,createIndex,destroyIndex,describe}`, `.query.searchSimple`, `.search()`, `.synchronizeContents()`. Not used: `.client`, `.synchronizer`, `.fgac`, `.$X`.

### 5.3 `env/lemon.yml` names (no values)

- Section `default_env` (merged into `test`/`local`/`dev`/`prod` via YAML anchor): `NAME`, `OS2_ENDPOINT`, `OS2_INDEX`, `OS2_SECRET_KEY`, `OS2_ACCESS_KEY`, `OS2_JWT_TOKEN`, `OS2_SIGNATURE` (KMS-encrypted `*…` value), `OS2_MESSAGE`. Section `local` adds `MY_DYNAMO_TABLE`.
- **Not set:** `OS2_VERSION` (so `'2.10'` is used), `OS2_DOCTYPE`, `OS2_AUTOCOMPLETE_FIELDS`, `OS2_MASTER_UID`, `OS2_MASTER_PWD`, any `ES6_*`, `elasticsearch_certificate`.
- `OS2_SECRET_KEY`/`OS2_ACCESS_KEY` are read nowhere in lemon-core `src`. The FGAC uses literal `'**'` keys at abstract-services.ts:2116-2117.
- `serverless.yml:103` mentions `OS2_ENDPOINT` in a comment.

### 5.4 Specs that touch search (jest 27, `npm test` = `LS=1 jest`)

| spec | tests | gating |
|---|---|---|
| src/modules/search/service.spec.ts | `it` basic functions (:48), `it` batch handler (:90), `_it` CRUD with storage (:133), `_it` search functions (:163), `it` search proxy(lemon) (:255) | `instance('dummy')` builds `new SearchService('Test','TT',{endpoint:'https://localhost:8443', indexName:'test-v1', docType:'_doc'})` (:28-33), so `_OS2` gets a localhost endpoint. :255 returns early unless `PROFILE === 'lemon'` (:261) |
| src/modules/search/api-search.spec.ts | `it` main-service (:32), `it` `GET /search/0/hello` via supertest `app` (:41) | none. Importing `../../express` builds the whole app (BackendService → SearchService → `_OS2`) |

Profile timing in specs:
- `loadProfile()` runs **inside `describe`**, after the imports (service.spec.ts:44).
- So `hasOS2` and `$ES6Routed` were fixed with no OS2 env at import. Under `ENV=lemon`, the test asserts `$ES6.options` is `null` (service.spec.ts:265) while `OS2_ENDPOINT` is set (:264).
- In the running server, `src/express.ts:20-24` loads the env **before** `import … from 'lemon-core'`. That is TS CJS emit order, so there `$ES6Routed` is an `OS2Instance`.

Also in the same spec: a commented block at service.spec.ts:~284-295 holds a sample identity with key and account fields (values not reproduced here).

---

## 6. Dev search cluster version

Method:
- One-off script `scratchpad/scripts/os-version.cjs`, run in `<templates-api-b0>` with `env -i`, `ENV=lemon`, `LS=1`.
- Env loaded with `lemon-core/dist/environ` default export, as in `src/express.ts:20-24`.
- All console output silenced. The script printed only the fields below.

| path | result |
|---|---|
| A. `$ES6Routed.elastic.client.info()` (master client, elastic 7.12, `auth` undefined) | **failure: `ResponseError` 401** |
| B. after `$engine.initialize()` (KMS decrypt of `OS2_SIGNATURE`), FGAC `fgac.proxy.doProxy('GET')` = `GET /` | `version.number = "7.10.2"`. **`version.distribution` absent**. `version` keys: `build_date, build_hash, build_snapshot, build_type, lucene_version, minimum_index_compatibility_version, minimum_wire_compatibility_version, number`. Tagline contains "OpenSearch" |
| C. FGAC `GET /_nodes/_local?filter_path=nodes.*.version` | **`["2.17.0"]`** |

Conclusions:
- The dev cluster is **OpenSearch 2.17.0** running in compatibility mode (root endpoint reports `7.10.2` without `distribution`).
- `getVersion()` / `parseVersion` therefore classify it as `engine:'es', major 7, minor 10`, the same as the 2.13 spec expectation at elastic6-service.spec.ts:2094.

---

## 7. Specs touched

Measured with `env -i … LS=1 npx vitest run <file> --coverage.enabled=false` (clean env, no tunnels).

| spec | own tests | vitest reports | ES-version-specific tests and gating |
|---|---|---|---|
| cores/elastic/elastic6-service.spec.ts | 10 `it` | 10 pass | <ul><li>Hard-coded `ENDPOINTS` (:24-34): 6.2, 7.1, 7.2, 7.10, 1.1, 1.2, 2.13 at `https://localhost:<port>`.</li><li>The 7 real-server tests (:1951-2103) return early via `canPerformTest` (:249-266) on ECONNREFUSED, `Connection Error`, `unknown error` or `404 NOT FOUND`. They are **vacuous** without tunnels.</li><li>`$ERROR/es6.2` (:1807) and `$ERROR/es7.1` (:1898) are pure sample-JSON tests.</li><li>No `PROFILE` gate.</li></ul> |
| cores/elastic/elastic6-query-service.spec.ts | 4 `it` inside `runElastic6QueryServiceTests`, called for 7 versions (:235-253) = 28 | **38** = 28 + 10 re-registered from `elastic6-service.spec` (imported :16-17) | Autocomplete and search-quality tests: `if (!PROFILE) return` (:61, :101) plus `canPerformTest`. ES blocks: 6.2/7.1/7.2/7.10 |
| extended/abstract-service.spec.ts | 13 `it` + 1 `_it` | 14 pass | <ul><li>`should pass $ES6` (:555) is ungated. It asserts `$ES6.hello()==='Elastic6Instance'`, `$ES6.options===null`, `ES6_ENDPOINT===''`, and `$ES6.$X.describeEndpointUrl`. This fixes L1 `$ES6` load-time behaviour.</li><li>`$ES6.$X.createHttpSearchProxy()` (:629) and `_ES6 factory` (:659) need `PROFILE==='lemon'`.</li><li>No OS-version tests.</li></ul> |
| extended/cores/abstract-services.spec.ts | 12 `it` | **17** = 12 + 4 (`commons.spec`, imported :16) + 1 (`contexts.spec`, :25) | <ul><li>**No OS2 test.** `_OS2`, `OS2Service`, `OS2FGACManager` and `OS2Instance` have zero lemon-core coverage.</li><li>`buildQuery for ES` (:539) is pure.</li><li>`migrate search-index` (:982) returns early for dummy data (:985).</li><li>`doScanLast` (:839) needs `PROFILE==='lemon'`.</li><li>`abstract-controllers.spec.ts:30-31` imports this spec, so it is re-registered there too.</li></ul> |
| cores/lambda/lambda-dynamo-stream-handler.spec.ts | 2 `it` (`handler listener`, `createSyncToElastic6()` :64) | **18** = 2 + 6 (`lambda-handler.spec`, :18) + 10 (`elastic6-service.spec`, :19) | `createSyncToElastic6()` uses `$elastic6.instance().dummy` (`DummyElastic6Service`, :67). It is in-memory, but the constructor still builds an ES client at `https://localhost:8443` |
| cores/elastic/hangul-service.spec.ts | 5 | 5 | pure |

- Deleting or reshaping `elastic6-service.spec.ts` changes the reported counts of `elastic6-query-service.spec` (38) and `lambda-dynamo-stream-handler.spec` (18).
- `instance()` / `canPerformTest` / `VERSIONS` are imported by those two files. They are exported helpers (:36, :41, :249), so moving them is a cross-file change.

---

## 8. Risks and questions for the spec writer

**R1. `$ERROR` breaks with the OS client's error message.**
- `asError` derives `type` from `E.message` (elastic6-service.ts:1354).
- Measured by feeding the repo's `data/samples/{es7.x,os1.x,os2.13}/*err*.json` `meta` into both clients' `ResponseError` and through `$ERROR.handler`:

| sample | elastic 7.12 | OpenSearch 3.9 |
|---|---|---|
| mapper | `400 MAPPER PARSING - failed to parse field …` | `400 MAPPER PARSING EXCEPTION: [MAPPER PARSING EXCEPTION] REASON: FAILED TO PARSE FIELD …` |
| version conflict | `409 VERSION CONFLICT ENGINE - [A0]: version conflict, …` | `409 VERSION CONFLICT ENGINE EXCEPTION: [VERSION CONFLICT ENGINE - [A0]: …` |
| illegal argument | `400 ILLEGAL ARGUMENT - Cannot apply …` | `400 ILLEGAL ARGUMENT EXCEPTION: [ILLEGAL ARGUMENT - Cannot apply …` |
| 404 `Response Error` | — | unchanged |

- Prefix checks like `'409 VERSION CONFLICT ENGINE'` (:727) and `'404 INDEX NOT FOUND'` still match by accident.
- **`'400 ILLEGAL ARGUMENT - Cannot apply'` / `'- class_cast_exception:'` (:946-947) no longer match.** The reason text is upper-cased into `type`.
- Every live error message changes. `meta.body.error.type` is available in both clients and is a stable source.

**R2. Doc `type` and `searchType` become query parameters.**
- Unconditional `type` sites: `pushItem` :760, `readItem` :793, `deleteItem` :837, `mget` abstract-service.ts:1154.
- Conditional `type` sites under default `version '6.8'`: :714, :731, :888, :981.
- `searchType` at :978 is not renamed to `search_type` by the OS client (§ 1.3). OpenSearch 2.x/3.x answer 400 on unknown params.
- Typed mappings: `prepareSettings` with `6 ≤ v < 7` (:1222, :1228, :1236-1250), and `AbstractElastic6Instance.createIndex` (abstract-service.ts:1108-1120), which always produces a typed mapping for OS version strings because `ver < 7.0`.
- The prior inventory listed only the 4 `isOldES6` lines.

**R3. Version detection cannot identify OpenSearch on the dev cluster.**
- The root endpoint reports `7.10.2` with no `distribution` (§ 6).
- The `engine` heuristic (`major < 6`, :441), `getVersion()` and `executeSelfTest()` are therefore wrong for compatibility-mode clusters. The 2.13 spec already encodes `engine:'es'`.
- Real version source: `_nodes` (2.17.0).
- `ElasticOption.version` is user-supplied (`'2.10'` default for OS2), and float comparisons (`$U.F('2.10')` = 2.1) are ES-oriented.

**R4. Laziness changes behaviour.**
- (a) `hasOS2` (abstract-services.ts:2616) is evaluated at load.
  - In `<templates-api>` jest specs the profile loads after import, so today `$ES6Routed` is a non-OS2 instance with `options === null` (service.spec.ts:265 asserts this).
  - A lazy getter evaluated after `loadProfile` would return an `OS2Instance`, which changes that assertion and the `SearchService` options.
  - `abstract-service.spec.ts:555` asserts L1 `$ES6` is `Elastic6Instance` with `options null` in a clean env.
- (b) Every `_ES6()`/`_OS2()` registers dynamo-stream listeners at construction (3 at import with no env; 5 with OS2; § 4.1).
  - Today they exist before any stream event.
  - `MyCoreManager` constructors call `$ES6.synchronizer?.enableSynchronization(type)` (abstract-services.ts:276). This would force construction at the first manager instantiation.
  - That is also the only place the routed synchronizer's map is filled, so sync works only if the same instance is the one registered.
- (c) Master-client `auth` is read from config at construction (:1651-1652). Today that is before `config.init()`, so it is `undefined`. Lazy construction after engine init would start sending credentials, if `OS2_MASTER_*` existed. `lemon.yml` has none, and the client currently gets 401 on dev (§ 6).
- (d) The ESM wrapper evaluates every value export at import (§ 4.3). Laziness exists only for CJS consumers unless the wrapper or the export form changes.
- (e) Public members a Proxy or getter must preserve: `.hello()` (own arrow property), `.options`/`.$X`/`.$X2` getters, `.elastic`, `.query`, `.client`, `.synchronizer`, `.fgac`. No `#private` and no `instanceof` blockers (§ 4.2).

**R5. Index-admin and bulk paths use the client directly, not FGAC.**
- `OS2Service.describe/createIndex/deleteIndex` (abstract-services.ts:1699-1776).
- `Elastic6Service.listIndices/destroyIndex/refresh/flush` inherited by `OS2Service` (`showIndexStat` service.ts:250, api-search.ts:282-286).
- `MyCoreManager.doSyncScanLast` `$ES6.client.bulk` (abstract-services.ts:839-850, not in the prior inventory).
- All go through the master client, which is unauthenticated today → 401 on dev. The client swap affects exactly these paths.
- Data-path CRUD and search for OS2 go through FGAC `http-fetch` and do not touch the client.

**R6. Bug carried over: `OS2Service.pushItem`.**
- It reads `res.body?._id/_version` (abstract-services.ts:1926-1927).
- The FGAC result is the unwrapped body, so `_id`/`_version` are always `undefined`.

**R7. Synchronizer path (`createSyncToElastic6`).**
- Defined at cores/lambda/lambda-dynamo-stream-handler.ts:149-217.
- Called only from the `Elastic6Synchronizer` constructor (extended/abstract-service.ts:953-959) and one spec (lambda-dynamo-stream-handler.spec.ts:103).
- Its `updateItem` → on `'404 NOT FOUND'` → `saveItem` fallback (:210-212) relies on:
  - `OS2Service.updateItem` deliberately throwing `404 NOT FOUND` (abstract-services.ts:2025-2033);
  - `Elastic6Service.updateItem`'s `$ERROR` mapping (R1).
- Duplicate instances mean duplicate listeners: 2 per OS2Instance, of which only the one whose map was filled acts. Per-request `_OS2()` in `doPostMigrate` leaks listeners.

**R8. Contradictions with the prior inventory (`docs/v5/B2-inventory.md` § 4).**
- L1 `$ES6` is now at abstract-service.ts:1525, not 1563.
- `mget` is at :1152-1159, not 1157.
- The master auth config reads are at :1651-1652.
- `bulk` is active at abstract-services.ts:840, not only commented at :1870.
- Unconditional `type` sites exist beyond `isOldES6` (R2).
- `abstract-services.spec` reports 17 (12 own).
- `elastic6-query-service.spec` own count is 4 per version × 7 = 28.
- `lambda-dynamo-stream-handler.spec` reports 18 (2 own).
- Everything else re-verified as stated.

**R9. Type leaks for consumers.**
- `AbstractElastic6Instance.client?: elasticsearch.Client` (abstract-service.ts:1050), `OS2Instance.client` (:2290) and `ElasticIndexService.client` (:234) put the client type into public d.ts.
- `<templates-api>/tsconfig.json` has no `skipLibCheck`, so the client package must be resolvable from the consumer, or the type must be replaced.
- The OS 3.9 typings are large (619 `.d.ts`).

**R10. Open questions for the spec writer.**
- Keep or rename `Elastic6*`/`ES6`-named public types used by `<templates-api>`? These are `Elastic6Instance`, `Elastic6Option`, `Elastic6SearchParams`, `SearchProxyBody`, `_OS2`, `_ES6` (spec only) and `$ES6Routed` (§ 3).
- Does `elasticsearch` (whole-module re-export) get a replacement name or disappear? It has 0 consumer uses.
- Should `version`/`docType` stay in `ElasticOption`?
- The analyzer setting uses the `seunjeon_tokenizer` plugin (elastic6-service.ts:1195). `createIndex` on a cluster without the plugin fails. This is unchanged by the client swap.
