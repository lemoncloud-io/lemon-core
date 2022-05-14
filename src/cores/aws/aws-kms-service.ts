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

import AWS, { KMS } from 'aws-sdk';
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
        keyId = keyId ?? `${$engine.environ(AWSKMSService.ENV_KMS_KEY_ID, AWSKMSService.DEF_KMS_TARGET)}`;
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
    public keyId = () => {
        if (!this._keyId || typeof this._keyId !== 'string')
            throw new Error(`.keyId<${typeof this._keyId}> (string) is required!`);
        return this._keyId;
    };

    protected _instance: AWS.KMS;
    /**
     * get KMS instance in stock
     */
    public instance() {
        if (!this._instance) this._instance = instance();
        return this._instance;
    }

    /**
     * Encrypt message
     *
     * @param {*} message
     */
    public encrypt = async (message: string): Promise<string> => {
        const keyId = this.keyId();
        _inf(NS, `encrypt(${keyId}, ${message.substring(0, 10)}...)..`);
        const KeyId = keyId;
        const params = {
            KeyId,
            Plaintext: message,
        };
        const result = await this.instance().encrypt(params).promise();
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
        const data: any = await this.instance().decrypt(params).promise();
        // _log(NS, '> data.type =', typeof data);
        return data && data.Plaintext ? data.Plaintext.toString() : '';
    };

    /**
     * make signature by message
     *
     * @param {*} message any string
     * @param forJwtSignature (option) flag to get JWT signature format.
     */
    public sign = async (message: string, forJwtSignature = true): Promise<string> => {
        if (!message || typeof message !== 'string') throw new Error(`@message[${message}] is invalid - kms.sign()`);
        const KeyId = this.keyId();
        _inf(NS, `sign(${KeyId}, ${message.substring(0, 10)}...)..`);
        const params: KMS.Types.SignRequest = {
            KeyId,
            Message: Buffer.from(message),
            SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
            MessageType: 'RAW',
        };
        const result = await this.instance().sign(params).promise();
        const signature = result.Signature.toString('base64');
        if (forJwtSignature) return signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return signature;
    };

    /**
     * verify signature in asymetric way
     * - it tooks around `30ms`
     *
     * @param {*} message any string
     * @param {*} signature signature of Buffer or string(in base64)
     */
    public verify = async (message: string, signature: Buffer | string): Promise<boolean> => {
        if (!message || typeof message !== 'string') throw new Error(`@signature[${message}] is invalid - kms.sign()`);
        const KeyId = this.keyId();
        _inf(NS, `verify(${KeyId}, ${message.substring(0, 10)}...)..`);
        const params: KMS.Types.VerifyRequest = {
            KeyId,
            Message: Buffer.from(message),
            SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
            MessageType: 'RAW',
            Signature: typeof signature === 'string' ? Buffer.from(signature, 'base64') : signature,
        };
        const result = await this.instance().verify(params).promise();
        return result?.SignatureValid;
    };

    /**
     * retrieve public-key for asymetric verification.
     * - used to verify signature with JWT library w/o making request to AWS KMS.
     * - in general, cache this `public-key` to verify locally.
     *
     * @param encoding (optional) encoding type
     */
    public getPublicKey = async (encoding: BufferEncoding = 'base64') => {
        const KeyId = this.keyId();
        _inf(NS, `getPublicKey(${KeyId})..`);
        const params: KMS.Types.GetPublicKeyRequest = {
            KeyId,
        };
        const result = await this.instance().getPublicKey(params).promise();
        return result?.PublicKey.toString(encoding);
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
        const keyId = this.keyId();
        _log(NS, '> key-id =', keyId);

        const encrypted = await this.encrypt(message);
        _log(NS, '> encrypted =', encrypted);

        const decrypted = await this.decrypt(encrypted);
        _log(NS, '> decrypted =', decrypted, '->', message == decrypted ? 'ok' : 'error');

        return { KMS_KEY_ID, keyId, message, encrypted, decrypted };
    }
}
