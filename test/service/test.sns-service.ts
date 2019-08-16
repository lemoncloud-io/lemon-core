/**
 * `service/test.sns-service.ts`
 *
 *
 * @author Steve Jung <steve@lemoncloud.io>
 * @date   2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'CORE_SNS_ARN';
const DEF_SNS = 'lemon-hello-sns';

//! override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'arn:aws:sns:ap-northeast-2::hello',
});

//! load $engine, and prepare dummy handler
import { SNS } from '../../src/service/';

describe(`test service/sns-service.js`, () => {
    test('check name() function', async () => {
        expect(SNS.name()).toEqual('SNS');
    });

    test('check hello() function', async () => {
        expect(SNS.hello()).toEqual({ hello: 'sns-service' });
    });

    test('check endpoint() function', async () => {
        expect(SNS.ENV_NAME).toEqual(ENV_NAME);
        expect(SNS.DEF_SNS).toEqual(DEF_SNS);
        const a0 = await SNS.endpoint(ENV_NAME);
        expect(a0).toEqual('arn:aws:sns:ap-northeast-2::hello');
        const a1 = await SNS.endpoint('arn:aws:sns:....');
        expect(a1).toEqual('arn:aws:sns:....');
    });
});
