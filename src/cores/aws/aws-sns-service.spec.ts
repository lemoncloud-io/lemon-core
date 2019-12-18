/**
 * `service/test.sns-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'MY_SNS_ENDPOINT';
const DEF_SNS = 'lemon-hello-sns';

//! override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'arn:aws:sns:ap-northeast-2::hello',
});

//! load $engine, and prepare dummy handler
import { AWSSNSService } from './aws-sns-service';
import { credentials } from '../../tools/shared';
import { environ } from '../../common/test-helper';

const SNS = new AWSSNSService();

describe(`test service/sns-service.js`, () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    test('check name() function', async () => {
        expect(SNS.name()).toEqual('SNS');
    });

    test('check hello() function', async () => {
        expect(SNS.hello()).toEqual('aws-sns-service:');
    });

    test('check endpoint() function', async () => {
        expect(AWSSNSService.ENV_SNS_ENDPOINT).toEqual(ENV_NAME);
        expect(AWSSNSService.DEF_SNS_ENDPOINT).toEqual(DEF_SNS);
        const a0 = await SNS.endpoint(ENV_NAME);
        expect(a0).toEqual('arn:aws:sns:ap-northeast-2::hello');
        const a1 = await SNS.endpoint('arn:aws:sns:....');
        expect(a1).toEqual('arn:aws:sns:....');
    });

    test('check asPayload() function', async () => {
        const e = new Error('test-error');
        // eslint-disable-next-line @typescript-eslint/no-object-literal-type-assertion
        const e2 = { statusMessage: 'test-status' };
        const e3 = 'test-message';
        expect(SNS.asPayload(e, { type: 'error' }).error).toEqual('test-error');
        expect(SNS.asPayload(e2, { type: 'error' })).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'test-status',
            type: 'error',
        });
        expect(SNS.asPayload(e2, 'error')['stack-trace']).toEqual(undefined);
        expect(SNS.asPayload(e2, 'error')).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'error',
        });
        expect(SNS.asPayload(e3, 'error')).toEqual({ error: e3, message: 'error' });
    });
});
