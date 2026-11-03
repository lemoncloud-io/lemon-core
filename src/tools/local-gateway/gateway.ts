/**
 * `tools/local-gateway/gateway.ts`
 * - v5 B20: the local API Gateway (REST v1) emulator as one node request handler.
 * - flow: match (serverless.yml routes) → event (REST v1) → `$web.packContext()` + `$web.handle()` → response.
 * - internal module (not exported from the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20-b).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { LemonEngine } from '../../engine/types';
import { LambdaWEBHandler } from '../../cores/lambda/lambda-web-handler';
import { loadJsonSync } from '../tools';
import { GatewayRouteTable } from './routes';
import { matchRoute } from './match';
import {
    acceptMatchesBinary,
    buildGatewayEvent,
    headerOf,
    matchesMediaType,
    PayloadTooLargeError,
    readRawBody,
} from './event';
import { errorReply, GatewayReply, missingTokenReply, preflightReply, proxyReply, sendReply } from './response';

//* v5 B20: options of the gateway.
export interface LocalGatewayOptions {
    /** the route table (see `loadRouteTable()`) */
    table: GatewayRouteTable;
    /** stage name of `requestContext.stage` */
    stage: string;
    /** (optional) request-id generator (default uuid) */
    genRequestId?: () => string;
}

//* v5 B20: a request that may carry the bytes read by the app (`rawBody`, v5 B21) or a body parser (`body`).
type GatewayRequest = IncomingMessage & { rawBody?: Buffer; body?: any; _body?: boolean; originalUrl?: string };

//* v5 B20: the `GET /` banner text (same lines as the devkit server).
export const bannerText = (ts?: (msec: number) => string): string => {
    const $env = process?.env || {};
    const $pack: any = loadJsonSync('package.json');
    //* modified time of `package.json` (empty if missing).
    const modified = (() => {
        try {
            const msec = Math.round(fs.statSync('package.json').ctimeMs);
            return ts ? ts(msec) : new Date(msec).toISOString();
        } catch (e) {
            return '';
        }
    })();
    const name = $pack?.name ?? 'LEMON API';
    const version = $pack?.version ?? '0.0.0';
    const core = $pack?.dependencies?.['lemon-core'] || $pack?.devDependencies?.['lemon-core'] || '';
    return [
        `${name}/${version}`,
        `lemon-core/${core || ''}`,
        `modified/${modified}`,
        `env/ENV=${$env.ENV || ''} NAME=${$env.NAME || ''} STAGE=${$env.STAGE || ''}`,
        `env/REPORT_ERROR_ARN=${$env.REPORT_ERROR_ARN || ''}`,
    ].join('\n');
};

//* v5 B20: the request body bytes — from the app (`rawBody`), else the stream, else what a body parser left.
export const requestBodyOf = async (req: GatewayRequest): Promise<Buffer | null> => {
    if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (!req.readableEnded && !req._body) return readRawBody(req);
    const b = req.body;
    if (b === undefined || b === null) return null;
    if (Buffer.isBuffer(b)) return b;
    if (typeof b === 'string') return Buffer.from(b, 'utf8');
    return typeof b === 'object' && Object.keys(b).length === 0 ? null : Buffer.from(JSON.stringify(b), 'utf8');
};

//* v5 B20: `Content-Type` of a proxy result (`headers` or `multiValueHeaders`), or ''.
const contentTypeOf = (result: any): string => {
    const one = headerOf(result?.headers || {}, 'content-type');
    const multi: any = headerOf(result?.multiValueHeaders || {}, 'content-type');
    return `${(Array.isArray(multi) ? multi[0] : multi) ?? one ?? ''}`;
};

//* v5 B20: parse a `Cookie` header into a map (as the devkit server did).
const cookiesOf = (cookie: string): { [k: string]: string } | undefined => {
    if (!cookie) return undefined;
    const rx = /([^;=\s]*)=([^;]*)/g;
    const obj: { [key: string]: string } = {};
    for (let m; (m = rx.exec(cookie)); ) {
        try {
            obj[m[1]] = decodeURIComponent(m[2]).trim();
        } catch (e) {
            obj[m[1]] = m[2].trim();
        }
    }
    return obj;
};

/**
 * v5 B20: build the gateway handler `(req, res) => Promise<void>` (never rejects).
 */
export const createLocalGateway = ($engine: LemonEngine, $web: LambdaWEBHandler, options: LocalGatewayOptions) => {
    const $U = $engine.U;
    const NS = $U.NS('EXPR', 'cyan');
    const { table, stage } = options;
    //* account of the local run: the OS user, as the devkit server did (keeps `context.accountId`).
    const accountIdOf = (): string => `${$engine.environ('USER', $engine.environ('LOGNAME', '')) || ''}`;

    //* the reply of one request (throws only on unexpected errors).
    const replyOf = async (req: GatewayRequest): Promise<GatewayReply> => {
        const method = `${req.method || 'GET'}`.toUpperCase();
        const url = `${req.originalUrl || req.url || '/'}`;
        const pathname = url.split('?')[0] || '/';
        const match = matchRoute(table.routes, method, pathname);
        //* `GET /` banner, unless `serverless.yml` routes `GET /` itself.
        if (method === 'GET' && pathname === '/' && match.status !== 'matched') {
            return {
                statusCode: 200,
                headers: { 'Content-Type': ['text/plain; charset=utf-8'] },
                body: Buffer.from(
                    bannerText(msec => $U.ts(msec)),
                    'utf8',
                ),
            };
        }
        //* CORS preflight by the mock integration (only when no explicit `OPTIONS` route).
        if (method === 'OPTIONS' && match.status !== 'none' && match.route?.method !== 'OPTIONS') {
            if (match.routes.some(r => !!r.cors)) return preflightReply(match.routes, `${req.headers.origin || ''}`);
        }
        if (match.status !== 'matched') {
            $engine.inf(
                NS,
                `! ${method} ${pathname} → 403 (no route${match.status === 'method' ? ' for method' : ''})`,
            );
            return missingTokenReply();
        }
        //* the body and the REST v1 event.
        const body = await requestBodyOf(req);
        const event = buildGatewayEvent({
            method,
            url,
            rawHeaders: req.rawHeaders,
            remoteAddress: req.socket?.remoteAddress,
            httpVersion: req.httpVersion,
            body,
            resource: match.resource,
            pathParameters: match.pathParameters,
            stage,
            accountId: accountIdOf(),
            binaryMediaTypes: table.binaryMediaTypes,
            requestId: options.genRequestId ? options.genRequestId() : undefined,
        });
        //* in-process invoke like the devkit server (same `source`/`domain`/`cookie` inputs).
        const orgContext: any = {
            source: 'express',
            domain: event.requestContext.domainName,
            cookie: cookiesOf(headerOf(event.headers, 'cookie')),
        };
        const $ctx = await $web.packContext(event as any, orgContext);
        const result = await $web.handle(event as any, $ctx);
        //* binary download only when the request `Accept` matches `binaryMediaTypes` (API Gateway's rule).
        //* without an `Accept` header, the result `Content-Type` is matched instead.
        const accept = headerOf(event.headers, 'accept');
        const binary = accept
            ? acceptMatchesBinary(accept, table.binaryMediaTypes)
            : matchesMediaType(contentTypeOf(result), table.binaryMediaTypes);
        if (result?.isBase64Encoded === true && !binary)
            $engine.log(NS, `! isBase64Encoded but Accept is not in binaryMediaTypes → base64 text (as API Gateway)`);
        return proxyReply(result, binary);
    };

    //* the node handler: a rejection or a too-large body becomes the API Gateway error (no hang).
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        let reply: GatewayReply;
        try {
            reply = await replyOf(req as GatewayRequest);
        } catch (e) {
            if (e instanceof PayloadTooLargeError) {
                reply = errorReply(413, 'Request Too Long');
            } else {
                //* a Lambda proxy function error is `502 Internal server error` on API Gateway.
                $engine.err(NS, `! gateway.err =`, e);
                reply = errorReply(502, 'Internal server error');
            }
        }
        try {
            sendReply(res, reply, req.method);
        } catch (e) {
            $engine.err(NS, `! gateway.send.err =`, e);
            if (!res.writableEnded) res.end();
        }
    };
};
