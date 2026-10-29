/**
 * `cores/aws/kms-fetch.ts`
 * - (internal) KMS `Decrypt` by a SigV4-signed `fetch` to the KMS JSON API (v5 B8, D55).
 * - used by `AWSKMSService.decrypt()` when the env has credentials, so the boot path does not load `@aws-sdk/client-kms`.
 * - not exported by any barrel. No SDK or `@smithy` type in the signatures.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 v5 B8 (D55)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { createHash, createHmac, Hash, Hmac } from 'crypto';
import { _inf, $U } from '../../engine/';
import { measure } from '../../lib/perf';

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

/** options of `decryptViaFetch()`. */
export interface DecryptViaFetchOptions {
    /** AWS region (ex: `ap-northeast-2`) */
    region: string;
    /** env with the credentials (default `process.env`) */
    env?: NodeJS.ProcessEnv;
    /** fetch to use (default `globalThis.fetch`) */
    fetchFn?: typeof fetch;
    /** logger of the `PERF` line (default `_inf`) */
    log?: KmsFetchLogger;
}

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
 * decrypt a base64 ciphertext by KMS `Decrypt` (`TrentService.Decrypt`) with a SigV4-signed `fetch`.
 * - KMS error (non-2xx): throws `<type>: <message>` (see `isKmsHttpError()`).
 * - network error: the `fetch` rejection is thrown as is.
 *
 * @param encryptedBase64 ciphertext blob in base64
 * @returns the plaintext in utf-8, or `''` when KMS returns no `Plaintext`.
 */
export const decryptViaFetch = async (encryptedBase64: string, opts: DecryptViaFetchOptions): Promise<string> => {
    const { region } = opts;
    const env = opts.env ?? process.env;
    const log = opts.log ?? _inf;
    const fetchFn = opts.fetchFn ?? globalThis.fetch;
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
    const signed: SignableRequest = (await signer.sign(request as any)) as any;

    //* send (a network error rejects here, as is).
    const res = await fetchFn(`https://${hostname}/`, { method: 'POST', headers: signed.headers, body });
    if (!res.ok) throw await asKmsError(res as any);

    //* decode the plaintext.
    const json: any = await res.json();
    return json?.Plaintext ? Buffer.from(json.Plaintext, 'base64').toString('utf-8') : '';
};
