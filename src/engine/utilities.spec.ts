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
});
