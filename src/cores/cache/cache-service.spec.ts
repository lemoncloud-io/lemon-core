/**
 * cache-service.spec.ts`
 * - unit test for `cache-service`
 *
 * @author      Tim Hong <tim@lemoncloud.io>
 * @date        2020-12-04 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR } from '../..';
import { CacheService, DummyCacheService, sleep, toTTL, fromTTL } from './cache-service';

type MemcachedMockEntry = { val: any; exp: number; cas: string };
type RedisMockEntry = { value: string; expireAt?: number };

jest.mock('memcached', () => {
    const store = new Map<string, MemcachedMockEntry>();
    let casSeq = 0;
    const now = () => Date.now();
    const cloneEntry = (entry?: MemcachedMockEntry) => (entry ? { val: entry.val, exp: entry.exp } : undefined);
    const readEntry = (key: string): MemcachedMockEntry | undefined => {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (entry.exp > 0 && entry.exp <= now()) {
            store.delete(key);
            return undefined;
        }
        return entry;
    };
    const respond = (fn: () => any, cb: (err: Error | null, res?: any) => void) => {
        try {
            cb(null, fn());
        } catch (err) {
            cb(err as Error);
        }
    };
    class MockMemcached {
        public constructor(private readonly endpoint: string = 'mock-memcached') {}

        public get(key: string, cb: (err: Error | null, value?: any) => void) {
            respond(() => cloneEntry(readEntry(key)), cb);
        }

        public gets(key: string, cb: (err: Error | null, value?: Record<string, any>) => void) {
            respond(() => {
                const entry = readEntry(key);
                if (!entry) return undefined;
                const payload: Record<string, any> = { cas: entry.cas };
                payload[key] = { val: entry.val, exp: entry.exp };
                return payload;
            }, cb);
        }

        public getMulti(keys: string[], cb: (err: Error | null, map?: Record<string, any>) => void) {
            respond(
                () =>
                    keys.reduce<Record<string, any>>((acc, key) => {
                        const entry = readEntry(key);
                        if (entry) acc[key] = { val: entry.val, exp: entry.exp };
                        return acc;
                    }, {}),
                cb,
            );
        }

        public set(
            key: string,
            entry: { val: any; exp: number },
            _lifetime: number,
            cb: (err: Error | null, success?: boolean) => void,
        ) {
            respond(() => {
                const cas = `cas-${++casSeq}`;
                store.set(key, { val: entry.val, exp: entry.exp, cas });
                return true;
            }, cb);
        }

        public cas(
            key: string,
            entry: { val: any; exp: number },
            cas: string,
            _lifetime: number,
            cb: (err: Error | null, success?: boolean) => void,
        ) {
            respond(() => {
                const current = readEntry(key);
                if (!current || current.cas !== cas) return false;
                const nextCas = `cas-${++casSeq}`;
                store.set(key, { val: entry.val, exp: entry.exp, cas: nextCas });
                return true;
            }, cb);
        }

        public del(key: string, cb: (err: Error | null, success?: boolean) => void) {
            respond(() => {
                const existed = readEntry(key) !== undefined;
                store.delete(key);
                return existed;
            }, cb);
        }

        public items(cb: (err: Error | null, stats?: Array<Record<string, any>>) => void) {
            respond(() => {
                if (store.size === 0) return [];
                const slabId = '1';
                const status: Record<string, any> = { server: this.endpoint };
                status[slabId] = { number: store.size };
                return [status];
            }, cb);
        }

        public cachedump(
            _server: string,
            _slabId: number,
            number: number,
            cb: (err: Error | null, dump?: Array<{ key: string }>) => void,
        ) {
            respond(() => {
                const limit = typeof number === 'number' && number > 0 ? number : store.size;
                return Array.from(store.keys())
                    .slice(0, limit)
                    .map(key => ({ key }));
            }, cb);
        }

        public end(): void {
            /* no-op */
        }
    }

    return { __esModule: true, default: MockMemcached };
});

jest.mock('ioredis', () => {
    class MockIORedis {
        private readonly store = new Map<string, RedisMockEntry>();
        public constructor() {}

        private read(key: string): RedisMockEntry | undefined {
            const entry = this.store.get(key);
            if (!entry) return undefined;
            if (entry.expireAt && entry.expireAt <= Date.now()) {
                this.store.delete(key);
                return undefined;
            }
            return entry;
        }

        private write(key: string, value: string, expireAt?: number) {
            this.store.set(key, { value, expireAt });
        }

        public async set(key: string, value: string, mode?: string, ttl?: number): Promise<string> {
            if (mode === 'EX' && typeof ttl === 'number') {
                this.write(key, value, Date.now() + ttl * 1000);
            } else {
                this.write(key, value);
            }
            return 'OK';
        }

        public async get(key: string): Promise<string | null> {
            const entry = this.read(key);
            return entry ? entry.value : null;
        }

        public multi(): MockRedisPipeline {
            return new MockRedisPipeline(this);
        }

        public async mget(keys: string[]): Promise<Array<string | null>> {
            return keys.map(key => {
                const entry = this.read(key);
                return entry ? entry.value : null;
            });
        }

        public async getset(key: string, value: string): Promise<string | null> {
            const previous = await this.get(key);
            await this.set(key, value);
            return previous;
        }

        public async incrbyfloat(key: string, increment: number): Promise<string> {
            const current = parseFloat((await this.get(key)) ?? '0');
            const next = current + increment;
            await this.set(key, String(next));
            return String(next);
        }

        public async keys(pattern: string): Promise<string[]> {
            if (pattern !== '*') return [];
            return Array.from(this.store.keys()).filter(key => this.read(key));
        }

        public async exists(key: string): Promise<number> {
            return (await this.get(key)) === null ? 0 : 1;
        }

        public async del(key: string): Promise<number> {
            const entry = this.read(key);
            if (!entry) return 0;
            this.store.delete(key);
            return 1;
        }

        public async expire(key: string, ttl: number): Promise<number> {
            const entry = this.read(key);
            if (!entry) return 0;
            entry.expireAt = Date.now() + ttl * 1000;
            this.store.set(key, entry);
            return 1;
        }

        public async persist(key: string): Promise<number> {
            const entry = this.read(key);
            if (!entry) return 0;
            entry.expireAt = undefined;
            this.store.set(key, entry);
            return 1;
        }

        public async pttl(key: string): Promise<number> {
            const entry = this.read(key);
            if (!entry) return -2;
            if (!entry.expireAt) return -1;
            const remaining = entry.expireAt - Date.now();
            return remaining >= 0 ? remaining : -2;
        }

        public async quit(): Promise<void> {
            return;
        }
    }

    class MockRedisPipeline {
        private readonly tasks: Array<() => Promise<any>> = [];

        public constructor(private readonly client: MockIORedis) {}

        public set(key: string, value: string, mode?: string, ttl?: number): MockRedisPipeline {
            this.tasks.push(() => this.client.set(key, value, mode, ttl));
            return this;
        }

        public get(key: string): MockRedisPipeline {
            this.tasks.push(() => this.client.get(key));
            return this;
        }

        public del(key: string): MockRedisPipeline {
            this.tasks.push(() => this.client.del(key));
            return this;
        }

        public async exec(): Promise<Array<[null, any]>> {
            const results: Array<[null, any]> = [];
            for (const task of this.tasks) {
                results.push([null, await task()]);
            }
            return results;
        }
    }

    return { __esModule: true, default: MockIORedis };
});

export const instance = (type: 'dummy' | 'memcached' | 'redis', ns: string = 'cache-service-test') => {
    if (type === 'dummy') {
        return { cache: DummyCacheService.create({ ns, defTimeout: 0 }) };
    } else {
        return { cache: CacheService.create({ type, ns, defTimeout: 0 }) }; // use local cache server
    }
};

//* main test body.
describe('DummyCacheService', () => {
    it('hello', async () => {
        const { cache } = instance('dummy');
        expect2(() => cache instanceof CacheService).toBeTruthy();
        expect2(() => cache instanceof DummyCacheService).toBeTruthy();
        expect2(() => cache.hello()).toEqual('dummy-cache-service:node-cache:cache-service-test');
        await cache.close();
    });

    it('TTL conversion', async () => {
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
    });

    it('namespace', async () => {
        const { cache: cacheA1 } = instance('dummy', 'NS-A');
        const { cache: cacheA2 } = instance('dummy', 'NS-A');
        const { cache: cacheB0 } = instance('dummy', 'NS-B');

        expect2(() => cacheA1.options).toEqual({ defTimeout: 0, ns: 'NS-A' });

        expect2(() => cacheA1.asNamespacedKey('a')).toEqual('NS-A::a');
        expect2(() => cacheA2.asNamespacedKey('a')).toEqual('NS-A::a');
        expect2(() => cacheB0.asNamespacedKey('a')).toEqual('NS-B::a');

        const cacheB1 = cacheB0.cloneByType('t1');
        const cacheB2 = cacheB0.cloneByType('x2', '|');
        expect2(() => cacheB1.asNamespacedKey('a')).toEqual('NS-B::t1:a');
        expect2(() => cacheB2.asNamespacedKey('a')).toEqual('NS-B::x2|a');

        // pre-condition
        expect2(await cacheA1.keys().catch(GETERR)).toEqual([]);
        expect2(await cacheA2.keys().catch(GETERR)).toEqual([]);
        expect2(await cacheB0.keys().catch(GETERR)).toEqual([]);

        // set key 'a' into 'NS-A' namespace
        expect2(await cacheA1.set('a', 'a').catch(GETERR)).toEqual(true);
        // key 'a' should be visible in cache1 and cache2
        expect2(await cacheA1.exists('a').catch(GETERR)).toEqual(true);
        expect2(await cacheA2.exists('a').catch(GETERR)).toEqual(true);
        // key 'a' should not be visible in cache3
        expect2(await cacheB0.exists('a').catch(GETERR)).toEqual(false);

        // set key 'b' into 'NS-B' namespace
        expect2(await cacheB0.set('b', 'b').catch(GETERR)).toEqual(true);
        // key 'b' should not be visible in 'NS-B' namespace
        expect2(await cacheA1.exists('b').catch(GETERR)).toEqual(false);
        expect2(await cacheA2.exists('b').catch(GETERR)).toEqual(false);
        // key 'b' should be visible in 'NS-A' namespace
        expect2(await cacheB0.exists('b').catch(GETERR)).toEqual(true);

        // set key 'c' into both 'NS-A' and 'NS-B' namespace with different values
        expect2(await cacheA2.set('c', 1).catch(GETERR)).toEqual(true);
        expect2(await cacheB0.set('c', 2).catch(GETERR)).toEqual(true);
        // key 'c' should be visible in 'NS-A and 'NS-B'
        expect2(await cacheA1.exists('c').catch(GETERR)).toEqual(true);
        expect2(await cacheA2.exists('c').catch(GETERR)).toEqual(true);
        expect2(await cacheB0.exists('c').catch(GETERR)).toEqual(true);
        // but values should be different
        expect2(await cacheA1.get('c').catch(GETERR)).toEqual(1);
        expect2(await cacheA2.get('c').catch(GETERR)).toEqual(1);
        expect2(await cacheB0.get('c').catch(GETERR)).toEqual(2);

        await cacheA1.close();
        await cacheA2.close();
        await cacheB0.close();
    });

    it('set/get/exists/delete', async () => {
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
    });

    it('setMulti/getMulti/deleteMulti', async () => {
        const { cache } = instance('dummy');

        // pre-condition
        expect2(await cache.keys().catch(GETERR)).toEqual([]);

        // setMulti
        expect2(
            await cache
                .setMulti([
                    { key: 1, val: 1 },
                    { key: 2, val: 2 },
                    { key: 3, val: 3 },
                ])
                .catch(GETERR),
        ).toEqual(true);
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

        await cache.close();
    });

    it('getAndSet/getAndDelete', async () => {
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
    });

    it('TTL', async () => {
        const { cache } = instance('dummy');

        // pre-condition
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(2).catch(GETERR)).toEqual(false);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        // set key with TTL
        expect2(await cache.set(1, 'foo', 1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1200);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeUndefined(); // undefined if key expired
        expect2(await cache.getTimeout(2).catch(GETERR)).toBeUndefined(); // undefined if key does not exist

        // set multiple keys with TTL
        expect2(
            await cache
                .setMulti([
                    { key: 1, val: 1, timeout: { expireIn: 1 } },
                    { key: 2, val: 2 },
                    { key: 3, val: 3, timeout: { expireAt: Date.now() + 2000 } },
                ])
                .catch(GETERR),
        ).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        expect2(await cache.getTimeout(2).catch(GETERR)).toBe(0); // 0 if no timeout set
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(2000);
        // expired
        await sleep(1200);
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
        await sleep(1200);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        // NodeCacheBackend returns false when the key does not exist
        expect2(await cache.setTimeout('dummy-missing', 1).catch(GETERR)).toEqual(false);

        await cache.close();
    });

    it('increment', async () => {
        const { cache } = instance('dummy');

        // Initialize with number
        expect2(await cache.set('counter', 10).catch(GETERR)).toEqual(true);

        // Test increment
        expect2(await cache.increment('counter', 1).catch(GETERR)).toEqual(11);
        expect2(await cache.inc('counter', 5).catch(GETERR)).toEqual(16);
        expect2(await cache.get('counter').catch(GETERR)).toEqual(16);

        // Test decrement (negative increment)
        expect2(await cache.increment('counter', -3).catch(GETERR)).toEqual(13);
        expect2(await cache.get('counter').catch(GETERR)).toEqual(13);

        // Test error: increment non-number value
        expect2(await cache.set('non-number', 'string').catch(GETERR)).toEqual(true);
        expect2(await cache.increment('non-number', 1).catch(GETERR)).toEqual(
            '@key [cache-service-test::non-number] does not hold a number value.',
        );

        // Test error: missing key
        expect2(await cache.increment('', 1).catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test error: undefined increment
        expect2(await cache.increment('counter', undefined as any).catch(GETERR)).toEqual(
            '@inc (number) cannot be undefined.',
        );

        await cache.close();
    });

    it('error cases', async () => {
        const { cache } = instance('dummy');

        // Test set with empty key
        expect2(await cache.set('', 'value').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test set with undefined value
        expect2(await cache.set('key', undefined).catch(GETERR)).toEqual('@val (CacheValue) cannot be undefined.');

        // Test get with empty key
        expect2(await cache.get('').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test delete with empty key
        expect2(await cache.delete('').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test setTimeout with empty key
        expect2(await cache.setTimeout('', 100).catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test getTimeout with empty key
        expect2(await cache.getTimeout('').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test removeTimeout with empty key
        expect2(await cache.removeTimeout('').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test getAndSet with empty key
        expect2(await cache.getAndSet('', 'value').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test getAndSet with undefined value
        expect2(await cache.getAndSet('key', undefined).catch(GETERR)).toEqual(
            '@val (CacheValue) cannot be undefined.',
        );

        // Test getAndDelete with empty key
        expect2(await cache.getAndDelete('').catch(GETERR)).toEqual('@key (CacheKey) is required.');

        // Test setMulti with missing key
        expect2(await cache.setMulti([{ key: '', val: 'value' }]).catch(GETERR)).toEqual(
            '.key (CacheKey) is required (at @entries[0]).',
        );

        // Test setMulti with undefined value
        expect2(await cache.setMulti([{ key: 'key', val: undefined }]).catch(GETERR)).toEqual(
            '.val (CacheValue) cannot be undefined (at @entries[0]).',
        );

        // Test getMulti with empty key
        expect2(await cache.getMulti(['']).catch(GETERR)).toEqual('@key (CacheKey) is required (at @keys[0]).');

        // Test deleteMulti with empty key
        expect2(await cache.deleteMulti(['']).catch(GETERR)).toEqual('@key (CacheKey) is required (at @keys[0]).');

        await cache.close();
    });
});

describe('CacheService - Memcached', () => {
    it('hello', async () => {
        const { cache } = instance('memcached');
        expect2(() => cache instanceof CacheService).toBeTruthy();
        expect2(() => cache instanceof DummyCacheService).toBeFalsy();
        expect2(() => cache.hello()).toEqual('cache-service:memcached:cache-service-test');
        await cache.close();
    });

    it('set/get/exists/delete', async () => {
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
    });

    it('setMulti/getMulti/deleteMulti', async () => {
        const { cache } = instance('memcached', 'TC02');

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // setMulti
        expect2(
            await cache
                .setMulti([
                    { key: 1, val: 1 },
                    { key: 2, val: 2 },
                    { key: 3, val: 3 },
                ])
                .catch(GETERR),
        ).toEqual(true);
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

        await cache.close();
    });

    it('getAndSet/getAndDelete', async () => {
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
    });

    it('increment', async () => {
        const { cache } = instance('memcached', 'TC03-INC');

        // Initialize counter
        expect2(await cache.set('counter', 10).catch(GETERR)).toEqual(true);

        // Test increment
        expect2(await cache.increment('counter', 1).catch(GETERR)).toEqual(11);
        expect2(await cache.inc('counter', 5).catch(GETERR)).toEqual(16);
        expect2(await cache.get('counter').catch(GETERR)).toEqual(16);

        // Test decrement
        expect2(await cache.increment('counter', -3).catch(GETERR)).toEqual(13);

        // Test increment on non-existent key (should initialize)
        await cache.delete('new-counter');
        expect2(await cache.increment('new-counter', 5).catch(GETERR)).toEqual(5);
        expect2(await cache.get('new-counter').catch(GETERR)).toEqual(5);

        // Test error: increment non-number value
        expect2(await cache.set('non-number', 'string').catch(GETERR)).toEqual(true);
        expect2(await cache.increment('non-number', 1).catch(GETERR)).toEqual(
            '.key [TC03-INC::non-number] has non-numeric value.',
        );

        await cache.close();
    });

    it('keys()', async () => {
        const { cache } = instance('memcached', 'TC-KEYS');

        expect2(await cache.keys()).toEqual([]);

        expect2(await cache.set('mem-a', 'A').catch(GETERR)).toEqual(true);
        expect2(await cache.set('mem-b', 'B').catch(GETERR)).toEqual(true);

        const keys = await cache.keys();
        expect2(keys.sort()).toEqual(['mem-a', 'mem-b']);

        await cache.close();
    });

    it('TTL', async () => {
        const { cache } = instance('memcached', 'TC04');

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // set key with TTL
        expect2(await cache.set(1, 'foo', 1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1200);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeUndefined(); // undefined if key expired
        expect2(await cache.getTimeout(2).catch(GETERR)).toBeUndefined(); // undefined if key does not exist

        // set multiple keys with TTL
        expect2(
            await cache
                .setMulti([
                    { key: 1, val: 1, timeout: { expireIn: 1 } },
                    { key: 2, val: 2 },
                    { key: 3, val: 3, timeout: { expireAt: Date.now() + 2000 } },
                ])
                .catch(GETERR),
        ).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        expect2(await cache.getTimeout(2).catch(GETERR)).toBe(0); // 0 if no timeout set
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(2000);
        // expired
        await sleep(1200);
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
        await sleep(1200);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        await cache.close();
    });
});

describe('CacheService - Redis', () => {
    it('hello', async () => {
        const { cache } = instance('redis');
        expect2(() => cache instanceof CacheService).toBeTruthy();
        expect2(() => cache instanceof DummyCacheService).toBeFalsy();
        expect2(() => cache.hello()).toEqual('cache-service:redis:cache-service-test');
        await cache.close();
    });

    it('set/get/exists/delete', async () => {
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
    });

    it('setMulti/getMulti/deleteMulti', async () => {
        const { cache } = instance('redis', 'TC02');

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // setMulti
        expect2(
            await cache
                .setMulti([
                    { key: 1, val: 1 },
                    { key: 2, val: 2 },
                    { key: 3, val: 3 },
                ])
                .catch(GETERR),
        ).toEqual(true);
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

        await cache.close();
    });

    it('getAndSet/getAndDelete', async () => {
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
    });

    it('increment', async () => {
        const { cache } = instance('redis', 'TC03-INC');

        // Initialize counter
        expect2(await cache.set('counter', 10).catch(GETERR)).toEqual(true);

        // Test increment
        expect2(await cache.increment('counter', 1).catch(GETERR)).toEqual(11);
        expect2(await cache.inc('counter', 5).catch(GETERR)).toEqual(16);
        expect2(await cache.get('counter').catch(GETERR)).toEqual(16);

        // Test decrement
        expect2(await cache.increment('counter', -3).catch(GETERR)).toEqual(13);

        // Test increment on non-existent key (Redis initializes to 0 + increment)
        await cache.delete('new-counter');
        expect2(await cache.increment('new-counter', 5).catch(GETERR)).toEqual(5);
        expect2(await cache.get('new-counter').catch(GETERR)).toEqual(5);

        // Test floating point increment
        expect2(await cache.increment('counter', 0.5).catch(GETERR)).toEqual(13.5);
        expect2(await cache.get('counter').catch(GETERR)).toEqual(13.5);

        await cache.close();
    });

    it('keys()', async () => {
        const { cache } = instance('redis', 'TC-KEYS');

        expect2(await cache.keys()).toEqual([]);

        expect2(await cache.set('redis-a', 'A').catch(GETERR)).toEqual(true);
        expect2(await cache.set('redis-b', 'B').catch(GETERR)).toEqual(true);

        const keys = await cache.keys();
        expect2(keys.sort()).toEqual(['redis-a', 'redis-b']);

        await cache.close();
    });

    it('TTL', async () => {
        const { cache } = instance('redis', 'TC04');

        // setup test
        await cache.deleteMulti([1, 2, 3]);

        // set key with TTL
        expect2(await cache.set(1, 'foo', 1).catch(GETERR)).toEqual(true);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        // expired
        await sleep(1200);
        expect2(await cache.exists(1).catch(GETERR)).toEqual(false);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeUndefined(); // undefined if key expired
        expect2(await cache.getTimeout(2).catch(GETERR)).toBeUndefined(); // undefined if key does not exist

        // set multiple keys with TTL
        expect2(
            await cache
                .setMulti([
                    { key: 1, val: 1, timeout: { expireIn: 1 } },
                    { key: 2, val: 2 },
                    { key: 3, val: 3, timeout: { expireAt: Date.now() + 2000 } },
                ])
                .catch(GETERR),
        ).toEqual(true);
        expect2(await cache.getTimeout(1).catch(GETERR)).toBeLessThanOrEqual(1000);
        expect2(await cache.getTimeout(2).catch(GETERR)).toBe(0); // 0 if no timeout set
        expect2(await cache.getTimeout(3).catch(GETERR)).toBeLessThanOrEqual(2000);
        // expired
        await sleep(1200);
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
        await sleep(1200);
        expect2(await cache.exists(3).catch(GETERR)).toEqual(false);

        await cache.close();
    });
});

describe('CacheService - Factory', () => {
    it('invalid type', async () => {
        expect2(() => CacheService.create({ type: 'invalid' as any })).toEqual(
            '@type [invalid] is invalid - CacheService.create()',
        );
    });
});
