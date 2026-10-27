# UPGRADE GUIDE: lemon-core V4 to V5

> Work in progress. This guide grows with each v5 bundle. This revision covers B1 (packaging), B2-a (dependencies: `request`, `lodash`, `ioredis`, `memcached` removed) B2-b (search: OpenSearch client, ES names, lazy `$OS2`) and B2-c (AWS SDK: optional peers, lazy loading, `PERF` lines).

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

File names: `cores/elastic/elastic6-service.ts` and `cores/elastic/elastic6-query-service.ts` were renamed in v5 (B3) to `os2-service.ts` and `os2-query-service.ts`. The old names stay during v5 as one-line re-export shims, so `lemon-core/dist/cores/elastic/elastic6-service` and `…/elastic6-query-service` still resolve (§ 9.4). The folder `cores/elastic/` and `hangul-service.ts` keep their names.

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

## 8. AWS SDK: optional peers, lazy loading, `PERF` lines (B2-c)

`require('lemon-core')` (and `import`) no longer loads any AWS SDK module. Each SDK package is loaded on its **first use** (the first KMS decrypt, the first DynamoDB call, the first SNS report, …). Measured with `scripts/aws-lazy-probe.cjs`, no AWS env: `require('lemon-core')` 737 → 265 modules, `$U` only (`dist/engine`) 338 → 131, with 0 files under `@aws-sdk`, `@smithy`, `@aws-crypto` and `@aws`.

### 8.1 Packages

* DynamoDB is the required storage (D41): `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` stay in lemon-core `dependencies`. They are installed with lemon-core, and still loaded only on first use.
* The other **8** packages are **optional peers** (`^3.971.0`). npm does not install them for you. Add the ones your service uses to **your own** `dependencies`:

| You use | Add to your `package.json` |
| --- | --- |
| KMS (config `*`-encrypted values are decrypted at `$engine.initialize()`, `AWSKMSService`, JWT sign/verify) | `@aws-sdk/client-kms` + `@aws-sdk/credential-providers` |
| a local profile (`env.NAME`) for any AWS client, `tools.asyncCredentials()` | `@aws-sdk/credential-providers` |
| DynamoDB (`DynamoService`, storage, query, scan) | nothing (in lemon-core `dependencies`) |
| error reports (`doReportError`, `AWSSNSService`), account id (`accountID()`, JWT `getAccountId`) | `@aws-sdk/client-sns` + `@aws-sdk/client-iam` + `@aws-sdk/client-sts` |
| `$protocol` (`execute` → Lambda, `notify` → SNS, `enqueue` → SQS, `broadcast` → SNS, plus IAM/STS when the topic ARN needs the account id), `AWSSQSService` | `@aws-sdk/client-lambda` + `@aws-sdk/client-sns` + `@aws-sdk/client-sqs` |
| S3 (`AWSS3Service`) | `@aws-sdk/client-s3` |

A typical API service (config decrypt, storage, error reports, protocol) adds all 8:

```bash
npm i @aws-sdk/client-kms @aws-sdk/credential-providers @aws-sdk/client-sns @aws-sdk/client-iam @aws-sdk/client-sts @aws-sdk/client-lambda @aws-sdk/client-sqs @aws-sdk/client-s3
```

* Removed from lemon-core: `@aws-sdk/client-dynamodb-streams` (never used), and the dev packages `@aws-sdk/types` and `@smithy/util-stream`.
* `npm link` hides a missing peer: Node resolves the SDK from the linked lemon-core checkout. Check peers with a registry or `npm pack` install.

### 8.2 When a missing peer fails

| | v4 | v5 |
| --- | --- | --- |
| package not installed | `Cannot find module '@aws-sdk/…'` at `import` | the same error at the **first use**: a rejected Promise from an async method (SNS, SQS, STS, IAM, Lambda, protocol, query, scan), or a `throw` from a sync getter (`AWSKMSService.instance()`, `AWSS3Service.instance()`, `DynamoService.instance()`, `awsConfig()` with a profile) |
| first use of a package | (paid at import) | pays the package load once (tens to hundreds of ms) |

`awsConfig()`, `AWSKMSService.instance()`, `AWSS3Service.instance()` and `DynamoService.instance()` stay **synchronous** with the same signatures.

### 8.3 `DynamoService.instance()` and client caches

| | v4 | v5 |
| --- | --- | --- |
| `DynamoService.instance(region)` returns | `{ dynamo, dynamostr, dynamodoc }` | `{ dynamo, dynamodoc }` — **`dynamostr` removed** (and the static `_dynamostr`) |
| low-level client (`dynamo`) | a new `DynamoDBClient` **and** a new `DynamoDBStreamsClient` on every call | one per region, cached in `_dynamo[region]` |
| `dynamodoc()` | one document client per region | unchanged |
| S3 module client (`AWSS3Service.instance()`) | a new `S3Client` on every call | one per region |
| KMS client | one per service (`_instance`) | unchanged |
| SNS, SQS, STS, IAM, Lambda, protocol | a new client per call | unchanged |

If you used `dynamostr`, build your own `DynamoDBStreamsClient` from `@aws-sdk/client-dynamodb-streams`. The region cache reads the profile once per region: a later change of `env.NAME` does not rebuild a cached Dynamo or S3 client.

`prepareCreateTable()` writes `StreamViewType: 'NEW_AND_OLD_IMAGES'` as a string (the same value the SDK enum had).

### 8.4 Types without the SDK

lemon-core `.d.ts` files no longer import `@aws-sdk/*` or `@smithy/*`, so a consumer without the optional peers still compiles (`skipLibCheck` not needed). The public names stay; their types became local structural types:

| Name | v5 type |
| --- | --- |
| `AwsConfigParams.credentials`, `awsConfig()` return `.credentials` | a provider function `(props?) => Promise<{ accessKeyId; secretAccessKey; sessionToken?; expiration? }>` (it is still the `fromIni` provider at runtime) |
| `AWSKMSService.instance()`, `_instance` | `{ send(command): Promise<any> }` |
| `AWSKMSSignOption.algorithm` | the literal union of the SDK signing algorithms |
| `AWSS3Service.instance()` (protected) | `{ send(command): Promise<any> }` |
| `S3Object`, `ListObjectResult.Contents` | `S3Object` interface with the SDK object fields (`Key`, `LastModified`, `ETag`, `Size`, `StorageClass`, `Owner`, …) |
| `DynamoService.instance()`, `_dynamo`, `_dynamodoc` | `{ send(command): Promise<any> }` clients |
| `DynamoService.createTable()` / `deleteTable()` | `Promise<{ TableDescription?: { TableName?; TableStatus?; … }; $metadata? }>` |
| `DynamoService.prepareCreateTable().KeySchema` | `{ AttributeName: string; KeyType: 'HASH' \| 'RANGE' }[]` |
| `MySNSEventParam`, SQS transformer event | interfaces with the fields lemon-core builds (`TopicArn`, `Subject`, `Message`, `MessageStructure`, `MessageAttributes` / `QueueUrl`, `MessageBody`, `DelaySeconds`, `MessageAttributes`) |

`send()` results are `any`. If you need the SDK result types, import them yourself (`import type { … } from '@aws-sdk/…'`).

`lemon-core/dist/tools/aws-lambda-helper.example` is an example file: a deep import of it loads `@aws-sdk/credential-providers` at import.

### 8.5 `PERF` lines

lemon-core prints one `PERF` line per checkpoint, once per process, through the normal info logger (`I` level). `LS=1` silences them like every other line; `TS` and `LC` work as before. There is no new switch. A line has a label and a time only (no values, hosts or profiles):

```
2026-10-28 10:00:00 I PERF: > lazy-load @aws-sdk/client-kms 50.9 ms
```

| Label | Printed when | Time measured |
| --- | --- | --- |
| `loaded lemon-core` | the `lemon-core` index finished loading | process uptime at that moment (includes everything loaded before, e.g. `ts-node` compile) |
| `initialize` | `$engine.initialize()` finished | the whole initialize (config init, KMS decrypt, …) |
| `lazy-load <package>` | the first use of an SDK package or of `@opensearch-project/opensearch` | the `require`/`import()` |
| `client KMS` / `client S3` / `client DYNAMO` / `client DYNAMO-DOC` | a cached client is built | the constructor (once per service or per region) |
| `instance $OS2` | the first access of `$OS2` | `_OS2()` |
| `client OS2` | an OpenSearch client is built | the constructor |

Each file has its own loader, so the same package can show twice (for example `lazy-load @aws-sdk/lib-dynamodb` from `dynamo-service` and from `dynamo-query-service`); the second line is near 0 ms because Node already has the module. `lazy-load @aws-sdk/credential-providers` is printed only when `awsConfig()` loads the package first (not from `asyncCredentials()`).

## 9. L1/L2 merge: one definition per name, removed aliases, renamed search files (B3)

lemon-core had two layers that defined the same names twice: L1 (`helpers/`, `common/`, `extended/abstract-service.ts`) and L2 (`extended/cores/`). The root hid the collisions with 18 pinned exports in `src/index.ts`. v5 keeps **one definition** per name and removes the pins. The rule: the copy the root already exported wins, so **the root names and the root behaviour do not change** (294 names, `npm run api:check` unchanged).

### 9.1 Root: no change

| Name | Root before | Root now |
| --- | --- | --- |
| `$T` | the L2 object (32 members) | the same members, one object defined in `helpers/helpers.ts` |
| `IdentityToken`, `IdentityTokenSite`, `IdentityTokenUser`, `IdentityTokenGroup`, `ListResult`, `PaginatedListResult`, `AggrKeyCount`, `ListParam`, `PaginateParam`, `BulkUpdateBody`, `BulkBody`, `BodyList`, `BulkItemsResult`, `AggrResult` | the L2 types | the same shape (minus `IdentityToken.iid`, § 9.2), defined in `helpers/types.ts` |
| `parseListParam`, `parsePaginateParam` | L2 copies | the identical L1 functions |
| `onlyDefined`, `sourceToItem`, `marshal`, `Filter` | L1 | unchanged |

Function identity changed only: for example `$T.S2` is now the function defined in `helpers/helpers.ts`. Code that compares functions by reference across deep paths sees one object now (§ 9.3).

### 9.2 Removed members

| Removed | Use instead | Note |
| --- | --- | --- |
| `MyCoreService.isUseSssion()` (typo alias) | `isUseSession()` | class member |
| `$U.crypto(passwd, algorithm?)` (and its `encrypt`/`decrypt`) | `$U.crypto2(passwd, algorithm?, …)` | `@deprecated` since Node.js 22. `crypto2` output is **not** compatible with `crypto` output: re-encrypt stored values before the upgrade |
| `credentials(profile)` from `lemon-core/dist/environ` | `tools.asyncCredentials()` | it always threw in v4 |
| `AbstractProxy.getCurrentIdentity$()` | `getCurrentIdentityId()` + `getIdentity$()` | `@deprecated` since 3.2.10 |
| `IdentityToken.iid` | — | `@deprecated` field, not set by lemon-core. Declare it in your own type if you still carry it |

Kept on purpose (still `@deprecated`): `CoreManager.insert` (removing it would switch to `AbstractManager.insert`, a silent behaviour change), `AbstractProxy.fetchIdentityAccess` / `_identity` / `getIdentity$` and `MyCoreProxy.fetchIdentityAccess`, `loadEnviron` (default export of `lemon-core/dist/environ`).

Check your service:

```bash
grep -rnE "isUseSssion|\$U\.crypto\(|getCurrentIdentity\$|\biid\b|credentials\(" src
```

### 9.3 Deep paths (`lemon-core/dist/...`): names kept, content from the single definition

The losing files now **re-export** the winning definition, so every deep path keeps its names in v5. What a deep path returns can change where the two copies were not the same:

| Deep path | v5 B3 change |
| --- | --- |
| `lemon-core/dist/helpers/helpers` (and `…/helpers/index`) | `$T` is the merged object: `$T.S2(v, def)` ignores a 3rd `delim` argument and always collapses white-space to one space (`S2('a b  c', '', '-')` → `'a b c'`, was `'a-b-c'`); `$T.SS(v)` ignores `def` (`SS(null, ['x'])` → `[]`, was `['x']`) and collapses white-space inside array items (`SS([' a  b '])` → `['a b']`, was `['a  b']`); `$T.US` added. These are the root behaviours since 4.x |
| `lemon-core/dist/helpers/types` | the L2 shapes: `IdentityToken.cid` is **required**, `IdentityToken.did?` added, `iid` removed, `ListResult.aggr` is `R \| R[]`, `AggrResult` added (types only) |
| `lemon-core/dist/extended/cores/commons`, `…/extended/cores/types`, `…/extended/cores/abstract-services`, `lemon-core/dist/extended/cores` | same names, now re-exports (`$T`, `parseListParam`, `parsePaginateParam`, `onlyDefined`, the types, `sourceToItem`) |
| `lemon-core/dist/cores/config/config-service` | same names; `Filter`/`marshal` are re-exports of the `lemon-core/testing` ones |

The root (`lemon-core`) is not affected. Prefer the root import; `lemon-core/dist/*` is removed in v6 (§ 3).

### 9.4 Search files renamed (`cores/elastic/`)

| v4 file | v5 file | Old path in v5 |
| --- | --- | --- |
| `cores/elastic/elastic6-service.ts` | `cores/elastic/os2-service.ts` | `lemon-core/dist/cores/elastic/elastic6-service` is a re-export shim (same symbols) |
| `cores/elastic/elastic6-query-service.ts` | `cores/elastic/os2-query-service.ts` | `lemon-core/dist/cores/elastic/elastic6-query-service` is a re-export shim |

The shims are removed with `./dist/*` in v6. The folder name (`cores/elastic/`) and `hangul-service.ts` are unchanged. The root names (`OS2CoreService`, `OS2QueryService`, …) are unchanged.

### 9.5 `lemon-templates-api`

* `$X` (`src/view/transformer.ts`, a local copy of `$T` helpers with different `B`/`BN`/`N`/`F` semantics) is removed. Use `$T` from `lemon-core`.
* `api/hello-api.ts` calls `isUseSession()`.

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
- [ ] The AWS SDK peers your service uses are in your own `dependencies` (§ 8.1); DynamoDB comes with lemon-core
- [ ] No `DynamoService.instance().dynamostr` (§ 8.3)
- [ ] Code that typed `send()` results through lemon-core SDK types imports them from `@aws-sdk/*` itself (§ 8.4)
- [ ] No `isUseSssion()`, `$U.crypto()`, `credentials()`, `getCurrentIdentity$()`, `IdentityToken.iid` (§ 9.2); values encrypted with `$U.crypto` are re-encrypted
- [ ] Deep imports of `lemon-core/dist/helpers/helpers` or `…/helpers/types`: check `$T.S2` 3-argument / `$T.SS(v, def)` calls and `IdentityToken.cid` (§ 9.3)
- [ ] Deep imports of `…/cores/elastic/elastic6-*` moved to `…/os2-*` or the root (§ 9.4)
- [ ] Template copies of `$T` helpers (`$X`) replaced by `$T` (§ 9.5)
