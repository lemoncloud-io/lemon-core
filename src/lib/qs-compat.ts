/**
 * `qs-compat.ts`
 * - internal query-string helper on `qs`, which keeps the observable behavior of `query-string` 7 (v4 ~ 5.0.3).
 * - used by `$U.qs` (`engine/utilities.ts`), `$protocol()`·`createSigV4Proxy()` (`helpers/helpers.ts`) and `createHttpWebProxy()` (`cores/api/api-service.ts`).
 * - NOTE: internal only. do not export from `lib/index.ts` or any other barrel.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 initial version (v5 B11: `query-string` -> `qs`)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import qs from 'qs';

//* v5 B11: decode one `%XX` run as UTF-8 bytes — an invalid byte becomes U+FFFD (non-fatal TextDecoder), linear time.
const UTF8 = new TextDecoder('utf-8'); // fatal: false
const decodeRun = (run: string): string => UTF8.decode(Buffer.from(run.replace(/%/g, ''), 'hex'));

//* v5 B11: decoder like `query-string` 7 — `+` as space; on a malformed text each `%XX` run is decoded by `decodeRun()` (`qs` keeps the whole raw text).
const decodeText = (text: string): string => {
    const str = text.replace(/\+/g, ' ');
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str.replace(/(?:%[0-9a-f]{2})+/gi, decodeRun);
    }
};

//* v5 B11: parse options — flat keys (`a[b]` as is), `null` for a missing `=`, null prototype, no count limits (as `query-string` 7).
const PARSE_OPTIONS: qs.IParseOptions = {
    depth: 0,
    strictNullHandling: true,
    plainObjects: true,
    parameterLimit: Infinity,
    arrayLimit: Infinity,
    decoder: (text: string) => decodeText(text),
};

//* v5 B11: stringify options — `a=1&a=2` arrays, `a` for `null`, keys in the default `.sort()` order, `!'()*` as %XX.
const STRINGIFY_OPTIONS: qs.IStringifyOptions = {
    arrayFormat: 'repeat',
    strictNullHandling: true,
    sort: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    format: 'RFC3986',
};

//* v5 B11: a value as text like `query-string` 7 did (`String(value)`), so `qs` neither nests an object nor ISO-formats a date.
const asText = (value: any): any =>
    value === null || value === undefined || typeof value === 'string' ? value : String(value);

/**
 * parse a query-string (raw values: strings, `null` and arrays of them).
 * - a leading `?`, `#` or `&` is removed, and the result has sorted keys (`query-string` 7 contract).
 */
export const qsParse = (query: any): { [key: string]: any } => {
    //* v5 B11: the result object has no prototype (as `query-string` 7).
    const ret: { [key: string]: any } = Object.create(null);
    if (typeof query !== 'string') return ret;
    //* v5 B11: trim, then drop one leading `?`, `#` or `&`.
    const text = query.trim().replace(/^[?#&]/, '');
    if (!text) return ret;
    const parsed: { [key: string]: any } = qs.parse(text, PARSE_OPTIONS);
    //* v5 B11: copy in the sorted key order.
    return Object.keys(parsed)
        .sort()
        .reduce((acc, key) => {
            acc[key] = parsed[key];
            return acc;
        }, ret);
};

/**
 * stringify an object as query-string (`undefined` values are skipped).
 */
export const qsStringify = (object: any): string => {
    //* v5 B11: `null`/`undefined`/empty input -> ''.
    if (!object) return '';
    //* v5 B11: scalar values as text (array items too), in a null-prototype copy so a `__proto__` key stays a key.
    const copy: { [key: string]: any } = Object.create(null);
    Object.keys(object).forEach(key => {
        const value = object[key];
        copy[key] = Array.isArray(value) ? value.map(asText) : asText(value);
    });
    return qs.stringify(copy, STRINGIFY_OPTIONS);
};
