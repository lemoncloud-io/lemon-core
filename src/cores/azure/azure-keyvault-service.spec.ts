/**
 * `azure-keyvault-service.spec.ts`
 * - unit test for `azure-keyvault-service`
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
import { expect2, environ, GETERR } from '../../common/test-helper';
import { $U } from '../../engine';

// import { credentials } from '../../tools';
import { KeyVaultService, fromBase64 } from './azure-keyvault-service';
import { performance } from 'perf_hooks';
import { sign } from 'jsonwebtoken';

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
jest.setTimeout(25000);
describe('KeyVaultService', () => {
    //! use `env.PROFILE`
    // const PROFILE = credentials(environ('ENV'));
    // if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //! test w/ azure-keyvault-service
    it('should pass azure-keyvault-service()', async done => {
        //NOTE - use `alias/lemon-hello-api` by default
        const keyId = 'key-lemon';
        const service = new KeyVaultService(keyId);
        const message = `hello lemon!`;

        /* eslint-disable prettier/prettier */
        expect2(service.hello()).toEqual(`azure-keyvault-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        expect2(() => Buffer.from('\n한/글!(.').toString('base64')).toEqual('Cu2VnC/quIAhKC4=');
        expect2(() => fromBase64(Buffer.from('\n한/글!(.').toString('base64'))).toEqual('Cu2VnC_quIAhKC4');

        //! run encrypt/decrypt
        expect2(await service.sample(), 'keyId,message,decrypted').toEqual({ keyId, message, decrypted: message });
        /* eslint-enable prettier/prettier */
        done();
    });

    it('should pass asymetric signing(for JWT Token)', async done => {
        //! make KMS custom-key for this test.
        const keyId = 'key-lemon';
        const alias = `lemon-identity-key`;
        const service = new KeyVaultService(keyId);

        expect2(service.hello()).toEqual(`azure-keyvault-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        //! sign()
        const message = $U.json({ iat: Math.floor(Date.now() / 1000), iss: alias });
        const signature = await service.sign(message);
        const verified = await service.verify(message, signature);

        expect2(() => signature.length).toEqual(256);
        expect2(verified).toEqual(true);

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
