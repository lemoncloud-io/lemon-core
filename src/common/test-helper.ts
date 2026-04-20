/**
 * `common/test-helper.ts`
 * - helper functions for test
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-10-16 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */

// Keep test runner access indirect. This module is exported from the public package API,
// so importing Vitest here would leak a devDependency into runtime consumers.
const $expect = (): any => (globalThis as any).expect;
const $it = (): any => (globalThis as any).it;

/**
 * catch error as string
 *
 * ```js
 * const a = sync () => throw new Error('ERROR');
 * expect(await a().catch(GETERR)).toEqual('ERROR');
 * ```
 * @param e
 */
export const GETERR = (e: any): string => {
    if (e instanceof Error) {
        const errors = Array.isArray((e as any).errors) ? ((e as any).errors as any[]).map(GETERR) : [];
        return [`${e.message}`, ...errors].filter(_ => _).join('\n');
    }
    return e && typeof e == 'object' ? JSON.stringify(e) : `${e}`;
};

/**
 * catch error as { error: string }
 *
 * ```js
 * const a = sync () => throw new Error('ERROR');
 * expect(await a().catch(GETERR$)).toEqual({ error:'ERROR' })
 * ```
 * @param e
 */
export const GETERR$ = (e: any) => ({ error: GETERR(e) });

/**
 * return null if 404 not found.
 * @param e error
 */
export const NUL404 = (e: Error) => {
    if (`${e.message}`.startsWith('404 NOT FOUND')) return null as any;
    throw e;
};

/** returns only defined */
export const onlyDefined = <T extends object>(N: T, $def: T = null): T =>
    N && typeof N === 'object'
        ? Object.entries(N).reduce<T>((N, [k, v]) => {
              if (v !== undefined) N[k as keyof T] = v;
              return N;
          }, {} as T)
        : ($def as T);

/**
 * improve expect() function with projection field.
 *
 * @param test      function or data.
 * @param view      projection attributes.
 */
export const expect2 = (test: any, view?: string): any => {
    const project = (data: any): any => {
        if (!view) return data;
        if (data === null || data === undefined) return data;
        if (typeof data != 'object') return data;
        if (Array.isArray(data)) {
            return (data as any[]).map(project);
        }
        const views = view.split(',');
        const excludes = views.filter(_ => _.startsWith('!')).map(_ => _.substring(1));
        const includes = views.filter(_ => !_.startsWith('!')).map(_ => _.substring(0));
        const V = excludes.reduce((N: any, key) => {
            delete N[key];
            return N;
        }, data);
        if (includes.length < 1) return V; // if no includes.
        return includes.reduce((N: any, key) => {
            N[key] = V[key];
            return N;
        }, {});
    };
    try {
        const ret = typeof test == 'function' ? test() : test;
        if (ret instanceof Promise) {
            return $expect()(ret.then(project).catch(GETERR)).resolves;
        } else {
            return $expect()(project(ret));
        }
    } catch (e) {
        return $expect()(GETERR(e));
    }
};

/**
 * ignore of `it()`
 *
 * @param name
 * @param callback
 */
export const _it = (name: string, callback?: (done?: any) => any) => {
    $it()(`ignore! ${name}`, (): void => undefined);
};

/**
 * use `target` as value or environment value.
 * environ('PROFILE', 'none') => use env.PROFILE if exist, or 'none'
 */
export const environ = (envName: string, envValue?: string) => {
    const $env = process.env;
    const val = $env[envName] !== undefined ? $env[envName] : envValue;
    return `${val || ''}`;
};

/**
 * filter function()
 */
export interface Filter<T> {
    (name: string, val: any, thiz?: any, attr?: string | number): T;
}

/**
 * marshaler: convert object to dotted list.
 *
 * @param obj   json object
 * @param name  current name
 * @param list  result list
 * @param filter filter function.
 */
export const marshal = <T>(
    obj: any,
    filter: Filter<T>,
    name: string = '',
    list: T[] = [],
    thiz?: any,
    attr?: string | number,
): T[] => {
    if (!filter) throw new Error('filter is required!');
    thiz = thiz === undefined ? obj : thiz;
    if (obj && typeof obj == 'object') {
        if (!Array.isArray(obj)) {
            return Object.keys(obj).reduce((L: T[], key: string) => {
                const val = obj[key];
                return marshal(val, filter, name ? `${name}.${key}` : `${key}`, L, obj, key);
            }, list);
        } else {
            return obj.reduce((L: T[], val: any, index: number) => {
                return marshal(val, filter, name ? `${name}.${index}` : `${index}`, L, obj, index);
            }, list);
        }
    } else {
        const line = filter(name, obj, thiz, attr);
        if (line !== undefined && line !== null) list.push(line);
    }
    return list;
};

/**
 * wait for some time (in msec).
 *
 * ```js
 * await waited();
 * ``
 * @param t msec
 */
export const waited = async (t: number = 200) =>
    new Promise(resolve => {
        setTimeout(() => {
            resolve(undefined);
        }, t);
    });

/**
 * error payload type
 */
type ErrorPayload = { 'stack-trace'?: any; message: string; error: string; errors?: any[] };

/**
 * convert Error to payload.
 */
export const asErrorPayload = (e: any, data?: string | object): ErrorPayload => {
    const _msg = (e: any): string => {
        const m = (e && (e.message || e.statusMessage)) || e;
        return typeof m == 'object' ? JSON.stringify(m) : `${m}`;
    };
    const _pack = (e: any, depth = 0): { error: string; stack?: string; errors?: any[] } => {
        if (e === undefined || e === null) return { error: e };
        const stack = e instanceof Error ? e?.stack : undefined;
        const error =
            e === undefined || e === null
                ? e
                : typeof e == 'string'
                ? e
                : e instanceof Error
                ? `${e.message}`
                : JSON.stringify(e);

        // make sure of no infinite recursion.
        if (depth > 5) return { stack, error };

        // check nested errors.
        const errors = e?.errors || e?.body?.errors || (e as any)?.cause;
        if (errors && typeof errors == 'object') {
            if (Array.isArray(errors)) {
                const errs = errors.map((ee: any) => _pack(ee, depth + 1));
                return { stack, error, errors: errs };
            }
            const errs = _pack(errors, depth + 1);
            return { stack, error, errors: [errs] };
        } else if (errors === undefined || errors === null) {
            return { stack, error };
        }

        // no nested errors.
        return { stack, error, errors: [errors] };
    };

    //* prepare payload
    const $base = data && typeof data == 'object' ? data : {};
    const message = data && typeof data == 'string' ? data : _msg(e);
    const E = _pack(e);
    const payload: ErrorPayload = Object.assign(
        $base,
        onlyDefined({
            'stack-trace': E?.stack,
            message,
            error: E?.error,
            errors: E?.errors,
        }),
    );

    //* returns payload for sns error
    return payload;
};
