import { createHash, createHmac } from 'node:crypto';
import { DeployError } from './deploy-plan.mjs';
import { boundedCredentialProvider } from './deploy-credentials.mjs';
import { assertPeer, importPeer } from './optional-peer.mjs';

//* v5 B19: a missing optional peer is a plain `DeployError` with the `npm i -D <pkg>` hint.
const missingPeer = hint => new DeployError('MISSING_PEER', hint);

/**
 * class: `NodeSha256`
 * - the `sha256` constructor `SignatureV4` expects, on Node `crypto` (hash, or HMAC with a secret).
 * - same as `NodeSha256` of `src/cores/aws/kms-fetch.ts`; kept local so the CLI does not load the lemon-core engine.
 */
//* v5 B19: replaces `@aws-crypto/sha256-js` (not a lemon-core dependency).
export class NodeSha256 {
    constructor(secret) {
        // keep the secret for `reset()`.
        this.secret = secret;
        this.hash = this.make();
    }
    // a new hash (HMAC with a secret).
    make() {
        return this.secret !== undefined ? createHmac('sha256', this.secret) : createHash('sha256');
    }
    // add data.
    update(data) {
        this.hash.update(data);
    }
    // the digest (async, as the signer awaits it).
    async digest() {
        return new Uint8Array(this.hash.digest());
    }
    // start over.
    reset() {
        this.hash = this.make();
    }
}

/** Loaded only for explicit apply. Offline planning never resolves credentials. */
export async function createDeployClient(config, { credentials, fetchImpl = globalThis.fetch, lambdaClient } = {}) {
    //* v5 B19: `@smithy/signature-v4` is a lemon-core dependency; the Lambda SDK is an optional peer.
    const [{ SignatureV4 }, lambda] = await Promise.all([
        import('@smithy/signature-v4'),
        importPeer('@aws-sdk/client-lambda', missingPeer),
    ]);
    //* v5 B19: the credential worker imports `@aws-sdk/credential-providers`; check it before forking.
    if (credentials === undefined) assertPeer('@aws-sdk/credential-providers', missingPeer);
    const ownedProvider =
        credentials === undefined
            ? boundedCredentialProvider({ profile: config.profile, timeoutMs: config.requestTimeoutMs })
            : undefined;
    const provider = credentials ?? ownedProvider;
    const signer = new SignatureV4({
        credentials: provider,
        region: config.region,
        service: 'execute-api',
        sha256: NodeSha256,
    });
    const sdk =
        lambdaClient ?? new lambda.LambdaClient({ region: config.region, credentials: provider, maxAttempts: 1 });
    const deadline = async (parentSignal, operation) => {
        const controller = new AbortController();
        const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
        let timer;
        let stop;
        try {
            signal.throwIfAborted();
            return await Promise.race([
                operation(signal),
                new Promise((_, reject) => {
                    stop = () => {
                        ownedProvider?.cancel();
                        reject(new Error('aborted'));
                    };
                    signal.addEventListener('abort', stop, { once: true });
                    timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
                }),
            ]);
        } finally {
            clearTimeout(timer);
            if (stop) signal.removeEventListener('abort', stop);
        }
    };
    return {
        async request({ tool, method = 'POST', input, deployId, resource, signal }) {
            const url = new URL(`${config.endpoint}/tools/${tool}${method === 'GET' ? '/status' : ''}`);
            if (deployId) url.searchParams.set('deployId', deployId);
            if (resource) url.searchParams.set('resource', resource);
            const body = input === undefined ? undefined : JSON.stringify(input);
            try {
                return await deadline(signal, async requestSignal => {
                    //* v5 B19: a plain request object (the fields `HttpRequest` would hold), no `@smithy/protocol-http`.
                    const signed = await signer.sign({
                        protocol: url.protocol,
                        hostname: url.hostname,
                        path: url.pathname,
                        query: Object.fromEntries(url.searchParams),
                        method,
                        headers: {
                            host: url.host,
                            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                        },
                        body,
                    });
                    requestSignal.throwIfAborted();
                    const response = await fetchImpl(url, {
                        method,
                        headers: signed.headers,
                        body,
                        redirect: 'manual',
                        signal: requestSignal,
                    });
                    const result = await response.json();
                    return { http: response.status, result };
                });
            } catch {
                throw new DeployError(
                    'TRANSPORT_UNKNOWN',
                    'Tool request outcome is unknown; inspect the receipt before recovery.',
                    { unknown: true },
                );
            }
        },
        async readFunction(name, { signal } = {}) {
            try {
                return await deadline(signal, async requestSignal => {
                    let found;
                    try {
                        found = await sdk.send(new lambda.GetFunctionConfigurationCommand({ FunctionName: name }), {
                            abortSignal: requestSignal,
                        });
                    } catch (error) {
                        if (error?.name === 'ResourceNotFoundException') return null;
                        throw error;
                    }
                    requestSignal.throwIfAborted();
                    const tags = await sdk.send(new lambda.ListTagsCommand({ Resource: found.FunctionArn }), {
                        abortSignal: requestSignal,
                    });
                    return {
                        functionArn: found.FunctionArn,
                        functionName: found.FunctionName,
                        runtime: found.Runtime,
                        architectures: found.Architectures,
                        handler: found.Handler,
                        role: found.Role,
                        state: found.State,
                        lastUpdateStatus: found.LastUpdateStatus,
                        tags: tags.Tags ?? {},
                    };
                });
            } catch {
                throw new DeployError(
                    'READ_FAILED',
                    'Lambda preflight could not read configuration/tags; no deployment round opened.',
                );
            }
        },
        async put({ url, headers, bytes, signal }) {
            try {
                return await deadline(signal, async requestSignal => {
                    requestSignal.throwIfAborted();
                    const response = await fetchImpl(url, {
                        method: 'PUT',
                        headers,
                        body: bytes,
                        redirect: 'manual',
                        signal: requestSignal,
                    });
                    await response.body?.cancel();
                    return response.status;
                });
            } catch {
                throw new DeployError(
                    'UPLOAD_UNKNOWN',
                    'ZIP upload outcome is unknown; inspect the receipt before recovery.',
                    { unknown: true },
                );
            }
        },
        close() {
            ownedProvider?.close();
            sdk.destroy?.();
        },
    };
}
