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
import { GETERR, expect2 } from '../common/test-helper';
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

    //! test cryto()
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
});
