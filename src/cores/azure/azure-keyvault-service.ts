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
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-09-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { $engine, _log, _inf, _err, $U } from '../../engine';
// import AWS, { KMS } from 'aws-sdk';
// import { SigningAlgorithmSpec } from 'aws-sdk/clients/kms';
import { CoreKmsService } from '../core-services';
import 'dotenv/config'
const NS = $U.NS('AZKV', 'blue'); // NAMESPACE TO BE PRINTED.

// type MySigningAlgorithm = SigningAlgorithmSpec;
const ALIAS = `lemon-hello-api`; //NOTE - use env[KMS_KEY_ID] to overide.
const region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;
//! get aws client for KMS
// const instance = () => {
//     const _region = region();
//     const config = { region: _region };
//     return new AWS.KMS(config);
// };

const instance = () => {
    return (KeyVaultService as any).instance();
};
export type EncryptResult = ReturnType<typeof instance>['EncryptResult'];
export type DecryptResult = ReturnType<typeof instance>['DecryptResult'];
/**
 * check if base64 string.
 */
export const isBase64 = (text: string) =>
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/.test(text);

/**
 * normal base64 to url encoded.
 */
export const fromBase64 = (base64: string) => base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * additional options for KMS signing.
 */
export interface AWSKMSSignOption {
    /**
     * algorithm used to sign and verify.
     * (default RSASSA_PKCS1_V1_5_SHA_256)
     */
    algorithm?: EncryptionAlgorithm;
}
type EncryptionAlgorithm = string
/**
 * class: `KeyVaultService`
 * - shared Key Management Service to encrypt/decrypt message.
 */
export class KeyVaultService implements CoreKmsService {
    /**
     * environ name of KMS KEY
     */
    public static ENV_KMS_KEY_ID = 'KMS_KEY_ID';
    public static DEF_KMS_TARGET = `key-lemon`;

    private _keyId: string;
    private _options: AWSKMSSignOption;
    public constructor(keyId?: string, options?: AWSKMSSignOption) {
        
        keyId = keyId ?? `${$engine.environ(KeyVaultService.ENV_KMS_KEY_ID, KeyVaultService.DEF_KMS_TARGET)}`;
        keyId = process.env.AZ_KEY ?? keyId
        this._keyId = keyId;
        this._options = options;
    }

    /**
     * get name of this
     */
    public name = () => `KMS`;

    /**
     * hello
     */
    public hello = () => `azure-keyvault-service:${this._keyId}`;

    /**
     * get key-id to encrypt.
     */
    public keyId = () => {
        if (!this._keyId || typeof this._keyId !== 'string')
            throw new Error(`.keyId<${typeof this._keyId}> (string) is required!`);
        return this._keyId;
    };

    public instance = () => {
        const { KeyClient, CryptographyClient, EncryptResult, DecryptResult } = require("@azure/keyvault-keys");
        const { DefaultAzureCredential } = require("@azure/identity");
        const keyVault = process.env.AZ_KEY_VAULT
        const vaultUrl = `https://${keyVault}.vault.azure.net/`;
        const credentials = new DefaultAzureCredential();
        const keyClient = new KeyClient(vaultUrl, credentials);
        return { keyClient, credentials, CryptographyClient, EncryptResult, DecryptResult }
    };

    /**
     * get KMS instance in stock
     */
    // public instance() {
    //     if (!this._instance) this._instance = instance();
    //     return this._instance;
    // }

    /**
     * Encrypt message
     *
     * @param {*} message
     */
    public encrypt = async (message: string): Promise<any> => {
        const keyId = this.keyId();
        _inf(NS, `encrypt(${keyId}, ${message.substring(0, 10)}...)..`);
        const { keyClient, credentials, CryptographyClient } = this.instance();
        const keyVaultKey = await keyClient.getKey(keyId);
        const cryptographyClient = new CryptographyClient(keyVaultKey, credentials);

        try{
            const EncryptResult: EncryptResult = await cryptographyClient.encrypt({
                algorithm: "RSA1_5",
                plaintext: Buffer.from(message)
            });
            if(!Buffer.from(EncryptResult.result, 'hex').toString('base64')){
                throw new Error(`buffered ${EncryptResult} (string) is required!`);
            }
            return (Buffer.from(EncryptResult.result, 'hex').toString('base64'))
        }
       
        catch(err){
            console.log(err)
        }
    };

    /**
     * Decrypt message
     *
     * @param {*} encryptedSecret
     */
    public decrypt = async (encryptedSecret: any): Promise<any> => {
        _inf(NS, `decrypt(${encryptedSecret.substring(0, 12)}...)..`);

        const bufferedEncryptedSecret = Buffer.from(encryptedSecret, 'base64');
        if(!bufferedEncryptedSecret){
            throw new Error(`${bufferedEncryptedSecret} (string) is required!`);
        }
        const keyId = this.keyId();
        const { keyClient, credentials, CryptographyClient } = this.instance();
        const keyVaultKey = await keyClient.getKey(keyId);
        const cryptographyClient = new CryptographyClient(keyVaultKey, credentials);

        try{
            const decryptedSecret: DecryptResult= await cryptographyClient.decrypt({
                algorithm: "RSA1_5",
                ciphertext: bufferedEncryptedSecret
            });
            return decryptedSecret.result.toString();
        }
        catch(err){
            console.log(err)
        }
    };

    /**
     * make signature by message
     *
     * @param {*} message any string
     * @param forJwtSignature (option) flag to get JWT signature format.
     */
    public sign = async (message: any, forJwtSignature = true): Promise<any> => {
        if (!message || typeof message !== 'string') throw new Error(`@message[${message}] is invalid - kms.sign()`);
        const keyId = this.keyId();
        const { keyClient, credentials, CryptographyClient } = this.instance();
        const keyVaultKey = await keyClient.getKey(keyId);
        const cryptographyClient = new CryptographyClient(keyVaultKey.id, credentials);
        _inf(NS, `sign(${keyId}, ${message.substring(0, 10)}...)..`);
        const result = await cryptographyClient.signData("RS256", Buffer.from(message));
        const signature = result.result;
        return signature;
    };

    /**
     * verify signature in asymetric way
     * - it tooks around `30ms`
     *
     * @param {*} message any string
     * @param {*} signature signature of Buffer or string(in base64)
     */
    public verify = async (message: any, signature: any): Promise<any> => {
        if (!message || typeof message !== 'string') throw new Error(`@message[${message}] is invalid - kms.verify()`);
        if (!signature) throw new Error(`@signature (string|Buffer) is required - kms.verify()`);
        const keyId = this.keyId();
        const { keyClient, credentials, CryptographyClient } = this.instance();
        const keyVaultKey = await keyClient.getKey(keyId);
        const cryptographyClient = new CryptographyClient(keyVaultKey.id, credentials);
        _inf(NS, `verify(${keyId}, ${message.substring(0, 10)}...)..`);
        const result = await cryptographyClient.verifyData("RS256", Buffer.from(message), Buffer.from(signature));
        return result.result;
    };

    /**
     * retrieve public-key for asymetric verification.
     * - used to verify signature with JWT library w/o making request to AWS KMS.
     * - in general, cache this `public-key` to verify locally.
     *
     * @param encoding (optional) encoding type
     */
    public getPublicKey = async (encoding: BufferEncoding = 'base64') => {
        const keyId = this.keyId();
        _inf(NS, `getPublicKey(${keyId})..`);
        const { keyClient } = this.instance();
        const result = await keyClient.getKey(keyId);
        return result.toString();
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
        const KMS_KEY_ID = $engine.environ(KeyVaultService.ENV_KMS_KEY_ID, `alias/${ALIAS}`) as string;
        const keyId = this.keyId();
        _log(NS, '> key-id =', keyId);

        const encrypted = await this.encrypt(message);
        _log(NS, '> encrypted =', encrypted);

        const decrypted = await this.decrypt(encrypted);
        _log(NS, '> decrypted =', decrypted, '->', message == decrypted ? 'ok' : 'error');

        return { KMS_KEY_ID, keyId, message, encrypted, decrypted };
    }
}
