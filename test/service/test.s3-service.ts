/**
 * `service/test.s3-service.ts`
 *
 *
 * @author Steve Jung <steve@lemoncloud.io>
 * @date   2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'CORE_S3_BUCKET';
const DEF_BUCKET = 'lemon-hello-www';

//! override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'hello-bucket',
});

//! load $engine, and prepare dummy handler
import { S3 } from '../../src/service/';

describe(`test service/s3-service.js`, () => {
    test('check name() function', async () => {
        expect(S3.name()).toEqual('S3');
    });

    test('check hello() function', async () => {
        expect(S3.hello()).toEqual({ hello: 's3-service' });
    });

    test('check bucket() function', async () => {
        expect(S3.ENV_NAME).toEqual(ENV_NAME);
        expect(S3.DEF_BUCKET).toEqual(DEF_BUCKET);
        const a0 = await S3.bucket(ENV_NAME);
        expect(a0).toEqual('hello-bucket');
        const a1 = await S3.bucket('MY_BUCKET');
        expect(a1).toEqual(DEF_BUCKET);
        const a2 = await S3.bucket('my-bucket');
        expect(a2).toEqual('my-bucket');
    });
});
