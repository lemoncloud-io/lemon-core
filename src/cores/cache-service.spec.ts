/**
 * cache-service.spec.ts`
 * - unit test for `cache-service`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-04 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import net from 'net';
import { expect2, GETERR, _it } from '..';
import { CacheService, DummyCacheService, sleep, toTTL, fromTTL } from './cache-service';

export const instance = (type: 'dummy' | 'memcached' | 'redis', ns: string = 'cache-service-test') => {
    if (type === 'dummy') {
        return { cache: DummyCacheService.create({ ns, defTimeout: 0 }) };
    } else {
        return { cache: CacheService.create({ type, ns, defTimeout: 0 }) }; // use local cache server
    }
};

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

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('DummyCacheService', () => {
    it('hello', async done => {
        const { cache } = instance('dummy');
        expect2(() => cache instanceof CacheService).toBeTruthy();
        expect2(() => cache instanceof DummyCacheService).toBeTruthy();
        expect2(() => cache.hello()).toEqual('dummy-cache-service:node-cache:cache-service-test');
        await cache.close();
        done();
    });

    it('TTL conversion', async done => {
        // toTTL(): seconds -> seconds
        expect2(() => toTTL(10)).toBe(10);
        expect2(() => toTTL(10)).toBe(10);
        expect2(() => toTTL(null)).toBe(0);
        // toTTL(): .expireIn -> seconds
        expect2(() => toTTL({ expireIn: 10 })).toBe(10);
        // toTTL(): .expireAt -> seconds
        expect2(() => toTTL({ expireAt: Date.now() + 750 })).toBe(1);
        expect2(() => toTTL({ expireAt: Date.now() + 1250 })).toBe(2);
        expect2(() => toTTL({ expireAt: Date.now() + 2800 })).toBe(3);
        // toTTL(): error handling
        expect2(() => toTTL(undefined)).toBe(`@timeout (number | Timeout) is invalid.`);
        expect2(() => toTTL({ expireIn: {} as any })).toBe(`@timeout (number | Timeout) is invalid.`);
        expect2(() => toTTL({ expireAt: '' as any })).toBe(`@timeout (number | Timeout) is invalid.`);

        // fromTTL():
        expect2(() => fromTTL(0)).toBe(0); // 0 means no timeout
        expect2(() => fromTTL(null)).toBe(0);
        expect2(() => fromTTL(undefined)).toBe(0);
        expect2(() => fromTTL(3)).toBeGreaterThan(Date.now() + 2000); // 3 seconds from now

        done();
    });

    it('namespace', async done => {
        const { cache: cacheA1 } = instance('dummy', 'NS-A');
        const { cache: cacheA2 } = instance('dummy', 'NS-A');
        const { cache: cacheB } = instance('dummy', 'NS-B');

        // pre-condition
        expect2(await cacheA1.keys().catch(GETERR)).toEqual([]);
        expect2(await cacheA2.keys().catch(GETERR)).toEqual([]);
        expect2(await cacheB.keys().catch(GETERR)).toEqual([]);

        // set key 'a' into 'NS-A' namespace
        expect2(await cacheA1.set('a', 'a').catch(GETERR)).toEqual(true);
        // key 'a' should be visible in cache1 and cache2
        expect2(await cacheA1.exists('a').catch(GETERR)).toEqual(true);
        expect2(await cacheA2.exists('a').catch(GETERR)).toEqual(true);
        // key 'a' should not be visible in cache3
        expect2(await cacheB.exists('a').catch(GETERR)).toEqual(false);

        // set key 'b' into 'NS-B' namespace
        expect2(await cacheB.set('b', 'b').catch(GETERR)).toEqual(true);
        // key 'b' should not be visible in 'NS-B' namespace
        expect2(await cacheA1.exists('b').catch(GETERR)).toEqual(false);
        expect2(await cacheA2.exists('b').catch(GETERR)).toEqual(false);
        // key 'b' should be visible in 'NS-A' namespace
        expect2(await cacheB.exists('b').catch(GETERR)).toEqual(true);

        // set key 'c' into both 'NS-A' and 'NS-B' namespace with different values
        expect2(await cacheA2.set('c', 1).catch(GETERR)).toEqual(true);
        expect2(await cacheB.set('c', 2).catch(GETERR)).toEqual(true);
        // key 'c' should be visible in 'NS-A and 'NS-B'
        expect2(await cacheA1.exists('c').catch(GETERR)).toEqual(true);
        expect2(await cacheA2.exists('c').catch(GETERR)).toEqual(true);
        expect2(await cacheB.exists('c').catch(GETERR)).toEqual(true);
        // but values should be different
        expect2(await cacheA1.get('c').catch(GETERR)).toEqual(1);
        expect2(await cacheA2.get('c').catch(GETERR)).toEqual(1);
        expect2(await cacheB.get('c').catch(GETERR)).toEqual(2);

        await cacheA1.close();
        await cacheA2.close();
        await cacheB.close();
        done();
    });

    it('set/get/exists/delete', async done => {
        const { cache } = instance('dummy');

        // number
        expect2(await cache.exists('N').catch(GETERR)).toEqual(false);
        expect2(await cache.set('N', 100).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('N').catch(GETERR)).toEqual(true);
        expect2(await cache.get('N').catch(GETERR)).toEqual(100);
        expect2(await cache.delete('N').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('N').catch(GETERR)).toEqual(false);
        // string
        expect2(await cache.exists('S').catch(GETERR)).toEqual(false);
        expect2(await cache.set('S', 'lemon').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('S').catch(GETERR)).toEqual(true);
        expect2(await cache.get('S').catch(GETERR)).toEqual('lemon');
        expect2(await cache.delete('S').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('S').catch(GETERR)).toEqual(false);
        // object
        expect2(await cache.exists('M').catch(GETERR)).toEqual(false);
        expect2(await cache.set('M', { a: 9, b: 'bar', c: null }).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('M').catch(GETERR)).toEqual(true);
        expect2(await cache.get('M').catch(GETERR)).toEqual({ a: 9, b: 'bar', c: null });
        expect2(await cache.delete('M').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('M').catch(GETERR)).toEqual(false);
        // array
        expect2(await cache.exists('L').catch(GETERR)).toEqual(false);
        expect2(await cache.set('L', ['foo', -1, {}]).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('L').catch(GETERR)).toEqual(true);
        expect2(await cache.get('L').catch(GETERR)).toEqual(['foo', -1, {}]);
        expect2(await cache.delete('L').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('L').catch(GETERR)).toEqual(false);
        // null
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(false);
        expect2(await cache.set('nil', null).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(true);
        expect2(await cache.get('nil').catch(GETERR)).toEqual(null);
        expect2(await cache.delete('nil').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(false);

        // failed: empty key
        expect2(await cache.set('', undefined).catch(GETERR)).toEqual('@key (CacheKey) is required.');
        // failed: undefined value
        expect2(await cache.set('key', undefined).catch(GETERR)).toEqual('@val (CacheValue) cannot be undefined.');

        await cache.close();
        done();
    });

    it('setMulti/getMulti/deleteMulti', async done => {
        const { cache } = instance('dummy');
        /* eslint-disable prettier/prettier */

        // pre-condition
        expect2(await cache.keys().catch(GETERR)).toEqual([]);

        // setMulti
        expect2(await cache.setMulti([{ key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 }]).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);
        // getMulti
        expect2(await cache.getMulti([1, 2, 3]).catch(GETERR)).toEqual({ '1': 1, '2': 2, '3': 3 });
        // deleteMulti
        expect2(await cache.deleteMulti([1, 2]).catch(GETERR)).toEqual([true, true]);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);
        expect2(await cache.deleteMulti([1, 2, 3]).catch(GETERR)).toEqual([false, false, true]);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        /* eslint-enable prettier/prettier */
        await cache.close();
        done();
    });

    it('getAndSet/getAndDelete', async done => {
        const { cache } = instance('dummy');

        // pre-condition
        expect2(await cache.set('a', 'bar').catch(GETERR)).toEqual(true);
        expect2(await cache.get('a').catch(GETERR)).toEqual('bar');

        // get-and-set
        expect2(await cache.getAndSet('a', 'baz').catch(GETERR)).toEqual('bar');
        expect2(await cache.get('a').catch(GETERR)).toEqual('baz');
        // get-and-delete
        expect2(await cache.getAndDelete('a').catch(GETERR)).toEqual('baz');
        expect2(await cache.exists('a').catch(GETERR)).toEqual(false);
        expect2(await cache.get('a').catch(GETERR)).toEqual(undefined);

        await cache.close();
        done();
    });

    _it('TTL', async done => {
        const { cache } = instance('dummy');
        /* eslint-disable prettier/prettier */

        // pre-condition
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        // set key with TTL
        expect2(await cache.set(1, 'foo', 1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeUndefined(); // undefined if key expired
        expect2(await cache.getTimeout(2).catch(GETERR)).toBeUndefined(); // undefined if key does not exist

        // set multiple keys with TTL
        expect2(await cache.setMulti([{ key: 1, val: 1, timeout: { expireIn: 1 } }, { key: 2, val: 2 }, { key: 3, val: 3, timeout: { expireAt: Date.now() + 2000 } }]).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        expect2(await cache.getTimeout(2).catch(GETERR)).toBe(0); // 0 if no timeout set
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(2000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);

        // remove TTL
        expect2(await cache.removeTimeout(3).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toEqual(0);

        // change TTL manually
        expect2(await cache.setTimeout(3, 3).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(3000);
        expect2(await cache.setTimeout(3, 1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        /* eslint-enable prettier/prettier */
        await cache.close();
        done();
    });
});

describe('CacheService - Memcached', () => {
    it('hello', async done => {
        const { cache } = instance('memcached');
        expect2(() => cache instanceof CacheService).toBeTruthy();
        expect2(() => cache instanceof DummyCacheService).toBeFalsy();
        expect2(() => cache.hello()).toEqual('cache-service:memcached:cache-service-test');
        await cache.close();
        done();
    });

    it('set/get/exists/delete', async done => {
        if (!(await isLocalCacheAvailable('memcached'))) return done();
        const { cache } = instance('memcached', 'TC01');

        // setup test
        await cache.deleteMulti(['N', 'S', 'M', 'L', 'nil']);

        // number
        expect2(await cache.exists('N').catch(GETERR)).toEqual(false);
        expect2(await cache.set('N', 100).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('N').catch(GETERR)).toEqual(true);
        expect2(await cache.get('N').catch(GETERR)).toEqual(100);
        expect2(await cache.delete('N').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('N').catch(GETERR)).toEqual(false);
        // string
        expect2(await cache.exists('S').catch(GETERR)).toEqual(false);
        expect2(await cache.set('S', 'lemon').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('S').catch(GETERR)).toEqual(true);
        expect2(await cache.get('S').catch(GETERR)).toEqual('lemon');
        expect2(await cache.delete('S').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('S').catch(GETERR)).toEqual(false);
        // object
        expect2(await cache.exists('M').catch(GETERR)).toEqual(false);
        expect2(await cache.set('M', { a: 9, b: 'bar', c: null }).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('M').catch(GETERR)).toEqual(true);
        expect2(await cache.get('M').catch(GETERR)).toEqual({ a: 9, b: 'bar', c: null });
        expect2(await cache.delete('M').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('M').catch(GETERR)).toEqual(false);
        // array
        expect2(await cache.exists('L').catch(GETERR)).toEqual(false);
        expect2(await cache.set('L', ['foo', -1, {}]).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('L').catch(GETERR)).toEqual(true);
        expect2(await cache.get('L').catch(GETERR)).toEqual(['foo', -1, {}]);
        expect2(await cache.delete('L').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('L').catch(GETERR)).toEqual(false);
        // null
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(false);
        expect2(await cache.set('nil', null).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(true);
        expect2(await cache.get('nil').catch(GETERR)).toEqual(null);
        expect2(await cache.delete('nil').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(false);

        // failed: empty key
        expect2(await cache.set('', undefined).catch(GETERR)).toEqual('@key (CacheKey) is required.');
        // failed: undefined value
        expect2(await cache.set('key', undefined).catch(GETERR)).toEqual('@val (CacheValue) cannot be undefined.');

        await cache.close();
        done();
    });

    it('setMulti/getMulti/deleteMulti', async done => {
        if (!(await isLocalCacheAvailable('memcached'))) return done();
        const { cache } = instance('memcached', 'TC02');
        /* eslint-disable prettier/prettier */

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // setMulti
        expect2(await cache.setMulti([{ key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 }]).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);
        // getMulti
        expect2(await cache.getMulti([1, 2, 3]).catch(GETERR)).toEqual({ '1': 1, '2': 2, '3': 3 });
        // deleteMulti
        expect2(await cache.deleteMulti([1, 2]).catch(GETERR)).toEqual([true, true]);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);
        expect2(await cache.deleteMulti([1, 2, 3]).catch(GETERR)).toEqual([false, false, true]);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        /* eslint-enable prettier/prettier */
        await cache.close();
        done();
    });

    it('getAndSet/getAndDelete', async done => {
        if (!(await isLocalCacheAvailable('memcached'))) return done();
        const { cache } = instance('memcached', 'TC03');

        // setup test
        await cache.set('a', 'bar');

        // get-and-set
        expect2(await cache.getAndSet('a', 'baz').catch(GETERR)).toEqual('bar');
        expect2(await cache.get('a').catch(GETERR)).toEqual('baz');
        // get-and-delete
        expect2(await cache.getAndDelete('a').catch(GETERR)).toEqual('baz');
        expect2(await cache.exists('a').catch(GETERR)).toEqual(false);
        expect2(await cache.get('a').catch(GETERR)).toEqual(undefined);

        await cache.close();
        done();
    });

    _it('TTL', async done => {
        if (!(await isLocalCacheAvailable('memcached'))) return done();
        const { cache } = instance('memcached', 'TC04');
        /* eslint-disable prettier/prettier */

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // set key with TTL
        expect2(await cache.set(1, 'foo', 1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeUndefined(); // undefined if key expired
        expect2(await cache.getTimeout(2).catch(GETERR)).toBeUndefined(); // undefined if key does not exist

        // set multiple keys with TTL
        expect2(await cache.setMulti([{ key: 1, val: 1, timeout: { expireIn: 1 } }, { key: 2, val: 2 }, { key: 3, val: 3, timeout: { expireAt: Date.now() + 2000 } }]).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        expect2(await cache.getTimeout(2).catch(GETERR)).toBe(0); // 0 if no timeout set
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(2000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);

        // remove TTL
        expect2(await cache.removeTimeout(3).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toEqual(0);

        // change TTL manually
        expect2(await cache.setTimeout(3, 3).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(3000);
        expect2(await cache.setTimeout(3, 1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        /* eslint-enable prettier/prettier */
        await cache.close();
        done();
    });
});

describe('CacheService - Redis', () => {
    it('hello', async done => {
        const { cache } = instance('redis');
        expect2(() => cache instanceof CacheService).toBeTruthy();
        expect2(() => cache instanceof DummyCacheService).toBeFalsy();
        expect2(() => cache.hello()).toEqual('cache-service:redis:cache-service-test');
        await cache.close();
        done();
    });

    it('set/get/exists/delete', async done => {
        if (!(await isLocalCacheAvailable('redis'))) return done();
        const { cache } = instance('redis', 'TC01');

        // setup test
        await cache.deleteMulti(['N', 'S', 'M', 'L', 'nil']);

        // number
        expect2(await cache.exists('N').catch(GETERR)).toEqual(false);
        expect2(await cache.set('N', 100).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('N').catch(GETERR)).toEqual(true);
        expect2(await cache.get('N').catch(GETERR)).toEqual(100);
        expect2(await cache.delete('N').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('N').catch(GETERR)).toEqual(false);
        // string
        expect2(await cache.exists('S').catch(GETERR)).toEqual(false);
        expect2(await cache.set('S', 'lemon').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('S').catch(GETERR)).toEqual(true);
        expect2(await cache.get('S').catch(GETERR)).toEqual('lemon');
        expect2(await cache.delete('S').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('S').catch(GETERR)).toEqual(false);
        // object
        expect2(await cache.exists('M').catch(GETERR)).toEqual(false);
        expect2(await cache.set('M', { a: 9, b: 'bar', c: null }).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('M').catch(GETERR)).toEqual(true);
        expect2(await cache.get('M').catch(GETERR)).toEqual({ a: 9, b: 'bar', c: null });
        expect2(await cache.delete('M').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('M').catch(GETERR)).toEqual(false);
        // array
        expect2(await cache.exists('L').catch(GETERR)).toEqual(false);
        expect2(await cache.set('L', ['foo', -1, {}]).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('L').catch(GETERR)).toEqual(true);
        expect2(await cache.get('L').catch(GETERR)).toEqual(['foo', -1, {}]);
        expect2(await cache.delete('L').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('L').catch(GETERR)).toEqual(false);
        // null
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(false);
        expect2(await cache.set('nil', null).catch(GETERR)).toEqual(true);
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(true);
        expect2(await cache.get('nil').catch(GETERR)).toEqual(null);
        expect2(await cache.delete('nil').catch(GETERR)).toEqual(true);
        expect2(await cache.exists('nil').catch(GETERR)).toEqual(false);

        // failed: empty key
        expect2(await cache.set('', undefined).catch(GETERR)).toEqual('@key (CacheKey) is required.');
        // failed: undefined value
        expect2(await cache.set('key', undefined).catch(GETERR)).toEqual('@val (CacheValue) cannot be undefined.');

        await cache.close();
        done();
    });

    it('setMulti/getMulti/deleteMulti', async done => {
        if (!(await isLocalCacheAvailable('redis'))) return done();
        const { cache } = instance('redis', 'TC02');
        /* eslint-disable prettier/prettier */

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // setMulti
        expect2(await cache.setMulti([{ key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 }]).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);
        // getMulti
        expect2(await cache.getMulti([1, 2, 3]).catch(GETERR)).toEqual({ '1': 1, '2': 2, '3': 3 });
        // deleteMulti
        expect2(await cache.deleteMulti([1, 2]).catch(GETERR)).toEqual([true, true]);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);
        expect2(await cache.deleteMulti([1, 2, 3]).catch(GETERR)).toEqual([false, false, true]);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        /* eslint-enable prettier/prettier */
        await cache.close();
        done();
    });

    it('getAndSet/getAndDelete', async done => {
        if (!(await isLocalCacheAvailable('redis'))) return done();
        const { cache } = instance('redis', 'TC03');

        // setup test
        await cache.set('a', 'bar');

        // get-and-set
        expect2(await cache.getAndSet('a', 'baz').catch(GETERR)).toEqual('bar');
        expect2(await cache.get('a').catch(GETERR)).toEqual('baz');
        // get-and-delete
        expect2(await cache.getAndDelete('a').catch(GETERR)).toEqual('baz');
        expect2(await cache.exists('a').catch(GETERR)).toEqual(false);
        expect2(await cache.get('a').catch(GETERR)).toEqual(undefined);

        await cache.close();
        done();
    });

    _it('TTL', async done => {
        if (!(await isLocalCacheAvailable('redis'))) return done();
        const { cache } = instance('redis', 'TC04');
        /* eslint-disable prettier/prettier */

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // set key with TTL
        expect2(await cache.set(1, 'foo', 1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeUndefined(); // undefined if key expired
        expect2(await cache.getTimeout(2).catch(GETERR)).toBeUndefined(); // undefined if key does not exist

        // set multiple keys with TTL
        expect2(await cache.setMulti([{ key: 1, val: 1, timeout: { expireIn: 1 } }, { key: 2, val: 2 }, { key: 3, val: 3, timeout: { expireAt: Date.now() + 2000 } }]).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        expect2(await cache.getTimeout(2).catch(GETERR)).toBe(0); // 0 if no timeout set
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(2000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(true);

        // remove TTL
        expect2(await cache.removeTimeout(3).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toEqual(0);

        // change TTL manually
        expect2(await cache.setTimeout(3, 3).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(3000);
        expect2(await cache.setTimeout(3, 1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1000);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        /* eslint-enable prettier/prettier */
        await cache.close();
        done();
    });
});
