/**
 * `service/index.spec.ts`
 *
 *
 * @author Steve Jung <steve@lemoncloud.io>
 * @date   2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//! override environ.
process.env = Object.assign(process.env, {
    TEST_A: 'A',
    TEST_B: 'B',
    TEST_C: 'C',
});

//! load $engine, and prepare dummy handler
import { region, environ } from './';

describe(`test service/index.js`, () => {
    test('check region() function', async () => {
        expect(await region()).toEqual('ap-northeast-2');
    });

    test('check environ() function', async () => {
        const a0 = await environ('TEST_A', 'TEST_B', 'X');
        expect(a0).toEqual('A');
        const a1 = await environ('', 'TEST_B', 'X');
        expect(a1).toEqual('B');
        const a2 = await environ('', 'TEST_X', 'X');
        expect(a2).toEqual('X');
        const a3 = await environ('abc', 'TEST_B', 'X');
        expect(a3).toEqual('abc');
        const a4 = await environ('TEST_B', '', 'X');
        expect(a4).toEqual('B');
        const a5 = await environ('', '', 'X');
        expect(a5).toEqual('X');
    });
});
