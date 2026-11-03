/**
 * `tools/local-gateway/event.spec.ts`
 * - v5 B20: the REST v1 event shape, binary body rules, and the `NextContext` of old (devkit) vs new events.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import { LambdaHandler } from '../../cores/lambda/lambda-handler';
import { LambdaWEBHandler } from '../../cores/lambda/lambda-web-handler';
import { acceptMatchesBinary, buildGatewayEvent, matchesMediaType, queryOf, requestTimeOf } from './event';

//* v5 B20: a GET with repeated query and header keys (fixed id and time).
const sampleEvent = () =>
    buildGatewayEvent({
        method: 'get',
        url: '/hello/a%20b?x=1&x=2&y=%20z&flag',
        rawHeaders: ['Host', 'localhost:8081', 'User-Agent', 'b20-test', 'X-Dup', 'a', 'X-Dup', 'b', 'x-api-key', 'k1'],
        remoteAddress: '::ffff:127.0.0.1',
        httpVersion: '1.1',
        body: null,
        resource: '/hello/{id}',
        pathParameters: { id: 'a b' },
        stage: 'local',
        accountId: 'tester',
        binaryMediaTypes: [],
        requestId: 'req-b20',
        now: new Date(Date.UTC(2026, 9, 31, 1, 2, 3)),
    });

describe('local-gateway event (B20)', () => {
    //* v5 B20: the whole event (REST v1 field set, like `bin/lib/event.mjs#webEvent()` and a deployed API).
    it('should build the REST v1 event of a GET with repeated keys (B20)', () => {
        expect(sampleEvent()).toEqual({
            resource: '/hello/{id}',
            path: '/hello/a%20b',
            httpMethod: 'GET',
            headers: { Host: 'localhost:8081', 'User-Agent': 'b20-test', 'X-Dup': 'b', 'x-api-key': 'k1' },
            multiValueHeaders: {
                Host: ['localhost:8081'],
                'User-Agent': ['b20-test'],
                'X-Dup': ['a', 'b'],
                'x-api-key': ['k1'],
            },
            queryStringParameters: { x: '2', y: ' z', flag: '' },
            multiValueQueryStringParameters: { x: ['1', '2'], y: [' z'], flag: [''] },
            pathParameters: { id: 'a b' },
            stageVariables: null,
            requestContext: {
                resourceId: 'local',
                resourcePath: '/hello/{id}',
                httpMethod: 'GET',
                extendedRequestId: 'req-b20',
                requestTime: '31/Oct/2026:01:02:03 +0000',
                path: '/local/hello/a%20b',
                accountId: 'tester',
                protocol: 'HTTP/1.1',
                stage: 'local',
                domainPrefix: 'localhost',
                requestTimeEpoch: Date.UTC(2026, 9, 31, 1, 2, 3),
                requestId: 'req-b20',
                identity: {
                    cognitoIdentityPoolId: null,
                    accountId: null,
                    cognitoIdentityId: null,
                    caller: null,
                    sourceIp: '127.0.0.1',
                    principalOrgId: null,
                    accessKey: null,
                    cognitoAuthenticationType: null,
                    cognitoAuthenticationProvider: null,
                    userArn: null,
                    userAgent: 'b20-test',
                    user: null,
                    apiKey: 'k1',
                    apiKeyId: null,
                    clientCert: null,
                },
                domainName: 'localhost',
                apiId: 'local',
            },
            body: null,
            isBase64Encoded: false,
        });
    });

    //* v5 B20: empty query/path → `null` (API Gateway), `X-Forwarded-For` first entry wins, uuid request id.
    it('should use null for empty maps and the first X-Forwarded-For (B20)', () => {
        const e = buildGatewayEvent({
            method: 'POST',
            url: '/',
            rawHeaders: ['X-Forwarded-For', '10.0.0.1, 10.0.0.2'],
            body: Buffer.alloc(0),
            resource: '/',
            pathParameters: null,
            stage: '',
            accountId: '',
            binaryMediaTypes: ['*/*'],
        });
        expect([e.queryStringParameters, e.multiValueQueryStringParameters, e.pathParameters, e.body]).toEqual([
            null,
            null,
            null,
            null,
        ]);
        expect([e.isBase64Encoded, e.requestContext.identity.sourceIp, e.requestContext.path]).toEqual([
            false,
            '10.0.0.1',
            '/',
        ]);
        expect(e.requestContext.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(queryOf('?a=%ZZ&b=1+2')).toEqual({ single: { a: '%ZZ', b: '1 2' }, multi: { a: ['%ZZ'], b: ['1 2'] } });
        expect(requestTimeOf(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('02/Jan/2026:03:04:05 +0000');
    });

    //* v5 B20: request body → base64 only when the content type matches `binaryMediaTypes`.
    it('should encode a binary request body by binaryMediaTypes (B20)', () => {
        const bytes = Buffer.from([0x00, 0xff, 0x10, 0x00, 0x41]);
        const of = (contentType: string, types: string[]) =>
            buildGatewayEvent({
                method: 'POST',
                url: '/files/1',
                rawHeaders: ['Content-Type', contentType],
                body: bytes,
                resource: '/files/{id}',
                pathParameters: { id: '1' },
                stage: 'local',
                accountId: '',
                binaryMediaTypes: types,
            });
        const bin = of('application/octet-stream', ['application/octet-stream']);
        expect(bin.isBase64Encoded).toBe(true);
        expect(Buffer.from(bin.body, 'base64').equals(bytes)).toBe(true);
        expect(of('image/png', ['image/*']).isBase64Encoded).toBe(true);
        expect(of('text/plain', ['*/*']).isBase64Encoded).toBe(true);
        //* not listed → utf8 text (lossy for binary, as on a deployed API without binary types).
        const txt = of('application/octet-stream', []);
        expect([txt.isBase64Encoded, txt.body]).toEqual([false, bytes.toString('utf8')]);
        expect(matchesMediaType('Image/PNG; q=1', ['image/png'])).toBe(true);
        expect(matchesMediaType('', ['*/*'])).toBe(false);
        expect(acceptMatchesBinary('text/html, image/png', ['image/png'])).toBe(true);
        expect(acceptMatchesBinary('*/*', ['image/png'])).toBe(false); // API Gateway's known rule
    });

    //* v5 B20: `NextContext` of the old devkit event vs the new REST v1 event (same request).
    it('should keep the NextContext of an ordinary request (devkit event vs B20 event) (B20)', async () => {
        const $web = new LambdaWEBHandler(new LambdaHandler(), true);
        const headers = { host: 'localhost:8081', 'user-agent': 'b20-test', cookie: 'a=1; b=x%20y' };
        //* the old event of the devkit express server (lower-case headers, Cognito-like `null` pool id).
        const oldEvent: any = {
            path: '/hello/a',
            queryStringParameters: { x: '1' },
            pathParameters: { type: 'hello', id: 'a' },
            httpMethod: 'GET',
            connection: null,
            url: '/hello/a?x=1',
            headers,
            body: undefined,
            requestContext: {
                source: 'express',
                domainName: 'localhost',
                accountId: 'tester',
                requestId: 'req-b20',
                stage: 'local',
                identity: {
                    sourceIp: '127.0.0.1',
                    userAgent: 'b20-test',
                    cognitoIdentityPoolId: null,
                    apiKey: undefined,
                    caller: undefined,
                    accessKey: undefined,
                },
                profile: undefined,
            },
        };
        const raw = Object.entries(headers).flat();
        const newEvent: any = buildGatewayEvent({
            method: 'GET',
            url: '/hello/a?x=1',
            rawHeaders: raw,
            remoteAddress: '127.0.0.1',
            body: null,
            resource: '/{type}/{id}',
            pathParameters: { type: 'hello', id: 'a' },
            stage: 'local',
            accountId: 'tester',
            binaryMediaTypes: [],
            requestId: 'req-b20',
        });
        const org: any = { source: 'express', domain: 'localhost', cookie: { a: '1', b: 'x y' } };
        const oldCtx = await $web.packContext(oldEvent, org);
        const newCtx = await $web.packContext(newEvent, org);
        //* the only change: the identity fields copied from `requestContext.identity` are `null` (API Gateway) not `undefined`.
        expect(newCtx).toEqual({
            ...oldCtx,
            identity: { ...oldCtx.identity, identityProvider: null, identityId: null, accountId: null },
        });
        expect([newCtx.accountId, newCtx.domain, newCtx.clientIp, newCtx.requestId, newCtx.channel]).toEqual([
            'tester',
            'localhost',
            '127.0.0.1',
            'req-b20',
            oldCtx.channel,
        ]);
        expect(newCtx.cookie).toEqual({ a: '1', b: 'x y' });
        //* the serverless resource `/hello/{id}` (no `type` param) gives the same context `source`.
        const ev2: any = { ...newEvent, resource: '/hello/{id}', pathParameters: { id: 'a' } };
        expect((await $web.packContext(ev2, org)).source).toBe(oldCtx.source);
    });
});
