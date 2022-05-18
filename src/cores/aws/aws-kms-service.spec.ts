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
import { expect2, environ, GETERR } from '../../common/test-helper';
import { $U } from '../../engine';

import { credentials } from '../../tools/';
import { AWSKMSService, fromBase64 } from './aws-kms-service';
import { performance } from 'perf_hooks';

const $perf = () => {
    return new (class MyPerfmance {
        public readonly t0: number;
        public constructor(t0?: number) {
            this.t0 = t0 || performance.now(); // start of processing
        }
        public took = () => {
            const t1 = performance.now(); // start of processing
            return t1 - this.t0;
        };
    })();
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('AWSKMSService', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('ENV'));
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //! test w/ aws-kms-service
    it('should pass aws-kms-service()', async done => {
        //NOTE - use `alias/lemon-hello-api` by default
        const keyId = 'alias/lemon-hello-api';
        const service = new AWSKMSService(keyId);
        const message = `hello lemon!`;

        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual(`aws-kms-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        expect2(() => Buffer.from('\n한/글!(.').toString('base64')).toEqual('Cu2VnC/quIAhKC4=');
        expect2(() => fromBase64(Buffer.from('\n한/글!(.').toString('base64'))).toEqual('Cu2VnC_quIAhKC4');

        //! break if no profile loaded.
        if (!PROFILE) return done();

        //! run encrypt/decrypt
        expect2(await service.sample(), 'keyId,message,decrypted').toEqual({ keyId, message, decrypted: message });

        /* eslint-enable prettier/prettier */
        done();
    });

    //! test of asymetric signing
    it('should pass asymetric signing(for JWT Token)', async done => {
        //! make KMS custom-key for this test.
        const alias = `lemon-identity-key`;
        const keyId = `alias/${alias}`;
        const service = new AWSKMSService(keyId);

        expect2(service.hello()).toEqual(`aws-kms-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        //! break if no profile loaded.
        if (!PROFILE) return done();

        expect2(await service.sign(null).catch(GETERR)).toEqual('@message[null] is invalid - kms.sign()');
        expect2(await service.sign('').catch(GETERR)).toEqual('@message[] is invalid - kms.sign()');
        expect2(await service.sign(0 as any).catch(GETERR)).toEqual('@message[0] is invalid - kms.sign()');

        //! sign()
        const message = $U.json({ iat: Math.floor(Date.now() / 1000), iss: alias });
        const signature = await service.sign(message);
        console.log(`! signature =`, signature);
        expect2(() => signature.length).toEqual(342);
        expect2(() => /^[a-zA-Z0-9_\-]+$/.test(signature)).toEqual(true);

        //! verify()
        if (1) {
            const signature = await service.sign(message, false);
            const perf = $perf();
            const verified1 = await service.verify(message, Buffer.from(signature, 'base64'));
            expect2(() => verified1).toEqual(true);
            const verified2 = await service.verify(message, signature);
            expect2(() => verified2).toEqual(true);
            console.log(`! took =`, perf.took()); //! ~75ms in Mac M1
        }

        //! public-key()
        if (1) {
            const perf = $perf();
            const pubKey = await service.getPublicKey();
            console.log(`! public =`, pubKey);
            console.log(`! took =`, perf.took()); //! ~30ms in Mac M1
        }

        done();
    });
});
