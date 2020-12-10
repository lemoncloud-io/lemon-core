/**
 * `cache-services.ts`
 * - common service for remote cache
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-02 initial version
 *
 * @copyright   (C) lemoncloud.io 2020 - All Rights Reserved.
 */
import { promisify } from 'util';
import NodeCache from 'node-cache';
import Memcached from 'memcached';
import IORedis, { Redis } from 'ioredis';
import { $U, _log, _inf } from '../engine';

// Log namespace
const NS = $U.NS('CCHS', 'green');

/** ********************************************************************************************************************
 *  Exported Types
 ** ********************************************************************************************************************/
/**
 * type `CacheOptions`
 */
export interface CacheOptions {
    /**
     * (optional) cache backend type (default: 'redis')
     */
    type?: 'memcached' | 'redis';
    /**
     * (optional) cache server endpoint (not required for dummy-cache)
     */
    endpoint?: string;
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
 * type `CacheValue`
 */
export type CacheValue = any;

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
export interface CacheEntry {
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
export type KeyValueMap = Record<CacheKey, CacheValue>;

/** ********************************************************************************************************************
 *  Exported Class
 ** ********************************************************************************************************************/
/**
 * class `CacheService`
 */
export class CacheService {
    /**
     * Environment variable name for cache server endpoint
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
     * Cache backend instance
     * @private
     */
    private readonly backend: CacheBackend;

    /**
     * Factory method
     *
     * @param options   (optional) cache options
     * @static
     */
    public static create(options?: CacheOptions): CacheService {
        const type = options?.type || 'redis';
        const endpoint = options?.endpoint || $U.env(CacheService.ENV_CACHE_ENDPOINT);
        const ns = options?.ns || '';
        const defTimeout = $U.N(
            options?.defTimeout,
            $U.N($U.env(CacheService.ENV_CACHE_DEFAULT_TIMEOUT), CacheService.DEF_CACHE_DEFAULT_TIMEOUT),
        );

        _log(NS, `constructing [${type}] cache ...`);
        _log(NS, ` > endpoint =`, endpoint);
        _log(NS, ` > ns =`, ns);
        _log(NS, ` > defTimeout =`, defTimeout);

        let backend: CacheBackend;
        switch (type) {
            case 'memcached':
                backend = new MemcachedBackend(endpoint, defTimeout);
                break;
            case 'redis':
                backend = new RedisBackend(endpoint, defTimeout);
                break;
            default:
                throw new Error(`@type [${type}] is invalid.`);
        }

        return new CacheService(backend, ns);
    }

    /**
     * Say hello
     */
    public hello(): string {
        return `cache-service:${this.backend.name}:${this.ns}`;
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
        _log(NS, `.exists ${namespacedKey} / ret =`, ret);
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
        _log(NS, `.keys / ret =`, ret);
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
        const ret = await this.backend.set(namespacedKey, val, ttl);
        _log(NS, `.set ${namespacedKey} ${val} / ret =`, ret);
        return ret;
    }

    /**
     * Store multiple keys
     *
     * @param entries
     * @return  true on success
     */
    public async setMulti(entries: CacheEntry[]): Promise<boolean> {
        const param = entries.map(({ key, val, timeout }, idx) => {
            if (!key) throw new Error(`.key (CacheKey) is required (at @entries[${idx}]).`);
            if (val === undefined) throw new Error(`.val (CacheValue) cannot be undefined (at @entries[${idx}]).`);
            return {
                key: this.asNamespacedKey(key),
                val,
                ttl: timeout && toTTL(timeout),
            };
        });
        const ret = await this.backend.mset(param);
        _log(NS, `.setMulti ${entries.map(entry => entry.key)} / ret =`, ret);
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
        const ret = await this.backend.get(namespacedKey);
        _log(NS, `.get ${namespacedKey} / ret =`, ret);
        return ret;
    }

    /**
     * Get multiple keys
     *
     * @param keys
     */
    public async getMulti(keys: CacheKey[]): Promise<KeyValueMap> {
        const namespacedKeys = keys.map((key, idx) => {
            if (!key) throw new Error(`@key (CacheKey) is required (at @keys[${idx}]).`);
            return this.asNamespacedKey(key);
        });
        const map = await this.backend.mget(namespacedKeys);

        // Remove namespace prefix from keys
        const ret = Object.entries(map).reduce<KeyValueMap>((newMap, [namespacedKey, val]) => {
            const key = namespacedKey.split(CacheService.NAMESPACE_DELIMITER)[1];
            newMap[key] = val;
            return newMap;
        }, {});
        _log(NS, `.getMulti ${namespacedKeys} / ret =`, ret);
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
        _log(NS, `.increment ${namespacedKey} ${inc} / ret =`, ret);
        return ret;
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
        _log(NS, `.getAndSet ${namespacedKey} ${val} / ret =`, ret);

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
        _log(NS, `.getAndDelete ${namespacedKey} / ret =`, ret);

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
        _log(NS, `.delete ${namespacedKey} / ret =`, ret);
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
        _log(NS, `.deleteMulti ${namespacedKeys} / ret =`, ret);
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
        _log(NS, `.setTimeout ${namespacedKey} ${timeout} / ret =`, ret);
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
        _log(NS, `.getTimeout ${namespacedKey} / ret =`, ret);
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
        _log(NS, `.removeTimeout ${namespacedKey} / ret =`, ret);
        return ret;
    }

    /**
     * Protected constructor -> use CacheService.create()
     *
     * @param backend   cache backend object
     * @param ns        (optional) namespace of cache key (default: '')
     * @protected
     */
    protected constructor(backend: CacheBackend, ns: string = '') {
        _inf(NS, `! cache-service instantiated with [${backend.name}] backend. [ns=${ns}]`);
        this.backend = backend;
        this.ns = ns;
    }

    /**
     * Get namespace prefixed cache key
     *
     * @param key
     * @protected
     */
    protected asNamespacedKey(key: CacheKey): string {
        return `${this.ns}${CacheService.NAMESPACE_DELIMITER}${key}`;
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

        _log(NS, `constructing dummy cache ...`);

        // NOTE: Use singleton backend instance
        // because node-cache is volatile and client instance does not share keys with other instance
        if (!DummyCacheService.backend) DummyCacheService.backend = new NodeCacheBackend(defTimeout);
        return new DummyCacheService(DummyCacheService.backend, ns);
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
 *  Internal Types
 ** ********************************************************************************************************************/
/**
 * type `ItemEntry`: parameter for mset operation
 */
interface ItemEntry<T = any> {
    key: string;
    val: T;
    ttl?: number;
}

/**
 * interface `CacheBackend`
 * @internal
 */
interface CacheBackend {
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

/**
 * class `MemcachedBackend`
 * @internal
 */
class MemcachedBackend implements CacheBackend {
    /**
     * Memcached promisified APIs
     * @private
     */
    private readonly api: {
        get: (key: string) => Promise<any>;
        gets: (
            key: string,
        ) => Promise<{
            [key: string]: any;
            cas: string;
        }>;
        getMulti: (keys: string[]) => Promise<{ [key: string]: any }>;
        set: (key: string, value: any, lifetime: number) => Promise<boolean>;
        cas: (key: string, value: any, cas: string, lifetime: number) => Promise<boolean>;
        del: (key: string) => Promise<boolean>;
        items: () => Promise<Memcached.StatusData[]>;
        cachedump: (server: string, slabid: number, number: number) => Promise<Memcached.CacheDumpData[]>;
        end: () => void;
    };

    /**
     * Default TTL as number in seconds
     * @private
     */
    private readonly defTTL: number;

    /**
     * backend type
     */
    public readonly name: string = 'memcached';

    /**
     * Public constructor
     */
    public constructor(endpoint?: string, defTTL: number = 0) {
        const memcached = new Memcached(endpoint || 'localhost:11211');

        // Build promisified API map
        this.api = {
            get: promisify(memcached.get.bind(memcached)),
            gets: promisify(memcached.gets.bind(memcached)),
            getMulti: promisify(memcached.getMulti.bind(memcached)),
            set: promisify(memcached.set.bind(memcached)),
            cas: promisify(memcached.cas.bind(memcached)),
            del: promisify(memcached.del.bind(memcached)),
            items: promisify(memcached.items.bind(memcached)),
            cachedump: (server, slabid, number) => {
                return new Promise((resolve, reject) => {
                    memcached.cachedump(server, slabid, number, (err, cachedump) => {
                        if (err) return reject(err);
                        if (!cachedump) return resolve([]);
                        // Deep-copy를 안하면 데이터가 없어지는 이슈가 있음
                        resolve(Array.isArray(cachedump) ? [...cachedump] : [cachedump]);
                    });
                });
            },
            end: memcached.end.bind(memcached),
        };
        // default TTL
        this.defTTL = defTTL;
    }

    /**
     * CacheBackend.set implementation
     */
    public async set<T>(key: string, val: T, ttl: number = this.defTTL): Promise<boolean> {
        const entry = { val, exp: fromTTL(ttl) };
        _log(NS, `[${this.name}-backend] storing to key [${key}] =`, $U.json(entry));

        return await this.api.set(key, entry, ttl);
    }

    /**
     * CacheBackend.get implementation
     */
    public async get<T>(key: string): Promise<T | undefined> {
        const entry = await this.api.get(key);
        _log(NS, `[${this.name}-backend] entry fetched =`, $U.json(entry));

        return entry && entry.val;
    }

    /**
     * CacheBackend.mset implementation
     */
    public async mset<T>(entries: ItemEntry<T>[]): Promise<boolean> {
        _log(NS, `[${this.name}-backend] storing multiple keys ...`);
        const promises = entries.map(({ key, val, ttl = this.defTTL }, idx) => {
            const entry = { val, exp: fromTTL(ttl) };
            _log(NS, ` ${idx}) key [${key}] =`, $U.json(entry));
            return this.api.set(key, entry, ttl);
        });
        const results = await Promise.all(promises);

        return results.every(result => result === true);
    }

    /**
     * CacheBackend.mget implementation
     */
    public async mget<T>(keys: string[]): Promise<{ [key: string]: T }> {
        const map = await this.api.getMulti(keys);
        _log(NS, `[${this.name}-backend] entry map fetched =`, $U.json(map));

        Object.keys(map).forEach(key => {
            const entry = map[key];
            map[key] = entry.val;
        });
        return map;
    }

    /**
     * CacheBackend.incr implementation
     */
    public async incr(key: string, increment: number): Promise<number> {
        // NOTE:
        // Memcached는 음수에 대한 incr/decr를 지원하지 않으며 0 미만으로 decr 되지 않는다.
        // 이런 이유로 sets & cas 조합을 이용해 직접 구현함

        _log(NS, `[${this.name}-backend] incrementing (${increment}) to key [${key}] ...`);

        // Use get/check-and-save + retry strategy for consistency
        for (let retry = 0; retry < 5; await sleep(10), retry++) {
            const result = await this.api.gets(key); // Get entry w/ CAS id

            if (result === undefined) {
                // Initialize to increment value if the key does not exist
                if (!(await this.set(key, increment, 0))) break;
                return increment;
            } else {
                const { [key]: oldEntry, cas } = result;
                if (typeof oldEntry.val !== 'number') throw new Error(`.key [${key}] has non-numeric value.`);

                // Preserve remaining lifetime w/ best effort strategy, not accurate
                const now = Date.now();
                const ttl = oldEntry.exp && Math.round((oldEntry.exp - now) / 1000);
                const entry = {
                    val: oldEntry.val + increment,
                    exp: ttl && now + ttl * 1000,
                };
                if (await this.api.cas(key, entry, cas, ttl)) return entry.val;
            }
        }

        throw new Error(`[memcached] failed to increment key [${key}].`);
    }

    /**
     * CacheBackend.keys implementation
     */
    public async keys(): Promise<string[]> {
        // NOTE:
        //  memcached는 원래 keys 기능을 지원하지 않으며
        //  아래와 같이 cachedump를 사용하여 가능하지만 set한 key가 dump 될 때 까지 상당한 시간이 소요되는 것으로 보인다.
        //  따라서 이 operation의 결과를 신뢰하지 않도록 한다.

        const item = (await this.api.items())[0];
        if (!item || Object.keys(item).length === 0) return [];

        const [server, slabid] = [item.server, Number(Object.keys(item)[0])];
        const number = ((item[slabid] as unknown) as Memcached.StatusData).number as number;
        const cachedump = await this.api.cachedump(server, slabid, number);
        return cachedump.map(({ key }) => key);
    }

    /**
     * CacheBackend.has implementation
     */
    public async has(key: string): Promise<boolean> {
        return (await this.api.get(key)) !== undefined;
    }

    /**
     * CacheBackend.del implementation
     */
    public async del(key: string): Promise<boolean> {
        return await this.api.del(key);
    }

    /**
     * CacheBackend.expire implementation
     */
    public async expire(key: string, ttl: number): Promise<boolean> {
        let saved = false;

        for (let retry = 0; !saved && retry < 5; await sleep(10), retry++) {
            const result = await this.api.gets(key); // Get entry w/ CAS id
            if (result === undefined) break; // If key does not exist or already expired

            // Refresh timeout
            const { [key]: oldEntry, cas } = result;
            const newEntry = {
                val: oldEntry.val,
                exp: ttl && Date.now() + ttl * 1000,
            };
            saved = await this.api.cas(key, newEntry, cas, ttl);
        }

        return saved;
    }

    /**
     * CacheBackend.ttl implementation
     */
    public async ttl(key: string): Promise<number | undefined> {
        const entry = await this.api.get(key); // undefined if key does not exist
        return entry?.exp && entry.exp - Date.now();
    }

    /**
     * CacheBackend.close implementation
     */
    public async close(): Promise<void> {
        this.api.end();
    }
}

/**
 * class `RedisBackend`
 * @internal
 */
class RedisBackend implements CacheBackend {
    /**
     * ioredis client
     * @private
     */
    private readonly redis: Redis;

    /**
     * Default TTL as number in seconds
     * @private
     */
    private readonly defTTL: number;

    /**
     * backend type
     */
    public readonly name: string = 'redis';

    /**
     * Public constructor
     */
    public constructor(endpoint?: string, defTTL: number = 0) {
        this.redis = new IORedis(endpoint || 'localhost:6379');
        this.defTTL = defTTL;
    }

    /**
     * CacheBackend.set implementation
     */
    public async set<T>(key: string, val: T, ttl: number = this.defTTL): Promise<boolean> {
        const data = JSON.stringify(val); // Serialize
        ttl > 0 ? await this.redis.set(key, data, 'EX', ttl) : await this.redis.set(key, data);
        return true; // 'set' command always return OK
    }

    /**
     * CacheBackend.get implementation
     */
    public async get<T>(key: string): Promise<T | undefined> {
        const data = await this.redis.get(key);
        if (data !== null) return JSON.parse(data); // Deserialize
    }

    /**
     * CacheBackend.mset implementation
     */
    public async mset<T>(entries: ItemEntry<T>[]): Promise<boolean> {
        // Create transaction pipeline
        //  -> MSET command를 사용할 수도 있으나 ttl 지정이 불가능하여 pipeline으로 구현함
        const pipeline = entries.reduce((pipeline, { key, val, ttl = this.defTTL }) => {
            const data = JSON.stringify(val); // Serialize
            return ttl > 0 ? pipeline.set(key, data, 'EX', ttl) : pipeline.set(key, data);
        }, this.redis.multi());

        // Execute transaction
        await pipeline.exec(); // Always OK

        return true;
    }

    /**
     * CacheBackend.mget implementation
     */
    public async mget<T>(keys: string[]): Promise<{ [key: string]: T }> {
        const list = await this.redis.mget(keys);

        // Deserialize and map array into object
        return list.reduce<{ [key: string]: T }>((map, data, idx) => {
            if (data !== null) {
                const key = keys[idx];
                map[key] = JSON.parse(data); // Deserialize
            }
            return map;
        }, {});
    }

    /**
     * CacheBackend.getset implementation
     */
    public async getset<T, U>(key: string, val: T): Promise<U | undefined> {
        const newData = JSON.stringify(val); // Serialize
        const oldData = await this.redis.getset(key, newData);
        if (oldData !== null) return JSON.parse(oldData); // Deserialize
    }

    /**
     * CacheBackend.pop implementation
     */
    public async pop<T>(key: string): Promise<T | undefined> {
        const [[err, data]] = await this.redis
            .multi()
            .get(key) // read
            .del(key) // and delete
            .exec();
        if (!err && data !== null) return JSON.parse(data);
    }

    /**
     * CacheBackend.incr implementation
     */
    public async incr(key: string, increment: number): Promise<number> {
        return await this.redis.incrbyfloat(key, increment); // Support both integer and floating point
    }

    /**
     * CacheBackend.keys implementation
     */
    public async keys(): Promise<string[]> {
        return await this.redis.keys('*');
    }

    /**
     * CacheBackend.has implementation
     */
    public async has(key: string): Promise<boolean> {
        return (await this.redis.exists(key)) > 0; // 1: exists / 0: does not exist
    }

    /**
     * CacheBackend.del implementation
     */
    public async del(key: string): Promise<boolean> {
        return (await this.redis.del(key)) === 1; // number of keys removed
    }

    /**
     * CacheBackend.expire implementation
     */
    public async expire(key: string, ttl: number): Promise<boolean> {
        const ret = ttl > 0 ? await this.redis.expire(key, ttl) : await this.redis.persist(key);
        return ret > 0; // 1: success / 0: key does not exist
    }

    /**
     * CacheBackend.ttl implementation
     */
    public async ttl(key: string): Promise<number | undefined> {
        const ms = await this.redis.pttl(key); // -2: key does not exist / -1: no timeout
        if (ms >= 0) return ms;
        if (ms === -1) return 0;
    }

    /**
     * CacheBackend.close implementation
     */
    public async close(): Promise<void> {
        await this.redis.quit();
    }
}
