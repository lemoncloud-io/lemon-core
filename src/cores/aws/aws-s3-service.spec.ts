/**
 * `service/test.s3-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// require('source-map-support').install();
const ENV_NAME = 'MY_S3_BUCKET';
const DEF_BUCKET = 'lemon-hello-www';

//! override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'hello-bucket',
});

//! load $engine, and prepare dummy handler
import { AWSS3Service } from './aws-s3-service';
import { credentials } from '../../tools/shared';
import { environ } from '../../common/test-helper';

const S3 = new AWSS3Service();

describe(`test service/s3-service.js`, () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    test('check name() function', async () => {
        expect(S3.name()).toEqual('S3');
    });

    test('check hello() function', async () => {
        expect(S3.hello()).toEqual('aws-s3-service:');
    });

    test('check bucket() function', async () => {
        expect(AWSS3Service.ENV_S3_NAME).toEqual(ENV_NAME);
        expect(AWSS3Service.DEF_S3_BUCKET).toEqual(DEF_BUCKET);
        const a0 = await S3.bucket(ENV_NAME);
        expect(a0).toEqual('hello-bucket');
        const a1 = await S3.bucket('MY_BUCKET');
        expect(a1).toEqual(DEF_BUCKET);
        const a2 = await S3.bucket('my-bucket');
        expect(a2).toEqual('my-bucket');
    });
});
