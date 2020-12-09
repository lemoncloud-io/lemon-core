/**
 * redis-storage-service.spec.ts`
 * - unit test for `redis-storage-service`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-08 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR, StorageModel } from '..';
import { RedisStorageService, DummyRedisStorageService } from './redis-storage-service';
import { isLocalCacheAvailable } from './cache-service.spec';

interface TestModel extends StorageModel {
    type?: 'test';
    B?: boolean;
    N?: number;
    S?: string;
    M?: object;
    L?: any[];
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('RedisStorageService', () => {
    it('hello', async done => {
        const service = new DummyRedisStorageService<TestModel>();
        expect2(() => service instanceof RedisStorageService).toBeTruthy();
        expect2(() => service instanceof DummyRedisStorageService).toBeTruthy();
        expect2(() => service.hello()).toEqual('dummy-redis-storage-service');
        await service.quit();
        done();
    });

    it('serialize/deserialize', async done => {
        const service = new DummyRedisStorageService<TestModel>();
        let model: TestModel;
        let data: Record<string, string>;
        /* eslint-disable prettier/prettier */

        model = { type: 'test', B: true, N: 100, S: 'lemon', M: { a: 9, b: 'cloud' }, L: [1, 3, 5, 'redis', 'storage', { empty: null }] };
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

        /* eslint-enable prettier/prettier */
        await service.quit();
        done();
    });

    it('CRUD', async done => {
        if (!(await isLocalCacheAvailable('redis'))) return done(); // dummy-redis-storage-service uses local redis server
        const service = new DummyRedisStorageService<TestModel>();
        /* eslint-disable prettier/prettier */

        // Empty dummy storage
        await service.truncate();

        // readOrCreate - will be created
        expect2(await service.read('a').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/a`);
        expect2(await service.readOrCreate('a', { type: 'test', N: 1, S: 'string' }).catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 1, S: 'string' });
        expect2(await service.read('a').catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 1, S: 'string' });
        // save to overwrite
        expect2(await service.save('a', { type: 'test', N: 3, M: { a: 1, b: 2 } }).catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 3, M: { a: 1, b: 2 } });
        // readOrCreate - will be read
        expect2(await service.readOrCreate('a', { type: 'test' }).catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 3, M: { a: 1, b: 2 } });
        // update - will be created
        expect2(await service.read('b').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/b`);
        expect2(await service.update('b', { type: 'test', L: [1, 2, 3] }).catch(GETERR)).toEqual({ id: 'b', type: 'test', L: [1, 2, 3] });
        // update - will be updated
        expect2(await service.update('b', { N: 9, L: [] }).catch(GETERR)).toEqual({ id: 'b', type: 'test', N: 9, L: [] });
        // update w/ increment
        expect2(await service.update('b', { L: ['foo', 'bar'] }, { N: 3 }).catch(GETERR)).toEqual({ id: 'b', type: 'test', N: 12, L: ['foo', 'bar'] });
        // increment
        expect2(await service.increment('b', { N: -2 }).catch(GETERR)).toEqual({ id: 'b', type: 'test', N: 10, L: ['foo', 'bar'] });
        // increment w/ update
        expect2(await service.increment('b', { N: 10 }, { S: 'lemon' }).catch(GETERR)).toEqual({ id: 'b', type: 'test', N: 20, S: 'lemon', L: ['foo', 'bar'] });
        // failed: increment for non-numeric field
        expect2(await service.increment('b', { S: 1 } as any, { N: 0 }).catch(GETERR)).toEqual(`.S is non-numeric field and cannot be incremented.`);

        // failed: existing model will not be changed
        expect2(await service.read('b').catch(GETERR), 'N').toEqual({ N: 20 });
        // delete
        expect2(await service.delete('a').catch(GETERR)).toEqual({ id: 'a', type: 'test', N: 3, M: { a: 1, b: 2 } });
        expect2(await service.delete('a').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/a`);
        expect2(await service.delete('b').catch(GETERR)).toEqual({ id: 'b', type: 'test', N: 20, S: 'lemon', L: ['foo', 'bar'] });
        expect2(await service.delete('b').catch(GETERR)).toEqual(`404 NOT FOUND - dummy/b`);

        /* eslint-enable prettier/prettier */
        await service.quit();
        done();
    });
});
