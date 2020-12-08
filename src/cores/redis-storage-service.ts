/**
 * `redis-storage-services.ts`
 * - storage implementation on redis backend
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-08 initial version
 *
 * @copyright   (C) lemoncloud.io 2020 - All Rights Reserved.
 */
import IORedis, { Redis } from 'ioredis';
import { $U, _log, _inf, _err } from '../engine';
import { StorageService, StorageModel } from './storage-service';

// Log namespace
const NS = $U.NS('RSTR', 'blue');

/** ********************************************************************************************************************
 *  Exported Types
 ** ********************************************************************************************************************/
/**
 * type `RedisOptions`
 */
export interface RedisOptions {
    /**
     * (optional) cache server endpoint
     */
    endpoint?: string;
    /**
     * (optional) virtual table name used as key prefix
     */
    tableName: string | number;
    /**
     * (optional) default time to live of a model in seconds. 0 for unlimited (default: 0)
     */
    defTimeout?: number;
}

/** ********************************************************************************************************************
 *  Exported Class
 ** ********************************************************************************************************************/
/**
 * class `RedisStorageService`
 */
export class RedisStorageService<T extends StorageModel> implements StorageService<T> {
    /**
     * Environment variable name for redis server endpoint
     * @static
     */
    public static readonly ENV_REDIS_ENDPOINT = 'REDIS_ENDPOINT';
    public static readonly ENV_REDIS_TABLE = 'REDIS_TABLE';

    public static readonly CAS_MAX_RETRIES = 5;

    /**
     * ioredis client
     * @protected
     */
    protected readonly redis: Redis;

    /**
     * Virtual table name
     * @private
     */
    public readonly tableName: string;

    /**
     * Default time to live of a model
     * @private
     */
    public readonly ttl: number;

    /**
     * Public constructor
     *
     * @options redis options
     */
    public constructor(options: RedisOptions) {
        const defTimeout = $U.N(options?.defTimeout, 0);

        if (typeof options.tableName === 'number') {
            // Open in non default database (for dummy use)
            this.redis = new IORedis(options.endpoint, { db: options.tableName });
            this.tableName = 'dummy';
        } else {
            // Open in default database w/ virtual table
            const endpoint = options.endpoint || $U.env(RedisStorageService.ENV_REDIS_ENDPOINT);
            const tableName = options.tableName || $U.env(RedisStorageService.ENV_REDIS_TABLE);
            if (!endpoint) throw new Error(`.endpoint (URL) is required.`);
            if (!tableName) throw new Error(`.tableName (string) is required.`);
            this.redis = new IORedis(endpoint, { keyPrefix: tableName });
            this.tableName = tableName;
        }
        this.ttl = defTimeout;

        _inf(NS, `RedisStorageService constructed.`);
        _inf(NS, ` > tableName =`, this.tableName);
        _inf(NS, ` > default TTL =`, this.ttl);
    }

    /**
     * Say hello
     */
    public hello(): string {
        return `redis-storage-service:${this.tableName}`;
    }

    /**
     * Read model by id
     *
     * @param id
     */
    public async read(id: string): Promise<T> {
        if (!id) throw new Error(`@id is required.`);

        const key = this.asKey(id);
        const data = await this.redis.hgetall(key); // {} if the key does not exist
        if (Object.keys(data).length > 0) {
            return this.deserialize(data);
        }

        throw new Error(`404 NOT FOUND - ${this.tableName}/${id}`);
    }

    /**
     * Read model or create if id does not exist
     *
     * @param id
     * @param model
     */
    public async readOrCreate(id: string, model: T): Promise<T> {
        if (!id) throw new Error(`@id is required.`);
        if (!model) throw new Error(`@model is required.`);

        const key = this.asKey(id);

        // check-and-save w/ retries to avoid race conditions
        for (let retry = 0; retry < RedisStorageService.CAS_MAX_RETRIES; await sleep(20), retry++) {
            await this.redis.watch(key); // Lock
            let data = await this.redis.hgetall(key); // {} if the key does not exist

            // 1. Return if a model found
            if (Object.keys(data).length > 0) {
                await this.redis.unwatch(); // Unlock
                return this.deserialize(data);
            }

            // 2. Otherwise try to create a new model
            data = this.serialize({ ...model, id });
            const pipeline = this.redis.multi().hset(key, data);
            if (this.ttl > 0) pipeline.expire(key, this.ttl);

            const results = await pipeline.exec(); // Unlock, null if the key has been changed
            if (results) return this.deserialize(data);
        }

        throw new Error(`readOrCreate[${id}] failed: transaction max retries exceeded.`);
    }

    /**
     * Create model and overwrite if id exists
     *
     * @param id
     * @param model
     */
    public async save(id: string, model: T): Promise<T> {
        if (!id) throw new Error(`@id is required.`);
        if (!model) throw new Error(`@model is required.`);

        const key = this.asKey(id);
        const data = this.serialize({ ...model, id });
        const pipeline = this.redis
            .multi()
            .del(key)
            .hset(key, data);
        if (this.ttl > 0) pipeline.expire(key, this.ttl);

        await pipeline.exec();
        return this.deserialize(data);
    }

    /**
     * Update existing model and create if id does not exist
     * @param id
     * @param update
     * @param increment
     */
    public async update(id: string, update: T, increment?: T): Promise<T> {
        if (!id) throw new Error(`@id is required.`);
        if (!update) throw new Error(`@update is required.`);

        const key = this.asKey(id);
        const data = this.serialize({ ...update, id });

        // Construct transaction pipeline
        const pipeline = this.redis.multi().hset(key, data);
        if (increment) {
            for (const [field, value] of Object.entries(increment)) {
                pipeline.hincrby(key, field, value);
            }
        }
        if (this.ttl > 0) pipeline.expire(key, this.ttl);
        pipeline.hgetall(key); // Acquire final data

        // Execute pipeline
        const results = await pipeline.exec();
        if (!results) throw new Error(`update[${id}] failed: redis transaction error.`);

        const err = results.find(result => result[0] !== null)?.[0];
        if (err) throw new Error(`redis error: ${err.message}`);

        const updated = results[results.length - 1][1]; // Result of 'hgetall'
        return this.deserialize(updated);
    }

    /**
     * Increment the integer value of a key
     *
     * @param id
     * @param increment
     * @param update
     */
    public async increment(id: string, increment: T, update?: T): Promise<T> {
        if (!id) throw new Error(`@id is required.`);
        if (!increment) throw new Error(`@increment is required.`);

        const key = this.asKey(id);

        // Construct transaction pipeline
        const pipeline = this.redis.multi();
        for (const [field, value] of Object.entries(increment)) {
            pipeline.hincrby(key, field, value);
        }
        if (update) {
            const data = this.serialize(update);
            pipeline.hset(key, data);
        }
        if (this.ttl > 0) pipeline.expire(key, this.ttl);
        pipeline.hgetall(key); // Acquire final data

        // Execute pipeline
        const results = await pipeline.exec();
        if (!results) throw new Error(`increment[${id}] failed: transaction error.`);

        const err = results.find(result => result[0] !== null)?.[0];
        if (err) throw new Error(`redis error: ${err.message}`);

        const updated = results[results.length - 1][1]; // Result of 'hgetall'
        return this.deserialize(updated);
    }

    /**
     * Delete a key
     *
     * @param id
     * @return  true on success
     */
    public async delete(id: string): Promise<T> {
        if (!id) throw new Error(`@key is required.`);

        const key = this.asKey(id);

        // Execute pipeline
        const results = await this.redis
            .multi()
            .hgetall(key) // Read
            .del(key) // And delete
            .exec();
        if (!results) throw new Error(`delete[${id}] failed: transaction error.`);

        const err = results.find(result => result[0] !== null)?.[0];
        if (err) throw new Error(`redis error: ${err.message}`);

        const data = results[0][1];
        if (Object.keys(data).length > 0) {
            return this.deserialize(data);
        }

        throw new Error(`404 NOT FOUND - ${this.tableName}/${id}`);
    }

    /**
     * Get redis key from id
     * @param id
     * @protected
     */
    protected asKey(id: string): string {
        return `${this.tableName}::${id}`;
    }

    /**
     * Serialize model into internal data
     * @param model
     * @protected
     */
    protected serialize(model: T): Record<string, string> {
        return Object.entries(model).reduce<Record<string, string>>((data, [key, val]) => {
            data[key] = JSON.stringify(val as any);
            return data;
        }, {});
    }

    /**
     * Deserialize internal data into model
     * @param data
     * @protected
     */
    protected deserialize(data: Record<string, string>): T {
        return Object.entries(data).reduce<any>((model, [field, value]) => {
            model[field] = JSON.parse(value);
            return model;
        }, {});
    }
}

/**
 * class `DummyRedisStorageService`
 */
export class DummyRedisStorageService<T extends StorageModel> extends RedisStorageService<T> {
    /**
     * Database index. Each DummyRedisStorageService uses different logical database.
     * @private
     */
    private static dbIndex = 0;

    /**
     * Public constructor
     */
    public constructor() {
        super({
            endpoint: 'localhost:6379',
            tableName: ++DummyRedisStorageService.dbIndex, // Open new DB
        });
    }

    /**
     * Say hello
     */
    public hello(): string {
        return `dummy-redis-storage-service`;
    }

    public async truncate(): Promise<void> {
        await this.redis.flushdb();
    }
}

/**
 * function `sleep`
 * @param ms    duration in milliseconds
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
