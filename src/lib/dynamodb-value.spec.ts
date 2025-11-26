/**
 * `dynamodb-value.spec.ts`
 * - dynamodb-value helpers
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2025-11-26 initial version
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import { expect2, GETERR } from '../common/test-helper';
import { toJavascript, toDDB } from './dynamodb-value';

describe('dynamodb-value helpers', () => {
    it('should convert DDB map into javascript object and reuse merge target', () => {
        const target = { base: 'keep' };
        const js = toJavascript(
            {
                str: { S: 'hello' },
                num: { N: '3.14' },
                bool: { BOOL: false },
                nullVal: { NULL: true },
                map: { M: { nested: { S: 'value' }, num: { N: '7' } } },
                list: { L: [{ S: 'one' }, { N: '2' }, { NULL: true }, { M: { deep: { BOOL: true } } }] },
            },
            target,
        );
        expect2(() => js).toEqual({
            base: 'keep',
            str: 'hello',
            num: 3.14,
            bool: false,
            nullVal: null,
            map: { nested: 'value', num: 7 },
            list: ['one', 2, null, { deep: true }],
        });
        expect2(() => js === target).toBe(true);

        expect2(() => {
            try {
                toJavascript({ broken: {} });
                return 'NO-ERROR';
            } catch (e) {
                return GETERR(e);
            }
        }).toEqual('missing type for [object Object]');
    });

    it('should convert javascript object into DDB map', () => {
        const result = toDDB(
            {
                str: 'hello',
                num: 42,
                bool: true,
                arr: [1, 'two', { deep: false }],
                obj: { nested: 9 },
            },
            { preset: { S: 'base' } },
        );
        expect2(() => result).toEqual({
            preset: { S: 'base' },
            str: { S: 'hello' },
            num: { N: '42' },
            bool: { BOOL: true },
            arr: {
                L: [{ N: '1' }, { S: 'two' }, { M: { deep: { BOOL: false } } }],
            },
            obj: {
                M: {
                    nested: { N: '9' },
                },
            },
        });
    });

    it('should handle undefined values when converting to DDB', () => {
        const result = toDDB({ optional: undefined });
        expect2(() => Object.prototype.hasOwnProperty.call(result, 'optional')).toBe(true);
        expect2(() => result.optional).toEqual(undefined);
    });
});
