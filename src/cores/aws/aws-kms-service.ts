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
import { KMSClient, SignCommand, SigningAlgorithmSpec } from '@aws-sdk/client-kms';
import { GetPublicKeyCommand, EncryptCommand, DecryptCommand, VerifyCommand } from '@aws-sdk/client-kms';
// eslint-disable-next-line prettier/prettier
import { EncryptCommandInput, DecryptCommandInput, GetPublicKeyCommandInput, SignCommandInput, VerifyCommandInput } from '@aws-sdk/client-kms';
import { CoreKmsService } from '../core-services';
import { awsConfig } from '../../tools';
import { GETERR } from '../../common/test-helper';
const NS = $U.NS('KMSS', 'blue'); // NAMESPACE TO BE PRINTED.

type MySigningAlgorithm = SigningAlgorithmSpec;
const ALIAS = `lemon-hello-api`; //NOTE - use env[KMS_KEY_ID] to overide.
const region = (): string => $engine.environ('REGION', 'ap-northeast-2') as string;

const instance = () => {
    const cfg = awsConfig($engine, region());
    return new KMSClient(cfg);
};

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
    algorithm?: MySigningAlgorithm;
}

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
    private _options: AWSKMSSignOption;
    public constructor(keyId?: string, options?: AWSKMSSignOption) {
        keyId = keyId ?? `${$engine.environ(AWSKMSService.ENV_KMS_KEY_ID, AWSKMSService.DEF_KMS_TARGET)}`;
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
    public hello = () => `aws-kms-service:${this._keyId}`;

    /**
     * get key-id to encrypt.
     */
    public keyId = () => {
        if (!this._keyId || typeof this._keyId !== 'string')
            throw new Error(`.keyId<${typeof this._keyId}> (string) is required!`);
        return this._keyId;
    };

    protected _instance: KMSClient;
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
        const params: EncryptCommandInput = {
            KeyId,
            Plaintext: Buffer.from(message),
        };
        const result = await this.instance().send(new EncryptCommand(params));
        _log(NS, '> result =', result);
        const ciphertext = result.CiphertextBlob ? Buffer.from(result.CiphertextBlob).toString('base64') : message;
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
        const CiphertextBlob = Buffer.from(encryptedSecret, 'base64');

        //* api param.
        const params: DecryptCommandInput = { CiphertextBlob: CiphertextBlob as Uint8Array };
        const data: any = await this.instance().send(new DecryptCommand(params));
        // _log(NS, '> data.type =', typeof data);
        return data?.Plaintext ? Buffer.from(data.Plaintext).toString('utf-8') : '';
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

        const params: SignCommandInput = {
            KeyId,
            Message: Buffer.from(message),
            SigningAlgorithm: this._options?.algorithm ?? 'RSASSA_PKCS1_V1_5_SHA_256',
            MessageType: 'RAW',
        };
        const result = await this.instance().send(new SignCommand(params));
        const signature = result.Signature ? Buffer.from(result.Signature).toString('base64') : '';
        if (forJwtSignature) return fromBase64(signature);
        return signature;
    };

    /**
     * verify signature in asymetric way
     * - it tooks around `30ms`
     *
     * @param {*} message any string
     * @param {*} signature signature of Buffer or string(in base64)
     */
    public verify = async (message: string, signature: string, options?: { throwable?: boolean }): Promise<boolean> => {
        const errScope = `kms.verify()`;
        const throwable = options?.throwable ?? false;
        if (!message || typeof message !== 'string') throw new Error(`@message[${message}] is invalid - ${errScope}`);
        if (!signature) throw new Error(`@signature (string|Buffer) is required - ${errScope}`);
        const KeyId = this.keyId();
        _inf(NS, `verify(${KeyId}, ${message.substring(0, 10)}...)..`);
        const params: VerifyCommandInput = {
            KeyId,
            Message: Buffer.from(message),
            SigningAlgorithm: this._options?.algorithm ?? 'RSASSA_PKCS1_V1_5_SHA_256',
            MessageType: 'RAW',
            Signature: typeof signature === 'string' ? Buffer.from(signature, 'base64') : signature,
        };
        const result = await this.instance()
            .send(new VerifyCommand(params))
            .catch(e => {
                if (throwable) throw e;
                _err(NS, `! err =`, GETERR(e), e);
                return null as any;
            });
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
        const params: GetPublicKeyCommandInput = {
            KeyId,
        };
        const result = await this.instance().send(new GetPublicKeyCommand(params));
        return result?.PublicKey ? Buffer.from(result.PublicKey).toString(encoding) : '';
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

        //* check key-id.
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

/*
 * class: `MocksAWSKMSService`
 * - use <mock>.json file in `./data/mocks/` instead of real AWS KMS request.
 */
/**
 * AWS KMS Error types for realistic testing
 */
class AWSKMSError extends Error {
    public readonly name: string;
    public readonly code: string;
    public readonly statusCode: number;

    constructor(code: string, message: string, statusCode: number = 400) {
        super(message);
        this.name = 'AWSKMSError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

export class MocksAWSKMSService extends KMSClient {

    public constructor() {
        super();
    }

    public send = async (command: any) => {
        const commandName = command.constructor.name;

        // Mock responses based on command type - reflect actual parameters with realistic error checking
        switch (commandName) {
            case 'EncryptCommand': {
                const { KeyId, Plaintext } = command.input;

                // Validate input parameters like real AWS KMS
                if (!Plaintext || (Buffer.isBuffer(Plaintext) && Plaintext.length === 0)) {
                    throw new AWSKMSError('ValidationException', 'Plaintext must be provided and cannot be empty', 400);
                }

                const plaintextString = Buffer.isBuffer(Plaintext) ? Plaintext.toString() : String(Plaintext);

                // Check plaintext size limit (AWS KMS limit is 4096 bytes)
                if (Buffer.byteLength(plaintextString) > 4096) {
                    throw new AWSKMSError('ValidationException', 'Plaintext must be no longer than 4096 bytes', 400);
                }

                // Simulate encryption by base64 encoding the plaintext with a prefix
                const mockEncrypted = Buffer.from(`ENCRYPTED:${plaintextString}:${KeyId}`);
                return {
                    CiphertextBlob: mockEncrypted,
                    KeyId: KeyId,
                    EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
                };
            }
            case 'DecryptCommand': {
                const { CiphertextBlob } = command.input;

                // Validate input parameters first
                if (
                    !CiphertextBlob ||
                    (Buffer.isBuffer(CiphertextBlob) && CiphertextBlob.length === 0) ||
                    (typeof CiphertextBlob === 'string' && CiphertextBlob === '')
                ) {
                    throw new AWSKMSError('ValidationException', 'CiphertextBlob must be provided', 400);
                }

                const ciphertextString = Buffer.isBuffer(CiphertextBlob)
                    ? CiphertextBlob.toString()
                    : String(CiphertextBlob);

                // Extract KeyId from ciphertext for error checking
                let keyIdFromCiphertext = 'unknown';
                if (ciphertextString.startsWith('ENCRYPTED:')) {
                    const parts = ciphertextString.split(':');
                    if (parts.length >= 3) {
                        keyIdFromCiphertext = parts[2];
                    }
                } else {
                    // Invalid ciphertext format
                    throw new AWSKMSError(
                        'InvalidCiphertextException',
                        'The ciphertext refers to a customer master key that does not exist, does not exist in this region, or you are not allowed to access.',
                        400,
                    );
                }

                // Simulate decryption by extracting original plaintext from mock format
                let plaintext = 'mock-decrypted-data';
                if (ciphertextString.startsWith('ENCRYPTED:')) {
                    const parts = ciphertextString.split(':');
                    if (parts.length >= 3) {
                        plaintext = parts[1]; // Extract original plaintext
                    }
                }

                return {
                    Plaintext: Buffer.from(plaintext),
                    KeyId: keyIdFromCiphertext,
                    EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
                };
            }
            case 'SignCommand': {
                const { KeyId, Message, SigningAlgorithm, MessageType } = command.input;

                const messageString = Buffer.isBuffer(Message) ? Message.toString() : String(Message);

                // Validate signing algorithm
                const validAlgorithms = [
                    'RSASSA_PKCS1_V1_5_SHA_256',
                    'RSASSA_PKCS1_V1_5_SHA_384',
                    'RSASSA_PKCS1_V1_5_SHA_512',
                    'RSASSA_PSS_SHA_256',
                    'RSASSA_PSS_SHA_384',
                    'RSASSA_PSS_SHA_512',
                ];

                if (SigningAlgorithm && !validAlgorithms.includes(SigningAlgorithm)) {
                    throw new AWSKMSError('ValidationException', `Invalid signing algorithm: ${SigningAlgorithm}`, 400);
                }

                // Create deterministic signature based on message content
                const mockSignature = Buffer.from(
                    `SIGNATURE:${messageString}:${KeyId}:${SigningAlgorithm || 'RSASSA_PKCS1_V1_5_SHA_256'}`,
                );
                return {
                    KeyId: KeyId,
                    Signature: mockSignature,
                    SigningAlgorithm: SigningAlgorithm || 'RSASSA_PKCS1_V1_5_SHA_256',
                };
            }
            case 'VerifyCommand': {
                const { KeyId, Message, Signature, SigningAlgorithm } = command.input;

                // Validate input parameters
                if (Signature === 'invalid-signature') {
                    throw new AWSKMSError('ValidationException', 'Invalid signature', 400);
                }
                if (KeyId === 'invalid-key') {
                    throw new AWSKMSError('ValidationException', 'Invalid key', 400);
                }

                const messageString = Buffer.isBuffer(Message) ? Message.toString() : String(Message);
                const signatureString = Buffer.isBuffer(Signature) ? Signature.toString() : String(Signature);

                // Verify by checking if signature matches expected format
                const expectedSignature = `SIGNATURE:${messageString}:${KeyId}:${
                    SigningAlgorithm || 'RSASSA_PKCS1_V1_5_SHA_256'
                }`;
                const isValid = signatureString === expectedSignature;

                return {
                    KeyId: KeyId,
                    SignatureValid: isValid,
                    SigningAlgorithm: SigningAlgorithm || 'RSASSA_PKCS1_V1_5_SHA_256',
                };
            }
            case 'GetPublicKeyCommand': {
                const { KeyId } = command.input;

                // Validate KeyId parameter
                if (!KeyId) {
                    throw new AWSKMSError('ValidationException', 'KeyId must be provided', 400);
                }

                // Create deterministic public key based on KeyId
                const mockPublicKey = Buffer.from(`PUBLIC_KEY:${KeyId}:RSA_2048`);
                return {
                    KeyId: KeyId,
                    PublicKey: mockPublicKey,
                    KeyUsage: 'SIGN_VERIFY',
                    KeySpec: 'RSA_2048',
                    SigningAlgorithms: ['RSASSA_PKCS1_V1_5_SHA_256'],
                };
            }
            default:
                return {
                    Command: command,
                    Mock: true,
                };
        }
    };
}
