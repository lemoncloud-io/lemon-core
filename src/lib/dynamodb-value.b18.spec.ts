/**
 * `dynamodb-value.b18.spec.ts`
 * - v5 B18-a: offline unit tests for the ddb ⇄ js value converters.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-a coverage)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import { toDDB, toJavascript } from './dynamodb-value';

describe('lib/dynamodb-value (B18)', () => {
    it('B18 toJavascript() converts each ddb type', () => {
        const ddb = {
            s: { S: 'x' },
            n: { N: '1.5' },
            z: { NULL: true },
            f: { NULL: false },
            b: { BOOL: true },
            m: { M: { e: { BOOL: false }, k: { S: 'v' } } },
            l: { L: [{ N: '2' }, { S: 'y' }, { L: [{ NULL: true }] }] },
            ss: { SS: ['a', 'b'] },
        };
        expect(toJavascript(ddb)).toEqual({
            s: 'x',
            n: 1.5,
            z: null,
            f: false,
            b: true,
            m: { e: false, k: 'v' },
            l: [2, 'y', [null]],
            ss: ['a', 'b'],
        });
    });

    it('B18 toJavascript() merges into the given object, and needs a type', () => {
        const into = { old: 1 };
        expect(toJavascript({ a: { S: 'x' } }, into)).toBe(into);
        expect(into).toEqual({ old: 1, a: 'x' });
        expect(() => toJavascript({ a: {} })).toThrow('missing type for [object Object]');
    });

    it('B18 toDDB() converts each js type', () => {
        expect(
            toDDB({ s: 'x', n: 2, b: false, l: [1, 'a', [true]], m: { k: 'v', o: { p: 3 } }, u: undefined }),
        ).toEqual({
            s: { S: 'x' },
            n: { N: '2' },
            b: { BOOL: false },
            l: { L: [{ N: '1' }, { S: 'a' }, { L: [{ BOOL: true }] }] },
            m: { M: { k: { S: 'v' }, o: { M: { p: { N: '3' } } } } },
            u: undefined,
        });
        const into = { old: { S: 'o' } };
        expect(toDDB({ a: 1 }, into)).toBe(into);
        expect(into).toEqual({ old: { S: 'o' }, a: { N: '1' } });
    });

    it('B18 toDDB() and toJavascript() round-trip', () => {
        const js = { id: 'a', n: 3, ok: true, tags: ['x', 'y'], meta: { depth: { v: 1 } } };
        expect(toJavascript(toDDB(js))).toEqual(js);
    });
});
