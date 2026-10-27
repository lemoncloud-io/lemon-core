/**
 * `lang.ts`
 * - small language helpers that replace the `lodash` functions used by the dynamo tools.
 * - NOTE: internal only (not exported from any barrel).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version (v5 B2-a: drop `lodash`)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

/** true only for `{}`-like objects: the prototype is `Object.prototype` or `null` (rejects Set, typed arrays, class instances) */
export const isPlainObject = (value: any): boolean => {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/** true for objects and functions (same as lodash `isObject`) */
export const isObject = (value: any): boolean =>
    value !== null && value !== undefined && (typeof value === 'object' || typeof value === 'function');

/** true for `null`/`undefined`, an empty string or array, an empty Map/Set, an object with no own keys, and any other primitive */
export const isEmpty = (value: any): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
    if (value instanceof Map || value instanceof Set) return value.size === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return true;
};

/** copy each source onto the target: `undefined` sources and values are skipped, plain objects and arrays are deep-copied, anything else by reference */
export const merge = <T = any>(target: any, ...sources: any[]): T => {
    sources.forEach(source => {
        // skip missing sources (ex: an absent `ExpressionAttributeNames`).
        if (source === null || source === undefined) return;
        Object.keys(source).forEach(key => {
            const val = source[key];
            if (val === undefined) return;
            // plain object: merge into the existing plain object, or into a new one.
            if (isPlainObject(val)) target[key] = merge(isPlainObject(target[key]) ? target[key] : {}, val);
            // array: merge by index into the existing array, or into a new one.
            else if (Array.isArray(val)) target[key] = merge(Array.isArray(target[key]) ? target[key] : [], val);
            // anything else (primitives, Date, Set, Buffer, class instances): by reference.
            else target[key] = val;
        });
    });
    return target as T;
};

/** map the own values of an object into a new object with the same keys */
export const mapValues = <T = any, U = any>(
    obj: { [key: string]: T },
    fn: (value: T, key: string) => U,
): { [key: string]: U } =>
    Object.entries(obj ?? {}).reduce((result: { [key: string]: U }, [key, value]) => {
        result[key] = fn(value, key);
        return result;
    }, {});

/** copy the own entries of an object, dropping those that match the predicate */
export const omitBy = <T = any>(
    obj: { [key: string]: T },
    predicate: (value: T, key: string) => boolean,
): { [key: string]: T } =>
    Object.entries(obj ?? {}).reduce((result: { [key: string]: T }, [key, value]) => {
        if (!predicate(value, key)) result[key] = value;
        return result;
    }, {});
