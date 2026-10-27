/**
 * `lang.spec.ts`
 * - checks the lodash replacements used by the dynamo tools.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version (v5 B2-a)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { isEmpty, isObject, isPlainObject, mapValues, merge, omitBy } from './lang';

describe('dynamo tools lang', () => {
    // plain objects only: Set, typed arrays, Date and class instances are rejected.
    it('should detect plain objects', () => {
        class Item {
            a = 1;
        }
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject(Object.create(null))).toBe(true);
        expect(isPlainObject({ $add: 1 })).toBe(true);
        expect(isPlainObject(new Set([1]))).toBe(false);
        expect(isPlainObject(new Uint8Array(2))).toBe(false);
        expect(isPlainObject(Buffer.from('a'))).toBe(false);
        expect(isPlainObject(new Date())).toBe(false);
        expect(isPlainObject(new Item())).toBe(false);
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject('a')).toBe(false);
    });

    // objects and functions are objects, primitives are not.
    it('should detect objects including functions', () => {
        expect(isObject({})).toBe(true);
        expect(isObject([])).toBe(true);
        expect(isObject(() => 1)).toBe(true);
        expect(isObject(null)).toBe(false);
        expect(isObject(undefined)).toBe(false);
        expect(isObject('a')).toBe(false);
        expect(isObject(1)).toBe(false);
    });

    // empty string, array, object (and nullish) are empty.
    it('should detect empty values', () => {
        expect(isEmpty('')).toBe(true);
        expect(isEmpty('a')).toBe(false);
        expect(isEmpty([])).toBe(true);
        expect(isEmpty([1])).toBe(false);
        expect(isEmpty({})).toBe(true);
        expect(isEmpty({ a: 1 })).toBe(false);
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
    });

    // copy-overlay: later sources win, nested plain objects are copied (not shared).
    it('should merge with nested copy', () => {
        const nested = { id: { S: 'a' } };
        const request = { TableName: 'T', ExclusiveStartKey: nested, Limit: 1 };
        const out = merge<any>({}, request, { TableName: 'U' });
        expect(out).toEqual({ TableName: 'U', ExclusiveStartKey: { id: { S: 'a' } }, Limit: 1 });
        expect(out.ExclusiveStartKey).not.toBe(nested);
        expect(out.ExclusiveStartKey.id).not.toBe(nested.id);
        // the source is not changed.
        out.ExclusiveStartKey.id.S = 'b';
        expect(nested.id.S).toBe('a');
    });

    // undefined sources and undefined values are skipped.
    it('should skip undefined sources and values', () => {
        expect(merge({}, { '#a': 'a' }, undefined)).toEqual({ '#a': 'a' });
        expect(merge({ a: 1 }, { a: undefined, b: 2 })).toEqual({ a: 1, b: 2 });
        expect(Object.keys(merge({}, { a: undefined }))).toEqual([]);
    });

    // arrays are copied, Set and Buffer are kept by reference.
    it('should copy arrays and keep Set by reference', () => {
        const list = [1, { a: 2 }];
        const set = new Set(['x']);
        const bin = Buffer.from('a');
        const out = merge<any>({}, { list, set, bin });
        expect(out.list).toEqual([1, { a: 2 }]);
        expect(out.list).not.toBe(list);
        expect(out.list[1]).not.toBe(list[1]);
        expect(out.set).toBe(set);
        expect(out.bin).toBe(bin);
    });

    // map values with the key, and drop entries by predicate.
    it('should map values and omit by predicate', () => {
        expect(mapValues({ a: 1, b: 2 }, (v, k) => `${k}${v * 2}`)).toEqual({ a: 'a2', b: 'b4' });
        expect(omitBy({ a: 1, b: null, c: '' }, v => v === null || v === '')).toEqual({ a: 1 });
        expect(omitBy({ id: 1, name: 'x' }, (_v, k) => k === 'id')).toEqual({ name: 'x' });
    });
});
