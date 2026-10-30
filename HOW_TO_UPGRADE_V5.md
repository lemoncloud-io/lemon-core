# UPGRADE GUIDE: lemon-core V4 to V5

> Work in progress. This guide grows with each v5 bundle. This revision covers B1 (packaging), B2-a (dependencies: `request`, `lodash`, `ioredis`, `memcached` removed) B2-b (search: OpenSearch client, ES names, lazy `$OS2`) and B2-c (AWS SDK: optional peers, lazy loading, `PERF` lines), B3 (L1/L2 merge) and B4 (field annotations: `@field()` replaces the generated field registry).

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
* The other **8** packages are **optional peers** (`^3.1159.0` since B11, § 14; was `^3.971.0`). npm does not install them for you. Add the ones your service uses to **your own** `dependencies`:

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

### 8.6 Per-request `PERF` lines (B7)

Web requests also print one `PERF` summary line each, and the `LambdaModule` handler prints one line per Lambda call. They use the same logger and switches as § 8.5 (`LS=1` silences them). A line has route words, the HTTP status and times only (no path, id, host, header or body):

```
2026-10-28 10:00:00 I PERF: > request 3.9 ms mode=GET type=hello status=200 context=1.2 param=0.6 handler=1.4 response=0.3 cold=1
2026-10-28 10:00:00 I PERF: > handle 1003.1 ms type=web cold=1
```

| Key | Time measured |
| --- | --- |
| `request <total>` | from `packContext()` to the built response (on failure, also the error report) |
| `context` | `packContext()` (`0.0` if it was not called with the same event object) |
| `param` | `transformToParam()` (`promised()`) |
| `handler` | `handleProtocol()`, up to the result or the throw |
| `response` | `success()`, or `asFailureResult()` on failure |
| `handle <ms>` | the `LambdaModule` handler call, including `engine.initialize()` |

`cmd=` is printed only when the route has one. `type=` on the `handle` line is the event type (`web`, `sqs`, …, or `unknown`). `cold=1` is on the first `request` line and the first `handle` line of the process only. The local express server prints the `request` line only. No API change: `promised`, `mxNextHandler` and `mxNextFailure` keep their signatures. Details: `docs/v5/B7-perf-trace.md`.

**Contract (D56).** The `request` and `handle` lines are a contract for all of 5.x. The key names, the key order (`request`: `mode type [cmd] status context param handler response cold`; `handle`: `type cold`) and the units (ms with one decimal; `status` is the HTTP code, `cold` is `1` or `0`) are fixed. A new key is added at the end of a line only. Renaming, removing or reordering a key is a major change. Values never carry paths, ids, hosts or headers. The consumer is the templates-api harness `perf:lambda`. `src/cores/lambda/perf-contract.spec.ts` checks the contract.

### 8.7 KMS Decrypt without the SDK (B8)

`AWSKMSService.decrypt()` (and so `ConfigService.init()` for env values that start with `*`) no longer loads `@aws-sdk/client-kms` when the env has credentials. It sends one SigV4-signed HTTPS call (Node `https.request`, not `fetch` — the first `fetch` call loads undici) to the KMS JSON API (`TrentService.Decrypt`) instead. On Lambda the runtime sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`, so the boot path takes the fetch path.

- **No API change.** `AWSKMSService` keeps its names and signatures. The new module is internal (no new root export).
- **Path selection.** `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` both non-empty → fetch. Otherwise (for example a local `AWS_PROFILE`) → the SDK path as before. `encrypt`, `sign`, `verify` and `getPublicKey` always use the SDK.
- **Errors.** A KMS error (non-2xx) is thrown as `<type>: <message>` (for example `InvalidCiphertextException: …`), so `ConfigService` makes the same `ERROR - …` value. A network error (socket error, 10 s idle timeout) logs `! kms fetch failed, fallback to sdk = <message>` once and the call goes through the SDK.
- **One new direct dependency:** `@smithy/signature-v4` (`^5.3.8`). It was already installed through `@aws-sdk/core`, so a consumer lock gains no package. Keep `@aws-sdk/client-kms` installed if you call the other KMS methods.
- **IAM is the same:** the role needs `kms:Decrypt` on the key, as before.

The boot log shows these lines instead of `lazy-load @aws-sdk/client-kms` and `client KMS` (the second one is each SDK-less decrypt, split into `sign=` SigV4, `send=` connect + request + whole response, `decode=` base64):

```
2026-10-29 10:00:00 I PERF: > lazy-load @smithy/signature-v4 3.4 ms
2026-10-29 10:00:00 I PERF: > kms decrypt 212.0 ms sign=1.2 send=210.5 decode=0.3
```

Details: `docs/v5/B8-kms-fetch.md`.

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

## 10. Field annotations: `@field()` replaces the generated registry (B4)

lemon-core v4 built its field lists with a generator (`lemon-fields gen` → `src/generated/field-registry.ts`, `fieldKeys.<model>()`). v5 reads them from the model class: a field carries `@field()`, and `fieldsOf(MyModel)` lists the fields. The annotations live in **lemon-model 5.0.0**.

### 10.1 What changed

| Area | v4 | v5 |
| --- | --- | --- |
| `CoreModel` (lemon-model) | interface | **class** with 16 annotated public optional fields (`$` view, `id`/`_id` internal, 13 data). Type-compatible: object literals typed as `CoreModel` and `interface X extends CoreModel` still compile |
| `CORE_FIELDS` (lemon-model, root) | literal list, 14 | `fieldsOf(CoreModel, { kinds: ['view', 'data'] })` — the same 14 in the same order |
| lemon-core generated registry | `src/generated/field-registry.ts`, `lemon-core/dist/generated/field-registry` | **removed** (the deep path is gone; it had no consumer) |
| lemon-core scripts | `fields:migrate`, `fields:gen`, `fields:check`, `fields:guard-common`; `build` ran `fields:gen` first | removed; `build` is `build-ts` + the ESM wrapper |
| Manager constructors (`AbstractManager`, `CoreManager`, `MyCoreManager`) | `fields: string[]` | `fields: string[] \| ModelClass` — a model class is read with `fieldsOf(cls)`. Existing calls are unchanged. `ModelClass`/`resolveFields` are not on the root (deep path `lemon-core/dist/cores/storage/model-fields`) |
| `lemon-devkit` | devDependency | still a devDependency (`loadProfile`/`loadEnviron`/`buildExpress` need it; only the `fields:*` use is gone) |

### 10.2 Root: lemon-model names

The lemon-core root re-exports **exactly the 32 lemon-model names it had in v4** (`CoreModel`, `CORE_FIELDS`, `AbstractTransformer`, `NextContext`, `SearchBody`, …). `CoreModel` is now a value and a type there. The new lemon-model names (1.2 to 1.6, including `field`, `fieldsOf`, `specsOf`, `FIELDS_KEY`) are **not** on the lemon-core root. Import them from lemon-model and declare it yourself (since 5.0.9: from `lemon-core/model`, without declaring lemon-model — § 16):

```jsonc
// package.json
"dependencies": { "lemon-core": "…", "lemon-model": "^5.0.0" }
```

```ts
import { CoreModel } from 'lemon-core'; // or 'lemon-model' (the same class)
import { field, fieldsOf } from 'lemon-model';
```

### 10.3 Convert one model

```ts
// before: interface + generated registry
export interface PetModel extends CoreModel<ModelType> {
    name?: string;
    stereo?: PetStereo;
    readonly $owner?: OwnerHead; // view field
}
export const $FIELD = { pet: filterFields(fieldKeys.petModel<PetModel>()) };

// after: class + annotations (no registry entry)
export class PetModel extends CoreModel<ModelType> implements PetHead {
    @field({ group: 'head' }) declare id?: string; // inherited field, redeclared to join the head group
    @field({ group: 'head' }) name?: string;
    @field({ group: 'head' }) declare stereo?: PetStereo; // narrowed redeclaration
    readonly $owner?: OwnerHead; // view field: no @field()
}
export const $HEAD = { pet: filterFields(fieldsOf(PetModel, { group: 'head' })) };
export const $FIELD = { pet: filterFields(fieldsOf(PetModel)) };
```

1. Turn `interface X extends A, B` into `class X extends CoreModel<…> implements <Head>`. A class has one parent; keep the head interface for type consumers and put its fields in the `head` group.
2. Put `@field()` on every stored field. Leave view fields (`$x`, `Model`, `Query`, …) without it; your `filterFields` then gives the same set as before.
3. Redeclare an inherited field only to narrow its type or to add a group. Use `declare` (needed from target ES2022, where a plain redeclaration is TS2612; harmless at es6). Options merge with the parent's: `@field({ group: 'head' }) declare id?: string` keeps `kind: 'internal'` from `CoreModel`.
4. Pass the list (`$FIELD.pet`) or the class (`super('pet', parent, PetModel)`) to the manager. A class gives the raw `fieldsOf(cls)` list (with `$`, `_id`); pass the filtered list if you rely on your own `filterFields`.
5. Remove the `fieldKeys.<model>` calls and rerun your generator while other models still use it (it drops the entries). Remove the generator, its scripts and `src/generated/` when no model uses it.
6. Add a parity spec (§ 10.4).

Keep `experimentalDecorators: true` (legacy decorators). lemon-core's vitest (Oxc) does not run TS 5 standard decorators. `field()` also works with standard decorators under `tsc` (lemon-model sets `Symbol.metadata ??= Symbol.for('Symbol.metadata')` once).

### 10.4 Parity spec

A missing `@field()` is silent: the field folds into `.meta` on save. In an es6 legacy build `Object.keys(new X())` is empty, so there is no automatic check. Copy the v4 registry list into a spec **before** you delete the entry and compare **sets** (not order):

```ts
// v4 list, copied from src/generated/field-registry.ts (`petModel`) through the same filterFields()
const V4_PET_FIELDS = ['name', 'stereo', 'id', 'ns', 'type' /* … */];
it('pet fields equal v4 as a set', () => {
    expect(new Set($FIELD.pet)).toEqual(new Set(V4_PET_FIELDS));
    expect(new Set($HEAD.pet)).toEqual(new Set(['id', 'name', 'stereo']));
});
```

### 10.5 Order

`fieldsOf()` lists fields in declaration order, **parent first** (`CoreModel`'s 16, then your own). A redeclared field keeps the parent position. The generator listed own fields first. Storage, `.meta` folding, search parameters and `listProjections()` (sorted) only check inclusion, so behaviour does not change. Specs that compare a field array with `join(',')` or `toEqual([...])` must compare sets.

### 10.6 Release order

lemon-model 5.0.0 is published first. lemon-core and your service then move to `"lemon-model": "^5.0.0"` with a lockfile update. Before the publish, test with `npm link` / a local tarball (`npm pack`).

### 10.7 `lemon-templates-api`

* `MockModel` (`src/modules/mock/model.ts`) is the first annotated model: `class MockModel extends CoreModel<ModelType> implements MockHead`; `$HEAD.mock`/`$FIELD.mock` come from `fieldsOf()` (same sets, parent-first order). Parity spec: `src/modules/mock/model.spec.ts`.
* The other models still use `fieldKeys` and `fields:gen` (the registry has 10 entries now). They move one by one with the steps of § 10.3.

### 10.8 `fields/admin`

`AbstractCRUDController.doGetAdmin` has a `fields` command that reports the manager's field list, so you can check the annotations in the deployed Lambda as well as locally:

```sh
$ http ':8888/<type>/fields/admin'
```

It returns `{ id: 'fields', type, model, core, fields, extra, counts, source, ok, issues, runtime }`: `core` is `fieldsOf(CoreModel)` (16), `fields` is the manager's `FIELDS`, `extra` is `fields` minus `core`, `source` is `class` (a model class was passed) or `list` (a `string[]`), `runtime` is `{ local, external, lambda, node, lemonCore }`. `ok` is false when a self-check fails; each failure is one line in `issues` (core < 14 names or without `id`/`_id`, empty `fields`, duplicates, and — for `source: 'class'` only — a core name missing from `fields`; a list may drop `$`/`_id` through `filterFields`).

The gate is the channel, not the role: allowed when `$U.isLocalMode()` is true (the express harness) or the request is internal (`$ctx.domain` is empty — a direct `lambda:Invoke` without a `host` header). Anything else gets `403 NOT ALLOWED - fields/admin is local or direct-invoke only`. No admin role is needed, because a direct invoke is already gated by IAM `lambda:InvokeFunction`. The other admin commands keep the admin-role check.

`checkFieldsAdmin(report, expect?)` is the single verifier of this report. The server runs it for its own `ok`/`issues`, and every test or harness runs the same function: vitest, an in-process express route, a downstream jest spec, a local express server, and the deployed Lambda. It checks the structure (lists, `counts`, `extra` = `fields` minus `core`, `source`, `ok` against `issues`, `runtime`), the self-checks above on the lists themselves (so a report edited to `ok: true` still fails), and only the expectations you pass. `runtime.lambda: true` means any function name, `false` means `null`. Each failure is one short line in `issues`. It is on the root (`import { checkFieldsAdmin } from 'lemon-core'`) and on a deep path without the engine (`lemon-core/dist/extended/cores/fields-admin`, also from an ESM `.mjs`):

```ts
import { checkFieldsAdmin } from 'lemon-core/dist/extended/cores/fields-admin';
const res = await request(app).get('/pets/fields/admin');
const expect = { type: 'pets', source: 'class' as const, extra: ['name', 'kind'], runtime: { local: true, lambda: false } };
const { ok, issues } = checkFieldsAdmin(res.body, expect);
if (!ok) throw new Error(issues.join('\n'));
```

## 11. Trust boundary and behaviour contract (B5)

v5 stops trusting what a request says about itself. A protocol context sent from outside is dropped, internal calls are signed, "local" is a runtime setting, handlers never reject, and the time helpers no longer depend on the host time zone. Details: `docs/v5/B5-trust-boundary.md`.

### 11.1 New env names

| Name | Values | Default | Meaning |
| --- | --- | --- | --- |
| `PROTOCOL_SIGN_KEY` | a secret string; `*<base64>` is decrypted by KMS at init like other config values | unset | install-wide HMAC-SHA256 key for internal protocol calls (web, SNS, SQS). Unset = calls are sent unsigned |
| `PROTOCOL_VERIFY` | `off` \| `warn` \| `enforce` | `warn` if the key is set, else `off` | `off`: no check. `warn`: accept an unsigned or mismatched call and log one `PROTOCOL unsigned <source>` line. `enforce`: reject it (`403 NOT ALLOWED - unsigned protocol context` for web, record failure for SQS, reported record for SNS) |
| `LOCAL_MODE` | `1` | unset | local mode for the express harness (§ 11.3). Ignored in Lambda |
| `LOCAL_TRANSPORT` | `mock` | unset | opt-in local transport: SNS/SQS/protocol sends to this service are delivered in-process (§ 11.3.1). Only in local mode; ignored in Lambda (one warn line) |

Use the same `PROTOCOL_SIGN_KEY` in every service of one install. Keep `warn` while v4 callers remain (they send unsigned contexts), then switch to `enforce`. When the key is not set, init prints one line: `PROTOCOL sign key not set — contexts unsigned`.

### 11.2 `x-protocol-context` from outside is ignored

A web event with a `host` header (any case — API Gateway, ALB, Function URL and the devkit express server always set it) is external. Its `x-protocol-context` and `x-protocol-signature` headers are ignored in every mode, and the context is built from the request as for any other client. A host-less web event (a direct Lambda invoke) must carry a valid `x-protocol-signature` in `enforce`; the same rule covers a JSON `x-lemon-identity` on a host-less event. `MyHttpHeaderTool.isExternal()` now means "a `host` key is present" (an empty value counts).

### 11.3 Local mode is a runtime setting

`$U.isLocalMode()` is true only when `LOCAL_MODE=1` and `AWS_LAMBDA_FUNCTION_NAME` is unset. It replaces every `$ctx.domain === 'localhost'` and `STAGE === 'local'` trust check: admin in `hasAdminRole()`, no `403 IDENTITY-TOKEN`, no session `sid` pin in `packSearchParam()`, custom `id` on POST, `?destroy`, `getIdentityId()`/`isUserAuthorized()` with `LOCAL_ACCOUNT`, `confUseSession`/`modelAsView`. `LOCAL_ACCOUNT` and `USE_SESSION=<file>.json` are honoured only in local mode.

* Set `LOCAL_MODE: '1'` in the `local` section of your env file for the harness.
* `domain: 'localhost'` in a context grants nothing any more. If your code put it in an **outgoing** context to raise the callee's rights, claim the role instead (the call is signed):

```ts
const identity: any = this.proxy.context?.identity;
const roles: string[] = [...(identity?.roles ?? []), 'admin'];
const context = this.proxy.asNextContext(null, { identity: { ...identity, roles } });
```

* Specs that need local behaviour set `process.env.LOCAL_MODE = '1'` (and delete `AWS_LAMBDA_FUNCTION_NAME`) and restore both in `afterEach`.

#### 11.3.1 Local transport (`LOCAL_TRANSPORT=mock`, opt-in)

With `LOCAL_TRANSPORT=mock` in local mode, the send side does not call AWS. `AWSSNSService.publish()`, `AWSSQSService.sendMessage()` and the protocol `execute()`/`notify()`/`enqueue()`/`broadcast()` build the Lambda event record and run it through the engine's `LambdaHandler.handle()`, in the same process. Signature checks, transformers, sub-handlers and `batchItemFailures` work as in Lambda. Without the env nothing changes. In Lambda (`AWS_LAMBDA_FUNCTION_NAME` set) the env is ignored and one `WARN! env.LOCAL_TRANSPORT[mock] is ignored - in Lambda` line is logged.

| Item | Rule |
| --- | --- |
| Targets | This service only: the topic of `MY_SNS_ENDPOINT` or the `sns://self` host, the queue of `MY_SQS_ENDPOINT` or the `sqs://self` host, the `web://self` function for `execute()`. No target and no `MY_SNS_ENDPOINT`/`MY_SQS_ENDPOINT` (a local run) means this service's topic/queue, as the Lambda deploy sets these env names. Any other target throws `501 NOT SUPPORTED - local transport: <name> is not this service` (no AWS call, no silent drop) |
| Timing | SNS/SQS kinds (incl. `notify`/`enqueue`/`broadcast`) are async (`setImmediate`, no `DelaySeconds`) and return `mock-<uuid>`. `execute()` waits for the handler and parses the result like `invokeLambda()` (`useEvent` → async, 202) |
| Records | ARNs and URLs use the placeholder account `000000000000` and env `REGION`; the fake Lambda context too. `getHelloArn()` returns the placeholder account when no 12-digit account is found (local transport only; the Lambda rule is unchanged) |
| Loop guard | 50 deliveries in one burst, or a chain depth of 8 (a send from inside a delivery is +1). A burst ends at `drain()` or when nothing is pending (idle), so a long-running server without `drain()` is not capped for good. Over the cap: `508 LOOP DETECTED - local transport` and one `[MOCK] cap` line per burst |
| Log | one line per delivery: `[MOCK] deliver kind=<sns\|sqs\|protocol> target=<name> message=<id>` |

`$localTransport` (root) has `isActive()`, `drain()` (waits for every pending delivery, also the ones they send, then returns `{ kind, target, messageId, result?, error? }[]` and clears) and `deliveries()` (a copy, no wait). Only the last 100 finished deliveries are kept; older ones are dropped. `drain()` is process-wide, and it must not run inside an SNS/SQS delivery. SQS `batchItemFailures` and an SNS failure result are copied to `error`. Root names: `$localTransport`, `LocalDelivery` (type).

### 11.4 Handlers never reject; SQS and DynamoDB Stream return `batchItemFailures`

| Source | v4 | v5 |
| --- | --- | --- |
| `LambdaHandler.handle` | reported, then **rethrew** (Lambda invocation error) | reported, then **resolved**: web → the HTTP failure response (bad `x-protocol-context` JSON → `400 INVALID CONTEXT - …`), SQS/DDS → every record in `batchItemFailures`, anything else (unknown event too) → `{ error: <message> }` |
| SQS | swallowed each failure, resolved `undefined` | resolves `{ batchItemFailures: [{ itemIdentifier: messageId }] }` (empty list if all succeeded). `SQSHandler` type changed |
| DynamoDB Stream | same as SQS | same shape, `itemIdentifier = dynamodb.SequenceNumber`. `DynamoStreamHandler` type changed |
| SNS | swallowed, resolved | unchanged (report and resolve). SNS → Lambda is asynchronous; a reject means retries and the DLQ |
| cron | the first listener error rejected | each listener is caught and reported; resolves `void` |
| cognito | rejected | cognito: rethrow (response contract) — reported, then the original error is rethrown so its message reaches the client |

The returned failures take effect **only** when the event source mapping has `FunctionResponseTypes: [ReportBatchItemFailures]` (a deploy setting). Without it the return value is ignored and every message is deleted, as in v4. With it, a failed record is redelivered, so listeners must be idempotent; for streams also set `MaximumRetryAttempts` and `BisectBatchOnFunctionError`.

### 11.5 `LemonError` and status codes

* New root class `LemonError(status, code, detail?)`: `message` is `<status> <code> - <detail>` (the existing wire format), `status` and `code` are readonly. The root has 295 names.
* `mxNextFailure` reads `e.status` first. The message rule accepts only `3xx`–`5xx` prefixes: a thrown `200 OK - …` is no longer a 200 response (it becomes 503 and is reported).
* The HTTP proxies and `invokeLambda` accept any 2xx (a 2xx other than 200/201 without a body resolves `null`). A failure carries the peer status (`e.status`); the message string is unchanged.
* Every proxy request has a timeout: **25 000 ms** by default, per request `timeout` (ms). The error message is `ETIMEDOUT timeout after <ms> ms`.
* `throw new Error('404 NOT FOUND - …')` and the other prefixed messages keep working.

### 11.6 `guardProxy` and `enableSync`

* `guardProxy(context, callback, { saveOnError })`: on an exception v5 does **not** save pending updates (v4 always did). Pass `{ saveOnError: true }` for the v4 behaviour.
* **`MyCoreManager` `enableSync` now defaults to `false`.** A manager without `{ enableSync: true }` no longer synchronizes to OpenSearch, silently. Pass `{ enableSync: true }` to every manager that relies on the sync (`super('pet', parent, $FIELD.pet, { enableSync: true })`).

### 11.7 Default CRUD access policy (B13)

With the session on (`useSession` of the controller, env `USE_SESSION` for a direct `proxy.canDo()`), the built-in CRUD handlers apply a default policy: **list the caller's site, read/create/update/delete only the caller's own rows** (same `sid` and the same non-empty `uid`), admin everything, anyone else 403. Admin (`hasAdminRole()`: local mode, an IAM SigV4 caller, `roles` with `admin`) is decided before the session, so the `roles: ['admin']` claim of § 11.3 works without a session. Rules, spec ids and examples: `docs/v5/B13-access-policy.md`.

| Caller (non-admin) | Before | B13 |
| --- | --- | --- |
| same site, other user: `read` | allowed | 403 |
| empty `uid` (session or row, incl. `#…`) | read allowed, writes refused | 403 for every action |
| offsite session (`sid` empty): `list` | listed without a site filter | 403 |
| guest, or no session: `list` | guest listed the site; no session got `403 IDENTITY-TOKEN` from the pin | 403 (`doList` calls `canDo('list')` first) |
| `create` | stamped `sid`/`uid` | also stamps the session `gid` when the model has none |
| bulk (`doPostBulk`, `doPutBulk`) | the first denied item threw, earlier ones could be written | every item is checked first; one denial → `403 NOT ALLOWED - bulk[<action>] denied ids[<id,…>]`, nothing is written |

**`sid`-less records.** A record without `sid` follows `SID_LEGACY_ACCESS` for read, update and delete (read was open before B13): `admin` (default) → admin only, `open` → every role holder (v4), `deny` → update/delete refused even for admin, read as `admin`. With the session on, a `list` is pinned to the session `sid`, so such records never appear in it.

**Session off and local mode are unchanged.** A controller with `useSession: false` (and every call in local mode) keeps the v5 rules above: same-site read for any role holder, update/delete for the same `sid` and `uid`, no list check or pin.

**Override** (highest first): a `MyManagerProxy.canDo()` override (runs first, falls back to `super.canDo()`); the controller option `policy` (`CRUDCreationOptions.policy?: Partial<AccessPolicy>`); `MyManagerProxy.accessPolicy()` per model type; the core `DEFAULT_ACCESS_POLICY` (`list: 'site'`, the other four `'owner'`, and since B15 `internal: 'admin'`, `cross: 'accept'`). Scopes: `owner`, `group`, `site`, `any`. New root names: `AccessScope`, `AccessPolicy`, `DEFAULT_ACCESS_POLICY` (B15: `AccessInternal`, `AccessCross`).

* **Restore the v5 read rule in one line:** `{ useSession: true, policy: { read: 'site' } }` in the controller options.
* Services that share rows by another field (`model.id`, `userId`, member lists) keep or add a `canDo` override; it runs before the default.
* The env table of § 11.8 has no new name: `SID_LEGACY_ACCESS` keeps its values and default (its row now says that read follows it too).

**B15 (list `view`, internal admin, cross-cloud).** Session on only; session off and local mode are unchanged. Rules and spec ids: `docs/v5/B15-security.md`.

* **`?view=` of `doList`.** No view = `mine` (`sid` + `uid` of the session, `?uid=` ignored) for a non-admin, `admin` for an admin-like caller. `mine` · `group` (`sid` + `gid`) · `site` (`sid`, `?uid=` narrows) · `admin` (the B13 admin list: own site unless `?sid=`). `policy.list` is now the **widest** scope a non-admin may ask for (`owner` < `group` < `site` < `any`; wider → `403 NOT ALLOWED - view[…] is over list[…]`). A non-admin `view=admin` → `403 NOT ALLOWED - view[admin] needs admin`. Another value → `400 INVALID - view[…] is invalid`, unless the controller overrides `resolveListView(view, $ctx)`. `view` is reserved: it never reaches `packSearchParam` as a filter. **The B13 default list (`site`) is now asked with `?view=site`.**
* **Internal admin.** A protocol caller (`context.channel === 'internal'`, § 15.1) is admin for the CRUD defaults (`canDo`, the list pin) when `policy.internal` is `'admin'` (default). `policy: { internal: 'identity' }` evaluates it by the relayed identity instead. An entry without `channel` (cron, streams, notifications, non-protocol SNS/SQS) is not internal. `hasAdminRole()` is unchanged, so `GET /<type>/<id>/admin` and `hasAdminRole('owner')` gates still need a role. Without `PROTOCOL_VERIFY=enforce` an internal call is accepted unsigned (§ 13.4): install the C1 key and enforce, or set `internal: 'identity'`.
* **Cross-cloud.** An identity with `cid` (cloud-id = the caller's account number) different from the receiver's own `context.accountId` is cross-cloud; an empty `cid` is the same cloud. `policy.cross`: `'accept'` (default, same rules), `'identity'` (never internal admin), `'deny'` (403 after the admin role). The `TRACE` line gets ` cross=1` (never the account number).
* **`getCurrentSession()` under `internal`.** A relayed identity (no `userAgent`) is now the session when `channel === 'internal'` (not in local mode, not with `useSession: false`), so a relayed user is no longer `403 IDENTITY-TOKEN` and `create` stamps its `sid`/`uid`.

### 11.8 `$U.ts()` / `$U.dt()` use timeZone 9 by default

| Input | v4 | v5 |
| --- | --- | --- |
| timeZone omitted | 0 (UTC) | `DEFAULT_TIME_ZONE` = 9. Pass `0` for UTC |
| string | host offset at call time (DST error) | wall clock of `timeZone`, host TZ and DST free |
| `dt(Date)` | the same object | a copy |
| `ts(Date, tz)` | changed the argument | never changes it |

**`$U.ts()` without arguments prints the time 9 hours later than v4** (KST wall clock instead of UTC); log time stamps follow it. `convDate`, `convDateToTS` and `convDateToTime` give the same results as before without changing a `Date` argument.

These three defaults can be changed by environment variables, read at call time (`process.env`):

| Env | Default | Values | Effect |
| --- | --- | --- | --- |
| `DEFAULT_TIME_ZONE` | `9` | hours, a finite number (`0`, `-5`, `5.5`); else `9` | timeZone of `$U.ts()`/`$U.dt()`/`convDate*` when omitted |
| `DATE_ONLY_CLOCK` | `noon` | `noon`, `midnight`; else `noon` | clock of `YYYY-MM-DD`, `YY-MM-DD`, `YYYYMMDD` (12:00:00 or 00:00:00) |
| `SID_LEGACY_ACCESS` | `admin` | `admin`, `open` (v4), `deny` (nobody, not even admin); else `admin` | who may update/delete a `sid`-less record (§ 11.7); with the session on, read follows it too (B13) |

### 11.9 `GeneralAPIController` is deprecated

It has no authorization. Gate it in your own code or move to `AbstractCRUDController`. It will be removed in v6.

### 11.10 `lemon-templates-api`

* `env/lemon.yml` `local`: `LOCAL_MODE: '1'`.
* `api-search.ts` and `api-callback.ts` use `$U.isLocalMode()` for their local-only routes.
* `callback/proxy.ts` claims the `admin` role in its outgoing context instead of `domain: 'localhost'`.
* `MockModelManager`, `TestModelManager`, `CallbackModelManager` pass `{ enableSync: true }`.

## 12. Services that carry a `src/cores/` copy (B6)

This section is for a service that pins lemon-core `^4.x` and carries a `src/cores/` copy (11 files, about 6.3k lines; the 2026 template generation). The full per-repo procedure, with counts per repo: `docs/v5/B6-dou-migration.md`.

Move one repo in four stages, one PR each:

* **A. Compile and run, copy kept.** Install v5 and the peers, delete the `exec-cli` branch, rename the search names, fix `$T.S2`, pass `tsc`, tests and the local harness.
* **B. Remove the copy.** Import from `lemon-core` / `lemon-core/testing`, then apply § 11.3, § 11.6, § 11.7 and § 11.8 to your own code.
* **C. Trust boundary and deploy.** Signing key, `warn` → `enforce`, `ReportBatchItemFailures`, Lambda runtime — with the deploy lane.
* **D. `@field()` models** (optional, § 10.3).

**A alone is deployable and keeps the copy's v4 behaviour (sync on, save on error, `domain` checks); B switches on the § 11 contracts.** Root-level changes (§ 11.4, § 11.5, § 11.8) apply from A.

Measured in the five DoU backend repos (read-only census):

| Item | Count |
| --- | --- |
| must-fix occurrences (removed search names, `$T.S2` 3-arg, `exec-cli`, directory import) | 73–80 per repo in 9–11 files; 68 of them in the same 6 shared files |
| `MyCoreManager` subclasses that relied on the copy's `enableSync` default | 46, all need `{ enableSync: true }` |
| `require('lemon-core/dist/exec-cli')` branch in `src/index.ts` | 1 per repo (66 of 68 consumer repos) |
| `$T.S2` with 3 arguments | 22, of which 2 change an id (`'-'` delimiter) |
| `lemon-model` not declared | 4 of 5 (the fifth pins `^1.2.2`) |
| `ReportBatchItemFailures` on an event source | 0 |

## 13. `context.source` carries the first request path (B10)

`packContext()` now adds the request path to `context.source`: `api://<account>@<service>/<type>/<id>/<cmd>#<version>` (v4: `api://<account>@<service>#<version>`). `type`, `id` and `cmd` come from `pathParameters` by the same rule as `web.transformToParam()`. An event without `pathParameters` keeps the v4 value. An internal call (host-less, `x-protocol-context`) keeps the caller's context as before, so every service down the chain sees the path of the first external request. Details: `docs/v5/B10-context-source.md`.

* Code that compares `context.source` with a service URI by equality compares the service part only: `new URL(source).host` is the service, `.pathname` the path, `.hash` the version. lemon-core itself only checks `source === 'express'` (`doReportError()`, `doReportSlack()`), which this change does not touch.

### 13.1 `doReportError()` account id (B10)

`getHelloArn()` now picks the SNS account in this order: the account of `context.invokedFunctionArn` → `NextContext.accountId` → `RequestContext.accountId`, and takes a candidate only when it is 12 digits. In Lambda the target is therefore always the function's own account, also for a downstream call that received another account's `x-protocol-context`. When no candidate passes, it throws `.accountId[] is missing - …` without the rejected value (a local runner can put the OS user name there). `REPORT_ERROR_ARN` (`arn:aws:sns:…`) still wins. `doReportError()` and `doReportSlack()` also return `'!ignore'` in local mode (`$U.isLocalMode()`, § 11.3), next to the old `source === 'express'` and empty-`accountId` rules. If your service expected `doReportError()` to reach SNS from a local run, it now gets `'!ignore'`. Details: `docs/v5/B10-report-account.md`.

### 13.2 Error reports with a circular structure (B10)

The error report path (`doReportError()` → `AWSSNSService.reportError()` → `asErrorPayload()` → `publish()`) and `GETERR()` now print objects with an internal circular-safe stringify instead of a bare `JSON.stringify()`. Before, a thrown http response or axios error (`req` ↔ `res`), or a circular object in `Error.errors`/`cause`, `data` or `context`, made the report fail with `Converting circular structure to JSON`, and the report was lost. Now a back-reference to an ancestor is printed as the string `'[Circular]'`, an `Error` inside an object is printed as `{ name, message, stack, …own props, errors?, cause? }` (bare `JSON.stringify()` printed `{}`), and a `BigInt` as its decimal string. Other values give the same text as before. A consumer that parses the report payload can meet `'[Circular]'` in place of an object. `$U.json()` is unchanged and still throws on a circular object. Details: `docs/v5/B10-report-circular.md`.

### 13.3 Secret header values are masked in logs (B10)

`LambdaHandler.findService()` logs the headers of every event, and the SNS HTTP subscription handler logs the headers of every notification. These lines now print a masked copy: the value of `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-amz-security-token`, `x-protocol-context`, `x-protocol-signature` and `x-lemon-identity` (key match is case-insensitive; the last three follow `HEADER_PROTOCOL_CONTEXT`/`HEADER_LEMON_IDENTITY` if you set them) becomes `[masked:<length>]`, with no character of the value. Other headers are printed as before. `signToken()` logs `[masked:<length>]` instead of the signature, a failed identity header parse logs `[masked:<length>]` instead of the header value, and the Cognito `identity(req)`/`identity(new)` lines of `prepareContext()` print `apiKey` and `accessKey` as `[masked:<length>]` (the `NextIdentity` object itself is unchanged). Only the log text changes: the handler still reads the original headers, so the service type and the request path are the same. If you debugged with header values in CloudWatch, read them from the request itself (for example a local run) instead. Details: `docs/v5/B10-header-log-mask.md`.
### 13.4 Before `PROTOCOL_VERIFY=enforce` (B10)

`enforce` rejects a host-less call (direct invoke, SNS, SQS) whose `x-protocol-context` or JSON `x-lemon-identity` is unsigned or mismatched; external requests (`host` present) are not affected in any mode. Switch a function only when all three hold, and set the value through your deploy env, not by editing the function directly:

* **The key is in place.** Every service of the install has the same `PROTOCOL_SIGN_KEY` as a config `*` (KMS) value, and the function log has no `PROTOCOL sign key not set` line. Without a key the mode is `off`, so a zero `PROTOCOL unsigned` count means nothing; with `enforce` and no key every internal call is rejected (`no-key`). The config init line `> config[KEY] :=` now prints `[masked:<length>]` for every decrypted `*` value (it printed the first 12 characters), so installing the key does not leak it to CloudWatch.
* **Every caller is on v5.** Each service that calls this one depends on lemon-core `^5` with no `src/cores/` copy. lemon-core 4.x callers, including 4.3.0, never sign.
* **A clean `warn` window.** In `warn`, the function logged no `PROTOCOL unsigned <source> (<reason>)` line for at least 7 days or the longest batch period, whichever is longer (bounded by the log retention), and every caller → callee pair was seen at least once in that window. Queues and DLQs hold no unsigned v4-era messages.

Then check one host-less unsigned call returns `403 NOT ALLOWED - unsigned protocol context` and one real internal call still succeeds. Roll back by setting `warn` (or removing the value). Measurement commands and the order: `docs/v5/B10-verify-enforce.md`.

### 13.5 `lemon-fields-types`: one field name, one type per index (B10)

lemon-core now ships a CLI, `lemon-fields-types` (`bin/lemon-fields-types.mjs`, from 5.0.5). One OpenSearch index has one dynamic mapping, so the first document that writes a field fixes its type, and a later model that writes the same name with another type gets `400 mapper_parsing_exception` (the document is stored but never reaches the index). The CLI reads the declared TypeScript types of the models in your `$FIELD` object, normalizes each field to `string`/`number`/`boolean`/`date`/`object`, and lists every field name with two or more kinds. It compiles nothing, runs nothing, and calls no AWS or OpenSearch.

* Add `"fields:types": "lemon-fields-types"` to your `scripts` and run `npm run fields:types`. Exit 1 on a `hard` conflict (`object` vs a scalar, `boolean` vs `number`/`date`: fails in both write orders); `--fail-on order` also fails on order-dependent pairs (`string` vs `number` …). Exit 2 on bad arguments or no TypeScript program.
* `typescript` is an optional peer (`>=4.7`, no upper bound so a TS 6.x service does not hit ERESOLVE). The CLI uses your repo's own `typescript` (devDependency) first, then each `--fallback <node_modules>`, then the copy next to lemon-core; none → exit 2. The summary line ends with `ts=<version>`, and `--json` has `typescript: { version, from }`.
* Services that write into the same index check together: `npx lemon-fields-types --root ../other-api --json > other.json`, then `npm run fields:types -- --with other.json`.
* A repo still on lemon-core 4.x can borrow the bin without changing its dependencies: `npx -p lemon-core@5 lemon-fields-types --root .`.

Options, output format, and limits: `docs/v5/B10-fields-types.md`.

## 14. Dependency audit: `query-string` and `uuid` removed, AWS SDK `^3.1159.0` (B11)

`npm audit --omit=dev` on lemon-core is 0. Details: `docs/v5/B11-deps-audit.md`.

* **`query-string` and `uuid` are no longer lemon-core dependencies.** If your service imports either one and got it only through lemon-core, add it to your own `package.json` (`npm i query-string@7 uuid@9`, or move to `qs` and `crypto.randomUUID()`).
* **AWS SDK peers: lower bound `^3.1159.0`** (was `^3.971.0`) for all 8 optional peers, and the 2 DynamoDB packages in `dependencies` use the same range. `@aws-sdk/core` ≤ 3.972.0 pulls a critical `fast-xml-parser`; 3.1159.0 no longer depends on it. Update the peers in your own `package.json` to the same version, so `npm ls @aws-sdk/core` shows one copy.
* **`$U.qs.parse()` / `$U.qs.stringify()` keep their output.** They now run on `qs` (already a lemon-core dependency) with options that reproduce `query-string` 7: sorted keys, `a=1&a=2` arrays, `a` for `null`, flat `a[b]` keys, strict `%XX` encoding, null-prototype result, no parameter limit. The same holds for the `$protocol()` callback query and the query string of `createSigV4Proxy()`/`createHttpWebProxy()`. Intentional differences:
  * A `__proto__=…` pair is dropped (prototype-pollution guard in `qs`); `constructor` and `hasOwnProperty` keys stay.
  * Every invalid `%XX` byte decodes to `\uFFFD` (`query-string` 7 kept the raw `%XX`, and only `%C2` became `\uFFFD`), in linear time.
* **`$U.uuid()` is unchanged in form** (lower-case 36-char v4). It now calls Node's `crypto.randomUUID()`. The automatic S3 key of `AWSS3Service.putObject()` also uses it.

## 15. Call channel, relay and trace (B14)

Internal calls no longer carry the caller's full context. Each entry sets `context.channel` once, an internal hop carries a small signed relay (identity summary + trace), and every entry logs one `TRACE` line. `x-protocol-context` is deprecated. Plan: `docs/v5/B14-relay-context.md`; implementation record: `docs/v5/B14-relay-context-impl.md`. Needs lemon-model with `NextContext.channel` and `NextContext.trace` (`NextTrace`).

### 15.1 `context.channel`

| Entry | `channel` |
| --- | --- |
| web with a `host` header (API Gateway, ALB, Function URL, the devkit express server) | `external` |
| web without `host` and without a protocol header (direct invoke) | `internal` |
| local mode (`$U.isLocalMode()`), web or ALB without a protocol header | `local` (wins over the `host` rule) |
| protocol receive: web relay or legacy context, SNS/SQS `x-protocol-service` | `internal` (also in local mode, so the local transport takes the Lambda path) |

* `fields/admin` is allowed only when `channel !== 'external'`. `domain` is still filled (and `runtime.external` still reports it) but is no longer a gate. A context built outside the lemon-core entries has no `channel` and is not treated as external.
* The relay never carries a channel; the receiver sets it.

### 15.2 The relay `x-lemon-relay`

| Item | Value |
| --- | --- |
| web | header `x-lemon-relay` |
| SNS/SQS | the `relay` field of the protocol param; the `context` field is not sent |
| value | `r1.<base64url(JSON)>`, at most 4096 bytes on receive (about 0.4 KB for a typical caller) |
| JSON | `idt` (`sid`, `uid`, `gid`, `roles`, `identityId`, `lang`, and since B15 `cid`, `aid` only), `tid`, `hop`, `src`, `via`, `pid`, `iat` |
| signature | web: `x-protocol-signature` with the relay string in the context slot of the canonical; SNS/SQS: the message signature (unchanged) |

The receiver builds its context from the relay: `identity` = `idt`, `channel` = `internal`, `depth` = `hop`, `source` = `src`, `trace` = `{ tid, hop, via, pid, src }`, and its own `requestId`/`accountId` (Lambda `awsRequestId` and the account of `invokedFunctionArn`). Nothing else of the caller crosses the hop: no `cookie`, `authorization`, `referer`, `origin`, `clientIp`, `userAgent`, `domain`, `meta`, tokens or keys. A web event with `host` ignores the relay exactly like `x-protocol-context`. A bad relay → `400 INVALID CONTEXT - relay <reason>`.

* **Code that read caller request values in a downstream service** (`$ctx.cookie`, `$ctx.authorization`, `$ctx.clientIp`, `$ctx.domain`, `identity.meta` …) gets `undefined` now. Pass what you need in the body or the param.
* **`depth`** is the hop count of the chain. Code that raised `context.depth` by hand to detect loops can read `context.trace.hop` instead.
* **The receiver's `requestId` is its own.** The first request's id is `context.trace.tid`, the direct caller's is `context.trace.pid`.

### 15.3 Hop cap

`PROTOCOL_MAX_HOP` (default 8). A relay with `hop` over the cap → web `508 LOOP DETECTED - protocol hop <n>`, SNS reported (not dispatched), SQS record failure. The sender refuses to build a hop over the cap with the same error, before any AWS call.

A same-service callback of an SNS/SQS protocol call (the `callback` attribute names this service, so it runs in-process) is a hop too: `trace.hop` + 1 with the same `tid`, `via`/`pid` of the current receiver, `depth` = the new hop (was `depth + 1` by hand), one `TRACE` line, and the same cap (over the cap → SNS reported, SQS record failure).

### 15.4 Trace

* Every entry sets `context.trace`: `{ tid: requestId, hop: 0 }` without a relay (external, local, direct invoke, legacy context), or the relay trace. `tid` is the requestId only when it is a safe id (`/^[\w.:-]{1,128}$/`, as Lambda and API Gateway ids are); otherwise a new uuid. The local express requestId (`YYYY-MM-DD hh:mm:ss.SSS`, with a space, not unique within a millisecond) therefore gets a uuid; `context.requestId` itself is unchanged.
* One line per web entry and per SNS/SQS protocol receive: `TRACE tid=<tid> hop=<hop> ch=<channel> via=<service|-> src=<path|->` (the via service host and the src path only; no identity value, no account). Join the lines of a chain by `tid` in CloudWatch Logs Insights.
* `doReportError()` adds `trace` to the report payload.

### 15.5 `x-protocol-context` is deprecated

| Env | Values | Default | Effect |
| --- | --- | --- | --- |
| `PROTOCOL_LEGACY_CONTEXT` | `off`, `send` | `off` | `off`: send the relay only. `send`: the relay and the full context (`x-protocol-context` / `context`) for v4 receivers |
| `PROTOCOL_LEGACY_ACCEPT` | `accept`, `warn`, `reject` | `warn` | a call with the legacy context and no relay. `accept`: as before. `warn`: as before + one `PROTOCOL deprecated x-protocol-context <caller service> (<web\|sns\|sqs>)` line. `reject`: web `400 INVALID CONTEXT - legacy context rejected`, SNS reported, SQS record failure |
| `PROTOCOL_MAX_HOP` | a positive integer | `8` | hop cap (§ 15.3) |

* An accepted legacy context keeps the v4 behaviour (the caller's context as is) plus `channel: 'internal'` and an entry trace.
* Relay and legacy together → the relay is used; no deprecated line.
* A host-less JSON `x-lemon-identity` (no relay, no legacy context) keeps its behaviour and the `PROTOCOL_VERIFY` rules; it logs one `PROTOCOL deprecated json identity (web)` line unless `PROTOCOL_LEGACY_ACCEPT=accept`.
* `HEADER_PROTOCOL_CONTEXT` is `@deprecated`; removal in v6.
* The values are read through the config service like `PROTOCOL_VERIFY` (env or the config file).

Settings while services move from v4 to v5 (DoU):

| Stage | Setting of a migrated (v5) service |
| --- | --- |
| some services still v4 | send `PROTOCOL_LEGACY_CONTEXT=send` (v4 receivers need the context). receive `PROTOCOL_LEGACY_ACCEPT=warn` (v4 callers send only the context) |
| all services v5 | send `off`. receive keep `warn`, and check that no `PROTOCOL deprecated` line is logged |
| after the `deprecated` count is 0 | receive `reject`. then `PROTOCOL_VERIFY=enforce` (§ 13.4) |

Module: `src/cores/protocol/protocol-relay.ts` (deep path `lemon-core/dist/cores/protocol/protocol-relay`, not on the root): `buildRelay`, `encodeRelay`, `decodeRelay`, `asRelayContext`, `traceLine`, `readLegacySend`, `readLegacyAccept`, `readMaxHop`, `HEADER_LEMON_RELAY`.

---

## 16. lemon-model through lemon-core (B16)

Since 5.0.9, lemon-core publishes the whole lemon-model surface on the sub-path `lemon-core/model` (`export * from 'lemon-model'`). Your service does not declare `lemon-model` any more (D73). Design record: `docs/v5/B16-model-subpath.md`.

Rule:

1. No `lemon-model` in your `dependencies` or `devDependencies`.
2. The 32 v4 lemon-model names (`CoreModel`, `CORE_FIELDS`, `AbstractTransformer`, `NextContext`, `NextIdentity`, `View`, `Body`, `SimpleSet`, …) from `lemon-core`. The root is unchanged (§ 10.2).
3. Every other lemon-model name (`field`, `fieldsOf`, `specsOf`, `FIELDS_KEY`, …) from `lemon-core/model`.

Before:

```jsonc
// package.json
"dependencies": { "lemon-core": "^5.0.8", "lemon-model": "^5.0.2" }
```

```ts
import { CoreModel, NextContext } from 'lemon-model';
import { field, fieldsOf } from 'lemon-model';
```

After:

```jsonc
// package.json
"dependencies": { "lemon-core": "^5.0.9" }
```

```ts
import { CoreModel, NextContext } from 'lemon-core';
import { field, fieldsOf } from 'lemon-core/model';
```

The pair: lemon-core pins `lemon-model` to one exact version (5.0.9 pins `5.0.2`; 5.0.11 pins `5.0.4`, so strict consumers of `lemon-core/model` need no `skipLibCheck`). Each lemon-core release names its lemon-model in `CHANGELOG.md`. A new lemon-model reaches your service with a lemon-core release, not by itself. After the move, `npm ls lemon-model` shows one copy, so one `CoreModel` class (`instanceof` works across files).

Guard: `no-restricted-imports` for `lemon-model` and `lemon-model/*` in your eslint config (snippet in the B16 doc).

Resolution: since 5.0.10, `lemon-core/model` and `lemon-core/testing` also resolve under TypeScript `moduleResolution: node` and Jest 27, without `paths` or `moduleNameMapper`. The package has physical `model/` and `testing/` folders with a `package.json` each (`main`/`types` into `dist/`) for resolvers that ignore the `exports` map; Node itself uses the `exports` map. With 5.0.9 these tools need two consumer lines (`compilerOptions.paths` for `lemon-core/model` in `tsconfig.json`, and a `moduleNameMapper` entry in the Jest config); remove them when you bump to 5.0.10.

---

## 18. Dual sign keys and log screening

Nothing changes until you set the new env names: one key, same signatures, same verify results.

### 18.1 Previous key B

| Env | Meaning |
| --- | --- |
| `PROTOCOL_SIGN_KEY_PREV` | previous protocol key B — verify only |
| `PROTOCOL_SIGN_KEY_PREV_UNTIL` | expiry of B, epoch seconds |
| `JWT_SIGN_KEY_PREV` | previous JWT HS256 key B — local `api/<self>` verify only |
| `JWT_SIGN_KEY_PREV_UNTIL` | expiry of B, epoch seconds |

* The receiver tries A (`PROTOCOL_SIGN_KEY` / `JWT_SIGN_KEY`) first, then B while `now <= UNTIL`. Signing always uses A. The signature format stays `v1.<ts>.<sig>`.
* B without `UNTIL` (or `UNTIL` not a positive number, or in the past) is ignored.
* `verifyContext()` / `verifyMessage()` return `prev: true` when B matched. Deep imports that passed `{ key }` keep the single-key behaviour.
* `JWT_SIGN_KEY` is now read per call through the config service, so a `*` (KMS) value is decrypted. Unset → `lemon` as before. If you had set an encrypted `*…` value, it was used as the raw string before; it is now decrypted, so HS256 tokens issued before the upgrade fail to verify — set the old value as `JWT_SIGN_KEY_PREV` with an `UNTIL` for the token lifetime.
* `buildJwtSecret(signKey?)` takes an optional key.

Replace a key in two steps across every function of the install: (1) set the new key as `_PREV` with `_PREV_UNTIL` everywhere, (2) set it as A and the old A as `_PREV` with a new `_PREV_UNTIL`. Every receiver must run this lemon-core version first; 5.0.7 or older ignores B. For SQS, keep the B window at least as long as the queue retention.

### 18.2 Value-based log screening

Every value the config service decrypts (`*…`, 8 characters or more) and every sign key read from a plain env is registered. When `_log` / `_inf` / `_err` prints one of them, the value becomes `[masked:<length>]` and one more line `!SECRET in log — masked` is printed at error level. Search for that line in CloudWatch to find the code that logs a secret. Direct `console.log` is not screened. With `LS=1` nothing is printed, so nothing is screened either (no cost).

Also: `AWSKMSService.encrypt()` logs the plaintext length (was the first 10 characters) and the ciphertext length (was the full result with the key ARN); `parseIdentityJWT()` errors print `@token[masked:<length>]` (was the full token).

Details: `docs/v5/security-key-rotation.md`.

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
- [ ] `lemon-model` `^5.0.0` declared in your own `package.json`; `field`/`fieldsOf`/`specsOf` imported from `lemon-model`, not `lemon-core` (§ 10.2)
- [ ] No `lemon-core/dist/generated/field-registry` import; no `fields:*` script calls into lemon-core (§ 10.1)
- [ ] Each converted model: `@field()` on stored fields, `declare` on narrowed redeclarations, a parity spec with set comparison (§ 10.3, § 10.4)
- [ ] Specs that compare field arrays by order compare sets (§ 10.5)
- [ ] Same `PROTOCOL_SIGN_KEY` in every service of the install; `PROTOCOL_VERIFY=warn` until no v4 caller remains, then `enforce` (§ 11.1)
- [ ] No caller relies on `x-protocol-context` through API Gateway, ALB or a URL (§ 11.2)
- [ ] `LOCAL_MODE: '1'` in the local env; no `domain: 'localhost'` as an elevation token (§ 11.3)
- [ ] SQS/Stream event sources get `ReportBatchItemFailures` when you want partial retries; listeners are idempotent (§ 11.4)
- [ ] Code that checked a thrown `200 OK - …` or only 200/201 is updated; long calls pass `timeout` (§ 11.5)
- [ ] **Every manager that needs OpenSearch sync passes `{ enableSync: true }`**; `guardProxy` callers that need save-on-error pass `{ saveOnError: true }` (§ 11.6)
- [ ] Updates/deletes of `sid`-less records go through an admin (§ 11.7)
- [ ] Same-site reads of other users' rows are intended? Add `policy: { read: 'site' }` or a `canDo` override; offsite sessions no longer list (§ 11.7, B13)
- [ ] `$U.ts()`/`$U.dt()` callers that expected UTC pass `0` (§ 11.8)
- [ ] No new use of `GeneralAPIController` (§ 11.9)
- [ ] `src/cores/` copy removed, or every removed search name inside it replaced (§ 12)
- [ ] `require('lemon-core/dist/exec-cli')` branch deleted from `src/index.ts` (§ 12)
- [ ] Every `MyCoreManager` subclass that relied on the copy's default passes `{ enableSync: true }` (§ 12, § 11.6)
- [ ] Code that compares `context.source` by equality compares the service part only; the value now ends with the request path (§ 13)
- [ ] Local runs that expected `doReportError()` to publish to SNS: it returns `'!ignore'` in local mode; the SNS account comes from `invokedFunctionArn` first (§ 13.1)
- [ ] Consumers that parse error report payloads accept `'[Circular]'` strings and `Error` objects as `{ name, message, stack }` (§ 13.2)
- [ ] Debugging that read header values (token, cookie, `x-protocol-context`, signature) from CloudWatch now sees only `[masked:<len>]` (§ 13.3)
- [ ] `PROTOCOL_VERIFY=enforce` only after the key is set everywhere, every caller is on v5, and a `warn` window shows no `PROTOCOL unsigned` line (§ 13.4)
- [ ] `npm run fields:types` (`lemon-fields-types`) shows no `hard` conflict; services that share one index are checked together with `--with` (§ 13.5)
- [ ] Direct imports of `query-string` or `uuid` are in your own `package.json` (§ 14)
- [ ] Downstream code does not read caller request values (`cookie`, `authorization`, `clientIp`, `domain`, `identity.meta` …) from an internal call's context; loops are detected by `context.trace.hop` (§ 15.2)
- [ ] `fields/admin` and other gates read `context.channel`, not `domain` (§ 15.1)
- [ ] While v4 services remain: send `PROTOCOL_LEGACY_CONTEXT=send`, receive `PROTOCOL_LEGACY_ACCEPT=warn`; then `off`, then `reject` when no `PROTOCOL deprecated` line is logged (§ 15.5)
- [ ] `@aws-sdk/*` peers in your `package.json` at `^3.1159.0`, one `@aws-sdk/core` in `npm ls` (§ 14)
- [ ] Since 5.0.9: no `lemon-model` in your `package.json`; root names from `lemon-core`, `field`/`fieldsOf`/`specsOf` from `lemon-core/model`; `npm ls lemon-model` shows one copy (§ 16)
- [ ] Key replacement only after every receiver runs this version; `_PREV` always with `_PREV_UNTIL`; an encrypted `JWT_SIGN_KEY` set before is kept as `JWT_SIGN_KEY_PREV` for the token lifetime (§ 18)
