/**
 * `cache-services.ts`
 * - common service for remote cache
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-02 initial version
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-04-01 optimized for `AbstractProxy`
 *
 * @copyright   (C) lemoncloud.io 2020 - All Rights Reserved.
 */
import NodeCache from 'node-cache';
import { $U, _log, _inf } from '../../engine';
const NS = $U.NS('CCHS', 'green'); // NAMESPACE TO BE PRINTED.

/**
 * type `CacheOptions`
 */
export interface CacheOptions {
    /**
     * (optional) cache backend type (default: 'node' = in-process `node-cache`)
     * - v5: the remote types are removed. inject a remote cache via `backend`.
     */
    type?: 'node';
    /**
     * (optional) cache backend implemented by the consumer (ex: a Redis client). default is in-process `node-cache`.
     */
    backend?: CacheBackend;
    /**
     * (optional) namespace. used as cache key prefix to avoid key collision between different services
     */
    ns?: string;
    /**
     * (optional) default timeout of cache entries. 0 for unlimited (default: 1-day)
     */
    defTimeout?: number;
}

/**
 * type `CacheKey`
 */
export type CacheKey = string | number;

/**
 * type: `Timeout`
 */
export interface Timeout {
    /**
     * key will be expired after given number of seconds
     */
    expireIn?: number;
    /**
     * key will be expired in given Unix timestamp (seconds since epoch)
     *  - ignored if 'expireIn' is provided
     *  - not accurate because this value is replaced to time to live in seconds using Math.ceil()
     */
    expireAt?: number;
}

/**
 * type `CacheEntry`: parameter type of 'setMulti' operation
 */
export interface CacheEntry<CacheValue> {
    /**
     * key
     */
    key: CacheKey;
    /**
     * value
     */
    val: CacheValue;
    /**
     * timeout - same effect as 'expireIn' if given value is number
     */
    timeout?: number | Timeout;
}

/**
 * type `KeyValueMap`: result type of 'getMulti' operation
 */
export type KeyValueMap<CacheValue> = Record<CacheKey, CacheValue>;

/**
 * class: `CacheKeyMakable`
 * - to provide the custom key-string of cache.
 * - the global pkey would be like `<project>:<model.ns>:<model.type>::<cache-key>` (ex: `lemon:SS:item::100001`)
 */
export interface CacheKeyMakable {
    /**
     * make the global pkey
     * - default must be like `${ns}${delim}${key}`
     */
    (ns: string, delim: string, key: CacheKey): string;
}

/**
 * class: `CacheSupportable`
 * - support basic cache operation(read/write/timeout).
 */
export interface CacheSupportable<CacheValue = any> {
    /**
     * save into cache w/ timeout(sec)
     */
    set(key: CacheKey, val: CacheValue, timeout?: number | Timeout): Promise<boolean>;
    /**
     * read from cache
     */
    get(key: CacheKey): Promise<CacheValue>;
    /**
     * increment number by `inc`
     * - should be atomic operation w/ thread safe.
     */
    inc(key: CacheKey, inc: number): Promise<number>;
}

/**
 * class `CacheService`
 * - common service to provide cache
 */
export class CacheService<CacheValue = any> implements CacheSupportable<CacheValue> {
    /**
     * Environment variable name for cache server endpoint
     * - v5: lemon-core no longer reads it (kept as a name for consumers that build their own backend).
     * @static
     */
    public static readonly ENV_CACHE_ENDPOINT = 'CACHE_ENDPOINT';

    /**
     * Environment variable name for default cache timeout
     * @static
     */
    public static readonly ENV_CACHE_DEFAULT_TIMEOUT = 'CACHE_DEFAULT_TIMEOUT';

    /**
     * Default cache timeout
     * @static
     */
    public static readonly DEF_CACHE_DEFAULT_TIMEOUT = 24 * 60 * 60; // 1-day

    /**
     * Namespace delimiter
     * @private
     * @static
     */
    private static readonly NAMESPACE_DELIMITER = '::';

    /**
     * Namespace of cache key
     */
    public readonly ns: string;

    /**
     * the final options to create this service.
     */
    public readonly options: CacheOptions;

    /**
     * maker of cache-key
     */
    public readonly maker: CacheKeyMakable;

    /**
     * Cache backend instance
     * @private
     */
    private readonly backend: CacheBackend;

    /**
     * Factory method
     *
     * @param options   (optional) cache options
     * @param maker     (optional) custome cache-pkey generator.
     * @static
     */
    public static create(options?: CacheOptions, maker?: CacheKeyMakable): CacheService {
        const type = options?.type || 'node';
        const ns = options?.ns || '';
        const defTimeout = $U.N(
            options?.defTimeout,
            $U.N($U.env(CacheService.ENV_CACHE_DEFAULT_TIMEOUT), CacheService.DEF_CACHE_DEFAULT_TIMEOUT),
        );
        // without an injected backend, only the in-process type is valid (ex: a v4 `redis` caller fails loudly).
        if (!options?.backend && type !== 'node')
            throw new Error(`@type [${type}] is invalid (inject options.backend) - CacheService.create()`);
        options = { ...options, type, ns, defTimeout };

        _log(NS, `constructing [${options.backend ? options.backend.name : type}] cache ...`);
        _log(NS, ` > ns =`, ns);
        _log(NS, ` > defTimeout =`, defTimeout);

        // the injected backend wins, else a new in-process `node-cache` backend.
        const backend: CacheBackend = options.backend ?? new NodeCacheBackend(defTimeout);
        return new CacheService(backend, { ns, options, maker });
    }

    /**
     * Protected constructor -> use CacheService.create()
     * WARN! - do not create directly.˜
     *
     * @param backend  cache backend object
     * @param params   params to create service.
     * @protected
     */
    protected constructor(
        backend: CacheBackend,
        params?: {
            /** (optional) namespace of cache key (default: '') */
            ns?: string;
            /** (optional) the final options to create() */
            options?: CacheOptions;
            /** custom key-maker */
            maker?: CacheKeyMakable;
        },
    ) {
        if (!backend) throw new Error(`@backend (cache-backend) is required!`);
        const ns = params?.ns || '';
        _inf(NS, `! cache-service instantiated with [${backend.name}] backend. [ns=${ns}]`);
        this.backend = backend;
        this.ns = ns;
        this.options = params.options;
        this.maker = params?.maker;
    }

    /**
     * Say hello
     */
    public hello(): string {
        return `cache-service:${this.backend.name}:${this.ns}`;
    }

    /**
     * for convient, make another typed service.
     * - it add `type` into key automatically.
     *
     * @param type model-type like 'test'
     * @param delimiter (optional) delim bewteen type and key (default ':')
     * @returns the typed CacheService
     */
    public cloneByType(type: string, delimiter: string = ':') {
        const { backend, ns, options } = this;
        const maker: CacheKeyMakable = (ns, delim, key) => this.asNamespacedKey(`${type}${delimiter}${key}`);
        return new CacheService(backend, { ns, options, maker });
    }

    /**
     * Close backend and connection
     */
    public async close(): Promise<void> {
        await this.backend.close();
    }

    /**
     * Check whether the key is cached
     *
     * @return  true if the key is cached
     */
    public async exists(key: CacheKey): Promise<boolean> {
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.has(namespacedKey);
        _log(NS, `.exists ${namespacedKey} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * List all keys
     *
     * @return  list of keys
     */
    public async keys(): Promise<string[]> {
        const namespacedKeys = await this.backend.keys();
        const ret = namespacedKeys.reduce<string[]>((keys, namespacedKey) => {
            const [ns, key] = namespacedKey.split(CacheService.NAMESPACE_DELIMITER);
            if (ns === this.ns) keys.push(key);
            return keys;
        }, []);
        _log(NS, `.keys / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Store a key
     *
     * @param key
     * @param val
     * @param timeout   (optional) TTL in seconds or Timeout object
     * @return  true on success
     */
    public async set(key: CacheKey, val: CacheValue, timeout?: number | Timeout): Promise<boolean> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        if (val === undefined) throw new Error(`@val (CacheValue) cannot be undefined.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ttl = timeout && toTTL(timeout);
        const ret = await this.backend.set<CacheValue>(namespacedKey, val, ttl);
        _log(NS, `.set ${namespacedKey} ${val} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Store multiple keys
     *
     * @param entries
     * @return  true on success
     */
    public async setMulti(entries: CacheEntry<CacheValue>[]): Promise<boolean> {
        const param = entries.map(({ key, val, timeout }, idx) => {
            if (!key) throw new Error(`.key (CacheKey) is required (at @entries[${idx}]).`);
            if (val === undefined) throw new Error(`.val (CacheValue) cannot be undefined (at @entries[${idx}]).`);
            return {
                key: this.asNamespacedKey(key),
                val,
                ttl: timeout && toTTL(timeout),
            };
        });
        const ret = await this.backend.mset<CacheValue>(param);
        _log(NS, `.setMulti ${entries.map(entry => entry.key)} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Retrieve a key
     *
     * @param key
     */
    public async get(key: CacheKey): Promise<CacheValue | undefined> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.get<CacheValue>(namespacedKey);
        _log(NS, `.get ${namespacedKey} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Get multiple keys
     *
     * @param keys
     */
    public async getMulti(keys: CacheKey[]): Promise<KeyValueMap<CacheValue>> {
        const namespacedKeys = keys.map((key, idx) => {
            if (!key) throw new Error(`@key (CacheKey) is required (at @keys[${idx}]).`);
            return this.asNamespacedKey(key);
        });
        const map = await this.backend.mget<CacheValue>(namespacedKeys);

        // Remove namespace prefix from keys
        const ret = Object.entries(map).reduce<KeyValueMap<CacheValue>>((newMap, [namespacedKey, val]) => {
            const key = namespacedKey.split(CacheService.NAMESPACE_DELIMITER)[1];
            newMap[key] = val;
            return newMap;
        }, {});
        _log(NS, `.getMulti ${namespacedKeys} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Increment the integer value of a key
     *
     * @param key
     * @param inc   number to increment
     */
    public async increment(key: CacheKey, inc: number): Promise<number> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        if (inc === undefined) throw new Error(`@inc (number) cannot be undefined.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.incr(namespacedKey, inc);
        _log(NS, `.increment ${namespacedKey} ${inc} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * same as increment()
     */
    public inc(key: CacheKey, inc: number): Promise<number> {
        return this.increment(key, inc);
    }

    /**
     * Set the value of a key and return its old value
     */
    public async getAndSet(key: CacheKey, val: CacheValue): Promise<CacheValue | undefined> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        if (val === undefined) throw new Error(`@val (CacheValue) cannot be undefined.`);

        const namespacedKey = this.asNamespacedKey(key);
        let ret: CacheValue | undefined;
        if (this.backend.getset) {
            ret = await this.backend.getset<CacheValue, CacheValue>(namespacedKey, val);
        } else {
            ret = await this.backend.get<CacheValue>(namespacedKey);

            // Best effort to keep remaining TTL
            let ttl = await this.backend.ttl(namespacedKey);
            if (ttl !== undefined) {
                ttl = Math.ceil(ttl / 1000);
            }

            if (!(await this.backend.set<CacheValue>(namespacedKey, val, ttl))) throw new Error(`getAndSet() failed`);
        }
        _log(NS, `.getAndSet ${namespacedKey} ${val} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));

        return ret;
    }

    /**
     * Get and delete the key
     *
     * @param key
     */
    public async getAndDelete(key: CacheKey): Promise<CacheValue | undefined> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);

        const namespacedKey = this.asNamespacedKey(key);
        let ret: CacheValue | undefined;
        if (this.backend.pop) {
            ret = await this.backend.pop<CacheValue>(namespacedKey);
        } else {
            ret = await this.backend.get<CacheValue>(namespacedKey);
            await this.backend.del(namespacedKey);
        }
        _log(NS, `.getAndDelete ${namespacedKey} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));

        return ret;
    }

    /**
     * Delete a key
     *
     * @param key
     * @return  true on success
     */
    public async delete(key: CacheKey): Promise<boolean> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.del(namespacedKey);
        _log(NS, `.delete ${namespacedKey} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Delete multiple keys
     *
     * @param keys
     * @return  number of deleted entries
     */
    public async deleteMulti(keys: CacheKey[]): Promise<boolean[]> {
        const namespacedKeys = keys.map((key, idx) => {
            if (!key) throw new Error(`@key (CacheKey) is required (at @keys[${idx}]).`);
            return this.asNamespacedKey(key);
        });
        const promises = namespacedKeys.map(namespacedKey => this.backend.del(namespacedKey));
        const ret = await Promise.all(promises);
        _log(NS, `.deleteMulti ${namespacedKeys} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Set or update the timeout of a key
     *
     * @param key
     * @param timeout   TTL in seconds or Timeout object
     * @return  true on success
     */
    public async setTimeout(key: CacheKey, timeout: number | Timeout): Promise<boolean> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.expire(namespacedKey, toTTL(timeout));
        _log(NS, `.setTimeout ${namespacedKey} ${timeout} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Get remaining time to live in milliseconds
     *
     * @return
     *  - number of milliseconds to expire
     *  - undefined if the key does not exist
     *  - 0 if the key has no timeout
     */
    public async getTimeout(key: CacheKey): Promise<number | undefined> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.ttl(namespacedKey);
        _log(NS, `.getTimeout ${namespacedKey} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Remove the timeout from a key
     *
     * @param key
     */
    public async removeTimeout(key: CacheKey): Promise<boolean> {
        if (!key) throw new Error(`@key (CacheKey) is required.`);
        const namespacedKey = this.asNamespacedKey(key);
        const ret = await this.backend.expire(namespacedKey, 0);
        _log(NS, `.removeTimeout ${namespacedKey} / ret =`, typeof ret === 'string' ? ret : $U.json(ret));
        return ret;
    }

    /**
     * Get namespace prefixed cache key
     *
     * @param key
     * @protected
     */
    public asNamespacedKey(key: CacheKey): string {
        const [ns, delim] = [this.ns, CacheService.NAMESPACE_DELIMITER];
        if (this.maker) return this.maker(ns, delim, key);
        return `${ns}${delim}${key}`;
    }
}

/**
 * class `DummyCacheService`: use 'node-cache' library
 */
export class DummyCacheService extends CacheService {
    /**
     * Singleton node-cache backend
     *
     * @private
     * @static
     */
    private static backend: NodeCacheBackend;

    /**
     * Factory method
     *
     * @param options   (optional) cache options
     * @static
     */
    public static create(options?: CacheOptions): DummyCacheService {
        const ns = options?.ns || '';
        const defTimeout = $U.N(
            options?.defTimeout,
            $U.N($U.env(CacheService.ENV_CACHE_DEFAULT_TIMEOUT), CacheService.DEF_CACHE_DEFAULT_TIMEOUT),
        );
        options = { ...options, ns, defTimeout };
        _log(NS, `constructing dummy cache ...`);

        // NOTE: Use singleton backend instance
        // because node-cache is volatile and client instance does not share keys with other instance
        if (!DummyCacheService.backend) DummyCacheService.backend = new NodeCacheBackend(defTimeout);
        return new DummyCacheService(DummyCacheService.backend, { ns, options });
    }

    /**
     * Say hello
     */
    public hello(): string {
        return `dummy-${super.hello()}`;
    }
}

/**
 * function `sleep`
 * @param ms    duration in milliseconds
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get TTL from timeout
 * @param timeout   timeout in seconds or Timeout object
 * @return  remaining time to live in seconds
 */
export function toTTL(timeout: number | Timeout): number {
    switch (typeof timeout) {
        case 'number':
            return timeout;
        case 'object':
            if (!timeout) return 0;
            const { expireIn, expireAt } = timeout;
            if (typeof expireIn === 'number') return expireIn;
            if (typeof expireAt === 'number') {
                const msTTL = timeout.expireAt - Date.now();
                return Math.ceil(msTTL / 1000);
            }
            break;
    }
    throw new Error(`@timeout (number | Timeout) is invalid.`);
}

/**
 * Get timestamp of expiration from TTL
 * @param ttl   remaining time to live in seconds
 * @return      timestamp in milliseconds since epoch
 */
export function fromTTL(ttl: number): number {
    return ttl > 0 ? Date.now() + ttl * 1000 : 0;
}

/** ********************************************************************************************************************
 *  Backend Types (exported in v5 so a consumer can inject its own backend)
 ** ********************************************************************************************************************/
/**
 * type `ItemEntry`: parameter for mset operation
 */
export interface ItemEntry<T = any> {
    key: string;
    val: T;
    ttl?: number;
}

/**
 * interface `CacheBackend`
 * - implement this to plug a remote cache (ex: Redis) into `CacheService.create({ backend })`.
 */
export interface CacheBackend {
    /**
     * backend type
     */
    readonly name: string;

    /**
     * Set the value of a key
     *
     * @param key
     * @param val
     * @param ttl   (optional) time to live in seconds
     * @return  true on success
     */
    set<T>(key: string, val: T, ttl?: number): Promise<boolean>;

    /**
     * Get the value of a key
     *
     * @param key
     * @return  the value of key, or undefined when key does not exist
     */
    get<T>(key: string): Promise<T | undefined>;

    /**
     * Set multiple keys to multiple values
     *
     * @param entries   see ItemEntry
     * @return  true on success
     */
    mset<T>(entries: ItemEntry<T>[]): Promise<boolean>;

    /**
     * Get the values of all the given keys
     *
     * @param keys
     * @return  key-value map
     */
    mget<T>(keys: string[]): Promise<{ [key: string]: T }>;

    /**
     * (optional) Set the value of a key and return its old value
     *
     * @param key
     * @param val
     * @return  the old value stored at key, or undefined when key did not exist
     */
    getset?<T, U>(key: string, val: T): Promise<U | undefined>;

    /**
     * (optional) Get the value of a key and remove the key
     *
     * @param key
     * @return  the old value stored at key, or undefined when key did not exist
     */
    pop?<T>(key: string): Promise<T | undefined>;

    /**
     * Increment the integer value of a key
     *
     * @param key
     * @param increment amount to increment
     * @return  the value of key after the increment
     */
    incr(key: string, increment: number): Promise<number>;

    /**
     * List all keys
     *
     * @return  list of keys
     */
    keys(): Promise<string[]>;

    /**
     * Determine if a key exists
     *
     * @param key
     * @return  true on success
     */
    has(key: string): Promise<boolean>;

    /**
     * Delete a key
     *
     * @param key
     * @return  true on success
     */
    del(key: string): Promise<boolean>;

    /**
     * Set the time to live in seconds
     *
     * @param key
     * @param ttl   time to live in seconds
     * @return  true on success
     */
    expire(key: string, ttl: number): Promise<boolean>;

    /**
     * Get the time to live for a key in milliseconds
     *
     * @param key
     * @return  the remaining time to live in milliseconds
     *          - 0 if the key exists but has no associated timeout
     *          - undefined if the key does not exist
     */
    ttl(key: string): Promise<number | undefined>;

    /**
     * Close connection(s) to the cache server
     */
    close(): Promise<void>;
}

/** ********************************************************************************************************************
 *  Internal Classes
 ** ********************************************************************************************************************/
/**
 * class `NodeCacheBackend`: use 'node-cache' library
 * @internal
 */
class NodeCacheBackend implements CacheBackend {
    /**
     * node-cache client
     * @private
     */
    private readonly cache: NodeCache;

    /**
     * backend type
     */
    public readonly name: string = 'node-cache';

    /**
     * Public constructor
     */
    public constructor(defTTL: number = 0) {
        this.cache = new NodeCache({ stdTTL: defTTL });
    }

    /**
     * CacheBackend.set implementation
     */
    public async set<T>(key: string, val: T, ttl?: number): Promise<boolean> {
        return this.cache.set<T>(key, val, ttl);
    }

    /**
     * CacheBackend.get implementation
     */
    public async get<T>(key: string): Promise<T | undefined> {
        return this.cache.get<T>(key);
    }

    /**
     * CacheBackend.mset implementation
     */
    public async mset<T>(entries: ItemEntry<T>[]): Promise<boolean> {
        return this.cache.mset<T>(entries);
    }

    /**
     * CacheBackend.mget implementation
     */
    public async mget<T>(keys: string[]): Promise<{ [key: string]: T }> {
        return this.cache.mget<T>(keys);
    }

    /**
     * CacheBackend.pop implementation
     */
    public async pop<T>(key: string): Promise<T | undefined> {
        return this.cache.take<T>(key);
    }

    /**
     * CacheBackend.incr implementation
     */
    public async incr(key: string, increment: number): Promise<number> {
        const org = this.cache.get(key);
        if (typeof org !== 'number') throw new Error(`@key [${key}] does not hold a number value.`);

        const newVal = org + increment;
        this.cache.set(key, newVal);
        return newVal;
    }

    /**
     * CacheBackend.keys implementation
     */
    public async keys(): Promise<string[]> {
        return this.cache.keys();
    }

    /**
     * CacheBackend.has implementation
     */
    public async has(key: string): Promise<boolean> {
        return this.cache.has(key);
    }

    /**
     * CacheBackend.del implementation
     */
    public async del(key: string): Promise<boolean> {
        return this.cache.del(key) === 1;
    }

    /**
     * CacheBackend.expire implementation
     */
    public async expire(key: string, ttl: number): Promise<boolean> {
        return this.cache.ttl(key, ttl);
    }

    /**
     * CacheBackend.ttl implementation
     */
    public async ttl(key: string): Promise<number | undefined> {
        const ts = this.cache.getTtl(key); // Timestamp in milliseconds
        return ts && ts - Date.now();
    }

    /**
     * CacheBackend.close implementation
     */
    public async close(): Promise<void> {
        this.cache.close();
    }
}
