/**
 * `utilities.b18.spec.ts`
 * - v5 B18-c: table tests of the legacy helpers in `Utilities` (`$U`).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Utilities } from './utilities';
import { $U } from './index';

//* an object whose first string conversion throws (to reach the `catch` of `N()`/`F()`).
const throwOnce = () => {
    let n = 0;
    return {
        [Symbol.toPrimitive]() {
            if (n++ === 0) throw new Error('B18 conv');
            return 'b18';
        },
    };
};

describe('utilities B18', () => {
    const $env = { ENV: process.env.ENV, NODE_ENV: process.env.NODE_ENV, B18_X: process.env.B18_X };
    afterEach(() => {
        Object.entries($env).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
    });

    it('B18 get_env() without environ, is_dev()', () => {
        //* v5 B18: a bare core (no `environ`) reads `process.env`.
        const logs: any[] = [];
        const $u = new Utilities({ log: (...a: any[]) => logs.push(a), err: (...a: any[]) => logs.push(a) } as any);
        process.env.B18_X = 'x';
        expect($u.get_env('B18_X')).toEqual('x');
        expect($u.get_env('B18_NONE', 'def')).toEqual('def');
        process.env.ENV = 'production';
        expect($u.is_dev()).toEqual(false);
        process.env.ENV = 'op';
        expect($u.is_dev()).toEqual(false);
        process.env.ENV = 'dev';
        expect($u.is_dev()).toEqual(true);
    });

    it('B18 load yaml (async and sync)', async () => {
        expect(() => $U.load_data_yaml('')).toThrow('param:name is required!');
        expect(() => $U.load_sync_yaml('')).toThrow('param:name is required!');
        //* `folder` is relative to `src/`: `../data` is the repo data folder.
        const doc = await $U.load_data_yaml('dummy-data', '../data');
        expect(typeof doc).toEqual('object');
        expect(await $U.load_data_yaml('dummy-data.yml', '../data')).toEqual(doc);
        await expect($U.load_data_yaml('b18-none', '../data')).rejects.toThrow('ENOENT');
        expect($U.load_sync_yaml('dummy-data', '../data')).toEqual(doc);
        expect($U.load_sync_yaml('b18-none.yml', '../data')).toEqual({});
        expect($U.load_sync_yaml('b18-none')).toEqual({});
    });

    it('B18 small object helpers', () => {
        expect($U.extend({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
        expect([$U.isset(undefined), $U.isset(0)]).toEqual([false, true]);
        expect([$U.empty(''), $U.empty('a')]).toEqual([true, false]);
        expect([$U.min(1, 2), $U.min(3, 2), $U.max(1, 2), $U.max(3, 2), $U.round(1.6)]).toEqual([1, 2, 2, 3, 2]);
        expect($U.cleanup({ a: 1, _b: 2, $c: 3 })).toEqual({ a: 1 });
        expect($U.updated({ a: 1, b: null, c: 3 }, { a: 2, b: '', c: 3 })).toEqual({ a: 2 });
        expect($U.copy({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
        expect($U.copy_node({ a: 1, _b: 2, $c: 3 })).toEqual({ a: 1 });
        expect($U.copy_node({ a: 1 }, true)).toEqual({ a: null });
        expect($U.bare_node({ _id: 'x', _current_time: 1, a: 1 })).toEqual({ _id: 'x', _current_time: 1 });
        expect($U.bare_node({ _id: 'x' }, { b: 2 })).toEqual({ _id: 'x', _current_time: undefined, b: 2 });
        expect($U.NS('')).toEqual('');
    });

    it('B18 escape()', () => {
        expect($U.escape(undefined)).toEqual('NULL');
        expect($U.escape(12 as any)).toEqual(12);
        expect($U.escape(null)).toEqual("''");
        expect($U.escape({ a: 'b' } as any)).toEqual(`'{\\"a\\":\\"b\\"}'`);
        expect($U.escape(`a'$\\`)).toEqual(`'a\\'\\$\\\\'`);
        expect($U.escape('a%20b', true)).toEqual(`'a b'`);
    });

    it('B18 N()/F() conversion errors give the default', () => {
        expect($U.N(throwOnce(), 7)).toEqual(7);
        expect($U.F(throwOnce(), 1.5)).toEqual(1.5);
    });

    it('B18 diff_node() and isEqual() branches', () => {
        expect($U.diff_node(null, null)).toEqual([]);
        expect($U.diff_node({ a: 1, b: 2, _x: 1 }, { a: 1, c: 3, $y: 2 })).toEqual(['c', 'b']);
        //* `diff()` walks `isEqual()` for each type.
        const A = {
            s: new String('a'),
            n: new Number(1),
            z: 0,
            nan: NaN,
            nn: new Number(NaN),
            d: new Date(1),
            b: new Boolean(true),
            r: /x/g,
            arr: [1, [2]],
            o: { k: { j: 1 } },
            f: () => 1,
            m: new Map(),
        };
        const B = {
            s: new String('a'),
            n: new Number(1),
            z: -0,
            nan: NaN,
            nn: new Number(NaN),
            d: new Date(1),
            b: new Boolean(true),
            r: /x/g,
            arr: [1, [2]],
            o: { k: { j: 1 } },
            f: A.f,
            m: new Map(),
        };
        expect($U.diff(A, B)).toEqual(['z']);
        //* zero of Number object, ctor mismatch, string vs object, cyclic objects.
        expect($U.diff({ a: new Number(0) }, { a: new Number(-0) })).toEqual(['a']);
        class X {
            public v = 1;
        }
        class Y {
            public v = 1;
        }
        expect($U.diff({ a: new X() }, { a: new Y() })).toEqual(['a']);
        expect($U.diff({ a: 'x' }, { a: { x: 1 } })).toEqual(['a']);
        expect($U.diff({ a: () => 1 }, { a: () => 2 })).toEqual(['a']);
        const c1: any = { v: 1 };
        c1.self = c1;
        const c2: any = { v: 1 };
        c2.self = c2;
        expect($U.diff({ a: c1 }, { a: c2 })).toEqual([]);
    });

    it('B18 promise helpers', async () => {
        expect(await $U.promise('b18')).toEqual('b18');
        const seen: number[] = [];
        await $U.promise_sequence([1, 2, 3], async (n: number) => seen.push(n));
        expect(seen).toEqual([1, 2, 3]);
    });
});
