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
    public static readonly ENV_REDIS_ENDPOINT = 'MY_REDIS_ENDPOINT';

    /**
     * Maximum retry count of check-and-save behavior
     * @static
     */
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
            // For dummy: open in non-default database (db index > 0)
            this.redis = new IORedis(options.endpoint, { db: options.tableName });
            this.tableName = 'dummy';
        } else {
            // For normal usage: open in default database (db index = 0) w/ virtual table
            const endpoint = options.endpoint || $U.env(RedisStorageService.ENV_REDIS_ENDPOINT);
            const tableName = options.tableName;
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
     * Disconnect from redis
     */
    public async quit(): Promise<void> {
        await this.redis.quit();
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
            const ret = this.deserialize(data);
            _log(NS, `> read[${id}].ret =`, $U.json(ret));
            return ret;
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
        for (let retry = 0; retry < RedisStorageService.CAS_MAX_RETRIES; await sleep(10), retry++) {
            await this.redis.watch(key); // Lock
            let data = await this.redis.hgetall(key); // {} if the key does not exist

            // 1. Return if a model found
            if (Object.keys(data).length > 0) {
                await this.redis.unwatch(); // Unlock
                const ret = this.deserialize(data);
                _log(NS, `> readOrCreate[${id}(read)].ret =`, $U.json(ret));
                return ret;
            }

            // 2. Otherwise try to create a new model
            data = this.serialize({ ...model, id });
            const pipeline = this.redis.multi().hset(key, data);
            if (this.ttl > 0) pipeline.expire(key, this.ttl);

            const results = await pipeline.exec(); // Unlock, null if the key has been changed
            if (results) {
                RedisStorageService.throwIfTransactionError(results);

                const ret = this.deserialize(data);
                _log(NS, `> readOrCreate[${id}(created)].ret =`, $U.json(ret));
                return ret;
            }
        }

        const message = `transaction max retries exceeded.`;
        _err(NS, `> readOrCreate[${id}].err =`, message);
        throw new Error(`redis transaction error: ${message}`);
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

        // Create transaction pipeline
        const pipeline = this.redis
            .multi()
            .del(key) // TODO: 만약 save의 overwrite 정책이 기존 존재하는 키는 유지하는 것이라면 del()은 제거해야 함
            .hset(key, data);
        if (this.ttl > 0) pipeline.expire(key, this.ttl);

        // Execute transaction
        const results = await pipeline.exec();
        RedisStorageService.throwIfTransactionError(results);

        const ret = this.deserialize(data);
        _log(NS, `> save[${id}].ret =`, $U.json(ret));
        return ret;
    }

    /**
     * Update existing model and create if id does not exist
     * @param id
     * @param update    model to update
     * @param increment (optional) model to increment
     */
    public async update(id: string, update: T, increment?: T): Promise<T> {
        if (!id) throw new Error(`@id is required.`);
        if (!update) throw new Error(`@update is required.`);

        const ret = await this.updateCAS(id, update, increment);
        _log(NS, `> update[${id}].ret =`, $U.json(ret));
        return ret;
    }

    /**
     * Increment the integer value of a key
     *
     * @param id
     * @param increment model to increment
     * @param update    (optional) model to update
     */
    public async increment(id: string, increment: T, update?: T): Promise<T> {
        if (!id) throw new Error(`@id is required.`);
        if (!increment) throw new Error(`@increment is required.`);

        const ret = await this.updateCAS(id, update, increment);
        _log(NS, `> increment[${id}].ret =`, $U.json(ret));
        return ret;
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

        // Execute transaction
        const results = await this.redis
            .multi()
            .hgetall(key) // Read
            .del(key) // And delete
            .exec();
        RedisStorageService.throwIfTransactionError(results);

        const data = results[0][1];
        if (Object.keys(data).length > 0) {
            const ret = this.deserialize(data);
            _log(NS, `> delete[${id}].ret =`, $U.json(ret));
            return ret;
        }

        throw new Error(`404 NOT FOUND - ${this.tableName}/${id}`);
    }

    /**
     * Get redis key from id
     * @param id
     * @protected
     */
    public asKey(id: string): string {
        return `${this.tableName}::${id}`;
    }

    /**
     * Serialize model into internal data
     * @param model
     * @protected
     */
    public serialize(model: T): Record<string, string> {
        return Object.entries(model).reduce<Record<string, string>>((data, [key, val]) => {
            if (val !== undefined) data[key] = JSON.stringify(val);
            return data;
        }, {});
    }

    /**
     * Deserialize internal data into model
     * @param data
     * @protected
     */
    public deserialize(data: Record<string, string>): T {
        return Object.entries(data).reduce<any>((model, [field, value]) => {
            model[field] = JSON.parse(value);
            return model;
        }, {});
    }

    /**
     * Update key w/ check-and-save behavior and retries
     * @param id
     * @param update    (optional) model to update
     * @param increment (optional) model to increment
     * @private
     */
    private async updateCAS(id: string, update?: T, increment?: T): Promise<T> {
        const key = this.asKey(id);

        // Use watch and transaction to avoid race conditions
        for (let retry = 0; retry < RedisStorageService.CAS_MAX_RETRIES; await sleep(10), retry++) {
            await this.redis.watch(key); // Lock

            try {
                // Evaluate new model to store
                const curData = await this.redis.hgetall(key); // {} if the key does not exist
                const curModel = this.deserialize(curData);
                const newModel = this.prepareUpdatedModel(curModel, update, increment);

                // Create transaction pipeline
                const data = this.serialize({ ...newModel, id });
                const pipeline = this.redis.multi().hset(key, data);
                if (this.ttl > 0) pipeline.expire(key, this.ttl);

                // Execute transaction
                const results = await pipeline.exec(); // Unlock, null if the key has been changed
                if (results) {
                    RedisStorageService.throwIfTransactionError(results);
                    return this.deserialize(data);
                }

                // Retry until max retry count reached
            } catch (e) {
                await this.redis.unwatch(); // Unlock explicitly
                throw e; // Rethrow
            }
        }

        const message = `transaction max retries exceeded.`;
        _err(NS, `> updateCAS[${id}].err =`, message);
        throw new Error(`redis error: ${message}`);
    }

    /**
     * Prepare new model - original model + update + increment
     * @param orig
     * @param update
     * @param increment
     * @private
     */
    private prepareUpdatedModel(orig: T, update?: T, increment?: T): T {
        const updated = Object.assign(orig, update);
        if (increment) {
            for (const [field, value] of Object.entries(increment)) {
                const key = field as keyof StorageModel;
                const oldVal = updated[key] || orig[key] || 0;
                if (typeof oldVal !== 'number') {
                    throw new Error(`.${key} is non-numeric field and cannot be incremented.`);
                }
                updated[key] = oldVal + value;
            }
        }
        return updated;
    }

    /**
     * Check transaction results and throw if error occurred
     * @param results   transaction pipeline execution results
     * @private
     */
    private static throwIfTransactionError(results: [Error | null, any][]): void {
        if (!results) throw new Error(`redis transaction failed: transaction aborted by key modification.`);
        const err = results.map(result => result[0]).find(err => err !== null);
        if (err) throw new Error(`redis transaction failed: ${err.message}`);
    }
}

/**
 * class `DummyRedisStorageService`
 *  - Use local redis server and non-default logical database
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
            tableName: ++DummyRedisStorageService.dbIndex, // Open non-default DB
        });
    }

    /**
     * Say hello
     */
    public hello(): string {
        return `dummy-redis-storage-service`;
    }

    /**
     * Delete all data in database
     */
    public async truncate(): Promise<void> {
        await this.redis.flushdb();
    }
}

/**
 * function `sleep`
 * @param ms    duration in milliseconds
 */
async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
