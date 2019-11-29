/**
 * `cores/aws/index.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-28 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */

//! load $engine, and prepare dummy handler
import { region, environ } from './';
import { expect2 } from '../../common/test-helper';

//! override environ.
process.env = Object.assign(process.env, {
    TEST_A: 'A',
    TEST_B: 'B',
    TEST_C: 'C',
});

describe(`test service/index.js`, () => {
    test('check region() function', async () => {
        expect(await region()).toEqual('ap-northeast-2');
    });

    test('check environ() function', async done => {
        expect2(await environ('TEST_A', 'TEST_B', 'X')).toEqual('A');
        expect2(await environ('', 'TEST_B', 'X')).toEqual('B');
        expect2(await environ('', 'TEST_X', 'X')).toEqual('X');
        expect2(await environ('abc', 'TEST_B', 'X')).toEqual('abc');
        expect2(await environ('TEST_B', '', 'X')).toEqual('B');
        expect2(await environ('', '', 'X')).toEqual('X');

        done();
    });
});
