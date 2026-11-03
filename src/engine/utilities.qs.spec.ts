/**
 * `engine/utilities.qs.spec.ts`
 * - golden test of the query-string behavior (v5 B11: `query-string` 7 -> `qs`).
 * - every expected value below is the output of the former `query-string` 7 code, recorded before the change.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-29 initial version (v5 B11)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Utilities } from './utilities';
import * as $builder from './builder.spec';
import $cores from '../cores/';
import { $protocol, createSigV4Proxy } from '../helpers/helpers';
import { createHttpWebProxy } from '../cores/api/api-service';

//* v5 B11: a new `$U` for each case.
const instance = () => {
    const { $engine } = $builder.instance();
    const $U = new Utilities($engine);
    return { $U };
};

//* v5 B11: strict encoding of query-string 7 (`encodeURIComponent` + `!'()*` as %XX).
const strict = (s: string) =>
    encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

//* v5 B11: stub the global `fetch`, and keep the requested urls.
const stubFetch = () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ ok: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    });
    return urls;
};

//! main test body.
describe('engine/utilities.qs (golden)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    //* `$U.qs.parse()` — [input, expected, expected key order].
    const parseCases: [any, any, string[]][] = [
        ['a=1&b=2', { a: 1, b: 2 }, ['a', 'b']],
        ['b=x&a=1&a=2', { a: ['1', '2'], b: 'x' }, ['a', 'b']],
        ['?a=1&b', { a: 1, b: '' }, ['a', 'b']],
        ['#a=1&c', { a: 1, c: '' }, ['a', 'c']],
        ['&a=1', { a: 1 }, ['a']],
        ['  a=1  ', { a: 1 }, ['a']],
        ['a=hello+world&b=%2B&c+d=1', { a: 'hello world', b: '+', 'c d': 1 }, ['a', 'b', 'c d']],
        ['q=%ED%95%9C%EA%B8%80&s=a%26b%3Dc&sp=a%20b', { q: '한글', s: 'a&b=c', sp: 'a b' }, ['q', 's', 'sp']],
        ['a[]=1&a[]=2&b[0]=x&c[d]=y', { 'a[]': ['1', '2'], 'b[0]': 'x', 'c[d]': 'y' }, ['a[]', 'b[0]', 'c[d]']],
        ['', {}, []],
        ['?', {}, []],
        [undefined, {}, []],
        [
            'a=&b=0&c=01&d=10&e=true&f=-1&g=1.5',
            { a: '', b: '0', c: '01', d: 10, e: 'true', f: '-1', g: '1.5' },
            ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        ],
        ['a=b=c&h=1#x', { a: 'b=c', h: '1#x' }, ['a', 'h']],
        ['&&a=1&', { a: 1 }, ['a']],
        //* v5 B11: every invalid byte becomes U+FFFD (WHATWG TextDecoder); query-string 7 kept them as '%XX' except a lone '%C2' — intentional
        ['a.b=1&x=%E0%A4%A', { 'a.b': 1, x: '\uFFFD%A' }, ['a.b', 'x']],
        ['a&a=1&a', { a: [null, '1', null] }, ['a']],
        ['x=%41%ZZ', { x: 'A%ZZ' }, ['x']],
        ['q=%ED%95%9C%20100%&k%ED%95%9C%ZZ=1', { q: '한 100%', 'k한%ZZ': 1 }, ['k한%ZZ', 'q']],
        //* v5 B11: every invalid byte becomes U+FFFD (WHATWG TextDecoder); query-string 7 kept them as '%XX' except a lone '%C2' — intentional
        ['x=%E0%A4%A%41&y=%FF%41%ED%95%9C', { x: '\uFFFD%AA', y: '\uFFFDA한' }, ['x', 'y']],
        ['x=%C2', { x: '\uFFFD' }, ['x']],
        //* v5 B11: compared with query-string 7.1.3 once (2026-10-29).
        ['x=a%C2b%20c', { x: 'a\uFFFDb c' }, ['x']],
        //* v5 B11: qs drops a '__proto__' key (prototype-pollution guard), 'constructor'·'hasOwnProperty' stay — intentional change from query-string 7
        [
            'constructor=y&hasOwnProperty=z&__proto__=x',
            { constructor: 'y', hasOwnProperty: 'z' },
            ['constructor', 'hasOwnProperty'],
        ],
    ];

    //* `$U.qs.parse()` — value, key order and the null prototype (one case per test).
    it.each(parseCases)('$U.qs.parse(%j) keeps the query-string 7 output', (input, expected, keys) => {
        const { $U } = instance();
        const res = $U.qs.parse(input);
        expect({ ...res }).toEqual({ ...expected });
        expect(Object.keys(res)).toEqual(keys);
        expect(Object.getPrototypeOf(res)).toEqual(null);
    });

    //* `$U.qs.parse()` — no limit of the parameter count, and of the array length.
    it('$U.qs.parse() has no count limits', () => {
        const { $U } = instance();
        //* no limit of the parameter count, and of the array length.
        expect(
            Object.keys(
                $U.qs.parse(
                    new Array(1500)
                        .fill(0)
                        .map((_, i) => `p${i}=${i}`)
                        .join('&'),
                ),
            ).length,
        ).toEqual(1500);
        expect(
            $U.qs.parse(
                new Array(25)
                    .fill(0)
                    .map((_, i) => `k=${i}`)
                    .join('&'),
            ).k.length,
        ).toEqual(25);
    });

    //* `$U.qs.stringify()` — [input, expected].
    const date = new Date(Date.UTC(2026, 9, 29, 1, 2, 3));
    const stringifyCases: [any, string][] = [
        [{ b: 2, a: 1 }, 'a=1&b=2'],
        [{ a: [1, 2], b: 'x' }, 'a=1&a=2&b=x'],
        [{ a: null, b: undefined, c: '' }, 'a&c='],
        [{}, ''],
        [null, ''],
        [undefined, ''],
        [
            { s: 'a b', k: '한글', x: "!'()*", amp: 'a&b=c', u: '~-._', p: '+' },
            'amp=a%26b%3Dc&k=%ED%95%9C%EA%B8%80&p=%2B&s=a%20b&u=~-._&x=%21%27%28%29%2A',
        ],
        [{ 'a[b]': 1, 'a[]': 2, 'a b': 3, 'k&=': 4 }, 'a%20b=3&a%5B%5D=2&a%5Bb%5D=1&k%26%3D=4'],
        [{ n: 0, t: true, f: false, m: -1.5 }, 'f=false&m=-1.5&n=0&t=true'],
        [{ o: { x: 1 } }, 'o=%5Bobject%20Object%5D'],
        [{ B: 1, a: 1, _: 1, '10': 1, '2': 1, Z: 1, b: 1 }, '10=1&2=1&B=1&Z=1&_=1&a=1&b=1'],
        [{ a: [] }, ''],
        [{ a: [null, undefined, 'x', ''] }, 'a&a=x&a='],
        [{ d: date }, `d=${strict(String(date))}`],
        [{ a: [[1, 2], { y: 1 }] }, 'a=1%2C2&a=%5Bobject%20Object%5D'],
    ];

    //* `$U.qs.stringify()` — sorted keys, repeat arrays, strict encoding (one case per test).
    it.each(stringifyCases)('$U.qs.stringify(%j) keeps the query-string 7 output', (input, expected) => {
        const { $U } = instance();
        expect($U.qs.stringify(input)).toEqual(expected);
    });

    //* `helpers.ts` `$protocol().notify()` — callback query (raw parse, no number/empty conversion).
    it('$protocol() callback keeps the query-string 7 parse', async () => {
        const $proto: any = $cores.protocol.service;
        const notify = vi.spyOn($proto, 'notify').mockResolvedValue('ok' as any);
        await $protocol({}, '//lemon-hello-api/hello/0').notify({}, {}, 'POST', 'hello/1/cmd?c=2&b&a=1&c=3');
        await $protocol({}, '//lemon-hello-api/hello/0').notify({}, {}, 'POST', 'hello/1/cmd');
        const callbacks = notify.mock.calls.map(c => c[1] as any);
        expect(callbacks.map(c => ({ ...c, param: { ...c.param } }))).toEqual([
            { type: 'hello', id: '1', cmd: 'cmd', param: { a: '1', b: null, c: ['2', '3'] } },
            { type: 'hello', id: '1', cmd: 'cmd', param: {} },
        ]);
        expect(Object.keys(callbacks[0].param)).toEqual(['a', 'b', 'c']);
    });

    //* `helpers.ts` `createSigV4Proxy().doProxy()` — query string of the url.
    it('createSigV4Proxy() keeps the query-string 7 stringify', async () => {
        const urls = stubFetch();
        await createSigV4Proxy('golden', 'https://api.example.test').doProxy('GET', 'a', 'b', {
            z: 'a b',
            a: [1, null],
            u: undefined,
        });
        expect(urls).toEqual(['https://api.example.test/a/b?a=1&a&z=a%20b']);
    });

    //* `api-service.ts` `createHttpWebProxy().doProxy()` — query string of the url.
    it('createHttpWebProxy() keeps the query-string 7 stringify', async () => {
        const urls = stubFetch();
        await createHttpWebProxy('golden', 'https://api.example.test').doProxy('GET', 'a', 'b', {
            z: "it's",
            a: [2, 1],
            n: null,
        });
        expect(urls).toEqual(['https://api.example.test/a/b?a=2&a=1&n&z=it%27s']);
    });
});
