/**
 * `safe-json.spec.ts`
 * - unit test for `safeStringify()` (v5 B10-2)
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 initial version
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import { safeStringify } from './safe-json';

// build a circular http-response like object: `r.req.res === r`.
const circular = (): any => {
    const r: any = { statusMessage: 'Bad Gateway', statusCode: 502 };
    r.req = { method: 'GET', res: r };
    return r;
};

describe('safeStringify()', () => {
    //* regression: same text as `JSON.stringify()` for plain values.
    it('should be same as JSON.stringify() for plain values', () => {
        const date = new Date('2026-10-29T01:02:03.004Z');
        const samples: any[] = [
            { b: 1, a: 'x', c: true },
            { a: { b: { c: [1, 2, { d: 'e' }] } }, z: [] },
            [1, 'two', null, { three: 3 }, [4]],
            { n: null, s: '', z: 0, f: false },
            { at: date, list: [date] },
            { u: undefined, fn: () => 1, keep: 1, arr: [undefined, () => 2] },
            { j: { toJSON: () => ({ x: 1 }) } },
            'text',
            123,
            null,
            true,
        ];
        samples.forEach(v => expect(safeStringify(v)).toBe(JSON.stringify(v)));
        // space argument as well.
        expect(safeStringify(samples[1], 2)).toBe(JSON.stringify(samples[1], null, 2));
    });

    //* a shared (non-circular) reference is printed as is.
    it('should keep a shared but non-circular reference', () => {
        const shared = { id: 1 };
        const v = { a: shared, b: shared, list: [shared, shared] };
        expect(safeStringify(v)).toBe(JSON.stringify(v));
    });

    //* circular structure becomes `[Circular]`.
    it('should replace a circular reference with [Circular]', () => {
        const r = circular();
        expect(() => JSON.stringify(r)).toThrow(/circular/i);
        expect(safeStringify(r)).toBe(
            '{"statusMessage":"Bad Gateway","statusCode":502,"req":{"method":"GET","res":"[Circular]"}}',
        );
        // self reference, and a circular array.
        const s: any = { a: 1 };
        s.self = s;
        expect(safeStringify(s)).toBe('{"a":1,"self":"[Circular]"}');
        const arr: any[] = [1];
        arr.push(arr);
        expect(safeStringify(arr)).toBe('[1,"[Circular]"]');
    });

    //* `Error` keeps name/message/stack and nested `errors`·`cause`.
    it('should expand Error with errors and cause', () => {
        expect(JSON.stringify(new Error('x'))).toBe('{}'); // the original loss.
        const e: any = new Error('outer');
        e.errors = [circular()];
        const o1 = JSON.parse(safeStringify(e));
        expect(o1.name).toBe('Error');
        expect(o1.message).toBe('outer');
        expect(typeof o1.stack).toBe('string');
        expect(o1.errors).toEqual([
            { statusMessage: 'Bad Gateway', statusCode: 502, req: { method: 'GET', res: '[Circular]' } },
        ]);

        // non-enumerable `cause` (es2022 option) with a circular object.
        const e2 = new (Error as any)('wrapped', { cause: circular() });
        const o2 = JSON.parse(safeStringify(e2));
        expect(o2.message).toBe('wrapped');
        expect(o2.cause.statusMessage).toBe('Bad Gateway');
        expect(o2.cause.req.res).toBe('[Circular]');

        // AggregateError (non-enumerable `errors`), and an Error pointing back to itself.
        const e3: any = new AggregateError([new Error('child')], 'agg');
        e3.self = e3;
        const o3 = JSON.parse(safeStringify(e3));
        expect(o3.name).toBe('AggregateError');
        expect(o3.errors[0].message).toBe('child');
        expect(o3.self).toBe('[Circular]');

        // an Error inside a plain object.
        const o4 = JSON.parse(safeStringify({ err: new TypeError('bad') }));
        expect(o4.err.name).toBe('TypeError');
        expect(o4.err.message).toBe('bad');
    });

    //* BigInt is printed as a string.
    it('should print BigInt as a string', () => {
        expect(safeStringify({ n: BigInt(10) ** BigInt(20) })).toBe('{"n":"100000000000000000000"}');
        expect(safeStringify(BigInt(7))).toBe('"7"');
    });

    //* never throws: falls back to `String(value)`.
    it('should never throw', () => {
        const bad = {
            get boom() {
                throw new Error('getter');
            },
        };
        expect(safeStringify(bad)).toBe('[object Object]');
        expect(safeStringify({ toJSON: () => (undefined as any).x })).toBe('[object Object]');
        expect(safeStringify(Object.create(null))).toBe('{}');
        const nul = Object.create(null);
        nul.toJSON = () => {
            throw new Error('x');
        };
        expect(safeStringify(nul)).toBe('[Unserializable]');
        expect(safeStringify(undefined)).toBe('undefined');
    });
});
