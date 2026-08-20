/**
 * `transformer.spec.ts`
 * - `transformer` test
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-06-21 optimized w/ `abstract-services`
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $T, parsePaginateParam } from './commons';

export const describe = (globalThis as any).describe;
export const expect = (globalThis as any).expect;
export const it = (globalThis as any).it;
export const beforeEach = (globalThis as any).beforeEach;

// Keep test runner access indirect. This module is exported from the public package API,
// so importing Vitest here would leak a devDependency into runtime consumers.
const $expect = (): any => (globalThis as any)?.expect ?? expect;
const $it = (): any => (globalThis as any)?.it || it;

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

const $LUT = {
    /**
     * Possible type of language.
     */
    Languages: {
        '': null as any,
        ko: 'Korean',
        en: 'English',
    } as { [key: string]: string },
};

//* main test body.
describe('commons', () => {
    //* test expect2()
    it('should pass expect2 helper', async () => {
        expect2(() => {
            throw new Error('HI Error');
        }).toEqual('HI Error');
        expect2(
            await (async () => {
                throw new Error('HI Error');
            })().catch(GETERR),
        ).toEqual('HI Error');
        expect2(() => ({ i: 1, n: 'hi' }), 'n').toEqual({ n: 'hi' });
        expect2(() => ({ i: 1, n: 'hi' }), '!i').toEqual({ n: 'hi' });
        expect2(() => [{ i: 1, n: 'hi', j: 2 }], 'i,n').toEqual([{ i: 1, n: 'hi' }]);
        expect2(() => 'hello me!', 'n').toEqual('hello me!');
        expect2(() => ['A', 'B'], 'n').toEqual(['A', 'B']);
        expect2(null, 'a').toBe(null);
        expect2(undefined, 'a').toBe(undefined);
    });

    it('should pass asLut', async () => {
        expect2(() => $T.asLut('some', $LUT.Languages, 'lang')).toEqual('.lang[some] is invalid key - asLut(lang)');
        expect2(() => $T.asLut('ko', $LUT.Languages, 'lang')).toEqual('ko');
        expect2(() => $T.asLut('en', $LUT.Languages, 'lang')).toEqual('en');
        expect2(() => $T.asLut('Korean', $LUT.Languages, 'lang')).toEqual('ko');
        expect2(() => $T.asLut(null as any, $LUT.Languages, 'lang')).toEqual(null);
        expect2(() => $T.asLut(null as any, $LUT.Languages, { default: 'some' })).toEqual('some');
        expect2(() => $T.asLut(undefined as any, $LUT.Languages, 'lang')).toEqual(undefined);
        expect2(() => $T.asLut(undefined as any, $LUT.Languages, { default: 'some' })).toEqual(undefined);
        expect2(() => $T.asLut('', $LUT.Languages, 'lang')).toEqual('');
    });

    _it('should pass parsePaginateParam', async () => {
        expect2(() => parsePaginateParam()).toEqual({ limit: 10, page: 0 });
        expect2(() => parsePaginateParam({ limit: 0 })).toEqual({ limit: 0, page: 0 });
        expect2(() => parsePaginateParam({ limit: -1 })).toEqual({ limit: 2000, page: 0 });
        expect2(() => parsePaginateParam({ limit: -1 }, { noLimit: true })).toEqual({ limit: 2000, page: 0 });
        expect2(() => parsePaginateParam({ limit: 1 }, { noLimit: true })).toEqual({ limit: 2000, page: 0 });
        expect2(() => parsePaginateParam({ limit: -1 }, { noLimit: false })).toEqual({ limit: -1, page: 0 });
        expect2(() => parsePaginateParam({ limit: 1 }, { noLimit: false })).toEqual({ limit: 1, page: 0 });

        expect2(() => parsePaginateParam({ page: -1 })).toEqual({ limit: 10, page: -1 });
        expect2(() => parsePaginateParam({ page: 1, sort: 'a' })).toEqual({ limit: 10, page: 1, sort: 'a' });
        expect2(() => parsePaginateParam({ offset: '2' } as any)).toEqual({ limit: 10, page: 0, offset: 2 });
        expect2(() => parsePaginateParam({ offset: '2' } as any, { limit: 4 })).toEqual({
            limit: 4,
            page: 0,
            offset: 2,
        });
    });

    it('should pass $T.US', async () => {
        expect2(() => $T.US(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
        expect2(() => $T.US(['a', 'a', 'a'])).toEqual(['a']);
        expect2(() => $T.US(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
        expect2(() => $T.US([])).toEqual([]);
        expect2(() => $T.US(null as any)).toEqual([]);
        expect2(() => $T.US(undefined as any)).toEqual([]);
        expect2(() => $T.US(['', 'a', '', 'b'])).toEqual(['', 'a', 'b']);
    });
});
