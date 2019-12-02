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
        const { $engine, $U } = instance();

        expect2($U.env('hi')).toEqual(undefined);
        expect2($U.env('hi', '')).toEqual('');
        expect2($U.env('hi', 'hoho')).toEqual('hoho');

        done();
    });
});
