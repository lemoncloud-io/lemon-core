/**
 * `kms-fetch.spec.ts`
 * - unit test for `kms-fetch` (v5 B8): KMS `Decrypt` by one SigV4-signed HTTPS call, and the routing in `AWSKMSService.decrypt()`.
 * - offline: the transport is a stub, and the credentials are fake test values.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 initial version
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptViaHttp, hasEnvCredentials, isKmsHttpError, transportOf } from './kms-fetch';
import { PassThrough } from 'stream';
import { AWSKMSService } from './aws-kms-service';

//* fake test credentials (not real keys).
const KEY = 'AKIAEXAMPLEEXAMPLE1';
const SECRET = 'fake-secret-for-unit-test-only';
const REGION = 'ap-northeast-2';
const INPUT = Buffer.from('fake-ciphertext-blob').toString('base64');

// a fetch stub that resolves one KMS-like response.
const okFetch = (json: any = { KeyId: 'k', Plaintext: Buffer.from('hello lemon').toString('base64') }) =>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    vi.fn(async (_url: any, _init?: any) => ({
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => JSON.stringify(json),
    }));

// a silent logger for the `PERF` line.
const quiet = () => {};

// env with the fake credentials (and an optional session token).
const envOf = (token?: string): NodeJS.ProcessEnv =>
    token
        ? { AWS_ACCESS_KEY_ID: KEY, AWS_SECRET_ACCESS_KEY: SECRET, AWS_SESSION_TOKEN: token }
        : { AWS_ACCESS_KEY_ID: KEY, AWS_SECRET_ACCESS_KEY: SECRET };

// lower-case header map of the init passed to fetch.
const headersOf = (init: any): Record<string, string> =>
    Object.entries(init?.headers || {}).reduce((M, [k, v]) => ({ ...M, [k.toLowerCase()]: `${v}` }), {});

describe('kms-fetch', () => {
    // restore env and globals after each case.
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    // a. credentials check: both values non-empty.
    it('hasEnvCredentials() needs both key and secret', () => {
        expect(hasEnvCredentials(envOf())).toBe(true);
        expect(hasEnvCredentials({})).toBe(false);
        expect(hasEnvCredentials({ AWS_ACCESS_KEY_ID: KEY })).toBe(false);
        expect(hasEnvCredentials({ AWS_SECRET_ACCESS_KEY: SECRET })).toBe(false);
        expect(hasEnvCredentials({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: SECRET })).toBe(false);
        expect(hasEnvCredentials({ AWS_ACCESS_KEY_ID: KEY, AWS_SECRET_ACCESS_KEY: '' })).toBe(false);
        //* default is `process.env`.
        vi.stubEnv('AWS_ACCESS_KEY_ID', KEY);
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', SECRET);
        expect(hasEnvCredentials()).toBe(true);
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', '');
        expect(hasEnvCredentials()).toBe(false);
    });

    // b. request shape: url, method, headers, signature, body.
    it('decryptViaHttp() sends a signed KMS Decrypt request', async () => {
        const fetchFn = okFetch();
        const log = vi.fn();
        await decryptViaHttp(INPUT, { region: REGION, env: envOf(), transport: fetchFn as any, log });
        expect(fetchFn).toHaveBeenCalledTimes(1);
        //* one `kms decrypt` PERF line through the given logger.
        expect(log.mock.calls.some(args => args.join(' ').includes('kms decrypt'))).toBe(true);
        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('https://kms.ap-northeast-2.amazonaws.com/');
        expect(init.method).toBe('POST');
        const H = headersOf(init);
        expect(H['content-type']).toBe('application/x-amz-json-1.1');
        expect(H['x-amz-target']).toBe('TrentService.Decrypt');
        expect(H['host']).toBe('kms.ap-northeast-2.amazonaws.com');
        expect(H['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
        const day = H['x-amz-date'].substring(0, 8);
        expect(
            H['authorization'].startsWith(
                `AWS4-HMAC-SHA256 Credential=${KEY}/${day}/${REGION}/kms/aws4_request, SignedHeaders=`,
            ),
        ).toBe(true);
        expect(H['authorization']).toMatch(/Signature=[0-9a-f]{64}$/);
        expect(H['x-amz-security-token']).toBeUndefined();
        expect(JSON.parse(init.body)).toEqual({ CiphertextBlob: INPUT });
    });

    // c. session token: header is sent and signed.
    it('decryptViaHttp() signs the session token', async () => {
        const fetchFn = okFetch();
        await decryptViaHttp(INPUT, {
            region: REGION,
            env: envOf('fake-session-token'),
            transport: fetchFn as any,
            log: quiet,
        });
        const H = headersOf(fetchFn.mock.calls[0][1]);
        expect(H['x-amz-security-token']).toBe('fake-session-token');
        const signed = /SignedHeaders=([^,]+),/.exec(H['authorization'])?.[1].split(';');
        expect(signed).toContain('x-amz-security-token');
    });

    // d. response decode: base64 plaintext, or '' when missing.
    it('decryptViaHttp() decodes the plaintext', async () => {
        const opts = { region: REGION, env: envOf(), log: quiet };
        await expect(decryptViaHttp(INPUT, { ...opts, transport: okFetch() as any })).resolves.toBe('hello lemon');
        await expect(decryptViaHttp(INPUT, { ...opts, transport: okFetch({ KeyId: 'k' }) as any })).resolves.toBe('');
    });

    // e. KMS error: `<type>: <message>`, marked as a KMS HTTP error.
    it('decryptViaHttp() throws the KMS error', async () => {
        const body = { __type: 'com.amazonaws.kms#InvalidCiphertextException', message: 'bad' };
        const fetchFn = vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => body,
            text: async () => JSON.stringify(body),
        }));
        const e: any = await decryptViaHttp(INPUT, {
            region: REGION,
            env: envOf(),
            transport: fetchFn as any,
            log: quiet,
        }).catch(e => e);
        expect(e).toBeInstanceOf(Error);
        expect(e.message).toBe('InvalidCiphertextException: bad');
        expect(isKmsHttpError(e)).toBe(true);
    });

    // f. network error: rethrown as is, not a KMS HTTP error.
    it('decryptViaHttp() rethrows a network error', async () => {
        const err = new Error('getaddrinfo ENOTFOUND');
        const fetchFn = vi.fn(async () => {
            throw err;
        });
        const e: any = await decryptViaHttp(INPUT, {
            region: REGION,
            env: envOf(),
            transport: fetchFn as any,
            log: quiet,
        }).catch(e => e);
        expect(e).toBe(err);
        expect(isKmsHttpError(e)).toBe(false);
    });

    // g-1. routing: env credentials → fetch, no SDK.
    it('AWSKMSService.decrypt() uses fetch with env credentials', async () => {
        //* was the SDK already loaded by another spec in this worker?
        const sdkLoaded = () => Object.keys(require.cache).some(k => k.includes('@aws-sdk/client-kms'));
        const before = sdkLoaded();
        vi.stubEnv('AWS_ACCESS_KEY_ID', KEY);
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', SECRET);
        vi.stubEnv('AWS_SESSION_TOKEN', '');
        const fetchFn = okFetch();
        const service: any = new AWSKMSService('alias/lemon-hello-api');
        service._transport = fetchFn;
        await expect(service.decrypt(INPUT)).resolves.toBe('hello lemon');
        expect(fetchFn).toHaveBeenCalledTimes(1);
        //NOTE - skip when the SDK was loaded before this case (shared worker cache).
        if (!before) expect(sdkLoaded()).toBe(false);
    });

    // g-2. routing: KMS HTTP error propagates (no SDK fallback).
    it('AWSKMSService.decrypt() passes a KMS error through', async () => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', KEY);
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', SECRET);
        const body = { __type: 'AccessDeniedException', message: 'denied' };
        const service: any = new AWSKMSService('alias/lemon-hello-api');
        service._transport = vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => body,
            text: async () => JSON.stringify(body),
        }));
        const send = vi.fn(async () => ({ Plaintext: Buffer.from('x') }));
        service._instance = { send };
        await expect(service.decrypt(INPUT)).rejects.toThrow('AccessDeniedException: denied');
        expect(send).not.toHaveBeenCalled();
    });

    // g-3. routing: network error → one SDK fallback.
    it('AWSKMSService.decrypt() falls back to the SDK on a network error', async () => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', KEY);
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', SECRET);
        const fetchFn = vi.fn(async () => {
            throw new Error('getaddrinfo ENOTFOUND');
        });
        const service: any = new AWSKMSService('alias/lemon-hello-api');
        service._transport = fetchFn;
        const send = vi.fn(async () => ({ Plaintext: Buffer.from('x') }));
        service._instance = { send };
        await expect(service.decrypt(INPUT)).resolves.toBe('x');
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
    });

    // g-4. routing: no env credentials → SDK path, no fetch.
    it('AWSKMSService.decrypt() uses the SDK without env credentials', async () => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', '');
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', '');
        const fetchFn = okFetch();
        const service: any = new AWSKMSService('alias/lemon-hello-api');
        service._transport = fetchFn;
        const send = vi.fn(async () => ({ Plaintext: Buffer.from('x') }));
        service._instance = { send };
        await expect(service.decrypt(INPUT)).resolves.toBe('x');
        expect(send).toHaveBeenCalledTimes(1);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    // h. the default transport on a fake `request()`: body sent, status/json/text read, errors rejected.
    describe('transportOf()', () => {
        //* a fake `https.request`: captures options and body, answers with `status` and `payload` (or emits `error`).
        const fakeRequest = (status: number, payload: string, error?: Error) => {
            const seen: any = {};
            const request: any = (opts: any, cb: (res: any) => void) => {
                seen.opts = opts;
                const req: any = new PassThrough();
                req.setTimeout = vi.fn();
                req.destroy = vi.fn();
                req.end = (body: string) => {
                    seen.body = body;
                    if (error) return req.emit('error', error);
                    const res: any = new PassThrough();
                    res.statusCode = status;
                    cb(res);
                    res.end(payload);
                };
                return req;
            };
            return { request, seen };
        };

        it('posts the body and reads a 2xx JSON', async () => {
            const { request, seen } = fakeRequest(200, JSON.stringify({ Plaintext: 'aGk=' }));
            const send = transportOf(request);
            const res = await send('https://kms.ap-northeast-2.amazonaws.com/', {
                method: 'POST',
                headers: { 'x-amz-target': 'TrentService.Decrypt' },
                body: '{"CiphertextBlob":"x"}',
            });
            expect(seen.opts).toMatchObject({
                method: 'POST',
                hostname: 'kms.ap-northeast-2.amazonaws.com',
                path: '/',
            });
            expect(seen.opts.headers['x-amz-target']).toBe('TrentService.Decrypt');
            expect(seen.body).toBe('{"CiphertextBlob":"x"}');
            expect(res.ok).toBe(true);
            expect(res.status).toBe(200);
            await expect(res.json()).resolves.toEqual({ Plaintext: 'aGk=' });
            await expect(res.text()).resolves.toBe('{"Plaintext":"aGk="}');
        });

        it('marks a non-2xx as not ok and keeps the body', async () => {
            const body = { __type: 'AccessDeniedException', message: 'denied' };
            const send = transportOf(fakeRequest(400, JSON.stringify(body)).request);
            const res = await send('https://kms.ap-northeast-2.amazonaws.com/', {
                method: 'POST',
                headers: {},
                body: '{}',
            });
            expect(res.ok).toBe(false);
            expect(res.status).toBe(400);
            await expect(res.json()).resolves.toEqual(body);
        });

        it('rejects on a socket error', async () => {
            const err = new Error('connect ECONNREFUSED');
            const send = transportOf(fakeRequest(200, '', err).request);
            await expect(
                send('https://kms.ap-northeast-2.amazonaws.com/', { method: 'POST', headers: {}, body: '{}' }),
            ).rejects.toBe(err);
        });
    });
});
