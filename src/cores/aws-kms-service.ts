/**
 * file: `cores/aws-kms-service.ts`
 * - kms service for AWS KMS.
 *
 *
 * **TODO**
 * - [x] in VPC lambda, will timeout due to NAT => so, need to support via engine. => use `VPC Endpoints` with kms service.
 * - [x] error of `not authorized` => use one of below.
 *      1. add this Role (lemon-todaq-api-prod-ap-northeast-2-lambdaRole) to `Key users`.
 *      2. add `kms:Decrypt` `kms:Encrypt` in resource of `iamRoleStatements`.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-10-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U } from '../engine/';
import { KMS } from '../service/kms-service';
const NS = $U.NS('KMSS', 'blue'); // NAMESPACE TO BE PRINTED.

//NOTE - use env[KMS_KEY_ID] to overide.
const ALIAS = `lemon-oauth-api`;

/**
 * class: `AWSKMSService`
 * - shared Key Management Service to encrypt/decrypt message.
 */
export class AWSKMSService {
    /**
     * environ name of KMS KEY
     */
    public static ENV_KMS_KEY_ID = 'KMS_KEY_ID';

    /**
     * default constructor.
     */
    public constructor() {}

    /**
     * hello
     */
    public hello() {
        return {
            hello: 'aws-kms-service',
        };
    }

    /**
     * get the current key-id
     */
    public keyId = async () => {
        return $engine.environ(AWSKMSService.ENV_KMS_KEY_ID, `alias/${ALIAS}`) as string;
    };

    /**
     * decrypt message.
     */
    public decrypt = async (encryptedSecret: string | Buffer): Promise<string> => {
        _inf(NS, 'decrypt()..');
        return await KMS.decrypt(encryptedSecret.toString());
    };

    /**
     * encrypt message, and returns as base
     *
     * @return base64 encoded string
     */
    public encrypt = async (message: string) => {
        _inf(NS, 'encrypt()..');
        const keyId = await this.keyId();
        return await KMS.encrypt(message, keyId);
    };

    /**
     * it should be 'hello lemon'
     *
     * # Example
     * ```sh
     * # encrypt text
     * $ aws kms encrypt --profile <profile> --key-id <kms-key-id> --plaintext "hello lemon" --query CiphertextBlob --output text
     * ```
     */
    public async sample() {
        _inf(NS, 'sample()..');

        //! check key-id.
        const message = `hello lemon!`;
        const KMS_KEY_ID = $engine.environ(AWSKMSService.ENV_KMS_KEY_ID, `alias/${ALIAS}`) as string;
        const keyId = await this.keyId();
        _log(NS, '> key-id =', keyId);

        const encrypted = await this.encrypt(message);
        _log(NS, '> encrypted =', encrypted);

        const decrypted = await this.decrypt(encrypted);
        _log(NS, '> decrypted =', decrypted, '->', message == decrypted ? 'ok' : 'error');

        return { KMS_KEY_ID, keyId, message, encrypted, decrypted };
    }
}
