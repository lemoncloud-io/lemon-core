/**
 * `bin/lib/event.mjs` (lemon-core)
 * - web (API Gateway REST v1 proxy) event builder for `lemon-lambda-invoke` (and the other invoke tools).
 * - no AWS SDK; errors are thrown as `ArgError` (exit 2) and never call `process.exit`.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/event.mjs` (snapshot d57dc5b) unchanged.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ArgError } from './common.mjs';

// header that lemon-core reads an identity from on internal calls.
export const IDENTITY_HEADER = 'x-lemon-identity';

// warning when `--identity` is given without `--internal`.
export const IDENTITY_WARNING = 'warn: --identity is only honoured by lemon-core on internal calls; add --internal';

// read a `@file` reference, or return the literal value (null when not a string).
export const readValue = value => {
    if (typeof value !== 'string') return null;
    if (!value.startsWith('@')) return value;
    try {
        return readFileSync(value.slice(1), 'utf8').replace(/\s+$/, '');
    } catch (e) {
        throw new ArgError(`cannot read ${value}: ${e.message}`);
    }
};

// split `k<sep>v` pairs into an object of arrays (keeps repeated keys).
export const toMulti = (list, sep) =>
    [].concat(list || []).reduce((M, item) => {
        const s = `${item}`;
        const at = s.indexOf(sep);
        if (at <= 0) throw new ArgError(`expected k${sep}v, got: ${s}`);
        const key = s.slice(0, at).trim();
        M[key] = [...(M[key] || []), s.slice(at + 1).trim()];
        return M;
    }, {});

// collapse multi-value map into single values (last one wins, like API Gateway).
export const toSingle = multi => Object.fromEntries(Object.entries(multi).map(([k, v]) => [k, v[v.length - 1]]));

// derive API Gateway `resource` and `pathParameters` from the path (`/{type}/{id}/{cmd}` routes).
export const toRoute = pathname => {
    const segs = pathname.split('/').filter(Boolean);
    if (segs.length < 2) return { resource: segs.length ? `/${segs[0]}` : '/', pathParameters: null };
    if (segs.length === 2) return { resource: `/${segs[0]}/{id}`, pathParameters: { id: segs[1] } };
    return { resource: `/${segs[0]}/{id}/{cmd}`, pathParameters: { id: segs[1], cmd: segs.slice(2).join('/') } };
};

// `--identity` value as given (verbatim), after checking it is JSON; undefined when not given.
export const parseIdentity = value => {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value) throw new ArgError('--identity needs a JSON string');
    try {
        JSON.parse(value);
    } catch {
        // no parser message: it can echo the identity text.
        throw new ArgError('--identity is not valid JSON');
    }
    return value;
};

// check the web-only options for an event kind; returns the warnings to print (throws `ArgError`).
export const checkWebOptions = (kind, opts = {}) => {
    if (opts.internal && kind !== 'web') throw new ArgError('--internal applies to --event web only');
    if (opts.identity !== undefined && kind !== 'web') throw new ArgError('--identity applies to --event web only');
    parseIdentity(opts.identity);
    return opts.identity !== undefined && !opts.internal ? [IDENTITY_WARNING] : [];
};

// event label for the `invoke …` banner: `web(internal)` with `--internal`.
export const eventLabel = (kind, opts = {}) => (kind === 'web' && opts.internal ? 'web(internal)' : kind);

// drop every `host` header (any case) from a header map.
const withoutHost = H => Object.fromEntries(Object.entries(H).filter(([k]) => `${k}`.toLowerCase() !== 'host'));

// API Gateway REST (v1) proxy event.
export const webEvent = (opts, stage) => {
    const method = `${opts.method || 'GET'}`.toUpperCase();
    const [pathname, qs = ''] = `${opts.path || '/'}`.split('?');
    // query from `--path ...?a=1` first, then `--query k=v`.
    const fromPath = qs ? qs.split('&').filter(Boolean) : [];
    const multiQuery = toMulti([...fromPath.map(decodeURIComponent), ...[].concat(opts.query || [])], '=');
    const body = readValue(opts.body);
    const identity = parseIdentity(opts.identity);
    // default headers; `Host` marks the request as external like a real API Gateway call.
    const allHeaders = {
        Host: ['localhost'],
        Accept: ['application/json'],
        'User-Agent': ['lambda-invoke'],
        ...(body !== null ? { 'Content-Type': ['application/json'] } : {}),
        ...toMulti(opts.header, ':'),
        ...(identity !== undefined ? { [IDENTITY_HEADER]: [identity] } : {}),
    };
    // `--internal`: no `host` header at all, like a direct `lambda:Invoke` (no `domainName` either).
    const multiHeaders = opts.internal ? withoutHost(allHeaders) : allHeaders;
    const { resource, pathParameters } = toRoute(pathname);
    const hasQuery = Object.keys(multiQuery).length > 0;
    return {
        resource,
        path: pathname,
        httpMethod: method,
        headers: toSingle(multiHeaders),
        multiValueHeaders: multiHeaders,
        queryStringParameters: hasQuery ? toSingle(multiQuery) : null,
        multiValueQueryStringParameters: hasQuery ? multiQuery : null,
        pathParameters,
        stageVariables: null,
        requestContext: {
            resourcePath: resource,
            httpMethod: method,
            path: pathname,
            stage,
            requestId: randomUUID(),
            identity: { sourceIp: '127.0.0.1', userAgent: 'lambda-invoke' },
            requestTimeEpoch: Date.now(),
        },
        body,
        isBase64Encoded: false,
    };
};
