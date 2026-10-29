/**
 * `cores/aws/kms-fetch.ts`
 * - (internal) KMS `Decrypt` by one SigV4-signed HTTPS call to the KMS JSON API (v5 B8, D55).
 * - used by `AWSKMSService.decrypt()` when the env has credentials, so the boot path does not load `@aws-sdk/client-kms`.
 * - transport is Node `https` (not `fetch`: the first `fetch` call loads undici, ~250 ms on a cold Lambda); `fetch` is a compatible transport.
 * - not exported by any barrel. No SDK or `@smithy` type in the signatures.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 v5 B8 (D55)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { createHash, createHmac, Hash, Hmac } from 'crypto';
import * as https from 'https';
import { _inf, $U } from '../../engine/';
import { measure, nowMs } from '../../lib/perf';

/** a logger like `_inf`. */
type KmsFetchLogger = (...args: any[]) => void;

/** the request the signer takes (local structural type; no `HttpRequest` import). */
interface SignableRequest {
    method: string;
    protocol: string;
    hostname: string;
    path: string;
    headers: Record<string, string>;
    body: string;
}

/** the response a transport returns (the part of `Response` this module reads). */
export interface KmsHttpResponse {
    ok: boolean;
    status: number;
    json: () => Promise<any>;
    text: () => Promise<string>;
}

/** a transport: `(url, { method, headers, body })` → response. Node `https` by default; `globalThis.fetch` is compatible. */
export type KmsTransport = (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
) => Promise<KmsHttpResponse>;

/** options of `decryptViaHttp()`. */
export interface DecryptViaHttpOptions {
    /** AWS region (ex: `ap-northeast-2`) */
    region: string;
    /** env with the credentials (default `process.env`) */
    env?: NodeJS.ProcessEnv;
    /** transport to use (default `httpsTransport`) */
    transport?: KmsTransport;
    /** logger of the `PERF` lines (default `_inf`) */
    log?: KmsFetchLogger;
}

/** socket idle timeout of the default transport; a timeout is a network error (the caller falls back to the SDK). */
export const KMS_HTTPS_TIMEOUT_MS = 10_000;

/**
 * true when the env has `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (both non-empty).
 */
export const hasEnvCredentials = (env: NodeJS.ProcessEnv = process.env): boolean =>
    !!(env?.AWS_ACCESS_KEY_ID && env?.AWS_SECRET_ACCESS_KEY);

/**
 * true when `e` is the error of a KMS HTTP response (not a network error).
 */
export const isKmsHttpError = (e: any): boolean => !!(e && e.kmsError === true);

/**
 * class: `NodeSha256`
 * - the `sha256` constructor the signer expects, on Node `crypto` (hash, or HMAC with a secret).
 */
export class NodeSha256 {
    //* the secret (for `reset()`), and the current hash.
    private readonly secret?: Uint8Array | string;
    private hash: Hash | Hmac;

    //* HMAC-SHA256 with a secret, else SHA256.
    public constructor(secret?: Uint8Array | string) {
        this.secret = secret;
        this.hash = this.make();
    }

    // build a new hash object.
    private make(): Hash | Hmac {
        return this.secret !== undefined ? createHmac('sha256', this.secret) : createHash('sha256');
    }

    /** add data. */
    public update(data: Uint8Array | string): void {
        this.hash.update(data);
    }

    /** the digest (async, as the signer awaits it). */
    public async digest(): Promise<Uint8Array> {
        return new Uint8Array(this.hash.digest());
    }

    /** start over. */
    public reset(): void {
        this.hash = this.make();
    }
}

/**
 * build a transport on a `request()` like Node `https.request` (injectable for tests).
 * - reads the whole body; `ok` is 2xx; a socket error or the idle timeout rejects.
 */
export const transportOf =
    (request: typeof https.request): KmsTransport =>
    (url, init) =>
        new Promise<KmsHttpResponse>((resolve, reject) => {
            const u = new URL(url);
            const req = request(
                { method: init.method, hostname: u.hostname, path: `${u.pathname}${u.search}`, headers: init.headers },
                res => {
                    //* collect the body, then resolve a `Response`-like object.
                    const chunks: Buffer[] = [];
                    res.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                    res.on('error', reject);
                    res.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf-8');
                        const status = res.statusCode ?? 0;
                        resolve({
                            ok: status >= 200 && status < 300,
                            status,
                            text: async () => text,
                            json: async () => JSON.parse(text),
                        });
                    });
                },
            );
            //* a socket error or the idle timeout is a network error.
            req.on('error', reject);
            req.setTimeout(KMS_HTTPS_TIMEOUT_MS, () =>
                req.destroy(new Error(`kms https timeout (${KMS_HTTPS_TIMEOUT_MS} ms)`)),
            );
            req.end(init.body);
        });

/** the default transport: Node `https` (no undici load on the boot path). */
export const httpsTransport: KmsTransport = transportOf(https.request);

/**
 * `@smithy/signature-v4`, required on the first use (not at import).
 */
let $sigv4: typeof import('@smithy/signature-v4');
// memoized sync loader (the first call prints one `PERF` line).
const loadSigV4 = (log: KmsFetchLogger): typeof import('@smithy/signature-v4') =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ($sigv4 ??= measure(log, $U.NS('PERF', 'cyan'), 'lazy-load @smithy/signature-v4', () =>
        require('@smithy/signature-v4'),
    ));

// build the error of a KMS HTTP response: `<type>: <message>`, marked with `kmsError`.
const asKmsError = async (res: { status: number; json?: () => Promise<any>; text?: () => Promise<string> }) => {
    //* read the JSON body (`{ __type, message }`), or the text.
    let body: any = null;
    try {
        body = res.json ? await res.json() : JSON.parse((await res.text?.()) || '{}');
    } catch {
        body = null;
    }
    const raw = `${body?.__type || body?.code || `HTTP${res.status}`}`;
    const type = raw.includes('#') ? raw.substring(raw.lastIndexOf('#') + 1) : raw;
    const message = `${body?.message ?? body?.Message ?? ''}`;
    const err: any = new Error(`${type}: ${message}`);
    err.kmsError = true;
    err.statusCode = res.status;
    return err as Error;
};

/**
 * decrypt a base64 ciphertext by KMS `Decrypt` (`TrentService.Decrypt`) with one SigV4-signed HTTPS call.
 * - KMS error (non-2xx): throws `<type>: <message>` (see `isKmsHttpError()`).
 * - network error (socket, timeout): the transport rejection is thrown as is.
 *
 * @param encryptedBase64 ciphertext blob in base64
 * @returns the plaintext in utf-8, or `''` when KMS returns no `Plaintext`.
 */
export const decryptViaHttp = async (encryptedBase64: string, opts: DecryptViaHttpOptions): Promise<string> => {
    const { region } = opts;
    const env = opts.env ?? process.env;
    const log = opts.log ?? _inf;
    const send = opts.transport ?? httpsTransport;
    const hostname = `kms.${region}.amazonaws.com`;

    //* the same body string is signed and sent.
    const body = JSON.stringify({ CiphertextBlob: encryptedBase64 });
    const request: SignableRequest = {
        method: 'POST',
        protocol: 'https:',
        hostname,
        path: '/',
        headers: {
            'content-type': 'application/x-amz-json-1.1',
            'x-amz-target': 'TrentService.Decrypt',
            host: hostname,
        },
        body,
    };

    //* sign with the env credentials (session token when present).
    const { SignatureV4 } = loadSigV4(log);
    const credentials = {
        accessKeyId: `${env.AWS_ACCESS_KEY_ID || ''}`,
        secretAccessKey: `${env.AWS_SECRET_ACCESS_KEY || ''}`,
        ...(env.AWS_SESSION_TOKEN ? { sessionToken: `${env.AWS_SESSION_TOKEN}` } : {}),
    };
    const signer = new SignatureV4({ service: 'kms', region, credentials, sha256: NodeSha256 as any });

    //* one `PERF` line for the whole call, split `sign=` (SigV4) `send=` (connect + request + response) `decode=` (base64).
    const t0 = nowMs();
    const signed: SignableRequest = (await signer.sign(request as any)) as any;
    const t1 = nowMs();

    //* send (a network error rejects here, as is).
    const res = await send(`https://${hostname}/`, { method: 'POST', headers: signed.headers, body });
    if (!res.ok) throw await asKmsError(res);
    const t2 = nowMs();

    //* decode the plaintext.
    const json: any = await res.json();
    const plain = json?.Plaintext ? Buffer.from(json.Plaintext, 'base64').toString('utf-8') : '';
    const t3 = nowMs();
    const ms = (a: number, b: number) => (b - a).toFixed(1);
    log(
        $U.NS('PERF', 'cyan'),
        '>',
        'kms decrypt',
        `${ms(t0, t3)} ms`,
        `sign=${ms(t0, t1)} send=${ms(t1, t2)} decode=${ms(t2, t3)}`,
    );
    return plain;
};
