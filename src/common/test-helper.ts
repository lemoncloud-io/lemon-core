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

/**
 * catch error as string
 *
 * ```js
 * const a = sync () => throw new Error('ERROR');
 * expect(await a().catch(GETERR)).toEqual('ERROR');
 * ```
 * @param e
 */
export const GETERR = (e: any) =>
    e instanceof Error ? `${e.message}` : e && typeof e == 'object' ? JSON.stringify(e) : `${e}`;

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
            return expect(ret.then(project).catch(GETERR)).resolves;
        } else {
            return expect(project(ret));
        }
    } catch (e) {
        return expect(GETERR(e));
    }
};

/**
 * ignore of `it()`
 *
 * @param name
 * @param callback
 */
export const _it = (name: string, callback?: (done?: any) => any) => {
    it(`ignore! ${name}`, done => done());
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
