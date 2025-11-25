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
import { GetPublicKeyCommand, KMSClient, VerifyCommand } from '@aws-sdk/client-kms';
import { expect2, GETERR } from '../../common/test-helper';
import { $U, $engine } from '../../engine';
import { loadProfile } from '../../environ';
import { AWSKMSService, fromBase64, isBase64 } from './aws-kms-service';
import { performance } from 'perf_hooks';
import { AWSModule } from '.';

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
/*
 * class: `MocksAWSKMSService`
 * - use <mock>.json file in `./data/mocks/` instead of real AWS KMS request.
 */
/**
 * AWS SNS Error types for realistic testing
 */
class AWSError extends Error {
    public readonly name: string;
    public readonly code: string;
    public readonly Code: string;
    public readonly Type: string;
    public readonly statusCode: number;
    public readonly $fault: string;
    public readonly $metadata: {
        httpStatusCode: number;
        requestId: string;
        extendedRequestId?: string;
        cfId?: string;
        attempts: number;
        totalRetryDelay: number;
    };
    public readonly Key?: string;

    constructor(code: string, message: string, statusCode: number = 400, key?: string) {
        super(message);
        this.name = code;
        this.code = code;
        this.Code = code;
        this.Type = statusCode >= 400 && statusCode < 500 ? 'Sender' : 'Receiver';
        this.statusCode = statusCode;
        this.$fault = statusCode >= 400 && statusCode < 500 ? 'client' : 'server';
        this.$metadata = {
            httpStatusCode: statusCode,
            requestId: Array.from({ length: 36 }, (_, i) =>
                i === 8 || i === 13 || i === 18 || i === 23 ? '-' : Math.floor(Math.random() * 16).toString(16),
            ).join(''),
            attempts: 1,
            totalRetryDelay: 0,
        };
        if (key) this.Key = key;
    }
}

/**
 * create AWS error instance.
 * @param code - error code
 * @param message - error message
 * @param statusCode - error status code
 * @param key - key for s3 error (optional)
 * @returns AWS error instance
 */
export const mockAwsError = (code: string, message: string, statusCode: number = 400, key?: string): AWSError => {
    return new AWSError(code, message, statusCode, key);
};

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
                    throw mockAwsError('ValidationException', 'Plaintext must be provided and cannot be empty', 400);
                }

                const plaintextString = Buffer.isBuffer(Plaintext) ? Plaintext.toString() : String(Plaintext);

                // Check plaintext size limit (AWS KMS limit is 4096 bytes)
                if (Buffer.byteLength(plaintextString) > 4096) {
                    throw mockAwsError('ValidationException', 'Plaintext must be no longer than 4096 bytes', 400);
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
                    throw mockAwsError('ValidationException', 'CiphertextBlob must be provided', 400);
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
                    throw mockAwsError(
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
                    throw mockAwsError('ValidationException', `Invalid signing algorithm: ${SigningAlgorithm}`, 400);
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
                    throw mockAwsError('ValidationException', 'Invalid signature', 400);
                }
                if (KeyId === 'invalid-key') {
                    throw mockAwsError('ValidationException', 'Invalid key', 400);
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
                    throw mockAwsError('ValidationException', 'KeyId must be provided', 400);
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

//! main test body.
describe('AWSKMSService', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* test w/ aws-kms-service
    it('should pass aws-kms-service()', async () => {
        //NOTE - use `alias/lemon-hello-api` by default
        const keyId = 'alias/lemon-hello-api';
        const service = new AWSKMSService(keyId);
        const message = `hello lemon!`;

        expect2(service.hello()).toEqual(`aws-kms-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        expect2(() => Buffer.from('\n한/글!(.').toString('base64')).toEqual('Cu2VnC/quIAhKC4=');
        expect2(() => fromBase64(Buffer.from('\n한/글!(.').toString('base64'))).toEqual('Cu2VnC_quIAhKC4');

        //* break if no profile loaded.
        if (!PROFILE) return;

        //* run encrypt/decrypt
        expect2(await service.sample(), 'keyId,message,decrypted').toEqual({ keyId, message, decrypted: message });
    });

    //* test of asymetric signing
    it('should pass asymetric signing(for JWT Token)', async () => {
        //* make KMS custom-key for this test.
        const alias = `lemon-identity-key`;
        const keyId = `alias/${alias}`;
        const service = new AWSKMSService(keyId);

        expect2(service.hello()).toEqual(`aws-kms-service:${keyId}`);
        expect2(service.keyId()).toEqual(keyId);

        //* break if no profile loaded.
        if (!PROFILE) return;

        expect2(await service.sign(null as any).catch(GETERR)).toEqual('@message[null] is invalid - kms.sign()');
        expect2(await service.sign('').catch(GETERR)).toEqual('@message[] is invalid - kms.sign()');
        expect2(await service.sign(0 as any).catch(GETERR)).toEqual('@message[0] is invalid - kms.sign()');

        //* sign()
        const message = $U.json({ iat: Math.floor(Date.now() / 1000), iss: alias });
        const signature = await service.sign(message);
        console.log(`! signature =`, signature);
        expect2(() => signature.length).toEqual(342);
        expect2(() => /^[a-zA-Z0-9_\-]+$/.test(signature)).toEqual(true);

        //* verify()
        if (1) {
            const signature = await service.sign(message, false);
            const perf = $perf();
            const verified1 = await service.verify(message, signature);
            expect2(() => verified1).toEqual(true);
            const verified2 = await service.verify(message, signature);
            expect2(() => verified2).toEqual(true);
            console.log(`! took =`, perf.took()); //* ~75ms in Mac M1
        }

        //* public-key()
        if (1) {
            const perf = $perf();
            const pubKey = await service.getPublicKey();
            console.log(`! public =`, pubKey);
            console.log(`! took =`, perf.took()); //* ~30ms in Mac M1
        }
    });

    //* test utility functions
    it('should pass utility functions', async () => {
        //* test isBase64()
        expect2(() => isBase64('SGVsbG8gV29ybGQ=')).toEqual(true);
        expect2(() => isBase64('SGVsbG8gV29ybGQ')).toEqual(false); // missing padding
        expect2(() => isBase64('SGVsbG8gV29ybGQ=')).toEqual(true);
        expect2(() => isBase64('invalid-base64!')).toEqual(false);
        expect2(() => isBase64('')).toEqual(false);
        expect2(() => isBase64('A')).toEqual(false);
        expect2(() => isBase64('AB')).toEqual(false);
        expect2(() => isBase64('ABC')).toEqual(false);
        expect2(() => isBase64('ABCD')).toEqual(true);
    });

    //* test basic methods
    it('should pass basic methods', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);

        //* test name() method
        expect2(() => service.name()).toEqual('KMS');

        //* test keyId() with valid key
        expect2(() => service.keyId()).toEqual(keyId);

        //* test keyId() with invalid key - use try/catch for error testing
        const invalidService = new AWSKMSService('');
        try {
            invalidService.keyId();
            expect2(() => 'should throw error').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('.keyId<string> (string) is required!');
        }

        // Note: null is converted to default value by constructor, so test with direct manipulation
        const nullService = new AWSKMSService('test');
        (nullService as any)._keyId = null; // directly set to null to trigger error
        try {
            nullService.keyId();
            expect2(() => 'should throw error').toEqual('error not thrown');
        } catch (e) {
            expect2(() => e.message).toEqual('.keyId<object> (string) is required!');
        }
    });

    //* test mock service functionality with actual parameter reflection
    it('should pass mock service operations', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);
        (service as any)._instance = new MocksAWSKMSService();

        //* test encrypt/decrypt with actual round-trip
        const message = 'hello world';
        const encrypted = await service.encrypt(message);

        // Verify encrypt result structure and content
        expect2(() => isBase64(encrypted)).toEqual(true);
        const decryptedBuffer = Buffer.from(encrypted, 'base64');
        const decryptedString = decryptedBuffer.toString();
        expect2(() => decryptedString).toEqual(`ENCRYPTED:${message}:${keyId}`);

        // Test actual decrypt round-trip
        const decrypted = await service.decrypt(encrypted);
        expect2(() => decrypted).toEqual(message); // Should get original message back

        //* test sign/verify with actual round-trip
        const testMessage = 'test message for signing';
        const signature = await service.sign(testMessage, false); // get base64 signature

        // Verify signature structure
        expect2(() => isBase64(signature)).toEqual(true);
        const signatureBuffer = Buffer.from(signature, 'base64');
        const expectedSigContent = `SIGNATURE:${testMessage}:${keyId}:RSASSA_PKCS1_V1_5_SHA_256`;
        expect2(() => signatureBuffer.toString()).toEqual(expectedSigContent);

        // Test actual verify round-trip
        const verified = await service.verify(testMessage, signature, { throwable: false });
        expect2(() => verified).toEqual(true);

        // Test verify with wrong message (should fail)
        const verifiedWrong = await service.verify('wrong message', signature, { throwable: false });
        expect2(() => verifiedWrong).toEqual(false);

        //* test JWT signature format
        const jwtSignature = await service.sign(testMessage, true);
        expect2(() => jwtSignature).toEqual(fromBase64(signature));

        //* test getPublicKey with actual KeyId reflection
        const pubKey = await service.getPublicKey();
        const expectedPubKey = Buffer.from(`PUBLIC_KEY:${keyId}:RSA_2048`).toString('base64');
        expect2(() => pubKey).toEqual(expectedPubKey);

        const pubKeyHex = await service.getPublicKey('hex');
        const expectedPubKeyHex = Buffer.from(`PUBLIC_KEY:${keyId}:RSA_2048`).toString('hex');
        expect2(() => pubKeyHex).toEqual(expectedPubKeyHex);

        //* test sample method with actual round-trip
        const result = await service.sample();
        expect2(() => result.message).toEqual('hello lemon!');
        expect2(() => result.keyId).toEqual(keyId);
        expect2(() => result.decrypted).toEqual(result.message); // Should decrypt to original

        // Verify KMS_KEY_ID environment variable is used
        const expectedKmsKeyId = $engine.environ(AWSKMSService.ENV_KMS_KEY_ID, AWSKMSService.DEF_KMS_TARGET);
        expect2(() => result.KMS_KEY_ID).toEqual(expectedKmsKeyId);
    });

    //* test error cases
    it('should pass error handling', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);
        (service as any)._instance = new MocksAWSKMSService();

        //* test sign() with invalid parameters
        expect2(await service.sign(null as any).catch(GETERR)).toEqual('@message[null] is invalid - kms.sign()');
        expect2(await service.sign('').catch(GETERR)).toEqual('@message[] is invalid - kms.sign()');
        expect2(await service.sign(0 as any).catch(GETERR)).toEqual('@message[0] is invalid - kms.sign()');

        //* test verify() with invalid parameters
        expect2(await service.verify(null as any, 'signature').catch(GETERR)).toEqual(
            '@message[null] is invalid - kms.verify()',
        );
        expect2(await service.verify('', 'signature').catch(GETERR)).toEqual('@message[] is invalid - kms.verify()');
        expect2(await service.verify('message', null as any).catch(GETERR)).toEqual(
            '@signature (string|Buffer) is required - kms.verify()',
        );
        expect2(await service.verify('message', '').catch(GETERR)).toEqual(
            '@signature (string|Buffer) is required - kms.verify()',
        );

        //* test sign with forJwtSignature=false
        const message = 'test message for error handling';
        const signature = await service.sign(message, false);
        expect2(() => isBase64(signature)).toEqual(true);

        // Verify signature content matches expected format
        const signatureBuffer = Buffer.from(signature, 'base64');
        const expectedContent = `SIGNATURE:${message}:${keyId}:RSASSA_PKCS1_V1_5_SHA_256`;
        expect2(() => signatureBuffer.toString()).toEqual(expectedContent);
    });

    //* test constructor variations
    it('should pass constructor variations', async () => {
        //* test default constructor (no parameters)
        const service1 = new AWSKMSService();
        expect2(() => service1.keyId()).toEqual('alias/lemon-hello-api');

        //* test with algorithm options
        const options = { algorithm: 'RSASSA_PSS_SHA_256' as any };
        const service2 = new AWSKMSService('alias/test-with-options', options);
        (service2 as any)._instance = new MocksAWSKMSService();
        expect2(() => service2.keyId()).toEqual('alias/test-with-options');

        // Test that algorithm option is actually used
        const message = 'test message with custom algorithm';
        const signature = await service2.sign(message, false);
        const signatureBuffer = Buffer.from(signature, 'base64');
        const expectedContent = `SIGNATURE:${message}:alias/test-with-options:RSASSA_PSS_SHA_256`;
        expect2(() => signatureBuffer.toString()).toEqual(expectedContent);

        // Test verify with custom algorithm
        const verified = await service2.verify(message, signature, { throwable: false });
        expect2(() => verified).toEqual(true);

        //* test with keyId only
        const service3 = new AWSKMSService('alias/test');
        expect2(() => service3.keyId()).toEqual('alias/test');
    });

    //* test invalid ciphertext handling
    it('should pass invalid ciphertext handling', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);
        (service as any)._instance = new MocksAWSKMSService();

        //* test decrypt with invalid ciphertext format
        expect2(await service.decrypt('invalid-ciphertext').catch(GETERR)).toEqual(
            'The ciphertext refers to a customer master key that does not exist, does not exist in this region, or you are not allowed to access.',
        );
    });

    //* test AWS KMS validation errors
    it('should pass AWS KMS validation errors', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);
        (service as any)._instance = new MocksAWSKMSService();

        //* test encrypt with empty plaintext
        expect2(await service.encrypt('').catch(GETERR)).toEqual('Plaintext must be provided and cannot be empty');

        //* test encrypt with oversized plaintext (>4096 bytes)
        const largePlaintext = 'a'.repeat(4097);
        expect2(await service.encrypt(largePlaintext).catch(GETERR)).toEqual(
            'Plaintext must be no longer than 4096 bytes',
        );

        //* test decrypt with empty ciphertext
        expect2(await service.decrypt('').catch(GETERR)).toEqual('CiphertextBlob must be provided');

        //* test sign with empty message
        expect2(await service.sign('').catch(GETERR)).toEqual('@message[] is invalid - kms.sign()');

        //* test sign with invalid algorithm (through options)
        const invalidAlgService = new AWSKMSService(keyId, { algorithm: 'INVALID_ALGORITHM' as any });
        (invalidAlgService as any)._instance = new MocksAWSKMSService();
        expect2(await invalidAlgService.sign('test message').catch(GETERR)).toEqual(
            'Invalid signing algorithm: INVALID_ALGORITHM',
        );

        //* test verify with empty parameters
        expect2(await service.verify('', 'signature').catch(GETERR)).toEqual('@message[] is invalid - kms.verify()');
        expect2(await service.verify('message', '').catch(GETERR)).toEqual(
            '@signature (string|Buffer) is required - kms.verify()',
        );

        const invalidKeyService = new AWSKMSService('invalid-key');
        (invalidKeyService as any)._instance = new MocksAWSKMSService();
        expect2(await invalidKeyService.verify('message', 'signature').catch(GETERR)).toEqual(undefined);

        //* test direct mock command validation
        const mockInstance = service.instance() as any;

        // Test GetPublicKeyCommand with empty KeyId
        const getPublicKeyCommand = new GetPublicKeyCommand({ KeyId: '' });
        expect2(await mockInstance.send(getPublicKeyCommand).catch(GETERR)).toEqual('KeyId must be provided');

        // Test VerifyCommand with empty Signature
        const verifyCommand = new VerifyCommand({
            KeyId: keyId,
            Message: new Uint8Array(),
            Signature: 'invalid-signature' as any,
            SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
        });
        expect2(await mockInstance.send(verifyCommand).catch(GETERR)).toEqual('Invalid signature');
    });

    //* test verify with invalid signature
    it('should pass verify with invalid signature', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);
        (service as any)._instance = new MocksAWSKMSService();

        //* test verify with completely wrong signature (should return false)
        const result = await service.verify('test message', 'invalid-signature', { throwable: false });
        expect2(() => result).toEqual(false);

        //* test verify with correct message and signature (should return true)
        const message = 'test message for verification';
        const signature = await service.sign(message, false);
        const verified = await service.verify(message, signature, { throwable: false });
        expect2(() => verified).toEqual(true);
    });

    //* test real AWS instance creation (without mock)
    it('should pass real instance creation', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);

        //* test instance creation
        const instance = service.instance();
        expect2(() => instance).toBeDefined();
        expect2(() => instance.constructor.name).toEqual('KMSClient');

        //* test instance caching
        const instance2 = service.instance();
        expect2(() => instance === instance2).toEqual(true);
    });
    //* test environment variable fallback
    it('should pass environment variable handling', async () => {
        //* backup original env
        const originalEnv = process.env.KMS_KEY_ID;

        //* test with env variable set
        process.env.KMS_KEY_ID = 'alias/env-test-key';
        const service1 = new AWSKMSService();
        expect2(() => service1.keyId()).toEqual('alias/env-test-key');

        //* test with env variable unset
        delete process.env.KMS_KEY_ID;
        const service2 = new AWSKMSService();
        expect2(() => service2.keyId()).toEqual('alias/lemon-hello-api');

        //* restore original env
        if (originalEnv) process.env.KMS_KEY_ID = originalEnv;
    });

    //* test utility functions coverage
    it('should pass utility functions coverage', async () => {
        //* test region function indirectly
        const originalRegion = process.env.REGION;

        //* test with REGION env set
        process.env.REGION = 'us-west-2';
        // Region function is not exported, so we'll test it indirectly through instance creation

        //* test instance function by creating service
        const service = new AWSKMSService('alias/test');
        const instance1 = service.instance();
        expect2(() => instance1).toBeDefined();

        //* restore original env
        if (originalRegion) process.env.REGION = originalRegion;
        else delete process.env.REGION;
    });

    //* test Buffer signature verification
    it('should pass Buffer signature verification', async () => {
        const keyId = 'alias/test-key';
        const service = new AWSKMSService(keyId);
        (service as any)._instance = new MocksAWSKMSService();

        //* test verify with Buffer signature - create proper signature first
        const message = 'test message for buffer verification';
        const signature = await service.sign(message, false);
        const bufferSignature = Buffer.from(signature, 'base64');

        // Verify with Buffer signature (should work same as string)
        const verified = await service.verify(message, bufferSignature as any, { throwable: false });
        expect2(() => verified).toEqual(true);

        //* test with wrong Buffer signature
        const wrongBufferSignature = Buffer.from('wrong-signature-content');
        const verifiedWrong = await service.verify(message, wrongBufferSignature as any, { throwable: false });
        expect2(() => verifiedWrong).toEqual(false);
    });
});

describe('index.ts test coverage', () => {
    it('should pass index.ts test coverage', async () => {
        const testModule = new AWSModule();
        expect2(await testModule.initModule(undefined)).toEqual(1);
    });
});
