/**
 * `core/utilities.spec.ts`
 * - test runner for `core/utilities.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-28 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { GETERR, expect2 } from '../common/test-helper';
import { Utilities } from './utilities';

import fs from 'fs';
import yaml from 'js-yaml';
import crypto from 'crypto';

type MockEnv = Record<string, string>;

export const instance = (env?: MockEnv) => {
    const scope: any = {
        id: 'utilities-test-engine',
        log: jest.fn(),
        inf: jest.fn(),
        err: jest.fn(),
    };
    if (env) {
        scope.environ = jest.fn((name: string, def?: string) => (env[name] !== undefined ? env[name] : def));
    }
    const $U = new Utilities(scope as any);
    return { $engine: scope, $U };
};

afterEach(() => {
    jest.restoreAllMocks();
});

//! main test body.
describe(`core/utilities.ts`, () => {
    //* test Module Manager
    test('check env()', async () => {
        const { $U } = instance({ hi: 'hello' });
        expect2($U.env('hi')).toEqual('hello');
        const { $U: $U2 } = instance();
        expect2($U2.env('hi')).toEqual(undefined);
        expect2($U2.env('hi', '')).toEqual('');
        expect2($U2.env('hi', 'hoho')).toEqual('hoho');
    });

    //* test env fallback
    test('check env() fallback to process', () => {
        const stubEngine: any = {
            log: jest.fn(),
            inf: jest.fn(),
            err: jest.fn(),
            environ: undefined,
        };
        const $U = new Utilities(stubEngine);
        const prev = process.env.DUMMY_ENV;
        process.env.DUMMY_ENV = 'dummy';
        expect2($U.env('DUMMY_ENV')).toEqual('dummy');
        prev === undefined ? delete process.env.DUMMY_ENV : (process.env.DUMMY_ENV = prev);
    });

    //* test load_data_yaml()
    test('check load_data_yaml()', async () => {
        const { $U } = instance();
        const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('foo: bar');
        const yamlSpy = jest.spyOn(yaml, 'load').mockReturnValue({ foo: 'bar' });

        expect2(await $U.load_data_yaml('foo')).toEqual({ foo: 'bar' });
        expect2(readSpy.mock.calls.length).toEqual(1);

        yamlSpy.mockImplementation(() => {
            throw new Error('yaml-error');
        });
        expect2(await $U.load_data_yaml('broken').catch(GETERR)).toEqual('yaml-error');
        expect2(() => $U.load_data_yaml(null as any)).toEqual('param:name is required!');
    });

    //* test load_sync_yaml()
    test('check load_sync_yaml()', () => {
        const { $U } = instance();
        jest.spyOn(fs, 'readFileSync').mockReturnValue('foo: bar');
        jest.spyOn(yaml, 'load').mockReturnValue({ foo: 'bar' });

        expect2(() => $U.load_sync_yaml('foo')).toEqual({ foo: 'bar' });

        jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('fs-error');
        });
        expect2(() => $U.load_sync_yaml('error')).toEqual({});
        expect2(() => $U.load_sync_yaml(undefined as any)).toEqual('param:name is required!');
    });

    //* test helper primitives
    test('check helper primitives()', () => {
        const { $U } = instance();
        expect2(() => $U.extend({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
        expect2($U.isset(undefined)).toEqual(false);
        expect2($U.empty(null)).toEqual(true);
        expect2($U.min(5, 2)).toEqual(2);
        expect2($U.max(5, 2)).toEqual(5);
        expect2($U.round(1.6)).toEqual(2);
        expect2($U.json({ b: 2, a: 1 }, true)).toEqual('{"a":1,"b":2}');

        const envPrev = process.env.ENV;
        process.env.ENV = 'production';
        expect2($U.is_dev()).toEqual(false);
        process.env.ENV = 'local';
        expect2($U.is_dev()).toEqual(true);
        envPrev === undefined ? delete process.env.ENV : (process.env.ENV = envPrev);
        const { $U: $UEnv } = instance({ ENV: 'op' });
        expect2($UEnv.is_dev()).toEqual(false);

        const baseDate = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
        const tsValue = $U.ts(baseDate, 0);
        expect2(tsValue.startsWith('2020-01-01 ')).toEqual(true);
        expect2(($U.dt('2020-01-01 00:00:00', 0) as any) instanceof Date).toEqual(true);
        expect2(($U.now() as any) instanceof Date).toEqual(true);
        const delta = $U.current_time_ms(100) - $U.current_time_ms();
        expect2(Math.abs(delta - 100) < 20).toEqual(true);

        const lcPrev = process.env.LC;
        process.env.LC = '1';
        expect2($U.NS('AB', 'red', 4, '-')).toEqual('\x1b[31m  AB-\x1b[0m');
        process.env.LC = '0';
        expect2($U.NS('CD')).toEqual('  CD:');
        lcPrev === undefined ? delete process.env.LC : (process.env.LC = lcPrev);
        expect2($U.NS('')).toEqual('');

        expect2(($U as any).escape(undefined as any)).toEqual('NULL');
        expect2(($U as any).escape(10)).toEqual(10);
        expect2(($U as any).escape({ a: 1 })).toEqual('\'{\\"a\\":1}\'');
        expect2(($U as any).escape('a%20b', true)).toEqual("'a b'");

        const throwingValue: any = {
            shouldThrow: true,
            valueOf() {
                if (this.shouldThrow) {
                    this.shouldThrow = false;
                    throw new Error('bad-value');
                }
                return 0;
            },
            toString() {
                return 'safe';
            },
        };
        const stubEngine: any = { log: jest.fn(), inf: jest.fn(), err: jest.fn(), environ: () => '' };
        const $U2 = new Utilities(stubEngine);
        expect2($U2.N(throwingValue, 7)).toEqual(7);
        throwingValue.shouldThrow = true;
        expect2($U2.F(throwingValue, 3)).toEqual(3);

        const parsed = $U.qs_parse('flag&num=12');
        expect2(parsed).toEqual({ flag: '', num: 12 });
        expect2($U.qs_stringify({ a: 1, b: 'x y' })).toEqual('a=1&b=x%20y');
    });

    //* test node helpers
    test('check node helpers()', () => {
        const { $U } = instance();

        expect2($U.cleanup({ keep: 1, _tmp: 1, $ref: 2 })).toEqual({ keep: 1 });
        expect2($U.updated({ a: 1, b: null }, { a: 1, b: '', c: 2 })).toEqual({ c: 2 });
        expect2($U.copy({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
        expect2($U.copy_node({ keep: 1, _tmp: 2 }, true)).toEqual({ keep: null });
        expect2($U.bare_node({ _id: 'ID', _current_time: 1 }, { extra: 'x' })).toEqual({
            _id: 'ID',
            _current_time: 1,
            extra: 'x',
        });
        expect2($U.diff({ a: 1, c: 2 }, { b: 1, c: 2 })).toEqual(['a', 'b']);
        expect2($U.diff_node({ a: 1, _tmp: 2 }, { a: 1, b: 2 })).toEqual(['b']);
        expect2($U.diff_node({ missing: 1 }, {})).toEqual(['missing']);
    });

    //* test isEqual()
    test('check isEqual()', () => {
        const { $U } = instance();
        const eq = ($U as any).isEqual.bind($U);
        expect2(eq('abc', new String('abc'))).toEqual(true);
        expect2(eq(NaN, NaN)).toEqual(true);
        expect2(eq(new Date(0), new Date(0))).toEqual(true);
        expect2(eq(true, true)).toEqual(true);
        expect2(eq(/abc/i, new RegExp('abc', 'i'))).toEqual(true);
        expect2(eq(1, 2)).toEqual(false);
        expect2(
            eq(
                function () {},
                function () {},
            ),
        ).toEqual(false);
        expect2(eq([1, 2], [1, 3])).toEqual(false);
        expect2(eq([1], [1, 2])).toEqual(false);
        expect2(eq(new Number(NaN), new Number(NaN))).toEqual(true);
        expect2(eq(new Number(5), new Number(5))).toEqual(true);
        class Foo {
            public value = 1;
        }
        class Bar {
            public value = 1;
        }
        expect2(eq(new Foo(), new Bar())).toEqual(false);
        const cyclicA: any = { name: 'a' };
        const cyclicB: any = { name: 'a' };
        cyclicA.self = cyclicA;
        cyclicB.self = cyclicB;
        expect2(eq(cyclicA, cyclicB)).toEqual(true);
        function OldFoo(this: any) {
            this.name = 'foo';
        }
        function OldBar(this: any) {
            this.name = 'foo';
        }
        expect2(eq(new (OldFoo as any)(), new (OldBar as any)())).toEqual(false);
    });

    //* test hashing + promises
    test('check hash and promise helpers()', async () => {
        const { $U } = instance();
        expect2($U.hash('hash-data')).toEqual('76327e9c');
        expect2(await $U.promise('done')).toEqual('done');
        const order: number[] = [];
        const seqResult = await $U.promise_sequence([1, 2], (item: number) => {
            order.push(item);
            return item * 2;
        });
        expect2(order).toEqual([1, 2]);
        expect2(seqResult).toEqual(4);
        expect2($U.md5('hello', 'hex')).toEqual('5d41402abc4b2a76b9719d911017c592');
        expect2($U.hmac('payload')).toEqual('E8C9DQIVf0az7vXakQiPrMmnNOyLcbfHT5Us+grCorY=');
    });

    //* test uuid()
    test('check uuid()', async () => {
        const { $U } = instance();

        expect2($U.uuid().length).toEqual('e82f0f6e-3b06-4cfb-8e56-12e046a8814e'.length);
        expect2($U.uuid().split('-').length).toEqual('e82f0f6e-3b06-4cfb-8e56-12e046a8814e'.split('-').length);
    });

    //* test qs()
    test('check qs()', async () => {
        const { $U } = instance();

        const qs = {
            a: 1,
            b: 'x y',
            c: 'z?=y',
            d: 'p&q',
        };

        expect2($U.qs.stringify(qs)).toEqual('a=1&b=x%20y&c=z%3F%3Dy&d=p%26q');
        expect2($U.qs.parse('a=1&b=x%20y&c=z%3F%3Dy&d=p%26q')).toEqual(qs);
    });

    //* test datetime()
    test('check datetime()', async () => {
        const { $U } = instance();
        const date1 = '79-11-26';
        const date2 = '19-11-26';
        const date3 = '1978-12-01';
        const date4 = '1978-12-01 12:34';
        const date5 = '1978-12-01 12:34:20';
        const date6 = '19781201';
        const date7 = '19781201 1234';

        expect2($U.dt(date3)).toEqual(new Date(1978, 11, 1, 12, 0, 0));
        expect2($U.dt(date4)).toEqual(new Date(1978, 11, 1, 12, 34, 0));
        expect2($U.dt(date5)).toEqual(new Date(1978, 11, 1, 12, 34, 20));
        expect2($U.dt(date6)).toEqual(new Date(1978, 11, 1, 12, 0, 0));
        expect2($U.dt(date7)).toEqual(new Date(1978, 11, 1, 12, 34, 0));

        expect2($U.dt(date1)).toEqual(new Date(1979, 10, 26, 12, 0, 0));
        expect2($U.dt(date2)).toEqual(new Date(2019, 10, 26, 12, 0, 0));
        expect2(($U.dt(1564711704000) as any) instanceof Date).toEqual(true);
        expect2(($U.dt(new Date(1564711704000)) as any) instanceof Date).toEqual(true);
        expect2(($U.dt(undefined) as any) instanceof Date).toEqual(true);
        expect2(() => $U.dt(true as any)).toEqual('Invalid type of dt: boolean');
        expect2($U.dt('invalid')).toEqual(null);
    });

    //* test cryto()
    test('check cryto()', async () => {
        const { $U } = instance();

        const passwd = 'lemon';
        const $crypt = $U.crypto(passwd);
        const $crypt2 = $U.crypto('LM~1212@' + 'SES');

        expect2(() => $crypt.encrypt(passwd)).toEqual('mwy4PPoRKDwGLlimYBvm8jbzAT0EMTl0FB7ErItyFEIux4bclkJc');
        expect2(() => $crypt.decrypt($crypt.encrypt(passwd))).toEqual(passwd);
        expect2(() => $crypt2.decrypt($crypt.encrypt(passwd))).toEqual('400 INVALID PASSWD - invalid magic string!');
        expect2(() => $crypt2.decrypt('XrlNs0ahuu9KVZbmkKphV3wc7eDeJ0P4WiAgSlYVMV9Z9hD9LZi5+s/h/LbiYPWYnqk=')).toEqual(
            'gXdY3v6rQMtSeXwF',
        );
        const decipherSpy = jest.spyOn(crypto, 'createDecipheriv').mockReturnValue({
            update: () => Buffer.from('LM!#invalid', 'utf8'),
            final: () => Buffer.alloc(0),
        } as any);
        expect2(() => $crypt.decrypt('AAAA')).toEqual('400 INVALID PASSWD - invalid json string!');
        decipherSpy.mockRestore();
    });

    //* test cryto2()
    test('check cryto2()', async () => {
        const { $U } = instance();

        const passwd = 'lemon';
        const $crypt = $U.crypto2(passwd);
        const $crypt2 = $U.crypto2('LM~1212@' + 'SES');

        expect2(() => $crypt.encrypt(passwd)).toEqual('9YhXj09n6JPFSSwN0HaISCIR7UgdhrbgaFOffANb1QQoErpHNwtZ');
        expect2(() => $crypt.decrypt($crypt.encrypt(passwd))).toEqual(`${passwd}`);
        expect2(() => $crypt.decrypt('9YhXj09n6JPFSSwN0HaISCIR7UgdhrbgaFOffANb1QQoErpHNwtZ')).toEqual(`${passwd}`);
        expect2(() => $crypt2.decrypt($crypt.encrypt(passwd))).toEqual('400 INVALID PASSWD - invalid magic string!');
        expect2(() => $crypt2.decrypt($crypt2.encrypt(passwd))).toEqual(`${passwd}`);
        expect2(() => $crypt2.decrypt('XrlNs0ahuu9KVZbmkKphV3wc7eDeJ0P4WiAgSlYVMV9Z9hD9LZi5+s/h/LbiYPWYnqk=')).toEqual(
            '400 INVALID PASSWD - invalid magic string!',
        );
        expect2(() => $crypt2.decrypt('XrlNs0ahuu9KVZbmkKphV3wc7eDeJ0P4WiAgSlYVMV9Z9hD9LZi5+s/h/LbiYPWYnqK=')).toEqual(
            '400 INVALID PASSWD - invalid magic string!',
        );
        const decipherSpy = jest.spyOn(crypto, 'createDecipheriv').mockReturnValue({
            update: () => Buffer.from('LM!#invalid', 'utf8'),
            final: () => Buffer.alloc(0),
        } as any);
        expect2(() => $crypt2.decrypt('AAAA')).toEqual('400 INVALID PASSWD - invalid json string!');
        decipherSpy.mockRestore();
    });

    //* test diff()
    test('check diff()', async () => {
        const { $U } = instance();

        expect2(() => $U.diff(undefined, undefined)).toEqual([]);
        expect2(() => $U.diff(null, null)).toEqual([]);
        expect2(() => $U.diff({}, null)).toEqual([]);
        expect2(() => $U.diff({ a: 1 }, null)).toEqual(['a']);
        expect2(() => $U.diff(null, { b: 1 })).toEqual(['b']);
        expect2(() => $U.diff({ a: 1 }, { b: 1 })).toEqual(['a', 'b']);
        expect2(() => $U.diff({ a: 1 }, { a: 1 })).toEqual([]);
        expect2(() => $U.diff({ a: {} }, { a: {} })).toEqual([]);
        expect2(() => $U.diff({ a: {} }, { a: { b: 1 } })).toEqual(['a']);
        expect2(() => $U.diff({ a: { b: null } }, { a: { b: 1 } })).toEqual(['a']);
        expect2(() => $U.diff({ a: { b: 1, a: 0 } }, { a: { a: 0, b: 1 } })).toEqual([]);
        expect2(() => $U.diff({ a: [0] }, { a: [null] })).toEqual(['a']);
        expect2(() => $U.diff({ a: [0] }, { a: {} })).toEqual(['a']);
    });

    //* test Integer Parser
    test('check N()', async () => {
        const { $U } = instance();

        expect2(() => $U.isInteger(0)).toEqual(true);
        expect2(() => $U.isInteger(0.1)).toEqual(false);
        expect2(() => $U.isInteger(1)).toEqual(true);
        expect2(() => $U.isInteger(1.0)).toEqual(true);
        expect2(() => $U.isInteger(1.1)).toEqual(false);
        expect2(() => $U.isInteger(1.0 / 3)).toEqual(false);

        expect2(() => $U.N('', 2)).toEqual(2);
        expect2(() => $U.N('1', 2)).toEqual(1);
        expect2(() => $U.N('1.1', 2)).toEqual(1);
        expect2(() => $U.N('1,000', 2)).toEqual(1000);
    });

    //* test Float Parser
    test('check F()', async () => {
        const { $U } = instance();

        expect2(() => $U.F('', 2)).toEqual(2);
        expect2(() => $U.F('1.0', 2)).toEqual(1);
        expect2(() => $U.F('1.1', 2)).toEqual(1.1);
        expect2(() => $U.F('1,000.0', 2)).toEqual(1000);

        expect2(() => $U.F(1.0 / 3, 0)).toEqual(0.3333333333333333);
        expect2(() => $U.F(1 / 3.0, 0)).toEqual(0.3333333333333333);
        expect2(() => $U.F(-1 / 3.0, 0)).toEqual(-0.3333333333333333);
        expect2(() => $U.F(-2 / 3.0, 0)).toEqual(-0.6666666666666666);
        expect2(() => $U.F('0.3333', 0)).toEqual(0.3333);
        expect2(() => $U.F('0.33333', 0)).toEqual(0.33333);
        expect2(() => $U.F('-0.33333', 0)).toEqual(-0.33333);
        expect2(() => $U.F('+0.33333', 0)).toEqual(0.33333);
    });

    //* test Float Parser w/ length
    test('check FN()', async () => {
        const { $U } = instance();

        expect2(() => $U.FN(0.0, -1)).toEqual('@len[-1] is out of range!');
        expect2(() => $U.FN(0.0, 0)).toEqual(0);
        expect2(() => $U.FN(0.0, 1)).toEqual(0);
        expect2(() => $U.FN(0.0, 2)).toEqual(0);
        expect2(() => $U.FN(0.0, 3)).toEqual(0);
        expect2(() => $U.FN(0.0, 4)).toEqual(0);
        expect2(() => $U.FN(0.0, 5)).toEqual(0);
        expect2(() => $U.FN(0.0, 6)).toEqual(0);
        expect2(() => $U.FN(0.0, 7)).toEqual('@len[7] is out of range!');

        expect2(() => $U.FN(1.0 / 3, 0)).toEqual(0);
        expect2(() => $U.FN(1.0 / 3, 1)).toEqual(0.3);
        expect2(() => $U.FN(+1 / 3.0, 2)).toEqual(0.33);
        expect2(() => $U.FN(+2 / 3.0, 2)).toEqual(0.67);
        expect2(() => $U.FN(+2 / 3.0, 2, 'round')).toEqual(0.67);
        expect2(() => $U.FN(+2 / 3.0, 2, 'floor')).toEqual(0.66);
        expect2(() => $U.FN(-1 / 3.0, 2)).toEqual(-0.33);
        expect2(() => $U.FN(-2 / 3.0, 2)).toEqual(-0.67);
        expect2(() => $U.FN(-2 / 3.0, 2, 'round')).toEqual(-0.67);
        expect2(() => $U.FN(-2 / 3.0, 2, 'floor')).toEqual(-0.67);

        expect2(() => $U.FN(1 + 1.0 / 3, 0)).toEqual(1);
        expect2(() => $U.FN(1 + 1.0 / 3, 1)).toEqual(1.3);
        expect2(() => $U.FN(1 + 1 / 3.0, 2)).toEqual(1.33);
        expect2(() => $U.FN(1 + 2 / 3.0, 2)).toEqual(1.67);
        expect2(() => $U.FN(1 + 2 / 3.0, 2, 'round')).toEqual(1.67);
        expect2(() => $U.FN(1 + 2 / 3.0, 2, 'floor')).toEqual(1.66);
        expect2(() => $U.FN(1 - 1 / 3.0, 2)).toEqual(0.67);
        expect2(() => $U.FN(1 - 2 / 3.0, 2)).toEqual(0.33);
        expect2(() => $U.FN(1 - 2 / 3.0, 2, 'round')).toEqual(0.33);
        expect2(() => $U.FN(1 - 2 / 3.0, 2, 'floor')).toEqual(0.33);

        expect2(() => $U.F2(8 / 3.0)).toEqual(2.67);
        expect2(() => $U.F3(8 / 3.0)).toEqual(2.667);

        expect2(() => $U.F2('1.66666666')).toEqual(1.67);
        expect2(() => $U.F3('1.66666666')).toEqual(1.667);

        expect2(() => $U.F2('.66666666')).toEqual(0.67);
        expect2(() => $U.F3('.66666666')).toEqual(0.667);

        expect2(() => $U.F2('-1.66666666')).toEqual(-1.67);
        expect2(() => $U.F3('-1.66666666')).toEqual(-1.667);

        expect2(() => $U.F2('1.66666666', 'floor')).toEqual(1.66);
        expect2(() => $U.F3('1.66666666', 'floor')).toEqual(1.666);

        expect2(() => $U.F2('.66666666', 'floor')).toEqual(0.66);
        expect2(() => $U.F3('.66666666', 'floor')).toEqual(0.666);

        expect2(() => $U.F2('-1.66666666', 'floor')).toEqual(-1.67);
        expect2(() => $U.F3('-1.66666666', 'floor')).toEqual(-1.667);
    });

    //* test String Text
    test('check S()', async () => {
        const { $U } = instance();
        const S = $U.S;

        expect2(() => S(null)).toEqual('');
        expect2(() => S(undefined)).toEqual('');
        expect2(() => S(0)).toEqual('0');
        expect2(() => S({ a: 1 })).toEqual('{"a":1}');
        const msg = 'abcdefg01234567890zzzz';
        const len = msg.length;
        expect2(() => S(msg, 10, 4)).toEqual('abcdefg012...zzzz');
        expect2(() => S(msg, 10, 0)).toEqual('abcdefg012...');
        expect2(() => S(msg, len, 0)).toEqual(msg);
        expect2(() => S(msg, len, 1)).toEqual(msg);
        expect2(() => S(msg, len - 1, 0)).toEqual(msg.substring(0, len - 1) + '...');
        expect2(() => S(msg, len - 2, 0)).toEqual(msg.substring(0, len - 2) + '...');
        expect2(() => S(msg, len - 2, 1)).toEqual(msg.substring(0, len - 2) + '...z');
        expect2(() => S(msg, len - 2, 2)).toEqual(msg.substring(0, len - 2) + 'zz');
        expect2(() => S(msg, len - 2, 3)).toEqual(msg.substring(0, len - 2) + 'zz');
        expect2(() => S(msg, len - 3, 3)).toEqual(msg.substring(0, len - 3) + 'zzz');
        expect2(() => S(msg, len - 3, 2)).toEqual(msg.substring(0, len - 3) + '...zz');
        expect2(() => S(msg, len - 3, 1)).toEqual(msg.substring(0, len - 3) + '...z');
        expect2(() => S(msg, len - 3, 0)).toEqual(msg.substring(0, len - 3) + '...');
    });

    //* test JWTHelper
    test('check JWTHelper()', async () => {
        const { $U } = instance();
        const current = 1 ? 1614241198963 : $U.current_time_ms();

        expect2(() => current).toEqual(1614241198963);
        expect2(() => $U.ts(current)).toEqual('2021-02-25 17:19:58');
        const iat = Math.floor(current / 1000);

        //* build jwt handler.
        const jwt = $U.jwt('#', current);

        const name = 'jwt-helper';
        const token = jwt.encode({ name });
        expect2(() => token).toEqual(
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiand0LWhlbHBlciIsImlhdCI6MTYxNDI0MTE5OH0.qV76eCxU5m_tcvPS4di07qM8bXaB7ss6Dt84hg-ESEI',
        );
        expect2(() => jwt.decode(token)).toEqual({ name, iat });
        expect2(() => jwt.decode(token.replace(/0/g, '1')), 'name').toEqual({ name: 'jwu-helper' });
        expect2(() => jwt.$.decode(token)).toEqual({ name, iat });

        expect2(() => jwt.verify(token)).toEqual({ name, iat });
        expect2(() => jwt.verify(token.replace(/0/g, '1')), 'name').toEqual('invalid signature');

        //* build jwt2 w/ wrong pass
        const jwt2 = $U.jwt('!', current);
        expect2(() => jwt2.decode(token)).toEqual({ name, iat });
        expect2(() => jwt2.verify(token)).toEqual('invalid signature');

        //* test expired.
        const token2 = jwt2.encode({ name, exp: iat + 1 });
        expect2(() => jwt2.decode(token2)).toEqual({ name, iat, exp: iat + 1 });
        expect2(() => jwt2.verify(token2)).toEqual(`jwt expired`); //* due to real current-time.

        //* make jwt3 w/ current + 5sec
        const curr = $U.current_time_ms() + 5 * 1000;
        const jwt3 = $U.jwt('!', curr);
        const token3 = jwt3.encode({ name, exp: Math.floor((curr + 1000) / 1000) });
        const expected3 = {
            name,
            iat: Math.floor((curr + 0) / 1000),
            exp: Math.floor((curr + 1000) / 1000),
        };
        expect2(() => jwt3.decode(token3)).toEqual({ ...expected3 });
        expect2(() => jwt3.verify(token3)).toEqual({ ...expected3 });

        const jwt3A = $U.jwt('!', curr + 5000);
        expect2(() => jwt3A.verify(token3)).toEqual(`jwt expired at ${$U.ts(expected3.exp * 1000)}`); //* due to real current-time.
    });

    //* test json() with number 0
    test('check json() with number 0', () => {
        const { $U } = instance();
        expect2(() => $U.json(0)).toEqual('0');
        expect2(() => $U.json(null)).toEqual('');
        expect2(() => $U.json(false)).toEqual('');
    });

    //* test timestamp() with timezone
    test('check timestamp() with timezone', () => {
        const { $U } = instance();
        const baseDate = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

        //* test with timezone offset
        const ts1 = $U.ts(baseDate, 9); // JST timezone
        expect2(() => ts1.startsWith('2020-01-01')).toEqual(true);

        //* test with negative timezone
        const ts2 = $U.ts(baseDate, -5); // EST timezone
        expect2(() => ts2.startsWith('2019-12-31')).toEqual(true);

        //* test timezone calculation with diff
        const ts3 = $U.ts(baseDate, 5);
        expect2(() => typeof ts3).toEqual('string');
        expect2(() => ts3.length).toEqual(19);
    });

    //* test datetime() with timezone
    test('check datetime() with timezone', () => {
        const { $U } = instance();

        //* test with timezone offset
        const dt1 = $U.dt('2020-01-01 12:00:00', 9);
        expect2(() => (dt1 as any) instanceof Date).toEqual(true);

        //* test with negative timezone
        const dt2 = $U.dt('2020-01-01 12:00:00', -5);
        expect2(() => (dt2 as any) instanceof Date).toEqual(true);

        //* test with zero timezone
        const now = new Date();
        const tzo = now.getTimezoneOffset();
        const dt3 = $U.dt('2020-01-01 12:00:00', -tzo / 60);
        expect2(() => (dt3 as any) instanceof Date).toEqual(true);
    });

    //* test isEqual() edge cases
    test('check isEqual() edge cases', () => {
        const { $U } = instance();
        const eq = ($U as any).isEqual.bind($U);

        //* test with arrays of different types
        expect2(eq([null], [undefined])).toEqual(false);
        expect2(eq([1, [2, 3]], [1, [2, 3]])).toEqual(true);
        expect2(eq([1, [2, 3]], [1, [2, 4]])).toEqual(false);

        //* test with nested objects
        expect2(eq({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toEqual(true);
        expect2(eq({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toEqual(false);

        //* test with mixed types
        expect2(eq(1, '1')).toEqual(false);
        expect2(eq(true, 1)).toEqual(false);
        expect2(eq(null, undefined)).toEqual(false);
    });

    //* test escape() edge cases
    test('check escape() edge cases', () => {
        const { $U } = instance();
        const escape = ($U as any).escape.bind($U);

        //* test with string containing backslash
        expect2(() => escape('test\\path')).toEqual("'test\\\\path'");

        //* test with string containing dollar sign
        expect2(() => escape('price$100')).toEqual("'price\\$100'");

        //* test with string containing quotes
        expect2(() => escape('he said "hello"')).toEqual('\'he said \\"hello\\"\'');
        expect2(() => escape("it's ok")).toEqual("'it\\'s ok'");

        //* test with empty string
        expect2(() => escape('')).toEqual("''");

        //* test with null
        expect2(() => escape(null)).toEqual("''");
    });

    //* test S() string truncation edge cases
    test('check S() string truncation edge cases', () => {
        const { $U } = instance();
        const S = $U.S;

        //* test with exact length
        const msg = 'abcdefghij';
        expect2(() => S(msg, 5, 2)).toEqual('abcde...ij');
        expect2(() => S(msg, 5, 5)).toEqual('abcdefghij');

        //* test with h=0
        expect2(() => S(msg, 0, 0)).toEqual(msg);

        //* test with undefined h
        expect2(() => S(msg)).toEqual(msg);

        //* test with custom delimiter
        expect2(() => S(msg, 5, 2, '...')).toEqual('abcde...ij');
        expect2(() => S(msg, 5, 2, '--')).toEqual('abcde--ij');

        //* test with number input (converted to string then truncated)
        expect2(() => S(12345, 3, 1)).toEqual('123...5');
    });

    //* test qs_parse() with different param types
    test('check qs_parse() with different param types', () => {
        const { $U } = instance();

        //* test with null value
        const parsed1 = $U.qs_parse('key1=&key2=value');
        expect2(() => parsed1).toEqual({ key1: '', key2: 'value' });

        //* test with numeric string
        const parsed2 = $U.qs_parse('id=123&count=456');
        expect2(() => parsed2).toEqual({ id: 123, count: 456 });

        //* test with leading zero (should not convert to number)
        const parsed3 = $U.qs_parse('code=0123');
        expect2(() => parsed3).toEqual({ code: '0123' });

        //* test with mixed types
        const parsed4 = $U.qs_parse('flag&num=42&str=hello&zero=0');
        expect2(() => parsed4).toEqual({ flag: '', num: 42, str: 'hello', zero: '0' });
    });

    //* test crypto() edge cases
    test('check crypto() edge cases', () => {
        const { $U } = instance();
        const passwd = 'test-password';
        const $crypt = $U.crypto(passwd);

        //* test with null value
        const encrypted1 = $crypt.encrypt(null as any);
        expect2(() => typeof encrypted1).toEqual('string');
        const decrypted1 = $crypt.decrypt(encrypted1);
        expect2(() => decrypted1).toEqual(null);

        //* test with empty string
        const encrypted2 = $crypt.encrypt('');
        expect2(() => typeof encrypted2).toEqual('string');
        const decrypted2 = $crypt.decrypt(encrypted2);
        expect2(() => decrypted2).toEqual('');

        //* test with object containing special characters
        const testObj = { key: 'value"with\'quotes' };
        const encrypted3 = $crypt.encrypt(JSON.stringify(testObj));
        const decrypted3 = $crypt.decrypt(encrypted3);
        expect2(() => decrypted3).toEqual(JSON.stringify(testObj));
    });

    //* test crypto2() edge cases
    test('check crypto2() edge cases', () => {
        const { $U } = instance();
        const passwd = 'test-password';

        //* test with custom algorithm
        const $crypt1 = $U.crypto2(passwd, 'aes-256-cbc');
        const encrypted1 = $crypt1.encrypt('test');
        expect2(() => typeof encrypted1).toEqual('string');
        const decrypted1 = $crypt1.decrypt(encrypted1);
        expect2(() => decrypted1).toEqual('test');

        //* test with custom ivNumb
        const $crypt2 = $U.crypto2(passwd, 'aes-256-ctr', 42);
        const encrypted2 = $crypt2.encrypt('test');
        expect2(() => typeof encrypted2).toEqual('string');
        const decrypted2 = $crypt2.decrypt(encrypted2);
        expect2(() => decrypted2).toEqual('test');

        //* test with custom magic string
        const $crypt3 = $U.crypto2(passwd, 'aes-256-ctr', 0, 'CUSTOM');
        const encrypted3 = $crypt3.encrypt('test');
        expect2(() => typeof encrypted3).toEqual('string');
        const decrypted3 = $crypt3.decrypt(encrypted3);
        expect2(() => decrypted3).toEqual('test');

        //* test with empty magic string
        const $crypt4 = $U.crypto2(passwd, 'aes-256-ctr', 0, '');
        const encrypted4 = $crypt4.encrypt('test');
        expect2(() => typeof encrypted4).toEqual('string');
        const decrypted4 = $crypt4.decrypt(encrypted4);
        expect2(() => decrypted4).toEqual('test');
    });

    //* test jwt() with different algorithms
    test('check jwt() with different algorithms', () => {
        const { $U } = instance();
        const current = 1614241198963;
        const jwt = $U.jwt('secret', current);

        //* test encode with HS384
        const token1 = jwt.encode({ data: 'test' }, 'HS384');
        expect2(() => typeof token1).toEqual('string');

        //* test encode with HS512
        const token2 = jwt.encode({ data: 'test' }, 'HS512');
        expect2(() => typeof token2).toEqual('string');

        //* test decode with options
        const decoded = jwt.decode(token1, { json: true });
        expect2(() => decoded.data).toEqual('test');
    });

    //* test jwt() without current_ms
    test('check jwt() without current_ms', () => {
        const { $U } = instance();
        const jwt = $U.jwt('secret');

        //* test encode without iat
        const token = jwt.encode({ data: 'test' });
        expect2(() => typeof token).toEqual('string');

        //* test decode (iat is auto-generated by jwt library)
        const decoded = jwt.decode(token);
        expect2(() => decoded.data).toEqual('test');
        expect2(() => typeof decoded.iat).toEqual('number');
    });

    //* test updated() edge case
    test('check updated() edge case', () => {
        const { $U } = instance();

        //* test with null vs empty string equivalence
        const that1: any = { a: null, b: 1 };
        const that2: any = { a: '', b: 1, c: 2 };
        const result = $U.updated(that1, that2);
        expect2(() => result).toEqual({ c: 2 });
    });

    //* test diff() with null/undefined combinations
    test('check diff() with null/undefined combinations', () => {
        const { $U } = instance();

        //* test both undefined
        expect2(() => $U.diff(undefined, undefined)).toEqual([]);

        //* test both null
        expect2(() => $U.diff(null, null)).toEqual([]);

        //* test undefined vs null
        expect2(() => $U.diff(undefined, null)).toEqual([]);
        expect2(() => $U.diff(null, undefined)).toEqual([]);

        //* test empty object vs null
        expect2(() => $U.diff({}, null)).toEqual([]);
        expect2(() => $U.diff(null, {})).toEqual([]);
    });

    //* test promise_sequence() edge case
    test('check promise_sequence() edge case', async () => {
        const { $U } = instance();

        //* test with single item array
        const result1 = await $U.promise_sequence([1], (item: number) => item * 2);
        expect2(() => result1).toEqual(2);

        //* test with async function
        const order: number[] = [];
        const result2 = await $U.promise_sequence([1, 2, 3], async (item: number) => {
            order.push(item);
            await new Promise(resolve => setTimeout(resolve, 10));
            return item * 2;
        });
        expect2(() => order).toEqual([1, 2, 3]);
        expect2(() => result2).toEqual(6);
    });
});
