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
import NodeCache, { Key } from 'node-cache';
import Memcached from 'memcached';
import IORedis, { Redis, Ok as RedisOK } from 'ioredis'; // redis client for TypeScript
import { $U, _log, _inf, _err } from '../engine';

const NS = $U.NS('CACHE', 'green');

/** ********************************************************************************************************************
 *  Exported Types
 ** ********************************************************************************************************************/
/**
 * type `Primitive`
 */
export type Primitive = number | string;

/**
 * type `List`
 */
export type List = Primitive[];

/**
 * type `Map` (Object)
 */
export interface Map {
    [propName: string]: Primitive;
}

/**
 * type `CacheKey`
 */
export type CacheKey = string;

/**
 * type `CacheValue`: string, number, array and object are allowed
 */
export type CacheValue = Primitive | List | Map;

/**
 * type: `Timeout`
 */
export interface Timeout {
    /**
     * key will be expired after given number of seconds
     */
    ttl?: number;
    /**
     * key will be expired in given Unix timestamp (seconds since epoch)
     *  - will be ignored if 'ttl' is provided.
     */
    expireAt?: number;
}

/**
 * type `MSetParam`: parameter type of mset() operation
 */
export type MSetParam = {
    key: CacheKey;
    val: CacheValue;
    timeout?: number | Timeout;
}[];

/**
 * type `MGetResult`: result type of mget() operation
 */
export type MGetResult = Record<CacheKey, CacheValue>;

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
    set<T>(key: string, val: T, ttl?: number): Promise<boolean>;
    get<T>(key: string): Promise<T | undefined>;
    mset<T>(entries: ItemEntry<T>[]): Promise<boolean>;
    mget<T>(keys: string[]): Promise<{ [key: string]: T }>;
    // pop<T>(key: string): Promise<T | undefined>;
    incr(key: string, inc: number): Promise<number>;

    keys(): Promise<string[]>;
    has(key: string): Promise<boolean>;
    del(key: string): Promise<boolean>;
    setTTL(key: string, ttl: number): Promise<boolean>;
    getTTL(key: string): Promise<number | undefined>;
}

/**
 * type `TypedPrimitive`: number or typed string
 * @internal
 */
type TypedPrimitive = number | { S: string };

/**
 * type `TypedList`: typed array
 * @internal
 */
interface TypedList {
    L: TypedPrimitive[];
}

/**
 * type `TypedMap`: typed object
 * @internal
 */
interface TypedMap {
    M: Record<string, TypedPrimitive>;
}

/**
 * type `TypedValue`
 * @internal
 */
type TypedValue = TypedPrimitive | TypedList | TypedMap;

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
    private backend: CacheBackend;

    /**
     * factory method
     *
     * @param type  (optional) type of cache backend. following backends are available (default: 'redis')
     *  - 'local': use local memory as cache. not suitable for Lambda based service
     *  - 'memcached'
     *  - 'redis'
     * @param host  (optional) cache host address (default: 'localhost')
     * @param port  (optional) port # (default: default port # of cache backend)
     */
    public static create(
        type: 'local' | 'memcached' | 'redis' = 'redis',
        host: string = 'localhost',
        port?: number,
    ): CacheService {
        let backend: CacheBackend;

        if (type === 'local') backend = new LocalCacheBackend();
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
    public async has(key: CacheKey): Promise<boolean> {
        return this.backend.has(key);
    }

    /**
     * Store a key
     *
     * @param key
     * @param val
     * @param timeout   (optional) TTL in seconds or Timeout object
     * @param overwrite (optional) flag to overwrite if exists (default: true)
     * @return  true on success
     */
    public async set(
        key: CacheKey,
        val: CacheValue,
        timeout?: number | Timeout,
        overwrite: boolean = true,
    ): Promise<boolean> {
        // if (val !== undefined) ;
        const serialized = CacheService.serialize(val);
        return this.backend.set(key, serialized);
    }

    /**
     * Store multiple keys
     *
     * @param param
     * @param overwrite (optional) flag to overwrite if exists (default: true)
     * @return  number of set entries
     */
    public async mset(param: MSetParam, overwrite: boolean = true): Promise<number> {
        const backendParam = param.map(({ key, val }) => ({ key, val: CacheService.serialize(val) }));
        return this.backend.mset(backendParam);
    }

    /**
     * Retrieve a key
     *
     * @param key
     */
    public async get(key: CacheKey): Promise<CacheValue | undefined> {
        const serialized = await this.backend.get(key);
        return CacheService.deserialize(serialized);
    }

    /**
     * Retrieve multiple keys
     *
     * @param keys
     */
    public async mget(keys: CacheKey[]): Promise<MGetResult> {
        const list = await this.backend.mget(keys);
        return list.reduce<MGetResult>((O, serialized, idx) => {
            const key = keys[idx];
            const val = CacheService.deserialize(serialized);
            O[key] = val;
            return O;
        }, {});
    }

    /**
     * Get and delete the key
     *
     * @param key
     */
    public async take(key: CacheKey): Promise<CacheValue | undefined> {
        const val = await this.get(key);
        await this.del(key);
        return val;
    }

    /**
     * Delete a key
     *
     * @param key
     * @return  true on success
     */
    public async del(key: CacheKey): Promise<boolean> {
        try {
            await this.backend.del(key);
            return true;
        } catch (e) {
            _inf(NS, `del() failed: `, e.message);
            return false;
        }
    }

    /**
     * Delete multiple keys
     *
     * @param keys
     * @return  number of deleted entries
     */
    public async mdel(keys: CacheKey[]): Promise<number> {
        const results = await Promise.all(keys.map(key => this.del(key)));
        return results.filter(result => result === true).length;
    }

    /**
     * Change TTL of a key
     *
     * @param key
     * @param timeout   number of seconds
     * @return  true on success
     */
    public async setExpire(key: CacheKey, timeout: number | Timeout): Promise<boolean> {
        try {
            await this.backend.setTTL(key, toTTL(timeout));
            return true;
        } catch (e) {
            _inf(NS, `setTTL() failed:`, e.message);
            return false;
        }
    }

    /**
     * Get remaining seconds to expire
     *
     * @return
     *  - undefined if the key does not exist
     *  - 0 if this key has no timeout
     *  - number of seconds to expire
     */
    public async getExpire(key: CacheKey): Promise<number | undefined> {
        try {
            return this.backend.getTTL(key);
        } catch (e) {
            _inf(NS, `getTTL() failed:`, e.message);
        }
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

    /**
     * Serialize value into string
     *
     * @param val   value to be cached
     * @return      serialized string
     * @static
     */
    public static serialize(val: CacheValue): string {
        const typed = CacheService._type(val);
        return JSON.stringify(typed);
    }

    /**
     * Deserialize string into value
     *
     * @param str   serialized string
     * @return      deserialized value
     * @static
     */
    public static deserialize(str: string): CacheValue {
        const typed = JSON.parse(str);
        return CacheService._untype(typed);
    }

    /**
     * Make value typed
     *
     * @param val
     * @private
     * @static
     */
    private static _type(val: CacheValue): TypedValue {
        const typePrimitive = (val: Primitive): TypedPrimitive => {
            return typeof val === 'string' ? { S: val } : val;
        };

        if (val instanceof Object) {
            if (Array.isArray(val)) {
                return { L: val.map(typePrimitive) };
            } else {
                return {
                    M: Object.entries(val).reduce<Record<string, TypedPrimitive>>((map, [k, v]) => {
                        map[k] = typePrimitive(v);
                        return map;
                    }, {}),
                };
            }
        }
        return typePrimitive(val);
    }

    /**
     * Make value untyped
     *
     * @param val
     * @private
     */
    private static _untype(val: TypedValue): CacheValue {
        const untypePrimitive = (val: TypedPrimitive): Primitive => {
            return val instanceof Object ? val.S : val;
        };

        if (val instanceof Object) {
            if ('M' in val) {
                const map = (val as TypedMap).M;
                return Object.entries(map).reduce<Map>((obj, [key, val]) => {
                    obj[key] = untypePrimitive(val);
                    return obj;
                }, {});
            }
            if ('L' in val) {
                const list = (val as TypedList).L;
                return list.map(untypePrimitive);
            }
        }
        return untypePrimitive(val);
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
            const msTTL = timeout.expireAt - Date.now();
            return Math.ceil(msTTL / 1000);
        default:
            throw new Error(`@timeout must be number or Timeout object.`);
    }
}

/** ********************************************************************************************************************
 *  Internal Classes
 ** ********************************************************************************************************************/
/**
 * class `LocalCacheBackend`: use 'node-cache' library
 * @internal
 */
class LocalCacheBackend implements CacheBackend {
    private readonly cache: NodeCache;

    public constructor() {
        this.cache = new NodeCache();
    }

    public async set<T>(key: string, val: T, ttl?: number): Promise<boolean> {
        return this.cache.set<T>(key, val, ttl);
    }

    public async get<T>(key: string): Promise<T | undefined> {
        return this.cache.get<T>(key);
    }

    public async mset<T>(entries: ItemEntry<T>[]): Promise<boolean> {
        return this.cache.mset<T>(entries);
    }

    public async mget<T>(keys: string[]): Promise<{ [key: string]: T }> {
        return this.cache.mget<T>(keys);
    }

    public async pop<T>(key: string): Promise<T | undefined> {
        return this.cache.take<T>(key);
    }

    public async incr(key: string, inc: number): Promise<number> {
        const org = this.cache.get(key);
        if (typeof org !== 'number') throw new Error(`@key [${key}] does not hold a number value.`);

        const newVal = org + inc;
        this.cache.set(key, newVal);
        return newVal;
    }

    public async keys(): Promise<string[]> {
        return this.cache.keys();
    }

    public async has(key: string): Promise<boolean> {
        return this.cache.has(key);
    }

    public async del(key: string): Promise<boolean> {
        return this.cache.del(key) > 0;
    }

    public async setTTL(key: string, ttl: number): Promise<boolean> {
        return this.cache.ttl(key, ttl);
    }

    public async getTTL(key: string): Promise<number | undefined> {
        return this.cache.getTtl(key);
    }
}

/**
 * class `MemcachedBackend`
 * @internal
 */
class MemcachedBackend implements CacheBackend {
    // private readonly memcached: Memcached;
    private readonly command: {
        touch: (key: string, lifetime: number) => Promise<void>;
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
        incr: (key: string, amount: number) => Promise<boolean | number>;
        decr: (key: string, amount: number) => Promise<boolean | number>;
        del: (key: string) => Promise<boolean>;
    };

    public constructor(location: string) {
        const memcached = new Memcached(location);
        this.command = {
            touch: promisify(memcached.touch.bind(memcached)),
            get: promisify(memcached.get.bind(memcached)),
            gets: promisify(memcached.gets.bind(memcached)),
            getMulti: promisify(memcached.getMulti.bind(memcached)),
            set: promisify(memcached.set.bind(memcached)),
            cas: promisify(memcached.cas.bind(memcached)),
            incr: promisify(memcached.incr.bind(memcached)),
            decr: promisify(memcached.decr.bind(memcached)),
            del: promisify(memcached.del.bind(memcached)),
        };
    }

    public async set<T>(key: string, val: T, ttl: number = 0): Promise<boolean> {
        if (val !== undefined) {
            // _log(NS, `[memcached] set [${key}] <- ${val}`);
            // Store expiration time entry
            if (ttl > 0) await this._saveTimeout(key, ttl);
            // Set value entry
            return await this.command.set(key, val, ttl);
        }
        return false;
    }

    public async get<T>(key: string): Promise<T | undefined> {
        const val = await this.command.get(key);
        // _log(NS, `[memcached] get [${key}] -> ${val}`);
        return val;
    }

    public async mset<T>(entries: ItemEntry<T>[]): Promise<boolean> {
        const promises = entries.map(({ key, val, ttl }) => this.set(key, val, ttl));
        const results = await Promise.all(promises);
        return results.every(result => result === true);
    }

    public async mget<T>(keys: string[]): Promise<{ [key: string]: T }> {
        const map = await this.command.getMulti(keys);
        // _log(NS, `[memcached] getMulti -> ${$U.json(map)}`);
        return map;
    }

    public async incr(key: string, inc: number): Promise<number> {
        // Memcached는 음수를 number형으로 직접 저장하는 것을 지원하지 않으며
        // decr command를 통해서도 최대 0까지만 decrement 가능하다.
        // do {
        //     const result = await this.command.gets(key);
        //     const { [key]: val, cas } = await this.command.gets(key);
        //
        // } while ();
        const command = inc >= 0 ? 'incr' : 'decr';
        let cur = await this.command[command](key, inc);
        if (typeof cur === 'number') {
            _log(NS, `[memcached] ${command} -> ${cur}`);
            return cur;
        }
        throw new Error(`[memcached] failed to run command [${command}]`);
    }

    public async has(key: string): Promise<boolean> {
        return (await this.command.get(key)) !== undefined;
    }

    public async del(key: string): Promise<boolean> {
        // Delete expiration time entry
        const timeoutKey = MemcachedBackend._asTimeoutKey(key);
        await this.command.del(timeoutKey);
        // Delete value entry
        return await this.command.del(key);
    }

    public async setTTL(key: string, ttl: number): Promise<boolean> {
        if (!(await this.has(key))) return false;

        // Update expiration time entry
        if (ttl > 0) await this._saveTimeout(key, ttl);
        // Touch given key
        await this.command.touch(key, ttl);

        return true;
    }

    public async getTTL(key: string): Promise<number | undefined> {
        return await this._loadTimeout(key);
    }

    private static _asTimeoutKey(key: string): string {
        return `${key}:expireAt__`;
    }

    private async _saveTimeout(key: string, ttl: number): Promise<void> {
        const timeoutKey = MemcachedBackend._asTimeoutKey(key);
        const expireAt = ttl && Date.now() + ttl * 1000;
        await this.command.set(timeoutKey, expireAt, ttl);
    }

    private async _loadTimeout(key: string): Promise<number | undefined> {
        const timeoutKey = MemcachedBackend._asTimeoutKey(key);
        return await this.command.get(timeoutKey);
    }
}

/**
 * class `RedisBackend`
 * @internal
 */
class RedisBackend implements CacheBackend {
    private readonly redis: Redis;

    public constructor(host: string, port: number) {
        this.redis = new IORedis({ port, host });
    }

    public async set(key: string, val: string, ttl?: number): Promise<boolean> {
        return (await this.redis.set(key, val)) === RedisOK;
    }

    public async get(key: string): Promise<string | undefined> {
        const val = await this.redis.get(key);
        if (val !== null) return val;
    }

    public async mset(param: { [key: string]: string }): Promise<boolean> {
        const pipeline = this.redis.multi();
        Object.entries(param).forEach(([key, val]) => {
            pipeline.set(key, val);
        });
        try {
            const results = await pipeline.exec();
            return results.every(([err]));
        } catch (e) {
        }
    }

    public async mget(keys: string[]): Promise<{ [key: string]: string }> {
        const res = await this.command.mget(keys);
        Object.values(res);
    }

    public async incr(key: string, inc: number): Promise<number> {
        try {
            return await this.redis.incrby(key, inc);
        } catch (e) {
        }
    }

    public async has(key: string): Promise<boolean> {
        try {
            await this.command.get(key);
            return true;
        } catch (e) {
            return false;
        }
    }

    public async del(key: string): Promise<boolean> {
        return await this.command.del(key);
    }

    public async setTTL(key: string, ttl: number): Promise<boolean> {
        return (await this.redis.expire(key, ttl)) > 0;
    }

    public async getTTL(key: string): Promise<number> {
        return await this.redis.ttl(key);
    }
}
