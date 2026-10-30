/**
 * `serializer.b18.spec.ts`
 * - v5 B18-a: offline unit tests for the dynamo `tools/serializer` (no AWS).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import Serializer from './serializer';

//* v5 B18: a document-client-like set (a class instance, so not a plain object) to hit `deserializeAttribute`.
class FakeSet {
    public values: any[];
    public constructor(values: any[]) {
        this.values = values;
    }
    public detectType() {
        return 'S';
    }
}

describe('dynamo/tools/serializer (B18)', () => {
    it('B18 serializeAttribute() by type', () => {
        const at = new Date(Date.UTC(2026, 9, 30, 1, 2, 3));
        const iso = at.toISOString();
        const table: [any, any, any][] = [
            ['v', undefined, 'v'],
            [null, 'S', null],
            [at, 'DATE', iso],
            [at.getTime(), 'DATE', iso],
            [iso, 'DATE', iso],
            [true, 'BOOL', true],
            ['x', 'BOOL', true],
            ['false', 'BOOL', false],
            [0, 'BOOL', false],
            [1, 'NS', [1]],
            [[1, 2], 'NS', [1, 2]],
            ['a', 'SS', ['a']],
            [['a', 'b'], 'SS', ['a', 'b']],
            ['s', 'S', 's'],
            [3, 'N', 3],
        ];
        table.forEach(([value, type, expected]) =>
            expect(Serializer.serializeAttribute(value, type)).toEqual(expected),
        );
    });

    it('B18 serializeAttribute() for binary types', () => {
        expect(Serializer.serializeAttribute('ab', 'B')).toEqual(Buffer.from('ab'));
        const buf = Buffer.from('x');
        expect(Serializer.serializeAttribute(buf, 'B')).toBe(buf);
        //* v5 B18: `createSet` copies via JSON, so a Buffer becomes its JSON form.
        expect(Serializer.serializeAttribute('a', 'BS')).toEqual([{ type: 'Buffer', data: [97] }]);
        expect(Serializer.serializeAttribute(['a', buf], 'BS')).toEqual([
            { type: 'Buffer', data: [97] },
            { type: 'Buffer', data: [120] },
        ]);
    });

    it('B18 buildKey() from hash and range values', () => {
        const schema = { hashKey: 'id', rangeKey: 's' };
        expect(Serializer.buildKey('a', 'b', schema)).toEqual({ id: 'a', s: 'b' });
        expect(Serializer.buildKey('a', 0, schema)).toEqual({ id: 'a', s: 0 });
        expect(Serializer.buildKey('a', undefined, schema)).toEqual({ id: 'a' });
        expect(Serializer.buildKey('a', null, schema)).toEqual({ id: 'a' });
        expect(Serializer.buildKey('a', 'b', { hashKey: 'id' })).toEqual({ id: 'a' });
    });

    it('B18 buildKey() from a key object with index keys', () => {
        const schema = {
            hashKey: 'id',
            rangeKey: 's',
            globalIndexes: { G: { hashKey: 'gh', rangeKey: 'gr' } },
            secondaryIndexes: { L: { rangeKey: 'lr' } },
            _modelDatatypes: { s: 'N' },
        };
        expect(Serializer.buildKey({ id: 1, s: 2, gh: 3, gr: 4, lr: 5, x: 9 }, undefined, schema)).toEqual({
            id: 1,
            s: 2,
            gh: 3,
            gr: 4,
            lr: 5,
        });
        expect(Serializer.buildKey({ id: 1, s: null }, undefined, schema)).toEqual({ id: 1 });
        expect(Serializer.buildKey({ id: 1, s: 2 }, undefined, { hashKey: 'id' })).toEqual({ id: 1 });
    });

    it('B18 serializeItem() walks nested objects and typed lists', () => {
        const at = new Date(Date.UTC(2026, 0, 1));
        const schema = { _modelDatatypes: { d: 'DATE', n: { x: 'BOOL' }, l: [{ b: 'BOOL' }] } };
        const item = { d: at, n: { x: 'false' }, l: [{ b: 1 }, { b: 0 }], z: null as any, u: [1, 2] };
        expect(Serializer.serializeItem(schema, item)).toEqual({
            d: at.toISOString(),
            n: { x: false },
            l: [{ b: true }, { b: false }],
            u: [1, 2],
        });
        expect(Serializer.serializeItem(schema, item, { returnNulls: true }).z).toBeNull();
        expect(Serializer.serializeItem(schema, null)).toBeNull();
        expect(Serializer.serializeItem({}, { a: 1 })).toEqual({ a: 1 });
    });

    it('B18 serializeItem() with `expected` wraps values', () => {
        const out = Serializer.serializeItem(
            { _modelDatatypes: {} },
            { e: { Exists: false }, a: 'v' },
            { expected: true },
        );
        expect(out).toEqual({ e: { Exists: false }, a: { Value: 'v' } });
    });

    it('B18 serializeItemForUpdate() maps to update actions', () => {
        const schema = { hashKey: 'id', rangeKey: 's', _modelDatatypes: { t: 'SS' } };
        const item = { id: 1, s: 2, a: null as any, b: { $add: 1 }, c: { $del: 'x' }, t: { $add: 'y' }, d: 'v' };
        expect(Serializer.serializeItemForUpdate(schema, 'PUT', item)).toEqual({
            a: { Action: 'DELETE' },
            b: { Action: 'ADD', Value: 1 },
            c: { Action: 'DELETE', Value: 'x' },
            t: { Action: 'ADD', Value: ['y'] },
            d: { Action: 'PUT', Value: 'v' },
        });
    });

    it('B18 deserializeItem() turns sets back into arrays', () => {
        expect(Serializer.deserializeItem(null)).toBeNull();
        const item = { a: { b: [1, { c: new FakeSet(['x']) }] }, s: new FakeSet([1, 2]), n: 1 };
        expect(Serializer.deserializeItem(item)).toEqual({ a: { b: [1, { c: ['x'] }] }, s: [1, 2], n: 1 });
        expect(Serializer.deserializeItem([new FakeSet(['z']), 'q'])).toEqual([['z'], 'q']);
    });
});
