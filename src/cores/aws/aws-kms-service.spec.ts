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
import { expect2, environ } from '../../common/test-helper';

import { credentials } from '../../tools/';
import { AWSKMSService } from './aws-kms-service';

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('AWSKMSService', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('PROFILE'));

    //! test w/ aws-kms-service
    it('should pass aws-kms-service()', async done => {
        //NOTE - use `alias/lemon-hello-api` by default
        const keyId = 'alias/lemon-hello-api';
        const service = new AWSKMSService(keyId);
        const message = `hello lemon!`;

        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual(`aws-kms-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        //! break if no profile.
        if (!PROFILE) return done();

        //! run encrypt/decrypt
        expect2(await service.sample(), 'keyId,message,decrypted').toEqual({ keyId, message, decrypted: message });
        /* eslint-enable prettier/prettier */
        done();
    });
});
