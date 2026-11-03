/**
 * `tools/local-gateway/response.ts`
 * - v5 B20: write a Lambda proxy result (or a gateway-made answer) to the http response, like API Gateway.
 * - internal module (not exported from the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20-b).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { ServerResponse } from 'http';
import { GatewayRoute } from './routes';

//* v5 B20: a gateway answer (status + headers + bytes).
export interface GatewayReply {
    statusCode: number;
    /** header name → one or more values (more values → repeated header lines) */
    headers: { [k: string]: string[] };
    body: Buffer;
}

//* v5 B20: a JSON error like API Gateway (`{"message":…}` + `x-amzn-ErrorType`).
export const errorReply = (statusCode: number, message: string, errorType?: string): GatewayReply => ({
    statusCode,
    headers: {
        'Content-Type': ['application/json'],
        ...(errorType ? { 'x-amzn-ErrorType': [errorType] } : {}),
    },
    body: Buffer.from(JSON.stringify({ message }), 'utf8'),
});

//* v5 B20: API Gateway's answer for an unknown route (or a method not on the resource).
export const missingTokenReply = (): GatewayReply =>
    errorReply(403, 'Missing Authentication Token', 'MissingAuthenticationTokenException');

//* v5 B20: header value as a string (`true` → `'true'`).
const textOf = (v: any): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : `${v}`);

/**
 * v5 B20: map a Lambda proxy result → reply.
 * - `headers` and `multiValueHeaders` are merged (the multi value list wins for the same name, as API Gateway does).
 * - `isBase64Encoded: true` → the body is decoded to bytes only when `binary` is true (the request `Accept` matches
 *   `binaryMediaTypes`, API Gateway's rule); otherwise the base64 text is sent as is (like a deployed API).
 * - a result without a numeric `statusCode` is a malformed proxy response → 502.
 */
export const proxyReply = (result: any, binary: boolean): GatewayReply => {
    if (!result || typeof result !== 'object' || !Number.isFinite(Number(result.statusCode)))
        return errorReply(502, 'Internal server error');
    const merged: { [k: string]: string[] } = {};
    const lower: { [k: string]: string } = {};
    //* set a header once per case-insensitive name (the later call replaces the earlier one).
    const put = (name: string, values: string[]) => {
        const key = name.toLowerCase();
        if (lower[key] !== undefined && lower[key] !== name) delete merged[lower[key]];
        lower[key] = name;
        merged[name] = values;
    };
    Object.entries<any>(result.headers || {}).forEach(([k, v]) => v !== undefined && put(k, [textOf(v)]));
    Object.entries<any>(result.multiValueHeaders || {}).forEach(
        ([k, v]) => Array.isArray(v) && v.length && put(k, v.map(textOf)),
    );
    //* API Gateway's default content type.
    if (lower['content-type'] === undefined) put('Content-Type', ['application/json']);
    const text =
        typeof result.body === 'string'
            ? result.body
            : result.body === undefined || result.body === null
            ? ''
            : `${result.body}`;
    const body = result.isBase64Encoded === true && binary ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
    return { statusCode: Number(result.statusCode), headers: merged, body };
};

/**
 * v5 B20: CORS preflight answer (Serverless `cors` → API Gateway mock integration on `OPTIONS`).
 * - origin: `*` if allowed, else the request origin when listed, else the first origin.
 * - methods: every method of the resource with cors on, + `OPTIONS`.
 */
export const preflightReply = (routes: GatewayRoute[], origin: string): GatewayReply => {
    const withCors = routes.filter(r => !!r.cors);
    const cors = withCors[0].cors;
    const origins = Array.from(new Set(withCors.flatMap(r => r.cors.origins)));
    const headers = Array.from(new Set(withCors.flatMap(r => r.cors.headers)));
    const methods = Array.from(new Set([...withCors.map(r => r.method), 'OPTIONS']));
    const allMethods = methods.includes('ANY') ? ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'] : methods;
    const allowOrigin = origins.includes('*') ? '*' : origins.includes(origin) ? origin : origins[0];
    return {
        statusCode: 200,
        headers: {
            'Content-Type': ['application/json'],
            'Access-Control-Allow-Origin': [allowOrigin],
            'Access-Control-Allow-Headers': [headers.join(',')],
            'Access-Control-Allow-Methods': [allMethods.join(',')],
            ...(withCors.some(r => r.cors.allowCredentials) ? { 'Access-Control-Allow-Credentials': ['true'] } : {}),
            ...(cors.maxAge ? { 'Access-Control-Max-Age': [`${cors.maxAge}`] } : {}),
        },
        body: Buffer.alloc(0),
    };
};

//* v5 B20: write a reply to the node response (repeated values → repeated header lines, e.g. `Set-Cookie`).
export const sendReply = (res: ServerResponse, reply: GatewayReply, method?: string): void => {
    res.statusCode = reply.statusCode;
    Object.entries(reply.headers).forEach(([k, v]) => res.setHeader(k, v.length === 1 ? v[0] : v));
    res.setHeader('Content-Length', `${reply.body.length}`);
    res.end(`${method ?? ''}`.toUpperCase() === 'HEAD' ? undefined : reply.body);
};
