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
import { $U, _log, _inf, _err } from '../engine';

const NS = $U.NS('CACHES', 'green');

/** ********************************************************************************************************************
 *  Exported Types
 ** ********************************************************************************************************************/
/**
 * type `CacheKey`
 */
export type CacheKey = string;

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
     * cache backend instance
     * @private
     */
    private readonly backend: CacheBackend;

    /**
     * factory method
     *
     * @param type  (optional) type of cache backend. following backends are available (default: 'redis')
     *  - 'local': use local memory as cache. not suitable for Lambda based service
     *  - 'memcached'
     *  - 'redis'
     * @param host  (optional) cache host address (default: 'localhost')
     * @param port  (optional) port # (default: default port # of cache backend)
     * @static
     */
    public static create(
        type: 'local' | 'memcached' | 'redis' = 'redis',
        host: string = 'localhost',
        port?: number,
    ): CacheService {
        let backend: CacheBackend;

        if (type === 'local') backend = new NodeCacheBackend();
        else if (type === 'memcached') backend = new MemcachedBackend(`${host}:${port || 11211}`);
        else if (type === 'redis') backend = new RedisBackend(host, port || 6379);
        else throw new Error(`@type [${type}] is invalid.`);

        return new CacheService(backend);
    }

    /**
     * Check whether the key is cached
     *
     * @return  true if the key is cached
     */
    public async exists(key: CacheKey): Promise<boolean> {
        return this.backend.has(key);
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
        const ttl = timeout && toTTL(timeout);
        // return val === undefined || this.backend.set(key, val, ttl);
        return await this.backend.set(key, val, ttl);
    }

    /**
     * Store multiple keys
     *
     * @param entries
     * @return  true on success
     */
    public async setMulti(entries: CacheEntry[]): Promise<boolean> {
        const param = entries.map(({ key, val, timeout }) => {
            return { key, val, ttl: timeout && toTTL(timeout) };
        });
        return this.backend.mset(param);
    }

    /**
     * Retrieve a key
     *
     * @param key
     */
    public async get(key: CacheKey): Promise<CacheValue | undefined> {
        return await this.backend.get(key);
    }

    /**
     * Get multiple keys
     *
     * @param keys
     */
    public async getMulti(keys: CacheKey[]): Promise<KeyValueMap> {
        return await this.backend.mget(keys);
    }

    /**
     * Set the value of a key and return its old value
     */
    public async getAndSet(key: CacheKey, val: CacheValue): Promise<CacheValue | undefined> {
        if (this.backend.getset) {
            return await this.backend.getset(key, val);
        } else {
            const oldValue = await this.backend.get(key);
            const set = await this.backend.set(key, val);
            if (!set) throw new Error(`getAndSet() failed`);
            return oldValue;
        }
    }

    /**
     * Get and delete the key
     *
     * @param key
     */
    public async getAndDelete(key: CacheKey): Promise<CacheValue | undefined> {
        if (this.backend.pop) {
            return this.backend.pop(key);
        } else {
            const val = await this.backend.get(key);
            await this.backend.del(key);
            return val;
        }
    }

    /**
     * Delete a key
     *
     * @param key
     * @return  true on success
     */
    public async delete(key: CacheKey): Promise<boolean> {
        return await this.backend.del(key);
    }

    /**
     * Delete multiple keys
     *
     * @param keys
     * @return  number of deleted entries
     */
    public async deleteMulti(keys: CacheKey[]): Promise<boolean> {
        const promises = keys.map(key => this.backend.del(key));
        return (await Promise.all(promises)).every(ret => ret === true);
    }

    /**
     * Set or update the timeout of a key
     *
     * @param key
     * @param timeout   TTL in seconds or Timeout object
     * @return  true on success
     */
    public async setTimeout(key: CacheKey, timeout: number | Timeout): Promise<boolean> {
        return await this.backend.expire(key, toTTL(timeout));
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
        return await this.backend.ttl(key);
    }

    /**
     * Remove the timeout from a key
     *
     * @param key
     */
    public async removeTimeout(key: CacheKey): Promise<boolean> {
        return await this.backend.expire(key, 0);
    }

    /**
     * Private constructor -> use CacheService.create()
     *
     * @param backend   cache backend object
     * @private
     */
    private constructor(backend: CacheBackend) {
        this.backend = backend;
    }
}

/**
 * Get TTL from timeout
 * @param timeout   TTL(timestamp in milliseconds since epoch) or Timeout object
 */
function toTTL(timeout: number | Timeout): number {
    switch (typeof timeout) {
        case 'number':
            return timeout;
        case 'object':
            if ('expireIn' in timeout) return timeout.expireIn;
            if ('expireAt' in timeout) {
                const msTTL = timeout.expireAt - Date.now();
                return Math.ceil(msTTL / 1000);
            }
            return 0;
        default:
            throw new Error(`@timeout must be number or Timeout object.`);
    }
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
    public constructor() {
        this.cache = new NodeCache();
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
        return ts - Date.now();
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
    };

    /**
     * backend type
     */
    public readonly name: string = 'memcached';

    /**
     * Public constructor
     */
    public constructor(location: string) {
        const memcached = new Memcached(location);

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
        };
    }

    /**
     * CacheBackend.set implementation
     */
    public async set<T>(key: string, val: T, ttl: number = 0): Promise<boolean> {
        const entry = { val, exp: ttl && Date.now() + ttl * 1000 };
        return await this.api.set(key, entry, ttl);
    }

    /**
     * CacheBackend.get implementation
     */
    public async get<T>(key: string): Promise<T | undefined> {
        const entry = await this.api.get(key);
        return entry && entry.val;
    }

    /**
     * CacheBackend.mset implementation
     */
    public async mset<T>(entries: ItemEntry<T>[]): Promise<boolean> {
        const promises = entries.map(({ key, val, ttl }) => this.set(key, val, ttl));
        const results = await Promise.all(promises);
        return results.every(result => result === true);
    }

    /**
     * CacheBackend.mget implementation
     */
    public async mget<T>(keys: string[]): Promise<{ [key: string]: T }> {
        const map = await this.api.getMulti(keys);
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

        for (let retry = 0; retry < 5; await sleep(10), retry++) {
            const result = await this.api.gets(key); // Get entry w/ CAS

            if (result === undefined) {
                // initialize to increment value if the key does not exist
                if (await this.set(key, increment, 0)) return increment;
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
        const item = (await this.api.items())[0];
        if (!item) return [];

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
            const result = await this.api.gets(key); // Get entry w/ CAS
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
     * backend type
     */
    public readonly name: string = 'redis';

    /**
     * Public constructor
     */
    public constructor(host: string, port: number) {
        this.redis = new IORedis({ port, host });
    }

    /**
     * CacheBackend.set implementation
     */
    public async set<T>(key: string, val: T, ttl?: number): Promise<boolean> {
        if (val !== undefined) {
            const data = JSON.stringify(val); // Serialize
            ttl > 0 ? await this.redis.set(key, data, 'EX', ttl) : await this.redis.set(key, data);
        }
        // 'set' command always return OK
        return true;
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
        const pipeline = entries
            .filter(entry => entry.val !== undefined)
            .reduce((pipeline, { key, val, ttl }) => {
                const data = JSON.stringify(val); // Serialize
                return ttl > 0 ? pipeline.set(key, data, 'EX', ttl) : pipeline.set(key, data);
            }, this.redis.multi());

        // Execute the transaction
        const results = await pipeline.exec();

        return results.every(result => result[0] === null); // 'set' command always return OK except error is thrown
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
            .get(key)
            .del(key)
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
}

/**
 * function `sleep`
 * @param ms    duration in milliseconds
 */
async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
