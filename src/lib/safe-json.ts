/**
 * `safe-json.ts`
 * - internal `JSON.stringify()` for error reports, which never throws.
 * - a back-reference to an ancestor (circular structure) becomes `'[Circular]'`.
 * - an `Error` instance is expanded to `{ name, message, stack?, ...own props, errors?, cause? }` (plain `JSON.stringify()` gives `{}`).
 * - a `BigInt` becomes its decimal string.
 * - otherwise the output is the same as `JSON.stringify()` (key order, `toJSON()`, omitted `undefined`/function values).
 * - used by `asErrorPayload()`·`GETERR()` (`common/test-helper.ts`), `doReportError()`·`do_parallel()` (`engine/engine.ts`) and `AWSSNSService.publish()`.
 * - NOTE: internal only. do not export from `lib/index.ts` or any other barrel.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 initial version (v5 B10-2: circular structure in `doReportError()`)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

//* v5 B10-2: one entry of the ancestor stack — `holder` is the object `JSON.stringify()` walks into, `origin` is the value before expansion.
interface Ancestor {
    holder: object;
    origin: object;
}

//* v5 B10-2: expand an `Error` to a plain object, so that `name`·`message`·`stack` and non-enumerable `errors`·`cause` are kept.
const expandError = (e: Error): Record<string, unknown> => {
    const out: Record<string, unknown> = { name: e.name, message: e.message };
    if (e.stack !== undefined) out.stack = e.stack;
    // own enumerable props (e.g. `code`, `statusCode`, `errors` set by assignment).
    for (const key of Object.keys(e)) out[key] = (e as any)[key];
    // `AggregateError.errors` and `new Error(m, { cause })` are own but non-enumerable.
    if (!('errors' in out) && (e as any).errors !== undefined) out.errors = (e as any).errors;
    if (!('cause' in out) && (e as any).cause !== undefined) out.cause = (e as any).cause;
    return out;
};

//* v5 B10-2: build a replacer, which tracks only the ancestors (a shared but non-circular reference is printed as is).
const circularReplacer = () => {
    const stack: Ancestor[] = [];
    return function (this: object, _key: string, value: unknown): unknown {
        if (typeof value === 'bigint') return value.toString();
        if (value === null || typeof value !== 'object') return value;
        // drop the finished siblings: the top of the stack must be the current holder.
        while (stack.length > 0 && stack[stack.length - 1].holder !== this) stack.pop();
        if (stack.some(a => a.origin === value)) return '[Circular]';
        const holder = value instanceof Error ? expandError(value) : value;
        stack.push({ holder, origin: value });
        return holder;
    };
};

/**
 * `JSON.stringify()` which never throws (v5 B10-2).
 * - on any failure (e.g. a throwing getter or `toJSON()`), it falls back to `String(value)`.
 *
 * @param value     any value to print.
 * @param space     (optional) same as `JSON.stringify()`.
 */
export const safeStringify = (value: unknown, space?: string | number): string => {
    //* v5 B10-2: main path — `JSON.stringify()` with the circular-safe replacer.
    try {
        const text = JSON.stringify(value, circularReplacer(), space);
        if (typeof text === 'string') return text;
    } catch (e) {
        // fall through to the last resort.
    }
    //* v5 B10-2: last resort — `String()` may throw too (e.g. `Object.create(null)`).
    try {
        return String(value);
    } catch (e) {
        return '[Unserializable]';
    }
};
