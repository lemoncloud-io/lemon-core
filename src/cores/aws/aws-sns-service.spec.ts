/**
 * `service/test.sns-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
const ENV_NAME = 'MY_SNS_ENDPOINT';
const DEF_SNS = 'lemon-hello-sns';

//* override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'arn:aws:sns:ap-northeast-2::hello',
});

//* load $engine, and prepare dummy handler
import { loadProfile } from '../../environ';
import { expect2 } from '../../common/test-helper';
import { AWSSNSService } from './aws-sns-service';

const SNS = new AWSSNSService();

//! main test body.
describe(`test service/sns-service.js`, () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    test('check basic function', async () => {
        expect2(() => SNS.name()).toEqual('SNS');
        expect2(() => SNS.hello()).toEqual('aws-sns-service:');

        expect2(AWSSNSService.ENV_SNS_ENDPOINT).toEqual(ENV_NAME);
        expect2(AWSSNSService.DEF_SNS_ENDPOINT).toEqual(DEF_SNS);
        const a0 = await SNS.endpoint(ENV_NAME);
        expect2(a0).toEqual('arn:aws:sns:ap-northeast-2::hello');
        const a1 = await SNS.endpoint('arn:aws:sns:....');
        expect2(a1).toEqual('arn:aws:sns:....');

        //* test of asPyload()
        const e = new Error('test-error');
        const e2 = { statusMessage: 'test-status' };
        const e3 = 'test-message';
        expect2(() => SNS.asPayload(e, { type: 'error' }).error).toEqual('test-error');
        expect2(() => SNS.asPayload(e2, { type: 'error' })).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'test-status',
            type: 'error',
        });
        expect2(() => SNS.asPayload(e2, 'error')['stack-trace']).toEqual(undefined);
        expect2(() => SNS.asPayload(e2, 'error')).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'error',
        });
        expect2(() => SNS.asPayload(e3, 'error')).toEqual({ error: e3, message: 'error' });
    });
});
