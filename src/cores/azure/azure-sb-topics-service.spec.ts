/**
 * `service/test.sns-service.ts`
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-25 initial azure service bus topics service
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
const ENV_NAME = 'MY_SNS_ENDPOINT';
const DEF_SNS = 'topic-lemon';

//! override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'arn:aws:sns:ap-northeast-2::hello',
});

//! load $engine, and prepare dummy handler
import { TopicsService } from './azure-sb-topics-service';
import { environ } from '../../common/test-helper';

const service = new TopicsService();
jest.setTimeout(10000);
describe(`test TopicsService.js`, () => {
    //! use `env.PROFILE`
    test('check name() function', async () => {
        expect(service.name()).toEqual('service-bus-topics');
    });

    test('check hello() function', async () => {
        expect(service.hello()).toEqual('az-sb-topics-service:topic-lemon');
    });


    test('check asPayload() function', async () => {
        const e = new Error('test-error');
        const e2 = { statusMessage: 'test-status' };
        const e3 = 'test-message';
        expect(service.asPayload(e, { type: 'error' }).error).toEqual('test-error');
        expect(service.asPayload(e2, { type: 'error' })).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'test-status',
            type: 'error',
        });
        expect(service.asPayload(e2, 'error')['stack-trace']).toEqual(undefined);
        expect(service.asPayload(e2, 'error')).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'error',
        });
        expect(service.asPayload(e3, 'error')).toEqual({ error: e3, message: 'error' });
        // await service.reportError(e, 'error')
    });
});
