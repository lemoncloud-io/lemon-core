/**
 * `helpers.spec.ts`
 * - test script for `utils`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-03-10 initial version
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../environ';
import { $U } from '../engine';
import { loadJsonSync } from '../tools/';
import { expect2, waited, GETERR } from '../common/test-helper';
import {
    $protocol,
    $rand,
    $T,
    getIdentityId,
    isUserAuthorized,
    my_parrallel,
    $info,
    parseRange,
    my_sequence,
    createSigV4Proxy,
    $event,
    $slack,
} from './helpers';
import $cores from '../cores/';
import request from 'request';
import * as EngineModule from '../engine';

jest.mock('request', () => jest.fn());
jest.mock('../engine', () => {
    const actual = jest.requireActual('../engine');
    return {
        ...actual,
        doReportSlack: jest.fn(),
    };
});
const requestMock = request as unknown as jest.Mock;
const coresAny = $cores as any;

//* create instance.
export const instance = async (type: 'dummy' = 'dummy') => {
    const accountId = type == 'dummy' ? '796730245826' : null;
    const identityId = type == 'dummy' ? 'ap-northeast-2:dbd95fb4-1234-2345-4567-56e5bc95e444' : null;
    const lang = 'ko';

    const $signed = loadJsonSync('data/samples/events/sample.event.web.signed.json');
    const $unsigned = loadJsonSync('data/samples/events/sample.event.web.unsigned.json');

    const signed = await $cores.lambda.web.packContext($signed, null);
    const unsigned = await $cores.lambda.web.packContext($unsigned, null);

    expect2(() => signed.identity, 'accountId,identityId,lang').toEqual({ accountId, identityId, lang });
    expect2(() => unsigned.identity, 'accountId,identityId,lang').toEqual({ accountId: null, identityId: null, lang });

    //* returns dummy data.
    return { $context: { signed, unsigned }, identityId };
};

//! main test body.
describe('utils', () => {
    const PROFILE = loadProfile(process); // override process.env.
    PROFILE && console.info(`! PROFILE =`, PROFILE);

    it('should pass basic code pattern.', () => {
        const params = [undefined, null, 0, 1, '', false, {}, [], '#', ' ', '1'];
        expect2(() => params.map(v => v ?? 'N')).toEqual(['N', 'N', 0, 1, '', false, {}, [], '#', ' ', '1']);
        expect2(() => params.map(v => v || 'N')).toEqual(['N', 'N', 'N', 1, 'N', 'N', {}, [], '#', ' ', '1']);

        expect2(() => params.map(v => $T.S(v))).toEqual([
            '',
            '',
            '0',
            '1',
            '',
            'false',
            '[object Object]',
            '',
            '#',
            '',
            '1',
        ]);
        expect2(() => params.map(v => $T.N(v))).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
    });

    //* test transformer
    it('should pass helper of $T (transformer).', async () => {
        expect2(() => $T.S(undefined)).toEqual('');
        expect2(() => $T.S(null)).toEqual('');
        expect2(() => $T.S(' a ')).toEqual('a');
        expect2(() => $T.S(' a\t\n\rb ')).toEqual('a\t\n\rb');
        expect2(() => $T.S2(' a\t\n\rb ')).toEqual('ab');
        expect2(() => $T.SS(undefined)).toEqual([]);
        expect2(() => $T.SS(' a ')).toEqual(['a']);
        expect2(() => $T.SS([' a '])).toEqual(['a']);
        expect2(() => $T.SS(42)).toEqual(['42']);
        expect2(() => $T.NN(null, [9])).toEqual([9]);
        expect2(() => $T.FF(undefined, [0.1])).toEqual([0.1]);
        expect2(() => $T.P(' a<b>b<em c=d>e</b>ㅋ ㅋ ^"}[&$%#*')).toEqual('a b e ㅋ ㅋ');

        expect2(() => $T.N('1.234')).toEqual(1);
        expect2(() => $T.NN(0.2)).toEqual([0]);
        expect2(() => $T.NN('1.234')).toEqual([1]);
        expect2(() => $T.NN('2,5,39,40,0')).toEqual([2, 5, 39, 40, 0]);
        expect2(() => $T.NN([35, '49.9', '101', 0, 1])).toEqual([35, 49, 101, 0, 1]);
        expect2(() => $T.F('1.234')).toEqual(1.234);
        expect2(() => $T.FF(0.2)).toEqual([0.2]);
        expect2(() => $T.FF('1.234')).toEqual([1.234]);
        expect2(() => $T.FF('2,5,39,40,0')).toEqual([2, 5, 39, 40, 0]);
        expect2(() => $T.FF([35, '49.9', '101', 0, 1])).toEqual([35, 49.9, 101, 0, 1]);
        expect2(() => $T.F3(1.555555)).toEqual(1.556);

        expect2(() => $T.B('0')).toEqual(0);
        expect2(() => $T.B('1')).toEqual(1);
        expect2(() => $T.B('2')).toEqual(1);
        expect2(() => $T.B(null)).toEqual(0);
        expect2(() => $T.B(true)).toEqual(1);
        expect2(() => $T.B('true')).toEqual(1);
        expect2(() => new Date().getTimezoneOffset()).toEqual(-9 * 60); //WARN! - can be different in env.
        expect2(() => $U.ts(new Date(1591282800000))).toEqual('2020-06-05 00:00:00'); // must be aware of time-zone.
        expect2(() => $T.T('2020-06-05 00:00:00')).toEqual(new Date('2020-06-05 00:00:00').getTime()); // := 1591282800000
        expect2(() => $T.T('2020-06-05')).toEqual(new Date('2020-06-05 12:00:00').getTime()); // := 1591282800000 + 12*60*60*1000
        expect2(() => $T.T('0')).toEqual(0);
        expect2(() => $T.T('9999-99-99')).toEqual('@val[9999-99-99] is invalid!');
        expect2(() => $T.T('0000-00-00')).toEqual('@val[0000-00-00] is invalid!');
        expect2(() => $T.T('2020-04-xx')).toEqual('@val[2020-04-xx] is invalid!');
        expect2(() => $T.T('2020-04-1')).toEqual('@val[2020-04-1] is invalid!');

        expect2(() => $T.D('2021-06-08')).toBe('2021-06-08');
        expect2(() => $T.D('2021-06-8')).toBe('2021-06-08');
        expect2(() => $T.D('2021-6-08')).toBe('2021-06-08');
        expect2(() => $T.D('2021-06')).toBe('2021-06');
        expect2(() => $T.D('2021-6')).toBe('2021-06');
        expect2(() => $T.D('2021')).toBe('2021');
        expect2(() => $T.D('20210608')).toBe('2021-06-08');
        expect2(() => $T.D('2021-12-32')).toBe('');
        expect2(() => $T.D('2021-13-31')).toBe('');
        expect2(() => $T.D('2021-00-01')).toBe('');
        expect2(() => $T.D('20210603')).toBe('2021-06-03');
        expect2(() => $T.D('202106')).toBe('2021-06');
        expect2(() => $T.D('1111111111')).toBe('');
        expect2(() => $T.D('100')).toBe('');
        expect2(() => $T.D('의미없다')).toBe('');
        expect2(() => $T.D(0)).toBe('');
        expect2(() => $T.DT('20210608')).toBe('2021-06-08');
        expect2(() => $T.DT('', '1999-01-02')).toBe('1999-01-02');
        expect2(() => $T.D(null)).toBe('');

        const exTextSample = 'hi, everybody. It is sample text. bye.';
        expect2(() => $T.EX(exTextSample, 'hi,', 'text')).toEqual(' everybody. It is sample ');
        expect2(() => $T.EX(exTextSample, '.', '.')).toEqual(' It is sample text');

        const samples = {
            _: 2,
            __: [2],
            한글: '5',
            'a-b': 7,
            a_b: 8,
            $ab: 9,
            i: [10, 12],
            a: 11,
            aB: 12,
            aBC: {},
            aBcD: 13,
        };
        const expected = {
            _: 2,
            a: 11,
            'a-b': 7,
            a_b: 8,
            aB: 12,
            aBcD: 13,
        };
        expect2(() => $T.simples({})).toEqual({});
        expect2(() => $T.simples(samples)).toEqual(expected);
        expect2(() => $T.simples(samples, true)).toEqual('.__[2] is invalid!');
        expect2(() => $T.simples({ ...samples, __: null }, true)).toEqual('.한글 is invalid format!');
        expect2(() => $T.simples({ ...samples, __: null, 한글: undefined }, true)).toEqual('.$ab is invalid format!');
        expect2(() => $T.simples({ ...samples, __: null, 한글: undefined, $ab: undefined }, true)).toEqual(
            '.i[10,12] is invalid!',
        );
        expect2(() =>
            $T.simples({ ...samples, __: null, 한글: undefined, $ab: undefined, i: undefined }, true),
        ).toEqual('.aBC[[object Object]] is invalid!');
        expect2(() =>
            $T.simples({ ...samples, __: null, 한글: undefined, $ab: undefined, i: undefined, aBC: undefined }, true),
        ).toEqual({ ...expected, __: null });
        expect2(() => $T.simples([1], true)).toEqual('@val[object] is invalid!');
        expect2(() => $T.simples([1])).toEqual({});
        expect2(() => $T.simples(undefined)).toEqual(undefined);
        expect2(() => $T.simples(null)).toEqual({ _: null });
        expect2(() => $T.simples('text')).toEqual({ _: 'text' });
        expect2(() => $T.simples(42)).toEqual({ _: 42 });

        expect2(() => $T.normal({ a: { a1: { a2: 'a2' } } })).toEqual({ a: { a1: { a2: 'a2' } } });
        expect2(() => $T.normal(samples)).toEqual({ ...samples, $ab: undefined, _: undefined, __: undefined });

        const objectArray = [
            { id: 'lemon', _id: 'L', price: 1000 },
            { id: 'apple', _id: 'A', price: 500 },
            { id: 'banana', _id: 'B', price: 2000 },
        ];
        expect2(() => $T.asMap(objectArray)).toEqual({
            lemon: objectArray[0],
            apple: objectArray[1],
            banana: objectArray[2],
        });
        expect2(() => $T.asMap(objectArray, '_id')).toEqual({
            L: objectArray[0],
            A: objectArray[1],
            B: objectArray[2],
        });

        expect2(() => $T.catch('abcdefg', 'a', 'c')).toEqual('b');
        expect2(() => $T.template('인증 번호는 [{code}] 입니다.', { code: 1234 })).toEqual(
            '인증 번호는 [1234] 입니다.',
        );
    });

    //* test diff()
    it('should pass $T.diff()', () => {
        expect2(() => $T.diff(null, null)).toEqual(null);
        expect2(() => $T.diff(null, 1)).toEqual(1);
        expect2(() => $T.diff(null, 'A')).toEqual('A');
        expect2(() => $T.diff(null, {})).toEqual({});
        expect2(() => $T.diff(null, [])).toEqual([]);
        expect2(() => $T.diff(1, 2)).toEqual(2);

        expect2(() => $T.diff(1, null)).toEqual(null);
        expect2(() => $T.diff('A', null)).toEqual(null);
        expect2(() => $T.diff({}, null)).toEqual(null);
        expect2(() => $T.diff([], null)).toEqual(null);

        expect2(() => $T.diff({}, {})).toEqual({});
        expect2(() => $T.diff({ a: 1 }, {})).toEqual({ a: null });
        expect2(() => $T.diff({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
        expect2(() => $T.diff({ a: null }, { a: 0 })).toEqual({ a: 0 });
        expect2(() => $T.diff({ a: 0 }, { a: null })).toEqual({ a: null });

        // test with inner-object(or array)
        const fx = (a: any, b: any) => $T.diff(a, b, true);
        expect2(() => fx({ a: null }, { a: {} })).toEqual({ a: {} });
        expect2(() => fx({ a: {} }, { a: {} })).toEqual({});
        expect2(() => fx({ a: {} }, { a: { b: 0 } })).toEqual({ a: { b: 0 } });
        expect2(() => fx({ a: { b: 0 } }, { a: { b: 0 } })).toEqual({});
        expect2(() => fx({ a: { b: null } }, { a: { b: 0 } })).toEqual({ a: { b: 0 } });
        expect2(() => fx({ a: { c: 0 } }, { a: { b: 0 } })).toEqual({ a: { b: 0 } });
        expect2(() => fx({ a: { c: 1, b: 0 } }, { a: { b: 0, c: 1 } })).toEqual({});

        expect2(() => fx({ a: [] }, { a: { b: 0 } })).toEqual({ a: { b: 0 } });
        expect2(() => fx({ a: { b: 0 } }, { a: [] })).toEqual({ a: [] });
        expect2(() => fx({ a: [] }, { a: [] })).toEqual({});
        expect2(() => fx({ a: [] }, { a: [0] })).toEqual({ a: [0] });
        expect2(() => fx({ a: [1] }, { a: [0] })).toEqual({ a: [0] });
        expect2(() => fx({ a: [0, 1] }, { a: [1, 0] })).toEqual({ a: [1, 0] });
        expect2(() => fx({ a: [] }, { a: [{}] })).toEqual({ a: [{}] });
        expect2(() => fx({ a: [{}] }, { a: [{}] })).toEqual({});
    });

    //* test makeRandomCode()
    it('should pass makeRandomCode()', async () => {
        const client = $T;
        if (1) {
            expect2(() => client.makeRandomCode(1, 1)).toEqual({ min: 1, max: 9, val: 9 });
            expect2(() => client.makeRandomCode(5, 1)).toEqual({ min: 10000, max: 99999, val: 99999 });
            expect2(() => client.makeRandomCode(6, 1)).toEqual({ min: 100000, max: 999999, val: 999999 });

            expect2(() => client.makeRandomCode(1, 0)).toEqual({ min: 1, max: 9, val: 1 });
            expect2(() => client.makeRandomCode(5, 0)).toEqual({ min: 10000, max: 99999, val: 10000 });
            expect2(() => client.makeRandomCode(6, 0)).toEqual({ min: 100000, max: 999999, val: 100000 });

            expect2(() => client.makeRandomCode(1, false).val).toEqual(9);
            expect2(() => client.makeRandomCode(5, false).val).toEqual(99999);
            expect2(() => client.makeRandomCode(6, false).val).toEqual(999999);

            //* test len=5
            expect2(() => client.makeRandomCode(5).val.toString().length).toEqual('17329'.length);
            expect2(/[1-9][0-9]{4}/.test(client.makeRandomCode(5).val.toString())).toEqual(true);
            expect2(/[1-9][0-9]{4}/.test(client.makeRandomCode(5).val.toString())).toEqual(true);
            expect2(/[1-9][0-9]{4}/.test(client.makeRandomCode(5).val.toString())).toEqual(true);
            expect2(/[1-9][0-9]{4}/.test(client.makeRandomCode(5).val.toString())).toEqual(true);

            //* test len=6
            expect2(() => client.makeRandomCode(6).val.toString().length).toEqual('173291'.length);
            expect2(/[1-9][0-9]{5}/.test(client.makeRandomCode(6).val.toString())).toEqual(true);
            expect2(/[1-9][0-9]{5}/.test(client.makeRandomCode(6).val.toString())).toEqual(true);
            expect2(/[1-9][0-9]{5}/.test(client.makeRandomCode(6).val.toString())).toEqual(true);
            expect2(/[1-9][0-9]{5}/.test(client.makeRandomCode(6).val.toString())).toEqual(true);
        }
    });

    it('should pass $T.perf()', async () => {
        const perf = $T.perf();

        // first took
        await waited(1000);
        const result = perf.took(); // return is seconds
        expect2(() => result).toBeGreaterThanOrEqual(1);

        // second took
        await waited(1000);
        const result2 = perf.took(); // return is seconds
        expect2(() => result2).toBeGreaterThanOrEqual(2);
    });

    it('should pass $T.parseMeta', () => {
        expect2(() => $T.parseMeta('{ "a": 123 }')).toEqual({ a: 123 });
        expect2(() => $T.parseMeta('["hi", 123, {"z": 123}]')).toEqual({ list: ['hi', 123, { z: 123 }] });
        expect2(() => $T.parseMeta('hello everybody')).toEqual({ type: 'string', value: 'hello everybody' });
        expect2(() => $T.parseMeta('{ "a": }')).toEqual({
            type: 'string',
            value: '{ "a": }',
            error: 'Unexpected token \'}\', "{ "a": }" is not valid JSON', // for nodejs 22
            // error: 'Unexpected token } in JSON at position 7', // for nodejs 18
        });
        expect2(() => $T.parseMeta({ a: 123 })).toEqual({ a: 123 });
        expect2(() => $T.parseMeta(null)).toEqual(null);
        expect2(() => $T.parseMeta(undefined)).toEqual(null);
        expect2(() => $T.parseMeta(true)).toEqual({ type: 'boolean', value: true });
    });

    it('should pass $T.onlyDefined', () => {
        expect2(() => $T.onlyDefined(null, null)).toBe(null);
        expect2(() => $T.onlyDefined({ a: 1, b: null, c: undefined }, null)).toEqual({ a: 1, b: null });

        expect2(() => Object.keys({ a: 1, b: null, c: undefined })).toEqual(['a', 'b', 'c']);
        expect2(() => Object.keys($T.onlyDefined({ a: 1, b: null, c: undefined }, null))).toEqual(['a', 'b']);
    });

    it('should pass $rand', () => {
        // range
        expect2(() => $rand.range(3)).toEqual([0, 1, 2]);
        expect2(() => $rand.range(0)).toEqual([]);

        // float
        const float1 = $rand.float(0, 1);
        expect2(() => float1).toBeGreaterThanOrEqual(0);
        expect2(() => float1).toBeLessThanOrEqual(1);
        const float2 = $rand.float(3, 3);
        expect2(() => float2).toEqual(3);
        const float3 = $rand.float(-1.4, -0.5);
        expect2(() => float3).toBeGreaterThanOrEqual(-1.4);
        expect2(() => float3).toBeLessThanOrEqual(-0.5);

        // floats
        const count = 15;
        const floats = $rand.floats(0, 1, count);
        expect2(() => floats).toHaveLength(count);
        floats.forEach((f: number) => {
            expect2(() => f).toBeGreaterThanOrEqual(0);
            expect2(() => f).toBeLessThanOrEqual(1);
        });

        // integer
        const integer1 = $rand.integer(3, 5);
        expect2(Number.isInteger(integer1)).toBeTruthy();
        expect2(integer1).toBeGreaterThanOrEqual(3);
        expect2(integer1).toBeLessThanOrEqual(5);
        const integer2 = $rand.integer(8, 8);
        expect2(Number.isInteger(integer2)).toBeTruthy();
        expect2(() => integer2).toEqual(8);

        // integers
        const count2 = 20;
        const integers = $rand.integers(2.7, 4.999, count2);
        expect2(() => integers).toHaveLength(count2);
        integers.forEach((i: number) => {
            expect2(() => i).toBeGreaterThanOrEqual(3);
            expect2(() => i).toBeLessThanOrEqual(4);
        });
    });

    it('should pass misc function()', async () => {
        //* test if making target protocol-url
        const $prot1 = $protocol({}, '//self/hello/0');

        //NOTE - package dependent
        expect2(() => $prot1.asTargetUrl()).toEqual('api://lemon-core-dev/hello/0');
    });

    it('should pass $info()', async () => {
        expect2(() => $info()).toEqual({
            service: 'lemon-core',
            stage: expect.any(String),
            version: expect.any(String),
        });
    });

    it('should pass parseRange()', async () => {
        expect2(() => parseRange('[1020 TO 3030]')).toEqual({ gte: 1020, lte: 3030 });
        expect2(() => parseRange('[1020 TO 3030}')).toEqual({ gte: 1020, lt: 3030 });
        expect2(() => parseRange('{80 TO 81]')).toEqual({ gt: 80, lte: 81 });
        expect2(() => parseRange('{80 TO 81}')).toEqual({ gt: 80, lt: 81 });
        expect2(() => parseRange('{* TO 999]')).toEqual({ lte: 999 });
        expect2(() => parseRange('{* TO 999}')).toEqual({ lt: 999 });
        expect2(() => parseRange('[999 TO *]')).toEqual({ gte: 999 });
        expect2(() => parseRange('{999 TO *]')).toEqual({ gt: 999 });
        expect2(() => parseRange('{* TO *}')).toEqual(undefined);
        expect2(() => parseRange('[* TO *}')).toEqual(undefined);
        expect2(() => parseRange('[* TO *]')).toEqual(undefined);
    });

    //* test of my_parrallel()
    it('should pass my_parrallel()', async () => {
        interface MyModel {
            id: string;
            error: string;
            data?: number;
        }
        //* test with async function.
        const results = await my_parrallel(
            [
                { id: '1', error: 'me' },
                { id: '2', error: null },
            ],
            async (item: MyModel, i) => {
                if (item?.error) throw new Error(`yes error of ${item?.error}`);
                const data = i + 1;
                return { ...item, data };
            },
        );
        expect2(() => results).toEqual([
            { id: '1', error: 'yes error of me' },
            { id: '2', error: null, data: 2 },
        ]);

        //* test with normal function.
        const results2 = await my_parrallel(
            [
                { id: '1', error: 'me' },
                { id: '2', error: null },
            ],
            (item: MyModel, i): any => {
                if (item?.error) throw new Error(`yes error of ${item?.error}`);
                const data = i + 1;
                return { ...item, data };
            },
        );
        expect2(() => results2).toEqual([
            { id: '1', error: 'yes error of me' },
            { id: '2', error: null, data: 2 },
        ]);
    });

    it('should pass my_sequence()', async () => {
        interface MyModel {
            id: string;
            error: string;
            data?: number;
            actionTime?: number;
        }
        const actionDelay = 100; // milliseconds
        //* test with async function.
        const results = await my_sequence(
            [
                { id: '1', error: null },
                { id: '2', error: null },
                { id: '3', error: null },
                { id: '4', error: null },
            ],
            async (item: MyModel, i) => {
                const actionTime = new Date().getTime();
                await waited(actionDelay);
                return { ...item, actionTime };
            },
        );
        expect2(() => results).toEqual([
            { id: '1', error: null, actionTime: expect.any(Number) },
            { id: '2', error: null, actionTime: expect.any(Number) },
            { id: '3', error: null, actionTime: expect.any(Number) },
            { id: '4', error: null, actionTime: expect.any(Number) },
        ]);

        let previousActionTime = 0;
        // compare action time of each task by order sequence
        results.forEach(result => {
            expect2(() => result.actionTime).toBeGreaterThan(previousActionTime + actionDelay - 0.1);
            previousActionTime = result.actionTime;
        });
    });

    it('should pass isUserAuthorized()', async () => {
        const { $context } = await instance();

        expect2(() => isUserAuthorized($context.signed)).toBe(true);
        expect2(() => isUserAuthorized($context.unsigned)).toBe(false);
    });

    it('should pass getIdentityId()', async () => {
        const { $context, identityId } = await instance();

        //* check in `env/none.yml`
        const LOCAL_ACCOUNT = 'my-local-iid';
        expect2(() => $U.env('LOCAL_ACCOUNT')).toEqual(LOCAL_ACCOUNT);

        expect2(() => getIdentityId($context.signed)).toBe(identityId);
        expect2(() => getIdentityId($context.unsigned)).toBeNull();
        expect2(() => getIdentityId(null)).toEqual();
        expect2(() => getIdentityId({})).toEqual();
        expect2(() => getIdentityId({ domain: 'localhost' })).toEqual(LOCAL_ACCOUNT);

        expect2(() => isUserAuthorized($context.signed)).toBe(true);
        expect2(() => isUserAuthorized($context.unsigned)).toBe(false);

        expect2(() => isUserAuthorized({ ...$context.signed, domain: 'localhost', identity: {} })).toBe(true);
        expect2(() => isUserAuthorized({ ...$context.unsigned, domain: 'localhost', identity: {} })).toBe(true);

        //* tracking context (1st try)
        const preCtx1 = { ...$context.unsigned, domain: 'localhost', identity: { ...$context.unsigned.identity } };
        expect2(() => preCtx1, 'identity,domain').toEqual({
            domain: 'localhost',
            identity: {
                accountId: null,
                caller: undefined,
                identityId: null,
                identityPoolId: null,
                identityProvider: null,
                lang: 'ko',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_4) AppleWebKit/537.36 (KHTML, like Gecko)',
            },
        });
        expect2(() => isUserAuthorized(preCtx1)).toBe(true);
        expect2(() => preCtx1, 'identity,domain').toEqual({
            domain: 'localhost',
            identity: {
                accountId: null,
                caller: undefined,
                identityId: LOCAL_ACCOUNT,
                identityPoolId: null,
                identityProvider: null,
                lang: 'ko',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_4) AppleWebKit/537.36 (KHTML, like Gecko)',
            },
        });

        //* tracking context (1st try)
        const preCtx2 = { ...$context.unsigned, domain: 'localhost', identity: { ...$context.unsigned.identity } };
        expect2(() => isUserAuthorized(preCtx2, { lang: 'en' })).toBe(true);
        expect2(() => preCtx2, 'identity,domain').toEqual({
            domain: 'localhost',
            identity: {
                identityId: LOCAL_ACCOUNT,
                lang: 'en',
            },
        });
    });

    it('should pass createSigV4Proxy()', async () => {
        expect2(() => createSigV4Proxy(null, null)).toEqual('@endpoint (url) is required - createSigV4Proxy()');
        expect2(() => createSigV4Proxy('abc', null)).toEqual('@endpoint (url) is required - createSigV4Proxy(abc)');

        expect2(() => createSigV4Proxy('abc', 'local')?.hello()).toEqual('http-web-proxy:abc');
        expect2(() => createSigV4Proxy('abc', 'local')?.doProxy(null, null)).toEqual(
            `@method is required - createSigV4Proxy(abc)`,
        );
        expect2(() => createSigV4Proxy('abc', 'local')?.doProxy('GET', null)).toEqual(
            '@endpoint[local] is invalid - createSigV4Proxy(abc)',
        );
    });

    it('should pass $T.merge()', async () => {
        expect2(() => $T.merge(null, { a: 2, b: null })).toEqual({ a: 2 });
        expect2(() => $T.merge(undefined, { a: 2, b: null })).toEqual({ a: 2 });

        expect2(() => $T.merge(null, null)).toEqual(null);
        expect2(() => $T.merge(undefined, null)).toEqual(undefined);
        expect2(() => $T.merge(null, undefined)).toEqual(null);

        expect2(() => $T.merge({ a: 3, b: 2 }, { a: 2, b: null })).toEqual({ a: 2 });
    });

    describe('mocked helper utilities', () => {
        const originalProtocolService = coresAny.protocol.service;

        afterEach(() => {
            coresAny.protocol.service = originalProtocolService;
        });

        it('should cover advanced $protocol flows', async () => {
            const mockService = {
                fromURL: jest.fn().mockReturnValue({ path: 'mocked' }),
                myProtocolURI: jest.fn().mockReturnValue('api://mock@id#stage'),
                execute: jest.fn().mockResolvedValue('EXEC'),
                enqueue: jest.fn().mockResolvedValue('ENQ'),
                notify: jest.fn().mockResolvedValue('NOTI'),
            };
            coresAny.protocol.service = mockService as any;

            const proto = $protocol({}, '//self/demo', {
                param: { foo: 'bar' },
                body: { ping: 'pong' },
                isProd: true,
            });
            expect2(() => proto.hello()).toEqual('helper:protocol://self/demo');
            expect2(() => proto.asTargetUrl()).toEqual('api://id/demo');

            await proto.execute({ a: 1 }, { b: 2 }, 'PUT');
            expect(mockService.execute).toHaveBeenCalledWith(expect.objectContaining({ mode: 'PUT', stage: 'prod' }));

            await proto.enqueue({ x: 1 }, { y: 2 }, 'POST', 'type/id/cmd?foo=bar', 5);
            expect(mockService.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({
                    mode: 'POST',
                }),
                { type: 'type', id: 'id', cmd: 'cmd', param: { foo: 'bar' } },
                5,
            );

            await proto.notify({ i: 1 }, { j: 2 }, 'GET', 'note/id/cmd');
            expect(mockService.notify).toHaveBeenCalled();

            const proto2 = $protocol('//outer/service');
            expect2(() => proto2.asTargetUrl()).toEqual('api://outer/service');

            const invalidProto = $protocol({}, 'invalid');
            expect2(() => invalidProto.asTargetUrl()).toEqual('@service[invalid] (string) is invalid!');

            expect2(() => $protocol(null as any, '//self/demo')).toEqual('@context (NextContext) is required!');
            expect2(() => $protocol({}, undefined as any)).toEqual('@service (string) is required!');
        });

        it('should handle $slack payload building and errors', async () => {
            const slackMock = EngineModule.doReportSlack as jest.Mock;
            slackMock.mockResolvedValue('ok');
            const svcSpy = jest.spyOn($cores.config.config, 'getService').mockReturnValue('svc');
            const verSpy = jest.spyOn($cores.config.config, 'getVersion').mockReturnValue('1.0.0');
            const stageSpy = jest.spyOn($cores.config.config, 'getStage').mockReturnValue('dev');

            const res = await $slack('TITLE', { hi: 'there' }, 'PRE', {
                channel: 'alert',
                color: '#fff',
                scope: 'scope',
                footer: 'foot',
                context: { identity: {} },
                ts: 123,
            });
            expect2(res).toEqual('ok');
            expect(slackMock).toHaveBeenCalledWith(
                '!alert',
                expect.objectContaining({
                    attachments: expect.any(Array),
                }),
                { identity: {} },
            );

            slackMock.mockRejectedValueOnce(new Error('fail'));
            const res2 = await $slack('TITLE', null, null);
            expect2(res2).toEqual('#err:fail');

            slackMock.mockReset();
            svcSpy.mockRestore();
            verSpy.mockRestore();
            stageSpy.mockRestore();
        });

        it('should build $event publisher with env overrides', async () => {
            const originalBroadcast = coresAny.protocol.service.broadcast;
            const broadcastMock = jest.fn().mockResolvedValue('sent');
            coresAny.protocol.service.broadcast = broadcastMock;

            const originalEnv = process.env.EVENT_RELAY_SNS;
            process.env.EVENT_RELAY_SNS = 'arn:aws:sns:region:acct:event';
            const publisher = $event({ identity: {} } as any);
            await publisher.publish({ hello: 'world' });
            expect(broadcastMock).toHaveBeenCalledWith({ identity: {} }, 'arn:aws:sns:region:acct:event', {
                hello: 'world',
            });

            delete process.env.EVENT_RELAY_SNS;
            const fallbackPublisher = $event({}, 'arn:fallback');
            await fallbackPublisher.publish({ sample: true });
            expect(broadcastMock).toHaveBeenCalledWith({}, 'arn:fallback', { sample: true });

            delete process.env.EVENT_RELAY_SNS;
            expect2(() => $event({})).toEqual('env[EVENT_RELAY_SNS] is required - $event()');

            process.env.EVENT_RELAY_SNS = originalEnv;
            coresAny.protocol.service.broadcast = originalBroadcast;
        });

        describe('createSigV4Proxy mocked client', () => {
            const RealDate = Date;
            class MockDate extends Date {
                public constructor(...args: any[]) {
                    if (args.length === 0) {
                        super(new Date('2024-05-06T07:08:09Z').getTime());
                        return;
                    }
                    super(...(args as [any]));
                }
                public static now() {
                    return new Date('2024-05-06T07:08:09Z').getTime();
                }
            }

            beforeAll(() => {
                (global as unknown as { Date: typeof Date }).Date = MockDate as any;
            });
            afterAll(() => {
                (global as unknown as { Date: typeof Date }).Date = RealDate;
            });
            afterEach(() => {
                requestMock.mockReset();
            });

            it('should handle signed proxy calls with various responses', async () => {
                const proxy = createSigV4Proxy(
                    'MockProxy',
                    'https://api.mock.com/prod',
                    {
                        accessKey: 'AKIDMOCK',
                        secretKey: 'SECRETKEYMOCK',
                        host: 'api.mock.com',
                    },
                    {
                        headers: { 'x-api-key': 'lemon' },
                        relayHeaderKey: 'Relay-',
                        resultKey: 'payload',
                    },
                );

                requestMock.mockImplementationOnce((options: any, callback: (...args: any[]) => void) => {
                    callback(null, { statusCode: 200, statusMessage: 'OK' }, JSON.stringify({ payload: { ok: true } }));
                    return {};
                });
                expect2(await proxy.doProxy('GET', 'host value', 'cmd value', { team: 'alpha' })).toEqual({ ok: true });
                expect2(requestMock.mock.calls[0][0].headers['Relay-x-api-key']).toEqual('lemon');

                requestMock.mockImplementationOnce((options: any, callback: (...args: any[]) => void) => {
                    callback(null, { statusCode: 200, statusMessage: 'OK' }, '["A","B"]');
                    return {};
                });
                expect2(await proxy.doProxy('GET', 'array', 'case')).toEqual(['A', 'B']);

                requestMock.mockImplementationOnce((options: any, callback: (...args: any[]) => void) => {
                    callback(null, { statusCode: 200, statusMessage: 'OK' }, '{"invalid":}');
                    return {};
                });
                expect2(await proxy.doProxy('GET', 'broken', 'json')).toEqual('{"invalid":}');

                requestMock.mockImplementationOnce((options: any, callback: (...args: any[]) => void) => {
                    callback(null, { statusCode: 404, statusMessage: 'Not Found' }, 'missing-id');
                    return {};
                });
                expect2(await proxy.doProxy('GET', 'missing', 'id').catch(GETERR)).toEqual(
                    '404 NOT FOUND - missing-id',
                );

                requestMock.mockImplementationOnce((options: any, callback: (...args: any[]) => void) => {
                    callback(null, { statusCode: 500, statusMessage: 'Oops' }, 'failure');
                    return {};
                });
                expect2(await proxy.doProxy('GET', 'error', 'case').catch(GETERR)).toEqual('500 Oops - failure');

                requestMock.mockImplementationOnce((options: any, callback: (...args: any[]) => void) => {
                    callback(new Error('network'), null, null);
                    return {};
                });
                expect2(await proxy.doProxy('GET', 'network', 'case').catch(GETERR)).toEqual('network');
            });
        });
    });
});
