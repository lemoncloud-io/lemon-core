/**
 * `core/utilities.spec.ts`
 * - test runnder for `core/utilities.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-28 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { expect2 } from '../common/test-helper';
import { Utilities } from './utilities';

import * as $builder from './builder.spec';

export const instance = () => {
    const { $engine } = $builder.instance();
    const $U = new Utilities($engine);
    return { $engine, $U };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe(`core/utilities.ts`, () => {
    //! test Module Manager
    test('check env()', async done => {
        const { $U } = instance();

        expect2($U.env('hi')).toEqual(undefined);
        expect2($U.env('hi', '')).toEqual('');
        expect2($U.env('hi', 'hoho')).toEqual('hoho');

        done();
    });

    //! test uuid()
    test('check uuid()', async done => {
        const { $U } = instance();

        expect2($U.uuid().length).toEqual('e82f0f6e-3b06-4cfb-8e56-12e046a8814e'.length);
        expect2($U.uuid().split('-').length).toEqual('e82f0f6e-3b06-4cfb-8e56-12e046a8814e'.split('-').length);

        done();
    });

    //! test qs()
    test('check qs()', async done => {
        const { $U } = instance();

        const qs = {
            a: 1,
            b: 'x y',
            c: 'z?=y',
            d: 'p&q',
        };

        expect2($U.qs.stringify(qs)).toEqual('a=1&b=x%20y&c=z%3F%3Dy&d=p%26q');
        expect2($U.qs.parse('a=1&b=x%20y&c=z%3F%3Dy&d=p%26q')).toEqual(qs);

        done();
    });

    //! test datetime()
    test('check datetime()', async done => {
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

        done();
    });

    //! test cryto()
    test('check cryto()', async done => {
        const { $U } = instance();

        const passwd = 'lemon';
        const $crypt = $U.crypto(passwd);
        const $crypt2 = $U.crypto('LM~1212@' + 'SES');

        /* eslint-disable prettier/prettier */
        expect2(() => $crypt.encrypt(passwd)).toEqual('mwy4PPoRKDwGLlimYBvm8jbzAT0EMTl0FB7ErItyFEIux4bclkJc');
        expect2(() => $crypt.decrypt($crypt.encrypt(passwd))).toEqual(passwd);
        expect2(() => $crypt2.decrypt($crypt.encrypt(passwd))).toEqual('400 INVALID PASSWD - invalid magic string!');
        expect2(() => $crypt2.decrypt('XrlNs0ahuu9KVZbmkKphV3wc7eDeJ0P4WiAgSlYVMV9Z9hD9LZi5+s/h/LbiYPWYnqk=')).toEqual('gXdY3v6rQMtSeXwF');
        /* eslint-enable prettier/prettier */

        done();
    });

    //! test cryto2()
    test('check cryto2()', async done => {
        const { $U } = instance();

        const passwd = 'lemon';
        const $crypt = $U.crypto2(passwd);
        const $crypt2 = $U.crypto2('LM~1212@' + 'SES');

        /* eslint-disable prettier/prettier */
        expect2(() => $crypt.encrypt(passwd)).toEqual('9YhXj09n6JPFSSwN0HaISCIR7UgdhrbgaFOffANb1QQoErpHNwtZ');
        expect2(() => $crypt.decrypt($crypt.encrypt(passwd))).toEqual(`${passwd}`);
        expect2(() => $crypt.decrypt('9YhXj09n6JPFSSwN0HaISCIR7UgdhrbgaFOffANb1QQoErpHNwtZ')).toEqual(`${passwd}`);
        expect2(() => $crypt2.decrypt($crypt.encrypt(passwd))).toEqual('400 INVALID PASSWD - invalid magic string!');
        expect2(() => $crypt2.decrypt($crypt2.encrypt(passwd))).toEqual(`${passwd}`);
        expect2(() => $crypt2.decrypt('XrlNs0ahuu9KVZbmkKphV3wc7eDeJ0P4WiAgSlYVMV9Z9hD9LZi5+s/h/LbiYPWYnqk=')).toEqual('400 INVALID PASSWD - invalid magic string!');
        expect2(() => $crypt2.decrypt('XrlNs0ahuu9KVZbmkKphV3wc7eDeJ0P4WiAgSlYVMV9Z9hD9LZi5+s/h/LbiYPWYnqK=')).toEqual('400 INVALID PASSWD - invalid magic string!');
        /* eslint-enable prettier/prettier */

        done();
    });

    //! test diff()
    test('check diff()', async done => {
        const { $U } = instance();

        expect2(() => $U.diff(undefined, undefined)).toEqual([]);
        expect2(() => $U.diff(null, null)).toEqual([]);
        expect2(() => $U.diff({}, null)).toEqual([]);
        expect2(() => $U.diff({ a: 1 }, null)).toEqual(['a']);
        expect2(() => $U.diff(null, { b: 1 })).toEqual(['b']);
        expect2(() => $U.diff({ a: 1 }, { b: 1 })).toEqual(['a', 'b']);
        expect2(() => $U.diff({ a: 1 }, { a: 1 })).toEqual([]);

        done();
    });

    //! test Integer Parser
    test('check N()', async done => {
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

        done();
    });

    //! test Float Parser
    test('check F()', async done => {
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

        done();
    });

    //! test Float Parser w/ length
    test('check FN()', async done => {
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

        done();
    });
});
