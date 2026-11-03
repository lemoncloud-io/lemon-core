# lemon-core v5 B2 (dependencies & coupling) — measured inventory

- Scope: `<lemon-core>` = v5-b2 worktree, branch `feat/v5-b2-deps` @ `f21182d8`. `<templates-api>` = v5-b0 worktree @ `8a1095d`.
- Every line number below is from `<lemon-core>` unless prefixed with `<templates-api>`.
- Measurement method (§5, §6, test runs): `<lemon-core>` has **no `node_modules`**. I built in a scratch copy of the `<lemon-core>` tree with `node_modules` borrowed from the v5-b1 worktree. The two trees are identical: `git diff --stat 33294d18 HEAD` is empty, and `package.json`/`package-lock.json` are byte-equal. No tracked file in any worktree changed. `git status` is clean in all three worktrees.
- Build: `npm run build` exit 0. ESM wrapper: `dist/esm/index.mjs` = 142 named + default.
- Env values, hostnames, account ids: omitted. Only env **names** appear.

---

## 1. `request` → `fetch`

### 1.1 The three call sites (options and response handling are effectively identical)

| | `createSigV4Proxy` | `createHttpSearchProxy` | `createHttpWebProxy` |
|---|---|---|---|
| import | helpers/helpers.ts:28 | extended/abstract-service.ts:49 | cores/api/api-service.ts:488 |
| factory | helpers.ts:871-1040 | abstract-service.ts:1327-1497 (`$X.createHttpSearchProxy`) | api-service.ts:505-616 |
| options object | helpers.ts:945-951 | abstract-service.ts:1405-1411 | api-service.ts:556-562 |
| `request(...)` call | helpers.ts:985 | abstract-service.ts:1443 | api-service.ts:575 |
| `method` | `APIHttpMethod` arg | same | same |
| `uri` | `endpoint + /encoder(host,path1) + /encoder(path,path2) + ?query_string` (helpers.ts:937-941). With a sigClient, replaced by `signedRequest.url` (:965) | same (1399-1403). Signed URL at :1426 | same (551-555). No signing |
| `headers` | `{...this.headers}`. Then sigV4 headers merged (:964). Then every header is re-added as `${relayHeaderKey}${key}` = `String(val)` (:968-977) | `{...headers}`. Then sigV4. Then relay with `${val ?? ''}` (1430-1438) | `{}`. Then relay (565-573) |
| `body` | `$body === null ? undefined : $body` | same | same |
| `json` | `typeof $body === 'string' ? false : true` | same | same |
| `qs` / `timeout` / `encoding` / `gzip` / `followRedirect` | **not set** (the query string is pre-built with `query-string` `stringify`) | not set | not set |
| network error | `reject(error instanceof Error ? error : new Error(GETERR(error)))` (:987) | same (:1445) | same (:577) |
| success test | only `statusCode === 200 \|\| 201`. **Any other 2xx, for example 204, is rejected** (:991) | same (:1449) | same (:582) |
| 400/404 error | `new Error(msg.startsWith('404 NOT FOUND') ? msg : `${statusCode} ${title} - ${msg}`)`. `title` = `statusMessage` for 400 and `'NOT FOUND'` for 404, upper-cased (:992-996) | same | same |
| other non-2xx error | `new Error(`${statusCode} ${statusMessage \|\| 'FAILURE'} - ${msg}`)`. `msg = body ? GETERR(body) : statusMessage` (:1000) | same | same |
| body parse | `request` already JSON-parses when `json:true`. Then a manual re-parse if the body is a string that starts and ends with `{}` or `[]` (:1003-1011) | same | same |
| result | `.then(res => resultKey && res?.[resultKey] !== undefined ? res[resultKey] : res)` | same | same |

`request` behaviour that a `fetch` port must reproduce. Source: `node_modules/request/request.js`.
- With `json:true`, `request` sets `accept: application/json` (request.js:1273-1274). If a body exists, it serializes the body with `safeStringify` and sets `content-type: application/json` when absent (:1285-1290).
- On the response it tries `JSON.parse` on **any** text (:1143-1148). If parsing fails, it silently keeps the string. So `"123"` → number. An empty body → `undefined`. The `{`/`[` heuristic alone would return the string `"123"`.
- With `json:false`, the body is sent as-is. An empty response body → `''` (:1151-1152).
- `request` sends no `accept-encoding`. `fetch` adds gzip/br and decompresses. This is harmless.
- No timeout is set today, so the OS default applies. undici `fetch` has 300 s header and body timeouts by default.
- SigV4 signing: `sig-v4.ts:250` signs `JSON.stringify(body)`. `request` sends `safeStringify(body)`. These match for non-circular bodies. A port must send exactly the string that was signed.
- `doFgacBulk` sends a **string** NDJSON body: `json:false`, plus the `Content-Type: application/json` header from FGAC headers (extended/cores/abstract-services.ts:2160-2170).

**Error-shape risk:** undici `fetch` rejects with `TypeError('fetch failed')`, and the errno is in `err.cause.code`. Several specs skip on `GETERR(e)` containing `ECONNREFUSED` or `ENOTFOUND`: api-service.spec.ts:117,186, storage-service.spec.ts:824, abstract-service.spec.ts:657. A plain port turns those skips into failures unless the cause code is lifted into the message.

### 1.2 Callers

| function | non-spec callers (lemon-core src) | spec callers | templates-api src |
|---|---|---|---|
| `createSigV4Proxy` (public) | extended/cores/abstract-services.ts:2129. This is the `OS2FGACManager.proxy` getter (sigConfig with dummy keys, `Authorization: Bearer <OS2_JWT_TOKEN or OS2_MESSAGE.OS2_SIGNATURE>`). It backs **every** `doFgac*` method (2140-2280): search 2050, create 1801, save 1807/1916, bulk 1864/2460, read 1955, delete 1991, sync 2432 | helpers.spec.ts:689-699: argument validation only, **no network**. sig-v4.spec.ts:38: 2 tests. They are **live** HTTPS to an API Gateway only if `asyncCredentials('lemon'\|'temp')` resolves; otherwise `SKIP` (:45-48, :67-70) | none directly. Indirect via `_OS2(...)` (<templates-api>/src/modules/search/service.ts:107, api-search.ts:643). This path is **active** because <templates-api>/env/lemon.yml sets `OS2_ENDPOINT` |
| `createHttpWebProxy` (public) | api-service.ts:196 (backbone, `BACKBONE_API`) and :200 (direct), both in `APIService.buildClient`. Reached from `new APIService(...)` (:155,:159) and `HttpStorageService` (cores/storage/http-storage-service.ts:32) | api-service.spec.ts (9 tests). Tests at :35, :62, :84 call a **live public HTTPS endpoint, ungated**. :100 uses localhost:8888 (skips on ECONNREFUSED). :178/:207 use backbone (skip on ECONNREFUSED). Mocks tests (:232+) make no network calls. storage-service.spec.ts:812 uses localhost:8113 and skips on ECONNREFUSED | none (no `APIService`/`HttpStorageService` use) |
| `createHttpSearchProxy` (`$X` member, reachable as `$ES6.$X`) | abstract-service.ts:1551 in `_ES6()` when `useProxy` is set (`ES6_IS_PROXY`, or an execute-api endpoint is detected) → `Elastic6Proxy` (:1225) | abstract-service.spec.ts:640, :670. Gated by `PROFILE === 'lemon'` (only `npm run test.lemon`). **Live** when run | none directly. Indirect via `_ES6`/`$ES6Routed` only if `ES6_ENDPOINT` is a proxy URL. In <templates-api>/env/lemon.yml those lines are commented out |

Network mocking: there is **no `nock`, `jest.mock` or `vi.mock`** in any lemon-core spec. Gating uses only PROFILE checks, credential presence, or ECONNREFUSED/ENOTFOUND string sniffing.

---

## 2. lodash (only in `src/cores/dynamo/tools/*`)

Vendored dynogels-style code. Not exported from the package: cores/dynamo/index.ts exports only the 3 services. **20 distinct functions, 100 call sites.** The prior note said 23. My count is 20, using `_.name` tokens.

| file | calls | functions (count) |
|---|---|---|
| expressions.ts (import :13) | 24 | reduce 6, isNull 4, isUndefined 3, keys 2, isPlainObject 2, isEmpty 2, includes 2, isString 1, isDate 1, isArray 1 |
| query.ts (:13) | 17 | merge 4, keys 4, isString 2, isEmpty 2, reduce 1, isUndefined 1, isDate 1, isBoolean 1, isArray 1 |
| scan.ts (:13) | 12 | merge 4, keys 2, isEmpty 2, reduce 1, isUndefined 1, isString 1, isArray 1 |
| serializer.ts (:13) | 38 | isArray 8, isNull 6, isPlainObject 5, map 3, has 3, reduce 2, isUndefined 2, isObject 2, each 2, mapValues 1, isString 1, isFunction 1, isDate 1, isBoolean 1 |
| utils.ts (:13) | 9 | isEmpty 2, reduce 1, omitBy 1, omit 1, isUndefined 1, isString 1, isNull 1, isArray 1 |

### 2.1 `_.merge` — all 8 calls

| site | expression | shapes |
|---|---|---|
| query.ts:190 | `_.merge({}, expressionAttributeNames, this.request.ExpressionAttributeNames)` | flat `{'#attr':'attr'}` string maps |
| query.ts:265 | `_.merge({}, this.request, { TableName })` (`buildRequest`) | the whole request object. A deep copy of nested `ExclusiveStartKey` and `ExpressionAttributeValues`/`Names` |
| query.ts:270 | `_.merge({}, condition.attributeNames, request.ExpressionAttributeNames)` | flat string map |
| query.ts:271 | `_.merge({}, condition.attributeValues, request.ExpressionAttributeValues)` | `{':v': rawValue}`. Values are raw JS (`v1`/`v2` at expressions.ts:202,206; IN-values via `formatAttributeValue`: Date→ISO, query.ts:283) |
| scan.ts:71, :72-76 | same as query.ts:270/271 (`addFilterCondition`) | same |
| scan.ts:118 | same as query.ts:190 | same |
| scan.ts:195 | `buildRequest`, same as query.ts:265 | same |

Value keys are made unique by `uniqAttributeValueName` (expressions.ts:151). So in practice the merges never deep-merge colliding keys. They act as "copy and overlay". `merge` skips `undefined` source values. It deep-clones plain objects, arrays and Buffers/typed arrays, and keeps `Set` by reference. `{...a, ...b}` matches for the name/value maps. Only `buildRequest`'s deep copy needs a small `clonePlain` helper, or a decision that aliasing is acceptable.

### 2.2 Replacement difficulty

- **Trivial native** (typed call sites):
  - `isNull` → `=== null`.
  - `isUndefined` → `=== undefined`.
  - `isString`, `isBoolean` → `typeof`.
  - `isArray` → `Array.isArray`.
  - `isDate` → `instanceof Date`.
  - `isFunction` → `typeof`.
  - `keys` → `Object.keys`.
  - `includes` (arrays only) → `.includes`.
  - `has` → `Object.hasOwn`.
  - `each`/`reduce`/`map` over arrays or objects → `Object.entries`/`Array.prototype`. Note that `reduce` at expressions.ts:21,44,65,75,107 and serializer.ts:169,213 iterates **objects**.
  - `omit(params, hashKey, rangeKey)` (utils.ts:127) → rest-destructure.
- **`isEmpty`**: all 8 sites take a string, an array or a plain object (expressions.ts:81,110; query.ts:273,277; scan.ts:78,82; utils.ts:23,24). The lodash quirk `_.isEmpty(5) === true` is never hit. Write a one-line helper.
- **Needs a small hand-written helper**:
  - `isPlainObject`: 7 sites. It must reject `Set`, `Uint8Array` and class instances from lib-dynamodb unmarshalling. It gates `$add`/`$del` detection (expressions.ts:84,88; serializer.ts:218,220) and the recursion (serializer.ts:127,177,247).
  - `isObject`: true for functions too (serializer.ts:83,172).
  - `mapValues`/`map` swap by reference: serializer.ts:238-241.
  - `omitBy`: utils.ts:19. lodash also walks inherited keys, which is irrelevant here.
  - `merge`: see §2.1.
- **Dead code on the lemon-core call path**: services call only `Query.where/ascending/descending/limit/startKey/buildRequest` (dynamo-query-service.ts:144-168) and `Scan.limit/startKey/filterExpression/expressionAttributeNames/Values/buildRequest` (dynamo-scan-service.ts:155-221). `Serializer.buildKey` is used via `startKey`.
  - Never referenced: `utils.omitNulls`, `expressions.serializeUpdateExpression`, `serializer.deserializeItem`.
  - `utils.paginatedRequest`/`mergeResults` are used only by Query/Scan `exec`-style paths that the services never call.
  - Trimming these removes `omitBy`, `mapValues` and most of `serializer.ts`'s lodash, and also the `async` dependency (utils.ts:14).
- **Existing helpers to reuse**: `src/lib/` holds only `dynamodb-value.ts`. `src/common/` has `onlyDefined` (test-helper.ts:58) and `$U.cleanup` (engine/utilities.ts:418). There is no `isPlainObject`/`isEmpty`/deep-merge helper anywhere in src.
- Test coverage: `cores/dynamo/tools/dynamo.spec.ts` has 2 tests and no network. The dynamo service specs are PROFILE-gated.

---

## 3. Redis / Memcached

### 3.1 `CacheBackend` (cores/cache/cache-service.ts:618-730, not exported)

```ts
interface CacheBackend {
  readonly name: string;
  set<T>(key: string, val: T, ttl?: number): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  mset<T>(entries: ItemEntry<T>[]): Promise<boolean>;      // ItemEntry {key; val; ttl?} :608-612
  mget<T>(keys: string[]): Promise<{ [key: string]: T }>;
  getset?<T, U>(key: string, val: T): Promise<U | undefined>;
  pop?<T>(key: string): Promise<T | undefined>;
  incr(key: string, increment: number): Promise<number>;
  keys(): Promise<string[]>;
  has(key: string): Promise<boolean>;
  del(key: string): Promise<boolean>;
  expire(key: string, ttl: number): Promise<boolean>;
  ttl(key: string): Promise<number | undefined>;
  close(): Promise<void>;
}
```

### 3.2 Options, factory, class boundaries

- `CacheOptions` (:22-39): `{ type?: 'memcached' | 'redis'; endpoint?; ns?; defTimeout? }`. The **`type` union has no `'local'`/`'dummy'`**.
- `CacheService.create(options?, maker?)` (:176-200): **the default is `type = 'redis'`** (:177). The endpoint falls back to env `CACHE_ENDPOINT` (:178). The timeout falls back to env `CACHE_DEFAULT_TIMEOUT`. `switch` → `MemcachedBackend` (:193) or `RedisBackend` (:196); anything else throws.
- `DummyCacheService.create` (:540-555) → a singleton `NodeCacheBackend` (node-cache).

| class | lines | client construction |
|---|---|---|
| `CacheService` | 122-520 | — |
| `DummyCacheService` | 525-561 | — |
| `NodeCacheBackend` | 739-847 | `new NodeCache` (:755) |
| `MemcachedBackend` | 853-1068 | `new Memcached(endpoint \|\| 'localhost:11211')` in the **sync constructor** (:888) |
| `RedisBackend` | 1074-1224 | `new IORedis(endpoint \|\| 'localhost:6379')` in the **sync constructor** (:1096) |

### 3.3 `RedisStorageService` / `DummyRedisStorageService` (cores/storage/redis-storage-service.ts)

- `RedisOptions` (:23-36): `{ endpoint?; tableName: string | number; defTimeout? }`.
- `RedisStorageService<T>` (:44-379) public surface:
  - statics: `ENV_REDIS_ENDPOINT = 'MY_REDIS_ENDPOINT'`, `CAS_MAX_RETRIES`.
  - readonly: `tableName`, `ttl`, `protected redis: Redis`.
  - constructor `(options: RedisOptions)` → `new IORedis(...)` (:85 / :93).
  - methods: `hello`, `quit`, `read`, `readOrCreate`, `save`, `update`, `increment`, `delete`, `asKey`, `serialize`, `deserialize`.
- `DummyRedisStorageService<T>` (:385-415): the constructor connects to `localhost:6379` with an incrementing db index. Adds `hello` and `truncate()` (`flushdb`).
- Consumers: lemon-core non-spec: **none**, apart from the barrel export (cores/storage/index.ts:11). Spec: redis-storage-service.spec.ts. <templates-api> src: **none**.
- `CacheService` consumers:
  - non-spec: extended/abstract-service.ts:677 only.
  - spec: cache-service.spec.ts.
  - <templates-api>: none.

### 3.4 `AbstractProxy` CACHE_ENDPOINT branch

- extended/abstract-service.ts:669-679: `if (cacheScope && $U.env('CACHE_ENDPOINT','').startsWith('redis:')) this.cache = CacheService.create({ type:'redis', endpoint, ns: cacheScope })`.
- `MyCoreProxy` **always** passes a cacheScope (`${NAME}:${service.NS}:`, extended/cores/abstract-services.ts:917-918). So any consumer with `CACHE_ENDPOINT=redis:...` gets an `IORedis` connection **per proxy instance (per request), never closed**.
- `this.cache` is **never read inside lemon-core**. The grep for `.cache.get/set/...` finds nothing outside cache-service.ts.
- <templates-api> uses `MyCoreProxy` (src/service/backend-proxy.ts:35) but sets no `CACHE_ENDPOINT` and never reads `.cache`.

### 3.5 Spec gating and counts (scratch-copy run, clean env, no local redis or memcached listening)

| spec | own tests | gating | vitest-reported |
|---|---|---|---|
| cache-service.spec.ts | 14 `it` + 3 `_it`. Dummy: 6+1. Memcached: 4+1. Redis: 4+1 | Live tests return early unless a TCP probe to localhost:11211/6379 succeeds (`isLocalCacheAvailable`, :24-39). The `'hello'` tests (:282, :448) construct real Memcached/IORedis clients **ungated** and pass because no command is sent. No PROFILE gating | 17 passed |
| redis-storage-service.spec.ts | 3 `it` | `CRUD` (:66-67) is probe-gated. `hello`/`serialize` construct `DummyRedisStorageService` (IORedis) **ungated** | 20 passed. The spec imports `isLocalCacheAvailable` from cache-service.spec.ts, which re-registers that file's 17 tests |

### 3.6 Public names that disappear (`etc/api-names.v4.txt`)

- If Redis and Memcached are both removed: `RedisOptions` (212), `RedisStorageService` (213), `DummyRedisStorageService` (89).
- `CacheService`, `DummyCacheService`, `CacheOptions`, `CacheEntry`, `CacheKey`, `CacheKeyMakable`, `CacheSupportable`, `KeyValueMap`, `Timeout`, `sleep`, `toTTL` and `fromTTL` can stay. But `CacheOptions.type`'s literal union changes, and `CacheService.create()`'s default `'redis'` must change. That is a behavioural break for callers that pass no `type`.
- `AbstractProxy.cache?: CacheService` stays as a type.

---

## 4. OpenSearch / `@elastic/elasticsearch`

### 4.1 Installed packages

| | `@elastic/elasticsearch` | `@opensearch-project/opensearch` |
|---|---|---|
| lemon-core node_modules (v5-b1, identical lock) | **7.12.0** (`package.json` pins `"7.12"`) | absent |
| <templates-api>/node_modules | absent. It resolves through the `lemon-core` npm link | absent |

Other installed versions: ioredis 5.2.3, memcached 2.2.2, request 2.88.2, lodash 4.18.1, node-cache 5.1.2. `@types/ioredis ^4.28.10` is a runtime dependency even though ioredis 5 ships its own types.

### 4.2 Client construction and API surface

Construction (both in **sync** code):
- cores/elastic/elastic6-service.ts:206 `ElasticIndexService.instance()` (static), called from the constructor :226.
- extended/cores/abstract-services.ts:1655 `OS2Service.instance()` (adds `auth` from config `OS2_MASTER_UID`/`OS2_MASTER_PWD`, :1650-1652).
- Both read env `elasticsearch_certificate` as the `ssl.ca`.

| API | lines (elastic6-service.ts unless noted) | response fields read |
|---|---|---|
| `client.info()` | 371 | `info.body.version.number` (373) |
| `client.cat.indices()` | 483 | `res` or `res.body` array (487) |
| `client.indices.getMapping()` | 513, 685; abstract-services.ts:1714 | `res.body[index].mappings` (522, 687) |
| `client.indices.create()` | 563; abstract-services.ts:1744 | `res.statusCode`, `res.body.shards_acknowledged` (576-578) |
| `client.indices.delete()` | 593; abstract-services.ts:1769 | `res.statusCode`, `res.body.acknowledged` (605-607) |
| `client.indices.refresh()` / `flush()` | 622 / 646 | `res.body` |
| `client.indices.getSettings()` | 670; abstract-services.ts:1699 | `res.body[index].settings` (680) |
| `client.create()` → falls back to `client.index()` on 409 | 722 → 732 | `res.body._version`, `res.body._id` (739-740) |
| `client.index()` | 766 | `res.body._id/_version` (776-777) |
| `client.get()` | 805 | `res.body._id/_version/_source` (816-818) |
| `client.delete()` | 841 | `res.body._id/_version/_source` (853-855) |
| `client.update(params, options)` | 934 | `res.body._id/_version` (959-960). Painless `ctx._source` scripts at 894-926 |
| `client.search()` | 987 | returns `$res.body` (1001). Then `hits.hits[]._source/sort` (1014-1024) |
| `client.mget()` | extended/abstract-service.ts:1157 | `$res.body.docs[].found/_source` |
| (commented) `client.bulk` | abstract-services.ts:1870 | — |
| Error parsing `$ERROR.asError` | 1346-1385 | ES7+ `ResponseError`: `E.meta.statusCode`, `meta.body.error.reason`, `caused_by.caused_by.reason`. ES6.2: `E.response` → `error.root_cause/status/reason`, `found`, `result` |

The OS2 data path does **not** use the ES client for CRUD or search. `OS2Service` overrides these to go through `this.$fgac.doFgac*`, which is `createSigV4Proxy`, which is `request` (abstract-services.ts:1801-2050). The ES client is used by OS2 only for index admin (1699-1769). For OS2, the `request`→`fetch` work (§1) is on the hot path.

### 4.3 Version predicates and `EngineType`

- `EngineType = 'os' | 'es'` (elastic6-service.ts:110). Used in `ParsedVersion.engine` (:117).
- `parseVersion` sets `engine: major < 6 ? 'os' : 'es'` (:441). This is a heuristic: OpenSearch 1.x/2.x → `'os'`.
- `isOldES6` (:339-341): `major<7 && es`. `isOldES71` (:346-348). `isLatestOS2` (:353-355).
- Non-spec use is **only `isOldES6`**, at :714, :731, :888, :981 (adds `type` to params). `isOldES71`/`isLatestOS2` appear only in elastic6-service.spec.ts (18 references).
- Public: `EngineType` (names:129), `ParsedVersion` (names:202).

### 4.4 Module-load-time instances

- extended/abstract-service.ts:1563 `export const $ES6 = _ES6()` (L1; reads `ES6_ENDPOINT`, `ES6_INDEX`, `ES6_VERSION`, `ES6_DOCTYPE`, `ES6_AUTOCOMPLETE_FIELDS`, `ES6_IS_PROXY`, `MY_DYNAMO_TABLE`).
- extended/cores/abstract-services.ts:2616-2618 `hasOS2 = OS2_ENDPOINT.startsWith('https://')`; `$OS2 = _OS2()`; `$ES6 = hasOS2 ? _OS2() : _ES6()`. `$ES6Routed = $ES6` (:2627). `_OS2` reads `OS2_ENDPOINT`, `OS2_INDEX`, `OS2_VERSION`, `OS2_DOCTYPE`, `OS2_AUTOCOMPLETE_FIELDS`. FGAC reads `OS2_JWT_TOKEN`, `OS2_MESSAGE` and config `OS2_SIGNATURE`.
- Root barrel: index.ts:40 exports the L1 `$ES6`. :42 exports `$ES6Routed`. `$OS2`, `_OS2` and `OS2*` come via `export * from './extended/cores/'` (:37).
- One `OS2Instance` builds **3 ES clients**:
  1. `Elastic6Instance` super → `Elastic6Service`.
  2. `OS2Service` super → `ElasticIndexService.instance`.
  3. `OS2Service.instance` (abstract-services.ts:2318-2319, 1670-1675).

### 4.5 Specs

| spec | tests | endpoint configuration | runs under plain `npm test`? |
|---|---|---|---|
| cores/elastic/elastic6-service.spec.ts | 10 `it`: 1 dummy, 2 `$ERROR` parsers, 7 real servers (ES 6.2/7.1/7.2/7.10, OS 1.1/1.2/2.13) | hard-coded `https://localhost:<port>` SSH-tunnel map (:24-34). **No env** | yes. The 7 real-server tests return early via `canPerformTest` (:249-263) on ECONNREFUSED, `Connection Error`, `unknown error` or 404, so they pass vacuously |
| cores/elastic/elastic6-query-service.spec.ts | 4 `it`. vitest reports 38 because it imports elastic6-service.spec | same instance map. 2 tests are also `if (!PROFILE) return` (:61, :101) | yes, vacuous |
| cores/elastic/hangul-service.spec.ts | 5 | none (pure) | yes |
| extended/abstract-service.spec.ts | 13 `it` + 1 `_it` | proxy and `_ES6` tests gated by `PROFILE === 'lemon'` (:629-690) | gated parts only under `test.lemon` |
| extended/cores/abstract-services.spec.ts | 12 | **no OS2 test at all**. `_OS2`, `OS2Service`, `OS2FGACManager` and `OS2Instance` have **zero spec coverage** in lemon-core | — |

Local run (clean env): elastic6-service 10, elastic6-query 38 and hangul 5 all pass.

### 4.6 Public names (`etc/api-names.v4.txt`, 35 matches for Elastic|ES6|elasticsearch|OS2|Hangul|Search)

- `$ES6`, `$ES6Routed`, `$OS2`, `$hangul`, `_ES6`, `_OS2`, `elasticsearch` (value).
- `AbstractElastic6Instance`, `DummyElastic6Service`, `Elastic6Instance`, `Elastic6QueryService`, `Elastic6Service`, `Elastic6Synchronizer`, `ElasticIndexService`, `HangulService`, `OS2FGACManager`, `OS2Instance`, `OS2Service` (value+type).
- `AutocompleteSearchParam`, `Elastic6ContructParams`, `Elastic6Item`, `Elastic6Option`, `Elastic6SearchParams`, `Elastic6SimpleQueriable`, `ElasticItem`, `ElasticOption`, `OS2Option`, `SearchBody`, `SearchParam`, `SearchProxyBody`, `SearchQuery`, `SearchResponse`, `SearchResult`, `SearchType`, `SimpleSearchParam` (type).
- Plus `EngineType`, `ParsedVersion`.
- **`elasticsearch` is a re-export of the whole `@elastic/elasticsearch` module** (elastic6-service.ts:24, `export { elasticsearch, $hangul }`). Any client swap removes or changes it.

### 4.7 <templates-api> imports (search + backend-service)

| file:line | names from `lemon-core` |
|---|---|
| src/modules/search/model.ts:14 | `CoreModel, QueryTerm, SortTerm, SearchQuery, SearchBody` |
| src/modules/search/model.ts:16 | `_log, _inf, _err, SearchResult` |
| src/modules/search/service.ts:12 | `$U, _err, _inf, _log, $protocol, SimpleSet, GETERR, NextContext` |
| src/modules/search/service.ts:13-24 | `…, GeneralKeyMaker, GeneralModelFilter, ProxyStorageService, StorageMakeable, TypedStorageService, UniqueFieldManager, Elastic6SearchParams, Elastic6Instance` |
| src/modules/search/service.ts:25-26 | `$T`; `_OS2` (used :107 `_OS2(options)` in the `SearchService` constructor; `.elastic.listIndices()` :250; `.search()` :199) |
| src/modules/search/api-search.ts:15 | `$T, $U, _log, _inf, _err, NUL404, GETERR, $info, $slack` |
| src/modules/search/api-search.ts:16-23 | `NextHandler, GeneralWEBController, loadJsonSync, doReportError, Elastic6SearchParams, SearchProxyBody` |
| src/modules/search/api-search.ts:25 | `_OS2, $ES6Routed as $ES6`. Uses `$ES6.query.searchSimple` :129, `$es6.elastic.createIndex/destroyIndex/describe` :282-286, `_OS2().synchronizeContents` :643-649 |
| src/modules/search/api-search.spec.ts:14-15 | `loadProfile` (deep `lemon-core/dist/environ`); `expect2, $U` |
| src/modules/search/service.spec.ts:14-18 | `loadProfile` (deep); `do_parrallel, expect2, GETERR, NUL404, _it, $U, _ES6`; `$ES6Routed as $ES6` |
| src/service/backend-service.ts:10-11 | `$U, _log, _inf, _err`; `NextContext, NextIdentityAccess, $protocol, getIdentityId` |
| src/service/backend-service.ts:15 | `MyCoreService, $ES6Routed as $ES6` (`$ES6.options` → `new SearchService(...)` at :49, :60-61) |

<templates-api> has **no direct import** of `request`, `lodash`, `@elastic/*`, `ioredis` or `@aws-sdk/*` in src. It also never calls `createHttpWebProxy`, `createSigV4Proxy`, `createHttpSearchProxy`, `APIService`, `CacheService` or `RedisStorageService`.

---

## 5. AWS SDK lazy-load feasibility

12 files import `@aws-sdk/*`. 11 are in the build. `tools/aws-lambda-helper.example.ts` is also compiled; it is not excluded by tsconfig.

### 5.1 Construction sites (TS-AST scan: innermost enclosing function and `async` flag)

| file | site → enclosing | async? |
|---|---|---|
| cores/aws/aws-kms-service.ts | `new KMSClient` :35 in module fn `instance()`, cached by **public sync `AWSKMSService.instance(): KMSClient`** (:102-105). Commands :120,138,160,189,211 run in async methods | **SYNC public getter** |
| cores/aws/aws-s3-service.ts | `new S3Client` :161 in module `instance()`, via **`protected instance(): S3Client`** (:196-197). Commands :215,283,318,346,371,398,449,466 run in async methods | **SYNC protected getter** |
| cores/aws/aws-sns-service.ts | `new IAMClient`/`GetUserCommand` :107-108, `new STSClient`/`GetCallerIdentityCommand` :115-117. All inside the Promise executor of `async accountID` (:104). `new SNSClient`/`PublishCommand` :159-161 in async `publish` | async (lazy-able) |
| cores/aws/aws-sqs-service.ts | `new SQSClient` + command :127-128, :156-157, :198-199, :217-218. All in async methods | async |
| cores/dynamo/dynamo-service.ts | `new DynamoDBClient` :141 and `new DynamoDBStreamsClient` :142 in **public static sync `DynamoService.instance(region)`**. It returns `{dynamo, dynamostr, dynamodoc}` (:138-160). `new DynamoDBClient` :151 + `DynamoDBDocumentClient.from` :152 in an async memo. Commands :393,408,429,489,595,645,737,768,826 run in async paths | **SYNC public static** |
| cores/dynamo/dynamo-service.ts | `StreamViewType.NEW_AND_OLD_IMAGES` value at :209 in **public sync `prepareCreateTable`** | **SYNC value use**. Replace with the literal `'NEW_AND_OLD_IMAGES'` |
| cores/dynamo/dynamo-query-service.ts | `new QueryCommand` :110 in async `queryRangeBy` | async |
| cores/dynamo/dynamo-scan-service.ts | `new ScanCommand` :129 in async `scan` | async |
| cores/lambda/lambda-web-handler.ts | `new STSClient`/`GetCallerIdentityCommand` :578-579 in async `getAccountId` | async |
| cores/protocol/aws-lambda-helper.ts | `new LambdaClient`/`InvokeCommand` :48-50 in async `invokeLambda` | async |
| cores/protocol/protocol-service.ts | SNS :367-369, SQS :415-417, SNS :464-466, all in async methods | async |
| tools/tools.ts | `fromIni(...)` :65 in async `asyncCredentials`. **`fromIni(...)` :131 in public sync `awsConfig()`** (:96-134), which 16 non-spec call sites use. It returns a provider *function*, so it can be wrapped lazily, e.g. `async (id) => (await import(...)).fromIni(...)(id)` | **SYNC value use (wrappable)** |
| tools/aws-lambda-helper.example.ts | `fromIni` :156 | example |

Sync blockers to restructure:
- `DynamoService.instance()` (public static, returns SDK client types).
- `AWSKMSService.instance()` (public).
- `AWSS3Service.instance()` (protected).
- `awsConfig()` → `fromIni`.
- `prepareCreateTable` → `StreamViewType`.

Side finding: `DynamoService._dynamo`/`_dynamostr` (:130-131) are **never assigned**. So every `DynamoService.instance()` call creates a new `DynamoDBClient` and `DynamoDBStreamsClient`, and every `readItem`/`saveItem`/... calls `instance()` (:455,593,621,735,766,796; query :109; scan :128).

### 5.2 Public `.d.ts` that reference `@aws-sdk/` (after build)

| d.ts | leaked types |
|---|---|
| dist/cores/aws/aws-kms-service.d.ts | `KMSClient` (`_instance`, `instance()`), `SigningAlgorithmSpec` |
| dist/cores/aws/aws-s3-service.d.ts | `S3Client` (`instance()`), `_Object` (`export type S3Object`) |
| dist/cores/dynamo/dynamo-service.d.ts | `KeySchemaElement`, `DynamoDBClient`, `DynamoDBStreamsClient`, `DynamoDBDocumentClient`, `CreateTableCommandOutput`, `DeleteTableCommandOutput` |
| dist/cores/protocol/protocol-service.d.ts | `PublishCommandInput` (`export type MySNSEventParam`), `SendMessageCommandInput` (`transformEvent` return) |
| dist/tools/tools.d.ts | `RuntimeConfigAwsCredentialIdentityProvider` via a **deep path** `@aws-sdk/types/dist-types/identity/AwsCredentialIdentity`. `@aws-sdk/types` is **not** a declared dependency |

Other optional-dependency type leaks:
- `@elastic/elasticsearch`: dist/extended/abstract-service.d.ts:21, dist/cores/elastic/elastic6-service.d.ts:2.
- `ioredis`: dist/cores/storage/redis-storage-service.d.ts:10.
- `memcached`: only as the string literal in `CacheOptions.type`.
- `request` and `lodash`: none.

### 5.3 How `tsc` (module: commonjs, target ES2024, esModuleInterop) emits `await import()`

There is no existing dynamic import in src. I compiled a probe in the scratch copy:

```js
const { STSClient } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/client-sts')));
```

So it becomes a deferred `require` in CJS: lazy, and it works with the existing ESM wrapper. `import type { STSClient }` is erased from JS but **kept in `.d.ts`**. Lazy loading does not remove type leaks.

---

## 6. Measurement (built `dist`, `env -i PATH HOME node`)

"files" = `require.cache` entries whose last `node_modules/<pkg>` owner matches. "substr" = path contains `/@aws-sdk/` (includes nested `@smithy` etc.). The prior figure of 377 is the substr count.

| probe | total cache | `@aws-sdk` files (substr) | `@aws-sdk` pkgs / `client-*` | `@smithy` | `@elastic` | `ioredis` | `memcached` | `request` | `lodash` | time |
|---|---|---|---|---|---|---|---|---|---|---|
| (a) `require('./dist/engine')` | 338 | 113 (137) | 23 / 3 (sns, iam, sts) | 85 | 0 | 0 | 0 | 0 | 0 | ~215 ms |
| (b) `require('./dist/index')` | 1066 | 288 (377) | 44 / 9 | 144 | 84 | 33 | 4 | 13 | 1 | ~585 ms |
| (c) (b) + `OS2_ENDPOINT=https://example.invalid` | 1066 | 288 (377) | 44 / 9 | 144 | 84 | 33 | 4 | 13 | 1 | — |

- (c) does not throw and makes no network call at import. It **constructs 6 `@elastic/elasticsearch` `Client`s at import**: 2 `OS2Instance`s (`$OS2` and the routed `$ES6`) × 3 clients each. I counted them by subclassing `Client` before load. `$ES6Routed.hello()` = `OS2Instance`. The root `$ES6.hello()` = `Elastic6Instance` with no client. With `ES6_ENDPOINT=https://example.invalid` instead: 2 clients. With neither: 0.
- Import side effects in a clean env (logged): `ConfigService()` and `AWSSQSService()` are constructed at load. Neither builds an SDK client.
- Engine AWS edges:
  - engine.ts:32 → `tools/` → `@aws-sdk/credential-providers` (tools alone: 34 files / 52 substr / 12 pkgs).
  - engine.ts:33 → `aws-sns-service` (total 113 / 137 / 23 pkgs, with client-sns/iam/sts).
  - **Both edges must go** for `$U`/engine to be AWS-free.
- Isolated closures (`require(pkg)` alone):

  | package | files | packages | time |
  |---|---|---|---|
  | `request` | 177 | 43 | 54 ms |
  | `@elastic/elasticsearch` | 96 | 11 | 57 ms |
  | `ioredis` | 51 | 13 | 33 ms |
  | `memcached` | 14 | 6 | 9 ms |
  | `lodash` | 1 | 1 | 9 ms |
  | `node-cache` | 3 | 2 | 5 ms |

  `request`'s transitive deps visible in (b) include ajv 41, sshpk 25, har-schema 19, tough-cookie 7.

---

## 7. Risks and questions for the spec writer

1. **Contradictions with prior notes:**
   - lodash = 20 functions / 100 calls, not 23.
   - The 377 `@aws-sdk` figure is a path-substring count. By owning package it is 288 files across 44 packages (9 `client-*`), plus 144 `@smithy` files.
   - Engine AWS loading has **two** edges, engine.ts:32 tools and :33 SNS, not one.
2. **The OS2 hot path depends on `request`, not on the ES client.** `OS2FGACManager` → `createSigV4Proxy` serves all OS2 CRUD, search and bulk. The `fetch` port is OS2-critical. Lemon-core has **no OS2 spec** to catch regressions. Only <templates-api> (`test.lemon` profile with `OS2_ENDPOINT`) exercises it.
3. **fetch error shape:** `TypeError('fetch failed')` with `cause.code` breaks the ECONNREFUSED/ENOTFOUND skip logic in api-service.spec, storage-service.spec and abstract-service.spec. The port must surface `cause.code` in the message, or the specs must change.
4. **Success = 200/201 only.** A 204 from OpenSearch (or anything) is rejected today. Decide whether to preserve this.
5. **JSON parse parity:** `request` `json:true` parses any JSON text, and an empty body → `undefined`. Mirror this or document the change. Bulk NDJSON goes through the string-body path.
6. **Sync blockers for lazy AWS:**
   - `DynamoService.instance()` (public static; returns SDK client types; also re-creates clients on every call because of the unassigned caches).
   - `AWSKMSService.instance()` (public).
   - `AWSS3Service.instance()` (protected).
   - `awsConfig()` → `fromIni` (sync, 16 callers; wrappable).
   - `prepareCreateTable` → `StreamViewType` (replace with a literal).
7. **Type leaks persist after lazy loading.** Five d.ts files reference `@aws-sdk/*`, one through an undeclared deep path. `@elastic/elasticsearch` and `ioredis` leak via d.ts too. <templates-api> `tsconfig.json` has **no `skipLibCheck`**. If these become optional peers, consumer `tsc` fails with TS2307 unless the peers are installed, or the d.ts are rewritten to local structural types.
8. **Public names at stake beyond the obvious lists:**
   - `elasticsearch` (the whole client module re-export), `$hangul`, `EngineType`, `ParsedVersion`.
   - `S3Object` (= SDK `_Object`), `MySNSEventParam` (= SDK `PublishCommandInput`).
   - `APIService`, `HttpStorageService`, `MocksAPIService`, `createHttpWebProxy`, `createSigV4Proxy` (all `request`-backed).
   - `RedisOptions`, `RedisStorageService`, `DummyRedisStorageService`.
   - The `CacheOptions.type` literal union.
9. **`CacheService.create()` defaults to `'redis'`.** Removing Redis changes the behaviour of a no-arg call. `AbstractProxy` opens a per-request, never-closed IORedis when `CACHE_ENDPOINT=redis:*`, and lemon-core never reads `this.cache`. A removal candidate, but consumers may read `proxy.cache`; <templates-api> does not.
10. **Import-time work.** Setting `OS2_ENDPOINT` builds 6 ES clients and touches the config service at import (`OS2Service.instance` reads `OS2_MASTER_UID/PWD` from `$cores.config`). Any "lazy search" design must handle module-top `$OS2`/`$ES6`/`$ES6Routed` (abstract-services.ts:2617-2627) and L1 `$ES6` (abstract-service.ts:1563).
11. **Harness (<templates-api> boot):**
    - `backend-service.ts:49` reads `$ES6Routed.options` and constructs `SearchService`, which calls `_OS2(options)`, at construction.
    - api-search uses `$ES6.query.searchSimple`, `.elastic.createIndex/destroyIndex/describe/listIndices` and `_OS2().synchronizeContents`.
    - Renaming or removing `Elastic6Instance`, `Elastic6Option`, `Elastic6SearchParams`, `SearchProxyBody`, `_OS2`, `_ES6` or `$ES6Routed`, or changing the `.elastic`/`.query` member shapes, breaks the boot or the compile.
    - `node_modules/lemon-core` is an npm link to v5-b1. <templates-api> has no `@elastic/elasticsearch` of its own, so it relies on lemon-core's copy.
12. **Spec count inflation.** vitest re-registers imported spec files. redis-storage = 3 own + 17 from the cache spec. elastic6-query = 4 own, 38 reported. Removing cache-service.spec or elastic6-service.spec changes other files' counts. All Redis, Memcached and ES live tests currently pass vacuously without local servers. The `npm test` baseline does not prove these backends work.
13. **Small items:**
    - `async` is a dependency used only by `dynamo/tools/utils.ts:14` (`paginatedRequest`, dead on the service path).
    - `@types/ioredis@4` is a runtime dependency alongside ioredis 5.
    - The `engine` heuristic is `'os'` iff major < 6.
    - The ES client config reads lower-case env `elasticsearch_certificate`.
