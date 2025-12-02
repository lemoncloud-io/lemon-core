/**
 * redis-storage-service.spec.ts`
 * - unit test for `redis-storage-service`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-08 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR } from '../..';
import { StorageModel } from './storage-service';
import { RedisStorageService, DummyRedisStorageService } from './redis-storage-service';
import net from 'net';

interface TestModel extends StorageModel {
    type?: 'test';
    B?: boolean;
    N?: number;
    S?: string;
    M?: object;
    L?: any[];
}

export async function isLocalCacheAvailable(type: 'memcached' | 'redis'): Promise<boolean> {
    const host = 'localhost';
    const port = type == 'memcached' ? 11211 : 6379;

    return new Promise(resolve => {
        const socket = net.createConnection({ port, host });
        socket.setTimeout(200);
        socket
            .on('connect', () => {
                socket.destroy();
                resolve(true);
            })
            .on('timeout', () => resolve(false))
            .on('error', () => resolve(false));
    });
}

//! main test body.
describe('RedisStorageService', () => {
    beforeEach(() => {
        // Reset DummyRedisStorageService database index counter to avoid exceeding Redis max databases (16)
        // Use Object.defineProperty to reset the private static dbIndex property
        Object.defineProperty(DummyRedisStorageService, 'dbIndex', {
            value: 0,
            writable: true,
            configurable: true,
        });
    });

    it('hello', async () => {
        const service = new DummyRedisStorageService<TestModel>();
        expect2(() => service instanceof RedisStorageService).toBeTruthy();
        expect2(() => service instanceof DummyRedisStorageService).toBeTruthy();
        expect2(() => service.hello()).toEqual('dummy-redis-storage-service');
        await service.quit();
    });

    it('serialize/deserialize', async () => {
        const service = new DummyRedisStorageService<TestModel>();
        let model: TestModel;
        let data: Record<string, string>;

        model = {
            type: 'test',
            B: true,
            N: 100,
            S: 'lemon',
            M: { a: 9, b: 'cloud' },
            L: [1, 3, 5, 'redis', 'storage', { empty: null }],
        };
        data = service.serialize(model);
        expect2(() => service.deserialize(data)).toEqual(model);

        // null values must be preserved
        model = { type: 'test', S: null };
        data = service.serialize(model);
        expect2(() => service.deserialize(data)).toEqual(model);

        // undefined values must be removed
        model = { type: 'test', N: undefined };
        data = service.serialize(model);
        expect2(() => data).toEqual({ type: '"test"' });
        expect2(() => service.deserialize(data)).toEqual({ type: 'test' });

        await service.quit();
    });

    it('CRUD', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return; // dummy-redis-storage-service uses local redis server
        const service = new DummyRedisStorageService<TestModel>();

        // Empty dummy storage
        await service.truncate();

        // readOrCreate - will be created
        expect2(await service.read('a').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/a`);
        expect2(await service.readOrCreate('a', { type: 'test', N: 1, S: 'string' }).catch(GETERR)).toEqual({
            id: 'a',
            type: 'test',
            N: 1,
            S: 'string',
        });
        expect2(await service.read('a').catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 1, S: 'string' });
        // save to overwrite
        expect2(await service.save('a', { type: 'test', N: 3, M: { a: 1, b: 2 } }).catch(GETERR)).toEqual({
            id: 'a',
            type: 'test',
            N: 3,
            M: { a: 1, b: 2 },
        });
        // readOrCreate - will be read
        expect2(await service.readOrCreate('a', { type: 'test' }).catch(GETERR)).toEqual({
            id: 'a',
            type: 'test',
            N: 3,
            M: { a: 1, b: 2 },
        });
        // update - will be created
        expect2(await service.read('b').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/b`);
        expect2(await service.update('b', { type: 'test', L: [1, 2, 3] }).catch(GETERR)).toEqual({
            id: 'b',
            type: 'test',
            L: [1, 2, 3],
        });
        // update - will be updated
        expect2(await service.update('b', { N: 9, L: [] }).catch(GETERR)).toEqual({
            id: 'b',
            type: 'test',
            N: 9,
            L: [],
        });
        // update w/ increment
        expect2(await service.update('b', { L: ['foo', 'bar'] }, { N: 3 }).catch(GETERR)).toEqual({
            id: 'b',
            type: 'test',
            N: 12,
            L: ['foo', 'bar'],
        });
        // increment
        expect2(await service.increment('b', { N: -2 }).catch(GETERR)).toEqual({
            id: 'b',
            type: 'test',
            N: 10,
            L: ['foo', 'bar'],
        });
        // increment w/ update
        expect2(await service.increment('b', { N: 10 }, { S: 'lemon' }).catch(GETERR)).toEqual({
            id: 'b',
            type: 'test',
            N: 20,
            S: 'lemon',
            L: ['foo', 'bar'],
        });
        // failed: increment for non-numeric field
        expect2(await service.increment('b', { S: 1 } as any, { N: 0 }).catch(GETERR)).toEqual(
            `.S is non-numeric field and cannot be incremented.`,
        );

        // failed: existing model will not be changed
        expect2(await service.read('b').catch(GETERR), 'N').toEqual({ N: 20 });
        // delete
        expect2(await service.delete('a').catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 3, M: { a: 1, b: 2 } });
        expect2(await service.delete('a').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/a`);
        expect2(await service.delete('b').catch(GETERR)).toEqual({
            id: 'b',
            type: 'test',
            N: 20,
            S: 'lemon',
            L: ['foo', 'bar'],
        });
        expect2(await service.delete('b').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/b`);

        await service.quit();
    });

    //* Test RedisStorageService constructor with normal mode (string tableName)
    it('should pass constructor with normal mode', async () => {
        // Mock environment variable
        const originalEnv = process.env.REDIS_ENDPOINT;
        process.env.REDIS_ENDPOINT = 'redis://localhost:6379';

        try {
            const service = new RedisStorageService<TestModel>({
                endpoint: 'redis://localhost:6379',
                tableName: 'test-table',
                defTimeout: 3600,
            });

            expect2(() => service.hello()).toEqual('redis-storage-service:test-table');
            expect2(() => service.tableName).toEqual('test-table');

            await service.quit();
        } finally {
            // Restore environment
            if (originalEnv) {
                process.env.REDIS_ENDPOINT = originalEnv;
            } else {
                delete process.env.REDIS_ENDPOINT;
            }
        }
    });

    //* Test constructor error: missing endpoint
    it('should throw error for missing endpoint', async () => {
        const originalEnv = process.env.REDIS_ENDPOINT;
        delete process.env.REDIS_ENDPOINT;

        try {
            expect2(() => new RedisStorageService<TestModel>({ tableName: 'test-table' })).toBe(
                '.endpoint (URL) is required.',
            );
        } finally {
            if (originalEnv) {
                process.env.REDIS_ENDPOINT = originalEnv;
            }
        }
    });

    //* Test constructor error: missing tableName
    it('should throw error for missing tableName', async () => {
        expect2(() => new RedisStorageService<TestModel>({ endpoint: 'redis://localhost:6379' } as any)).toBe(
            '.tableName (string) is required.',
        );
    });

    //* Test readOrCreate max retries exceeded
    it('should throw error when readOrCreate max retries exceeded', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();
        const redis = (service as any).redis;

        // Mock redis methods to always fail transaction
        const originalWatch = redis.watch.bind(redis);
        const originalHgetall = redis.hgetall.bind(redis);
        const originalUnwatch = redis.unwatch.bind(redis);
        const originalMulti = redis.multi.bind(redis);

        let callCount = 0;
        redis.watch = jest.fn().mockResolvedValue('OK');
        redis.hgetall = jest.fn().mockResolvedValue({});
        redis.unwatch = jest.fn().mockResolvedValue('OK');
        redis.multi = jest.fn().mockReturnValue({
            hset: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve(null); // Simulate transaction failure
            }),
        });

        expect2(await service.readOrCreate('test-id', { type: 'test' }).catch(GETERR)).toEqual(
            'redis transaction error: transaction max retries exceeded.',
        );

        // Restore
        redis.watch = originalWatch;
        redis.hgetall = originalHgetall;
        redis.unwatch = originalUnwatch;
        redis.multi = originalMulti;

        await service.quit();
    });

    //* Test updateCAS max retries exceeded
    it('should throw error when updateCAS max retries exceeded', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();
        const redis = (service as any).redis;

        await service.truncate();
        await service.save('test-id', { type: 'test', N: 1 });

        // Mock redis methods to always fail transaction
        const originalWatch = redis.watch.bind(redis);
        const originalHgetall = redis.hgetall.bind(redis);
        const originalUnwatch = redis.unwatch.bind(redis);
        const originalMulti = redis.multi.bind(redis);

        redis.watch = jest.fn().mockResolvedValue('OK');
        redis.hgetall = jest.fn().mockResolvedValue({ type: '"test"', N: '1' });
        redis.unwatch = jest.fn().mockResolvedValue('OK');
        redis.multi = jest.fn().mockReturnValue({
            hset: jest.fn().mockReturnThis(),
            hdel: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(null), // Simulate transaction failure
        });

        expect2(await service.update('test-id', { N: 2 }).catch(GETERR)).toEqual(
            'redis error: transaction max retries exceeded.',
        );

        // Restore
        redis.watch = originalWatch;
        redis.hgetall = originalHgetall;
        redis.unwatch = originalUnwatch;
        redis.multi = originalMulti;

        await service.quit();
    });

    //* Test increment max retries exceeded
    it('should throw error when increment max retries exceeded', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();
        const redis = (service as any).redis;

        await service.truncate();
        await service.save('test-id', { type: 'test', N: 10 });

        // Mock redis methods to always fail transaction
        const originalWatch = redis.watch.bind(redis);
        const originalHgetall = redis.hgetall.bind(redis);
        const originalUnwatch = redis.unwatch.bind(redis);
        const originalMulti = redis.multi.bind(redis);

        redis.watch = jest.fn().mockResolvedValue('OK');
        redis.hgetall = jest.fn().mockResolvedValue({ type: '"test"', N: '10' });
        redis.unwatch = jest.fn().mockResolvedValue('OK');
        redis.multi = jest.fn().mockReturnValue({
            hset: jest.fn().mockReturnThis(),
            hdel: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(null), // Simulate transaction failure
        });

        expect2(await service.increment('test-id', { N: 5 }).catch(GETERR)).toEqual(
            'redis error: transaction max retries exceeded.',
        );

        // Restore
        redis.watch = originalWatch;
        redis.hgetall = originalHgetall;
        redis.unwatch = originalUnwatch;
        redis.multi = originalMulti;

        await service.quit();
    });

    //* Test constructor with defTimeout
    it('should pass constructor with defTimeout parameter', async () => {
        const originalEnv = process.env.REDIS_ENDPOINT;
        process.env.REDIS_ENDPOINT = 'redis://localhost:6379';

        try {
            const service1 = new RedisStorageService<TestModel>({
                endpoint: 'redis://localhost:6379',
                tableName: 'test-table',
                defTimeout: 7200,
            });
            expect2(() => service1.hello()).toEqual('redis-storage-service:test-table');
            await service1.quit();

            const service2 = new RedisStorageService<TestModel>({
                endpoint: 'redis://localhost:6379',
                tableName: 'test-table2',
            });
            expect2(() => service2.hello()).toEqual('redis-storage-service:test-table2');
            await service2.quit();
        } finally {
            if (originalEnv) {
                process.env.REDIS_ENDPOINT = originalEnv;
            } else {
                delete process.env.REDIS_ENDPOINT;
            }
        }
    });

    //* Test read with empty id
    it('should throw error for empty id in read', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.read('').catch(GETERR)).toEqual('@id is required.');

        await service.quit();
    });

    //* Test readOrCreate with empty id
    it('should throw error for empty id in readOrCreate', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.readOrCreate('', { type: 'test' }).catch(GETERR)).toEqual('@id is required.');

        await service.quit();
    });

    //* Test readOrCreate with empty model
    it('should throw error for empty model in readOrCreate', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.readOrCreate('test-id', null).catch(GETERR)).toEqual('@model is required.');

        await service.quit();
    });

    //* Test readOrCreate with TTL
    it('should pass readOrCreate with TTL expiration', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        await service.truncate();

        //* Mock TTL to be > 0 to cover line 164
        (service as any).ttl = 3600;

        const result = await service.readOrCreate('ttl-test', { type: 'test', N: 100 });
        expect2(() => result.id).toEqual('ttl-test');
        expect2(() => result.type).toEqual('test');
        expect2(() => result.N).toEqual(100);

        await service.quit();
    });

    //* Test constructor with number tableName (dummy mode)
    it('should pass constructor with number tableName for dummy mode', async () => {
        const service = new RedisStorageService<TestModel>({
            endpoint: 'redis://localhost:6379',
            tableName: 1 as any,
            defTimeout: 0,
        });

        expect2(() => service.hello()).toEqual('redis-storage-service:dummy');

        await service.quit();
    });

    //* Test save with empty id
    it('should throw error for empty id in save', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.save('', { type: 'test' }).catch(GETERR)).toEqual('@id is required.');

        await service.quit();
    });

    //* Test save with empty model
    it('should throw error for empty model in save', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.save('test-id', null).catch(GETERR)).toEqual('@model is required.');

        await service.quit();
    });

    //* Test save with TTL
    it('should pass save with TTL expiration', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        await service.truncate();

        //* Mock TTL to be > 0 to cover line 199
        (service as any).ttl = 3600;

        const result = await service.save('save-ttl-test', { type: 'test', N: 200 });
        expect2(() => result.id).toEqual('save-ttl-test');
        expect2(() => result.type).toEqual('test');
        expect2(() => result.N).toEqual(200);

        await service.quit();
    });

    //* Test update with empty id
    it('should throw error for empty id in update', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.update('', { type: 'test' }).catch(GETERR)).toEqual('@id is required.');

        await service.quit();
    });

    //* Test update with empty model
    it('should throw error for empty model in update', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.update('test-id', null).catch(GETERR)).toEqual('@update is required.');

        await service.quit();
    });

    //* Test increment with empty id
    it('should throw error for empty id in increment', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.increment('', { N: 5 }).catch(GETERR)).toEqual('@id is required.');

        await service.quit();
    });

    //* Test increment with empty model
    it('should throw error for empty increment in increment', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.increment('test-id', null).catch(GETERR)).toEqual('@increment is required.');

        await service.quit();
    });

    //* Test delete with empty id
    it('should throw error for empty id in delete', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        expect2(await service.delete('').catch(GETERR)).toEqual('@key is required.');

        await service.quit();
    });

    //* Test updateCAS with TTL
    it('should pass update with TTL expiration', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        await service.truncate();
        await service.save('update-ttl-test', { type: 'test', N: 10 });

        //* Mock TTL to be > 0 to cover line 326
        (service as any).ttl = 3600;

        const result = await service.update('update-ttl-test', { N: 20 });
        expect2(() => result.N).toEqual(20);

        await service.quit();
    });

    //* Test prepareUpdatedModel with default values
    it('should pass increment with default field values', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        await service.truncate();

        //* Create record without N field
        await service.save('default-test', { type: 'test' });

        //* Increment N which doesn't exist - should default to 0 (line 359)
        const result = await service.increment('default-test', { N: 5 });
        expect2(() => result.N).toEqual(5);

        await service.quit();
    });

    //* Test throwIfTransactionError with results
    it('should pass transaction with proper error handling', async () => {
        if (!(await isLocalCacheAvailable('redis'))) return;
        const service = new DummyRedisStorageService<TestModel>();

        await service.truncate();

        //* Mock redis to return error in transaction results (line 375-377)
        const redis = (service as any).redis;
        const originalMulti = redis.multi.bind(redis);

        redis.multi = jest.fn().mockReturnValue({
            hset: jest.fn().mockReturnThis(),
            expire: jest.fn().mockReturnThis(),
            del: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([[new Error('Redis command failed'), null]]),
        });

        expect2(await service.save('error-test', { type: 'test' }).catch(GETERR)).toEqual(
            'redis transaction failed: Redis command failed',
        );

        //* Restore
        redis.multi = originalMulti;

        await service.quit();
    });

    //* Test constructor without defTimeout to cover optional chaining
    it('should pass constructor without defTimeout option', async () => {
        const service = new RedisStorageService<TestModel>({
            endpoint: 'redis://localhost:6379',
            tableName: 'test-no-timeout',
        } as any);

        expect2(() => service.hello()).toEqual('redis-storage-service:test-no-timeout');

        await service.quit();
    });
});
