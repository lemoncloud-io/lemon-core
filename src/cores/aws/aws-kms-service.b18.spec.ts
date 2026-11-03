/**
 * `aws-kms-service.b18.spec.ts`
 * - v5 B18: offline unit test of `AWSKMSService` (the SDK client `send()` is stubbed; no AWS call).
 * - checks KeyId / SigningAlgorithm / MessageType of each command, and the base64 mapping of results.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    KMSClient,
    EncryptCommand,
    DecryptCommand,
    SignCommand,
    VerifyCommand,
    GetPublicKeyCommand,
} from '@aws-sdk/client-kms';
import { AWSKMSService, fromBase64, isBase64 } from './aws-kms-service';
import { GETERR } from '../../common/test-helper';

//* v5 B18: dummy key ARN (not a real key).
const KEY_ID = 'arn:aws:kms:ap-northeast-2:123456789012:key/dummy';

describe('AWSKMSService (B18 offline)', () => {
    let send: ReturnType<typeof vi.fn>;
    // stub the client boundary; no env credentials, so `decrypt()` takes the SDK path.
    beforeEach(() => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', '');
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', '');
        send = vi.fn();
        vi.spyOn(KMSClient.prototype, 'send').mockImplementation(((cmd: any) => send(cmd)) as any);
    });
    // restore the spy and env after each case.
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });
    // the command passed to `send()` at call `n`.
    const cmdOf = (n = 0) => send.mock.calls[n][0];

    it('B18 helpers and keyId()', () => {
        expect(isBase64('aGVsbG8=')).toBe(true);
        expect(isBase64('not base64!')).toBe(false);
        expect(fromBase64('a+b/c==')).toBe('a-b_c');

        const kms = new AWSKMSService(KEY_ID);
        expect(kms.name()).toBe('KMS');
        expect(kms.hello()).toBe(`aws-kms-service:${KEY_ID}`);
        expect(kms.keyId()).toBe(KEY_ID);
        //* the client is created once, and cached.
        expect(kms.instance()).toBe(kms.instance());

        //* env `KMS_KEY_ID` is the default key.
        vi.stubEnv('KMS_KEY_ID', 'alias/test-key');
        expect(new AWSKMSService().keyId()).toBe('alias/test-key');
        //* invalid key-id.
        expect(() => new AWSKMSService('').keyId()).toThrow('.keyId<string> (string) is required!');
        expect(() => new AWSKMSService(1 as any).keyId()).toThrow('.keyId<number> (string) is required!');
    });

    it('B18 encrypt() sends KeyId + Plaintext, and returns base64', async () => {
        const kms = new AWSKMSService(KEY_ID);
        send.mockResolvedValueOnce({ CiphertextBlob: Uint8Array.from(Buffer.from('cipher')) });
        expect(await kms.encrypt('hello lemon')).toBe(Buffer.from('cipher').toString('base64'));
        expect(cmdOf()).toBeInstanceOf(EncryptCommand);
        expect(cmdOf().input.KeyId).toBe(KEY_ID);
        expect(Buffer.from(cmdOf().input.Plaintext).toString()).toBe('hello lemon');

        //* no blob: the message as is.
        send.mockResolvedValueOnce({});
        expect(await kms.encrypt('plain')).toBe('plain');
    });

    it('B18 decrypt() via the SDK when no env credentials', async () => {
        const kms = new AWSKMSService(KEY_ID);
        const blob = Buffer.from('cipher').toString('base64');
        send.mockResolvedValueOnce({ Plaintext: Uint8Array.from(Buffer.from('hello lemon')) });
        expect(await kms.decrypt(blob)).toBe('hello lemon');
        expect(cmdOf()).toBeInstanceOf(DecryptCommand);
        expect(Buffer.from(cmdOf().input.CiphertextBlob).toString()).toBe('cipher');

        send.mockResolvedValueOnce({});
        expect(await kms.decrypt(blob)).toBe('');
    });

    it('B18 sign() uses RSASSA_PKCS1_V1_5_SHA_256 by default, and the JWT form', async () => {
        const kms = new AWSKMSService(KEY_ID);
        expect(await kms.sign('').catch(GETERR)).toBe('@message[] is invalid - kms.sign()');

        const sig = Buffer.from([0xfb, 0xff, 0xfe, 0x01]);
        send.mockResolvedValue({ Signature: Uint8Array.from(sig) });
        expect(await kms.sign('hello')).toBe(fromBase64(sig.toString('base64')));
        expect(cmdOf()).toBeInstanceOf(SignCommand);
        expect(cmdOf().input).toMatchObject({
            KeyId: KEY_ID,
            SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
            MessageType: 'RAW',
        });
        expect(Buffer.from(cmdOf().input.Message).toString()).toBe('hello');
        //* plain base64 if not for JWT.
        expect(await kms.sign('hello', false)).toBe(sig.toString('base64'));

        //* the algorithm option.
        const kms2 = new AWSKMSService(KEY_ID, { algorithm: 'ECDSA_SHA_256' });
        await kms2.sign('hello');
        expect(cmdOf(2).input.SigningAlgorithm).toBe('ECDSA_SHA_256');

        //* no signature.
        send.mockResolvedValue({});
        expect(await kms.sign('hello')).toBe('');
    });

    it('B18 verify() maps SignatureValid, and swallows errors unless throwable', async () => {
        const kms = new AWSKMSService(KEY_ID);
        expect(await kms.verify('', 'sig').catch(GETERR)).toBe('@message[] is invalid - kms.verify()');
        expect(await kms.verify('msg', '').catch(GETERR)).toBe('@signature (string|Buffer) is required - kms.verify()');

        send.mockResolvedValueOnce({ SignatureValid: true });
        expect(await kms.verify('msg', Buffer.from('sig').toString('base64'))).toBe(true);
        expect(cmdOf()).toBeInstanceOf(VerifyCommand);
        expect(cmdOf().input).toMatchObject({ KeyId: KEY_ID, SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256' });
        expect(Buffer.from(cmdOf().input.Signature).toString()).toBe('sig');

        //* a buffer signature is passed as is.
        const buf = Buffer.from('raw');
        send.mockResolvedValueOnce({ SignatureValid: false });
        expect(await kms.verify('msg', buf as any)).toBe(false);
        expect(cmdOf(1).input.Signature).toBe(buf);

        //* error: `undefined` by default, thrown if throwable.
        send.mockRejectedValueOnce(new Error('KMSInvalidSignatureException'));
        expect(await kms.verify('msg', 'c2ln')).toBeUndefined();
        send.mockRejectedValueOnce(new Error('KMSInvalidSignatureException'));
        expect(await kms.verify('msg', 'c2ln', { throwable: true }).catch(GETERR)).toBe('KMSInvalidSignatureException');
    });

    it('B18 getPublicKey() encodes the key', async () => {
        const kms = new AWSKMSService(KEY_ID);
        const key = Buffer.from('public-key');
        send.mockResolvedValue({ PublicKey: Uint8Array.from(key) });
        expect(await kms.getPublicKey()).toBe(key.toString('base64'));
        expect(cmdOf()).toBeInstanceOf(GetPublicKeyCommand);
        expect(cmdOf().input).toEqual({ KeyId: KEY_ID });
        expect(await kms.getPublicKey('hex')).toBe(key.toString('hex'));

        send.mockResolvedValue({});
        expect(await kms.getPublicKey()).toBe('');
    });

    it('B18 sample() runs encrypt then decrypt', async () => {
        vi.stubEnv('KMS_KEY_ID', KEY_ID);
        const kms = new AWSKMSService();
        const cipher = Buffer.from('cipher');
        // reply by the command type.
        send.mockImplementation(async (cmd: any) =>
            cmd instanceof EncryptCommand
                ? { CiphertextBlob: Uint8Array.from(cipher) }
                : { Plaintext: Uint8Array.from(Buffer.from('hello lemon!')) },
        );
        expect(await kms.sample()).toEqual({
            KMS_KEY_ID: KEY_ID,
            keyId: KEY_ID,
            message: 'hello lemon!',
            encrypted: cipher.toString('base64'),
            decrypted: 'hello lemon!',
        });
    });
});
