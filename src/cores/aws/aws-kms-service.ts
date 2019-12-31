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
import { $engine, _log, _inf, _err, $U } from '../../engine/';
const NS = $U.NS('KMSS', 'blue'); // NAMESPACE TO BE PRINTED.

import AWS from 'aws-sdk';
import { CoreKmsService } from '../core-services';

//NOTE - use env[KMS_KEY_ID] to overide.
const ALIAS = `lemon-hello-api`;

/** ****************************************************************************************************************
 *  Public Instance Exported.
 ** ****************************************************************************************************************/
const region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;

//! check if base64 string.
const isBase64 = (text: string) =>
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/.test(text);

//! get aws client for KMS
const instance = () => {
    const _region = region();
    const config = { region: _region };
    return new AWS.KMS(config);
};

/**
 * class: `AWSKMSService`
 * - shared Key Management Service to encrypt/decrypt message.
 */
export class AWSKMSService implements CoreKmsService {
    /**
     * environ name of KMS KEY
     */
    public static ENV_KMS_KEY_ID = 'KMS_KEY_ID';
    public static DEF_KMS_TARGET = `alias/${ALIAS}`;

    private _keyId: string;
    public constructor(keyId?: string) {
        keyId = keyId ? keyId : ($engine.environ(AWSKMSService.ENV_KMS_KEY_ID, AWSKMSService.DEF_KMS_TARGET) as string);
        this._keyId = keyId;
    }

    /**
     * get name of this
     */
    public name = () => `KMS`;

    /**
     * hello
     */
    public hello = () => `aws-kms-service:${this._keyId}`;

    /**
     * get key-id to encrypt.
     */
    public keyId = () => this._keyId;

    /**
     * Encrypt message
     *
     * @param {*} message
     * @param {*} keyId
     */
    public encrypt = async (message: string): Promise<string> => {
        const keyId = this.keyId();
        _inf(NS, `encrypt(${keyId}, ${message.substring(0, 10)}...)..`);
        const KeyId = keyId;
        const params = {
            KeyId,
            Plaintext: message,
        };
        const result = await instance()
            .encrypt(params)
            .promise();
        _log(NS, '> result =', result);
        const ciphertext = result.CiphertextBlob ? result.CiphertextBlob.toString('base64') : message;
        _log(NS, '> ciphertext =', ciphertext.substring(0, 32), '...');
        return ciphertext;
    };

    /**
     * Decrypt message
     *
     * @param {*} encryptedSecret
     */
    public decrypt = async (encryptedSecret: string): Promise<string> => {
        _inf(NS, `decrypt(${encryptedSecret.substring(0, 12)}...)..`);
        const CiphertextBlob =
            typeof encryptedSecret == 'string'
                ? isBase64(encryptedSecret)
                    ? Buffer.from(encryptedSecret, 'base64')
                    : encryptedSecret
                : encryptedSecret;
        //! api param.
        const params = { CiphertextBlob };
        const data: any = await instance()
            .decrypt(params)
            .promise();
        // _log(NS, '> data.type =', typeof data);
        return data && data.Plaintext ? data.Plaintext.toString() : '';
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
