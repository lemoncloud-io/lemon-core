/**
 * `aws-kms-service.spec.ts`
 * - unit test for `aws-kms-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-10-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { expect2, _it } from '../../common/test-helper';

import { credentials } from '../../tools/';
import { AWSKMSService } from './../aws/aws-kms-service';

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('AWSKMSService', () => {
    const PROFILE = 1 ? 'lemon' : '';
    if (PROFILE) credentials(PROFILE);

    //! test w/ aws-kms-service
    _it('should pass aws-kms-service()', async done => {
        if (!PROFILE) return done();

        //NOTE - use `alias/lemon-hello-api` by default
        const keyId = 'alias/lemon-hello-api';
        const service = new AWSKMSService(keyId);
        const message = `hello lemon!`;

        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual({ hello: 'aws-kms-service' });
        expect2(service.keyId()).toEqual(keyId);
        expect2(await service.sample(), 'keyId,message,decrypted').toEqual({ keyId, message, decrypted: message });
        /* eslint-enable prettier/prettier */
        done();
    });
});
