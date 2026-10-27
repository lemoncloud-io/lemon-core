# UPGRADE GUIDE: lemon-core V4 to V5

> Work in progress. This guide grows with each v5 bundle. This revision covers B1 (packaging) and B2-a (dependencies: `request`, `lodash`, `ioredis`, `memcached` removed).

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

## At-a-Glance Checklist

- [ ] Node.js 24 (`.nvmrc`, local runtime)
- [ ] ESM services: load env with `await import('lemon-core/dist/environ')` before `await import('lemon-core')`
- [ ] No directory deep imports (`lemon-core/dist/<dir>`); plan to remove file deep imports before v6
- [ ] Test helpers from `lemon-core/testing` (optional in v5)
- [ ] `npm ls lemon-core` shows one copy
- [ ] Direct imports of `request`, `lodash`, `ioredis`, `memcached` are in your own `package.json`
- [ ] `CacheService.create()` without `backend` is in-process; inject a `CacheBackend` for a shared cache
- [ ] No `RedisStorageService` / `DummyRedisStorageService` / `RedisOptions`
