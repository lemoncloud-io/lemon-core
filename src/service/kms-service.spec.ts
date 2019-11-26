/**
 * `service/kms-service.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'CORE_KMS_KEY';
const DEF_TARGET = 'alias/lemon-hello-api';

//! override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'hello-key',
});

//! load $engine, and prepare dummy handler
import { KMS } from './kms-service';

describe(`test service/kms-service.js`, () => {
    test('check name() function', async () => {
        expect(KMS.name()).toEqual('KMS');
    });

    test('check hello() function', async () => {
        expect(KMS.hello()).toEqual({ hello: 'kms-service' });
    });

    test('check keyId() function', async () => {
        expect(KMS.ENV_NAME).toEqual(ENV_NAME);
        expect(KMS.DEF_TARGET).toEqual(DEF_TARGET);
        const a0 = await KMS.keyId(ENV_NAME);
        expect(a0).toEqual('hello-key');
        const a1 = await KMS.keyId('MY_KEY');
        expect(a1).toEqual(DEF_TARGET);
        const a2 = await KMS.keyId('my-key');
        expect(a2).toEqual('my-key');
    });
});
