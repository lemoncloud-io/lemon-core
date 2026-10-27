# UPGRADE GUIDE: lemon-core V4 to V5

> Work in progress. This guide grows with each v5 bundle. This revision covers B1 (packaging), B2-a (dependencies: `request`, `lodash`, `ioredis`, `memcached` removed) and B2-b (search: OpenSearch client, ES names, lazy `$OS2`).

---

## 1. Node.js 24

lemon-core v5 requires Node.js 24 (`engines.node >= 24.0.0`).

```bash
nvm install 24
nvm use 24
```

* Update `.nvmrc` to `24` (lemon-core uses `24.15.0`).

```diff
-  22.15.1
+  24.15.0
```

* `npm` only warns when `engines` does not match. Set `engine-strict=true` in your own `.npmrc` if you want the install to fail.
* The Lambda runtime of a deployed service is a separate change and is not part of this step.

---

## 2. ESM `import` and the env order

lemon-core is still built as CommonJS. v5 adds an ESM entry (`dist/esm/index.mjs`) that re-exports the same CommonJS module, so `import` and `require` give the **same instances** (`$engine`, the engine modules, the handlers).

```ts
// CommonJS (unchanged)
const { $engine, $U } = require('lemon-core');

// ESM
import { $engine, $U } from 'lemon-core';
import $core from 'lemon-core'; // { engine, cores, tools, controllers } - same as require('lemon-core').default
```

* In ESM, the default import is the root default export (`{ engine, cores, tools, controllers }`), the same object as `require('lemon-core').default`.
* Named ESM exports are copied once when lemon-core is loaded. Do not reassign lemon-core exports at run time.

**Env order.** lemon-core reads some env values while it is imported. In CommonJS you can set `process.env` before `require('lemon-core')`. In ESM, static `import` statements run before any code of the importing module, so you **cannot** set env values before a static `import 'lemon-core'`. Load the env first, then import lemon-core dynamically:

```js
// main.mjs
const { loadEnviron } = await import('lemon-core/dist/environ');
process.env = loadEnviron(process); // same loader as `require('lemon-core/dist/environ').default`
const { $engine } = await import('lemon-core');
```

* Any env loader works (for example `lemon-devkit`); what matters is that it runs before the first `import('lemon-core')`.

---

## 3. `exports` boundary and the `./dist/*` transition

v5 adds an `exports` map to `package.json`. With `exports`, Node resolves only the listed paths.

| Path | Use |
| --- | --- |
| `lemon-core` | root (CommonJS `require` or ESM `import`) |
| `lemon-core/testing` | test helpers (section 4) |
| `lemon-core/dist/environ` | compatibility (env loader) |
| `lemon-core/dist/cores/lambda/lambda-web-handler` | compatibility |
| `lemon-core/dist/extended/cores` | compatibility (directory path, listed explicitly) |
| `lemon-core/dist/*` | **transition only**: any other file under `dist/` |
| `lemon-core/package.json` | tools |

* **Transition pattern.** `lemon-core/dist/<file>` keeps working in v5 for any file (for example `lemon-core/dist/engine/builder`). This pattern **will be removed in v6**. Move deep imports to the root (`lemon-core`) or to a listed sub-path during v5.
* **Directory paths are blocked.** A deep path that relies on a directory `index` (for example `lemon-core/dist/extended`) is not resolved any more (`ERR_PACKAGE_PATH_NOT_EXPORTED` / `MODULE_NOT_FOUND`). Only `lemon-core/dist/extended/cores` is listed.
* **`moduleResolution: node` consumers are not affected.** TypeScript with `moduleResolution: node` (node10) ignores `exports` and keeps using `main` / `types`, which are unchanged. Node's own `require` does read `exports` at run time, so the rules above apply to the run time in every case.
* Types are one set (`dist/**/*.d.ts`) for both `import` and `require`.

Check your service:

```bash
grep -rn "lemon-core/dist" src | grep -v node_modules
```

---

## 4. `lemon-core/testing`

The test helpers have their own sub-path:

```ts
import { expect2, GETERR, waited } from 'lemon-core/testing';
```

* Exports: `GETERR`, `GETERR$`, `NUL404`, `onlyDefined`, `expect2`, `_it`, `environ`, `marshal`, `waited`, `asErrorPayload` (and the `Filter` type).
* The same helpers are still re-exported from the root (`import { expect2 } from 'lemon-core'`). Existing specs do not need a change.

---

## 5. Engine modules are registered once

`$engine.register(mod)` now ignores a module whose name (`getModuleName()`) is already registered and logs one info line (`! mod.reg(<name>) is already registered - ignored`). `$engine.module(name)` already returned the first one, so a single install sees no change.

If you see this line, lemon-core is probably installed twice (different versions or nested `node_modules`). Check with:

```bash
npm ls lemon-core
```

Fix the install so there is one copy. Two copies still mean two sets of globals.

---

## 6. Dependencies removed: `request`, `lodash`, `ioredis`, `memcached` (B2-a)

lemon-core v5 no longer installs `request`, `lodash`, `ioredis`, `memcached` (and `@types/ioredis`). If your service imports one of them directly, add it to **your own** `package.json`. Check with:

```bash
grep -rn "from 'request'\|from 'lodash'\|from 'ioredis'\|from 'memcached'\|require('request')\|require('lodash')" src
```

### 6.1 `CacheService.create()` default: Redis → in-process

| | v4 | v5 |
| --- | --- | --- |
| `CacheService.create()` (no `type`) | Redis client to `CACHE_ENDPOINT` (or `localhost:6379`) | in-process cache (`node-cache`), per process |
| `CacheOptions.type` | `'memcached' \| 'redis'` | `'node'` (the only value) |
| `CacheOptions.endpoint` | cache server url | removed |
| `CacheOptions.backend` | - | new: a `CacheBackend` you provide |
| `CacheService.create({ type: 'redis' })` | Redis | throws `@type [redis] is invalid (inject options.backend)` |
| `AbstractProxy.cache` with `CACHE_ENDPOINT=redis:...` | one Redis connection per proxy | not created (`undefined`); `CACHE_ENDPOINT` is not read |

* This is a **breaking** change for a service that calls `CacheService.create()` without arguments and expects a shared (cross-process) cache. An in-process cache is not shared between Lambda instances.
* `DummyCacheService` is unchanged.

### 6.2 Inject your own cache backend

`CacheBackend` and `ItemEntry` are exported. Implement `CacheBackend` with the client of your choice and pass it as `backend`. lemon-core keeps no Redis code; the client is a dependency of your service.

```ts
import { CacheService, CacheBackend, ItemEntry } from 'lemon-core';

const cache = CacheService.create({ backend: myBackend, ns: 'my-service:' });
```

Sketch of a consumer-side Redis backend (your service installs `ioredis`; error handling and `getset`/`pop` left out):

```ts
import IORedis from 'ioredis';
import { CacheBackend, ItemEntry } from 'lemon-core';

/** CacheBackend over ioredis: values are JSON strings, ttl in seconds (0 = no timeout). */
export class RedisBackend implements CacheBackend {
    public readonly name = 'redis';
    private readonly redis: IORedis;
    public constructor(endpoint: string, private readonly defTTL = 0) {
        this.redis = new IORedis(endpoint);
    }
    /** set one value with the given or default ttl */
    public async set<T>(key: string, val: T, ttl = this.defTTL) {
        const text = JSON.stringify(val);
        const res = ttl > 0 ? await this.redis.set(key, text, 'EX', ttl) : await this.redis.set(key, text);
        return res === 'OK';
    }
    /** get one value (undefined if missing) */
    public async get<T>(key: string): Promise<T | undefined> {
        const text = await this.redis.get(key);
        return text === null ? undefined : JSON.parse(text);
    }
    /** set many values in one transaction */
    public async mset<T>(entries: ItemEntry<T>[]) {
        const multi = this.redis.multi();
        entries.forEach(({ key, val, ttl = this.defTTL }) =>
            ttl > 0 ? multi.set(key, JSON.stringify(val), 'EX', ttl) : multi.set(key, JSON.stringify(val)),
        );
        return !!(await multi.exec());
    }
    /** get many values as a key map (missing keys are left out) */
    public async mget<T>(keys: string[]) {
        const texts = await this.redis.mget(keys);
        return keys.reduce((M: { [key: string]: T }, key, i) => {
            if (texts[i] !== null) M[key] = JSON.parse(texts[i]);
            return M;
        }, {});
    }
    /** add to a number value */
    public async incr(key: string, increment: number) {
        return this.redis.incrbyfloat(key, increment).then(Number);
    }
    /** list keys (use SCAN for large key spaces) */
    public async keys() {
        return this.redis.keys('*');
    }
    /** whether the key exists */
    public async has(key: string) {
        return (await this.redis.exists(key)) > 0;
    }
    /** delete the key */
    public async del(key: string) {
        return (await this.redis.del(key)) === 1;
    }
    /** set the ttl in seconds */
    public async expire(key: string, ttl: number) {
        return (await this.redis.expire(key, ttl)) === 1;
    }
    /** remaining ttl in milliseconds (0 = no timeout, undefined = missing) */
    public async ttl(key: string) {
        const ms = await this.redis.pttl(key);
        return ms === -2 ? undefined : ms === -1 ? 0 : ms;
    }
    /** close the connection */
    public async close() {
        await this.redis.quit();
    }
}
```

### 6.3 `RedisStorageService` removed

`RedisStorageService`, `DummyRedisStorageService` and `RedisOptions` are removed from the public API. Use a `StorageService` over DynamoDB (`DynamoStorageService`), or keep a copy of the v4 class in your service together with your own `ioredis` dependency.

### 6.4 HTTP proxies use the built-in `fetch`

`createHttpWebProxy`, `createSigV4Proxy` and `$X.createHttpSearchProxy` (and so `APIService`, `HttpStorageService` and the OS2 FGAC data path) now send requests with the Node built-in `fetch` instead of `request`. Signatures and results are unchanged:

* Success is still `200` or `201` only. Any other status (including `204`) rejects as before.
* Error messages keep the v4 formats (`404 NOT FOUND - ...`, `400 BAD REQUEST - ...`, `<code> <status text> - ...`).
* A network error now rejects with a message that starts with the error code, for example `ECONNREFUSED connect ECONNREFUSED 127.0.0.1:8080` or `ENOTFOUND ...`. Code that checks `GETERR(e).includes('ECONNREFUSED')` keeps working.
* `json` bodies are serialized once; with SigV4 the signed string is exactly the sent string.
* A `GET`/`HEAD` request never sends a body (`fetch` does not allow it; SigV4 already signed an empty body for `GET`).
* **Timeout.** lemon-core sets no timeout, as before. The `fetch` implementation (undici) has a default of **300 seconds** for headers and for the body. A Lambda timeout is usually shorter, so this rarely matters.
* `fetch` asks for compressed responses (`accept-encoding`) and decompresses them. Results are the same.

---

## 7. Search: OpenSearch client, ES names removed, lazy `$OS2` (B2-b)

lemon-core v5 talks to OpenSearch with `@opensearch-project/opensearch` (^3.9.0) instead of `@elastic/elasticsearch` 7.12. Responses keep the wrapped shape `{ body, statusCode, headers, meta }`, so code that reads `res.body` keeps working. If your service imports `@elastic/elasticsearch` directly, add it to **your own** `package.json`. The client type is no longer re-exported; import it from the client package:

```ts
import type { Client } from '@opensearch-project/opensearch';
```

Find the names that changed:

```bash
grep -rn "Elastic6\|ElasticIndexService\|ElasticOption\|ElasticItem\|_ES6\|\$ES6\b\|createSyncToElastic6\|ES6_\|OS2_VERSION\|OS2_DOCTYPE\|docType\|esVersion" src
```

### 7.1 Renamed

| v4 | v5 | kind |
| --- | --- | --- |
| `ElasticIndexService` | `OS2ClientService` | class + type. Holds the client; creates it on first use |
| `Elastic6Service` | `OS2CoreService` | class + type. Client CRUD and index management; parent of `OS2Service` |
| `Elastic6QueryService` | `OS2QueryService` | class + type |
| `Elastic6Synchronizer` | `OS2Synchronizer` | class + type |
| `AbstractElastic6Instance` | `AbstractOS2Instance` | class + type. The constructor builds nothing |
| `Elastic6ContructParams` | `OS2ConstructParams` | type. `esVersion`, `esDocType` removed |
| `Elastic6SearchParams` | `OS2SearchParams` | type |
| `ElasticOption`, `Elastic6Option` | `OS2BaseOption` | type. `version`, `docType` removed |
| `ElasticItem`, `Elastic6Item` | `OS2Item` | type |
| `LambdaDynamoStreamHandler.createSyncToElastic6()` | `LambdaDynamoStreamHandler.createSyncToOS2()` | static method |

Kept: `$OS2`, `$ES6Routed`, `_OS2`, `OS2Instance` (now `extends AbstractOS2Instance`), `OS2Service`, `OS2FGACManager`, `OS2Option`, `$ERROR`, `RetryOptions`, `SearchType`, `SearchResponse`, `SearchParam`, `SearchProxyBody`, `SearchResult`, `HangulService`, `$hangul`. `Elastic6SimpleQueriable` and the other search types from `lemon-model` keep their names (they belong to `lemon-model`).

File names (`cores/elastic/elastic6-service.ts` and the others) are unchanged in v5, so `lemon-core/dist/...` file deep imports still resolve.

### 7.2 Removed

| Removed | Use instead |
| --- | --- |
| root `$ES6` (the L1 instance), `_ES6()` | `$OS2` (or `$ES6Routed`, the same object), `_OS2()` |
| `$ES6` in `lemon-core/dist/extended/cores` (deep import) | `$ES6Routed` / `$OS2` |
| `Elastic6Instance`, the internal `Elastic6Proxy` | `OS2Instance` |
| `$ES6.$X` (`describeEndpointUrl`, `createHttpSearchProxy`) | `$OS2.$X2.describeEndpointUrl`. The search proxy agent is gone; call the proxy endpoint with `createHttpWebProxy` if you need it |
| `elasticsearch` (re-export of the whole client module) | `import { Client } from '@opensearch-project/opensearch'` |
| `DummyElastic6Service` | a small in-memory class in your spec (extend `OS2CoreService` and override `readItem`/`saveItem`/`updateItem`/`deleteItem`) |
| `EngineType`, `ParsedVersion` | - |
| `getVersion()`, `executeSelfTest()`, `parseVersion()`, `parsedVersion`, `isOldES6`, `isOldES71`, `isLatestOS2`, `version` (getter) | call `client.info()` or `client.nodes.info()` yourself. No behaviour depends on the server version any more |
| env reads `ES6_ENDPOINT`, `ES6_INDEX`, `ES6_VERSION`, `ES6_DOCTYPE`, `ES6_AUTOCOMPLETE_FIELDS`, `ES6_IS_PROXY`, `OS2_VERSION`, `OS2_DOCTYPE` | `OS2_ENDPOINT`, `OS2_INDEX`, `OS2_AUTOCOMPLETE_FIELDS`, `MY_DYNAMO_TABLE` (unchanged) |

Why no version detection: an OpenSearch cluster in compatibility mode answers `GET /` with `7.10.2` and no `distribution`, so the root response cannot tell OpenSearch from Elasticsearch.

### 7.3 Typeless requests, options and parameters

* No request sends a doc `type` any more. The OpenSearch client puts every unknown key into the query string as-is, and OpenSearch 2.x/3.x answers `400` to `?type=`. `searchType` is sent as `search_type`.
* `OS2BaseOption.docType` and `OS2BaseOption.version` are removed. Passing them in an object literal is a type error. Default options are `{ idName: '$id' }`.
* `OS2CoreService.saveItem(id, item)` and `pushItem(item)` have no `type` parameter.
* `OS2CoreService.prepareSettings({ idName, timeSeries?, shards?, replicas? })` always returns the typeless mapping (`mappings.properties`, `mappings.dynamic_templates`); the `standard` token filter branch is gone. With `timeSeries: true` it no longer throws (v4 deleted from a missing object).
* `createIndex()` on an instance (`OS2Instance`) sends that mapping as-is. The v4 L1 instance also added a `score_` (`half_float`) field; that instance is removed.
* `OS2SearchParams.searchType` keeps its name (it is the lemon-core parameter; it goes out as `search_type`).
* `hello()` of the services: `os2-core-service:<index>`, `os2-query-service:<index>`.

### 7.4 Lazy `$OS2`

`$OS2` and `$ES6Routed` are **one object**: a `Proxy` that runs `_OS2()` on the first property access and delegates everything after that.

| | v4 | v5 |
| --- | --- | --- |
| `require('lemon-core')` / `import` with `OS2_ENDPOINT` | 6 clients, 5 dynamo-stream listeners | 0 clients, 0 listeners |
| first access (`$OS2.hello()`, first `MyCoreManager`) | - | `_OS2()` reads env **now**: 1 instance, 1 listener, 0 clients |
| first `client` use (index management, bulk) | - | 1 master client |
| `$OS2 === $ES6Routed` | no (two instances) | yes |
| without `OS2_ENDPOINT` | L1 `Elastic6Instance` (root `$ES6`) | `OS2Instance` with `options === null`, `elastic`/`query`/`synchronizer` `undefined`, no listener |

* Env is read at the first access, not at import. Loading the env after `import 'lemon-core'` but before the first use now gives a configured `$OS2` (v4 fixed it at import).
* `$OS2` is a `Proxy`: `$OS2 instanceof OS2Instance`, `'hello' in $OS2`, `Object.keys($OS2)` and property writes work as on the instance itself.
* `OS2ClientService` and its subclasses create the client on the first `client` access, once per service. `new OS2Service(...)` and `new OS2CoreService(...)` build no client.
* One `OS2Instance` = one service = at most one client = one listener (v4: 3 clients, 2 listeners).
* The client package itself is loaded on the first client creation, not at import (`require('lemon-core')` no longer loads it).

### 7.5 Master credentials are read when the master client is built

`OS2Service` (the master client for index management and `bulk`) reads `OS2_MASTER_UID` and `OS2_MASTER_PWD` from the lemon-core config **when the client is first used**, which is after `$engine` init. It sets `auth` only when **both** are present.

In v4 they were read at import, before config init, so they were always `undefined` and no `Authorization` header was sent. **If your config defines `OS2_MASTER_*`, v5 now sends them.** If it does not, nothing changes (the master paths answer `401` as before). The FGAC data path (CRUD and search through `OS2Service`) does not use the client and is unchanged.

### 7.6 `$ERROR` messages are unchanged

`$ERROR.asError()` now reads the error type from `meta.body.error.type` (present with both clients) instead of the client's error message, so the messages keep the v4 form:

```
409 VERSION CONFLICT ENGINE - [A0]: version conflict, ...
404 INDEX NOT FOUND - ...
400 MAPPER PARSING - failed to parse field ...
```

Prefix checks such as `msg.startsWith('400 ILLEGAL ARGUMENT - Cannot apply')` keep matching. Errors without `meta` (FGAC `fetch` errors, network errors) are rethrown as they are. The `E.response` branch for Elasticsearch 6.2 error objects is removed.

### 7.7 Fixed

* `OS2Service.pushItem()` returns `_id` and `_version` (v4 read them from `res.body`, which the FGAC result does not have).
* `api-search` style code that called `_OS2()` per request added two listeners per call; use the shared `$OS2` (`$ES6Routed`).

---

## At-a-Glance Checklist

- [ ] Node.js 24 (`.nvmrc`, local runtime)
- [ ] ESM services: load env with `await import('lemon-core/dist/environ')` before `await import('lemon-core')`
- [ ] No directory deep imports (`lemon-core/dist/<dir>`); plan to remove file deep imports before v6
- [ ] Test helpers from `lemon-core/testing` (optional in v5)
- [ ] `npm ls lemon-core` shows one copy
- [ ] Direct imports of `request`, `lodash`, `ioredis`, `memcached` are in your own `package.json`
- [ ] `CacheService.create()` without `backend` is in-process; inject a `CacheBackend` for a shared cache
- [ ] No `RedisStorageService` / `DummyRedisStorageService` / `RedisOptions`
- [ ] Search names renamed (`Elastic6Service` → `OS2CoreService` …, § 7.1); no `$ES6`/`_ES6`/`Elastic6Instance`/`elasticsearch` (§ 7.2)
- [ ] No `docType`/`version` in search options; no `type` argument to `saveItem`/`pushItem`
- [ ] Env loaded before the first use of `$OS2`/`$ES6Routed` (not needed before import any more)
- [ ] `OS2_MASTER_UID`/`OS2_MASTER_PWD` in config are now sent by the master client (§ 7.5)
