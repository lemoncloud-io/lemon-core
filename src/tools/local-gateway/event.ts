/**
 * `tools/local-gateway/event.ts`
 * - v5 B20: build an API Gateway (REST v1) proxy event from a local http request.
 * - internal module (not exported from the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20-b).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';

//* v5 B20: API Gateway's payload limit (10 MB).
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

//* v5 B20: the error of a request body over the limit (→ 413).
export class PayloadTooLargeError extends Error {
    public constructor(readonly size: number) {
        super(`413 REQUEST TOO LONG - ${size} > ${MAX_PAYLOAD_BYTES}`);
    }
}

//* v5 B20: read all bytes of a request (drains the rest and rejects with `PayloadTooLargeError` over the limit).
export const readRawBody = (req: IncomingMessage, limit = MAX_PAYLOAD_BYTES): Promise<Buffer> =>
    new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= limit) chunks.push(chunk);
        });
        req.on('end', () => (size > limit ? reject(new PayloadTooLargeError(size)) : resolve(Buffer.concat(chunks))));
        req.on('error', reject);
    });

//* v5 B20: the media type part of a header value (`image/png; q=1` → `image/png`).
const mediaOf = (value: string): string => `${value ?? ''}`.split(';')[0].trim().toLowerCase();

/**
 * v5 B20: true if a content type matches a binary media type list.
 * - pattern `*\/*` matches any (non-empty) type, `type/*` any subtype, else exact (case-insensitive).
 */
export const matchesMediaType = (contentType: string, patterns: string[]): boolean => {
    const type = mediaOf(contentType);
    if (!type) return false;
    return (patterns || []).some(p => {
        const pat = mediaOf(p);
        if (pat === '*/*') return true;
        if (pat.endsWith('/*')) return type.startsWith(pat.substring(0, pat.length - 1));
        return pat === type;
    });
};

//* v5 B20: true if any type of an `Accept` header matches the binary media types (API Gateway's response rule).
export const acceptMatchesBinary = (accept: string, patterns: string[]): boolean =>
    `${accept ?? ''}`
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .some(s => matchesMediaType(s, patterns));

//* v5 B20: single (last value wins) + multi-value maps from `req.rawHeaders` (original casing).
export const headersOf = (
    rawHeaders: string[],
): { headers: { [k: string]: string }; multi: { [k: string]: string[] } } => {
    const headers: { [k: string]: string } = {};
    const multi: { [k: string]: string[] } = {};
    for (let i = 0; i + 1 < (rawHeaders || []).length; i += 2) {
        const [name, value] = [rawHeaders[i], rawHeaders[i + 1]];
        headers[name] = value;
        (multi[name] = multi[name] || []).push(value);
    }
    return { headers, multi };
};

//* v5 B20: single (last value wins) + multi-value query maps (`null` when empty, like API Gateway).
export const queryOf = (
    search: string,
): { single: { [k: string]: string } | null; multi: { [k: string]: string[] } | null } => {
    const params = new URLSearchParams(`${search ?? ''}`.replace(/^\?/, ''));
    const single: { [k: string]: string } = {};
    const multi: { [k: string]: string[] } = {};
    params.forEach((value, key) => {
        single[key] = value;
        (multi[key] = multi[key] || []).push(value);
    });
    const has = Object.keys(single).length > 0;
    return { single: has ? single : null, multi: has ? multi : null };
};

//* v5 B20: `requestTime` in API Gateway's format (`31/Oct/2026:09:15:00 +0000`).
export const requestTimeOf = (date: Date): string => {
    const MONS = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',');
    const p2 = (n: number) => `${n}`.padStart(2, '0');
    const d = date;
    return `${p2(d.getUTCDate())}/${MONS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${p2(d.getUTCHours())}:${p2(
        d.getUTCMinutes(),
    )}:${p2(d.getUTCSeconds())} +0000`;
};

//* v5 B20: header value by a case-insensitive name.
export const headerOf = (headers: { [k: string]: string }, name: string): string => {
    const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
    return key !== undefined ? headers[key] : undefined;
};

//* v5 B20: inputs of `buildGatewayEvent()`.
export interface GatewayEventInput {
    /** request method */
    method: string;
    /** raw url (path + `?query`) as received */
    url: string;
    /** `req.rawHeaders` */
    rawHeaders: string[];
    /** socket address of the client */
    remoteAddress?: string;
    /** http version like `1.1` */
    httpVersion?: string;
    /** raw request body */
    body: Buffer | null;
    /** matched resource (like `/{type}/{id}`) */
    resource: string;
    /** decoded path parameters (or `null`) */
    pathParameters: { [k: string]: string } | null;
    /** stage name (`requestContext.stage`) */
    stage: string;
    /** `requestContext.accountId` */
    accountId: string;
    /** binary media types (request body → base64) */
    binaryMediaTypes: string[];
    /** (optional) request id (default uuid) */
    requestId?: string;
    /** (optional) time of the request */
    now?: Date;
}

/**
 * v5 B20: build the REST v1 proxy event (`APIGatewayProxyEvent` shape).
 * - body: base64 + `isBase64Encoded: true` when the request content-type matches `binaryMediaTypes`, else utf8 (or `null`).
 */
export const buildGatewayEvent = (input: GatewayEventInput) => {
    const now = input.now || new Date();
    const [pathname, ...rest] = `${input.url || '/'}`.split('?');
    const { headers, multi } = headersOf(input.rawHeaders);
    const query = queryOf(rest.join('?'));
    const method = `${input.method || 'GET'}`.toUpperCase();
    const contentType = headerOf(headers, 'content-type');
    const raw = input.body && input.body.length > 0 ? input.body : null;
    const isBase64Encoded = !!raw && matchesMediaType(contentType, input.binaryMediaTypes);
    const body = raw ? (isBase64Encoded ? raw.toString('base64') : raw.toString('utf8')) : null;
    //* client ip: the first `X-Forwarded-For` entry, else the socket (IPv4-mapped prefix removed).
    const xff = `${headerOf(headers, 'x-forwarded-for') ?? ''}`.split(',')[0].trim();
    const sourceIp = xff || `${input.remoteAddress ?? ''}`.replace(/^::ffff:/, '') || '127.0.0.1';
    const host = `${headerOf(headers, 'host') ?? ''}`;
    const requestId = input.requestId || randomUUID();
    const stage = `${input.stage || ''}`;
    return {
        resource: input.resource,
        path: pathname || '/',
        httpMethod: method,
        headers,
        multiValueHeaders: multi,
        queryStringParameters: query.single,
        multiValueQueryStringParameters: query.multi,
        pathParameters: input.pathParameters,
        stageVariables: null as { [k: string]: string } | null,
        requestContext: {
            resourceId: 'local',
            resourcePath: input.resource,
            httpMethod: method,
            extendedRequestId: requestId,
            requestTime: requestTimeOf(now),
            path: `${stage ? `/${stage}` : ''}${pathname || '/'}`,
            accountId: input.accountId,
            protocol: `HTTP/${input.httpVersion || '1.1'}`,
            stage,
            domainPrefix: host.split('.')[0].split(':')[0],
            requestTimeEpoch: now.getTime(),
            requestId,
            identity: {
                cognitoIdentityPoolId: null as string,
                accountId: null as string,
                cognitoIdentityId: null as string,
                caller: null as string,
                sourceIp,
                principalOrgId: null as string,
                accessKey: null as string,
                cognitoAuthenticationType: null as string,
                cognitoAuthenticationProvider: null as string,
                userArn: null as string,
                userAgent: `${headerOf(headers, 'user-agent') ?? ''}`,
                user: null as string,
                apiKey: headerOf(headers, 'x-api-key') ?? null,
                apiKeyId: null as string,
                clientCert: null as any,
            },
            domainName: host.split(':')[0],
            apiId: 'local',
        },
        body,
        isBase64Encoded,
    };
};

//* v5 B20: type of the event built above.
export type GatewayEvent = ReturnType<typeof buildGatewayEvent>;
