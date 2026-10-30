/**
 * `tools/local-gateway/gateway.spec.ts`
 * - v5 B20: the local API Gateway over http (supertest): 403, events, binary in/out, headers, CORS, errors, banner.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildEngine } from '../../engine';
import { LambdaHandler } from '../../cores/lambda/lambda-handler';
import { LambdaWEBHandler } from '../../cores/lambda/lambda-web-handler';
import { NextDecoder } from '../../cores';
import { buildExpress, BuildExpressOptions } from '../express';
import { loadJsonSync } from '../tools';

//* v5 B20: the fixture `serverless.yml`.
const FIXTURE = 'src/tools/local-gateway/fixtures/serverless.gateway.yml';

//* v5 B20: a stub web handler that records each event and answers by `answer(event)`.
const stubWeb = (answer: (event: any) => any = () => ({ statusCode: 200, headers: {}, body: '{"ok":1}' })) => {
    const events: any[] = [];
    const $web: any = {
        packContext: async (event: any, org: any) => ({ org }),
        handle: async (event: any) => {
            events.push(event);
            return answer(event);
        },
    };
    return { $web, events };
};

//* v5 B20: an express app over the fixture (or other options).
const appOf = ($web: any, opts?: BuildExpressOptions) =>
    buildExpress(buildEngine({}), $web, { serverlessFile: FIXTURE, ...opts }).app;

//* v5 B20: superagent parser that keeps the raw bytes.
const binaryParser = (res: any, done: (err: any, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
};

//* v5 B20: a temp `serverless.yml` (absolute path).
const tempYml = (text: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgw-b20-'));
    fs.writeFileSync(path.join(dir, 'serverless.yml'), text);
    return path.join(dir, 'serverless.yml');
};

//* v5 B20: bytes with 0x00 and every byte value.
const BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => (i * 7) % 256));

describe('local-gateway over http (B20)', () => {
    //* v5 B20: unknown path, or a resource without the method → API Gateway's 403.
    it('should answer 403 Missing Authentication Token (B20)', async () => {
        const { $web, events } = stubWeb();
        const app = appOf($web);
        for (const [m, p] of [
            ['get', '/x'],
            ['post', '/hello/abc'],
            ['get', '/assets'],
            ['options', '/hello/world'],
        ] as const) {
            const res = await request(app)[m](p);
            expect([m, p, res.status, res.text, res.headers['x-amzn-errortype']]).toEqual([
                m,
                p,
                403,
                '{"message":"Missing Authentication Token"}',
                'MissingAuthenticationTokenException',
            ]);
        }
        expect(events.length).toBe(0);
    });

    //* v5 B20: event of a `{proxy+}` route with repeated query and header keys.
    it('should build the event of a {proxy+} route (B20)', async () => {
        const { $web, events } = stubWeb();
        const res = await request(appOf($web))
            .get('/hello/a/b%20c/d?x=1&x=2')
            .set('X-Dup', ['a', 'b'])
            .set('User-Agent', 'b20-agent');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: 1 });
        const e = events[0];
        expect([e.resource, e.path, e.httpMethod, e.pathParameters]).toEqual([
            '/{type}/{proxy+}',
            '/hello/a/b%20c/d',
            'GET',
            { type: 'hello', proxy: 'a/b c/d' },
        ]);
        expect([e.queryStringParameters, e.multiValueQueryStringParameters]).toEqual([{ x: '2' }, { x: ['1', '2'] }]);
        expect([e.headers['X-Dup'], e.multiValueHeaders['X-Dup']]).toEqual(['b', ['a', 'b']]);
        expect(e.requestContext.identity.userAgent).toBe('b20-agent');
        expect([e.requestContext.stage, e.requestContext.domainName, e.body, e.isBase64Encoded]).toEqual([
            process.env.STAGE || 'local',
            '127.0.0.1',
            null,
            false,
        ]);
        expect(Object.keys(e.headers).some(k => k.toLowerCase() === 'host')).toBe(true);
    });

    //* v5 B20: octet-stream bytes (with 0x00) → base64 → the same bytes.
    it('should pass a binary request body as base64 (B20)', async () => {
        const { $web, events } = stubWeb();
        const res = await request(appOf($web))
            .post('/files/1')
            .set('Content-Type', 'application/octet-stream')
            .send(BYTES);
        expect(res.status).toBe(200);
        expect(events[0].isBase64Encoded).toBe(true);
        expect(Buffer.from(events[0].body, 'base64').equals(BYTES)).toBe(true);
    });

    //* v5 B20: multipart is passed raw (no parsing): base64 when listed, utf8 text otherwise.
    it('should pass multipart raw bytes through (B20)', async () => {
        const boundary = 'b20boundary';
        const multipart = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n`),
            Buffer.from('Content-Type: application/octet-stream\r\n\r\n'),
            BYTES,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const { $web, events } = stubWeb();
        const send = (app: any, p: string, body: Buffer) =>
            request(app).post(p).set('Content-Type', `multipart/form-data; boundary=${boundary}`).send(body);
        expect((await send(appOf($web), '/files/1', multipart)).status).toBe(200);
        expect(events[0].isBase64Encoded).toBe(true);
        expect(Buffer.from(events[0].body, 'base64').equals(multipart)).toBe(true);
        //* no binary types (legacy table) → the text as is.
        const text = Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\nhello\r\n--${boundary}--\r\n`,
        );
        const legacy = appOf($web, { serverlessFile: 'no-such-dir/serverless.yml' });
        expect((await send(legacy, '/files/1', text)).status).toBe(200);
        expect([events[1].isBase64Encoded, events[1].body]).toEqual([false, text.toString('utf8')]);
    });

    //* v5 B20: a base64 result → bytes when `Accept` matches `binaryMediaTypes` (else the base64 text, as API Gateway).
    it('should send a binary response by isBase64Encoded + Accept (B20)', async () => {
        const answer = () => ({
            statusCode: 200,
            headers: { 'Content-Type': 'image/png' },
            body: BYTES.toString('base64'),
            isBase64Encoded: true,
        });
        const { $web } = stubWeb(answer);
        const app = appOf($web);
        const bin = await request(app).get('/files/1').set('Accept', 'image/png').buffer(true).parse(binaryParser);
        expect([bin.status, bin.headers['content-type'], bin.headers['content-length']]).toEqual([
            200,
            'image/png',
            '256',
        ]);
        expect(Buffer.isBuffer(bin.body) && bin.body.equals(BYTES)).toBe(true);
        const txt = await request(app).get('/files/1').set('Accept', '*/*').buffer(true).parse(binaryParser);
        expect(txt.body.toString('utf8')).toBe(BYTES.toString('base64'));
        //* `binaryMediaTypes` option adds a type; without `Accept` the result `Content-Type` is matched.
        const app2 = appOf($web, { binaryMediaTypes: ['*/*'] });
        const any = await request(app2).get('/files/1').buffer(true).parse(binaryParser);
        expect([any.body.equals(BYTES), any.headers['x-powered-by']]).toEqual([true, undefined]);
    });

    //* v5 B20: `multiValueHeaders` → repeated headers (`Set-Cookie`), default content type.
    it('should map multiValueHeaders and Set-Cookie (B20)', async () => {
        const answer = () => ({
            statusCode: 201,
            headers: { 'X-One': '1', 'X-Multi': 'ignored', 'X-Bool': true },
            multiValueHeaders: { 'Set-Cookie': ['a=1; Path=/', 'b=2; HttpOnly'], 'x-multi': ['x', 'y'] },
            body: '{"made":true}',
        });
        const { $web } = stubWeb(answer);
        const res = await request(appOf($web)).get('/hello/abc');
        expect([res.status, res.body]).toEqual([201, { made: true }]);
        expect(res.headers['set-cookie']).toEqual(['a=1; Path=/', 'b=2; HttpOnly']);
        expect([res.headers['x-one'], res.headers['x-multi'], res.headers['x-bool']]).toEqual(['1', 'x, y', 'true']);
        expect(res.headers['content-type']).toBe('application/json');
    });

    //* v5 B20: CORS preflight like the mock integration of Serverless `cors`.
    it('should answer CORS preflight by the route cors (B20)', async () => {
        const { $web, events } = stubWeb();
        const app = appOf($web);
        const one = await request(app).options('/hello').set('Origin', 'http://localhost:3000');
        expect([one.status, one.text]).toEqual([200, '']);
        expect([
            one.headers['access-control-allow-origin'],
            one.headers['access-control-allow-headers'],
            one.headers['access-control-allow-methods'],
            one.headers['access-control-allow-credentials'],
            one.headers['access-control-max-age'],
        ]).toEqual(['http://localhost:3000', 'Content-Type,X-Lemon-Identity', 'GET,OPTIONS', 'true', '600']);
        const any = await request(app).options('/hello/a/b');
        expect([any.headers['access-control-allow-origin'], any.headers['access-control-allow-methods']]).toEqual([
            '*',
            'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
        ]);
        expect(any.headers['access-control-allow-headers']).toBe(
            'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amzn-Trace-Id',
        );
        expect(any.headers['access-control-allow-credentials']).toBeUndefined();
        //* only the cors-on methods of the resource (`GET /files/{id}` has no cors).
        const files = await request(app).options('/files/1');
        expect(files.headers['access-control-allow-methods']).toBe('POST,OPTIONS');
        expect(events.length).toBe(0);
    });

    //* v5 B20: a rejected handler → 502 at once (the devkit server left the request hanging).
    it('should answer 502 when the handler rejects (B20)', { timeout: 3000 }, async () => {
        const { $web } = stubWeb(() => Promise.reject(new Error('boom')));
        const res = await request(appOf($web)).get('/hello/abc').timeout(2000);
        expect([res.status, res.text]).toEqual([502, '{"message":"Internal server error"}']);
        //* a malformed proxy result is also 502.
        const bad = await request(appOf(stubWeb(() => 'not-an-object').$web)).get('/hello/abc');
        expect(bad.status).toBe(502);
    });

    //* v5 B20: a body over 10 MB → 413.
    it('should answer 413 over 10 MB (B20)', { timeout: 10000 }, async () => {
        const { $web, events } = stubWeb();
        const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
        const res = await request(appOf($web))
            .post('/files/1')
            .set('Content-Type', 'application/octet-stream')
            .send(big);
        expect([res.status, res.text]).toEqual([413, '{"message":"Request Too Long"}']);
        const json = await request(appOf($web))
            .post('/files/1')
            .set('Content-Type', 'application/json')
            .send(Buffer.alloc(10 * 1024 * 1024 + 1, 0x20));
        expect(json.status).toBe(413);
        expect(events.length).toBe(0);
    });

    //* v5 B20: `GET /` is the banner unless `serverless.yml` routes it.
    it('should keep the GET / banner only without a GET / route (B20)', async () => {
        const $pack = loadJsonSync('package.json');
        const { $web, events } = stubWeb(() => ({
            statusCode: 200,
            headers: { 'Content-Type': 'text/plain' },
            body: 'root',
        }));
        expect((await request(appOf($web)).get('/')).text).toBe('root');
        expect(events[0].resource).toBe('/');
        const noRoot = tempYml('functions:\n  f:\n    events:\n      - http: GET /a\n');
        for (const serverlessFile of [noRoot, 'no-such-dir/serverless.yml']) {
            const res = await request(appOf($web, { serverlessFile })).get('/');
            expect([res.status, res.text.split('\n')[0], res.text.split('\n')[3]]).toEqual([
                200,
                `${$pack.name}/${$pack.version}`,
                `env/ENV=${process.env.ENV || ''} NAME=${process.env.NAME || ''} STAGE=${process.env.STAGE || ''}`,
            ]);
        }
        expect(events.length).toBe(1);
    });

    //* v5 B20: express routes added after `buildExpress()` win over the gateway (and get a parsed JSON body).
    it('should keep express routes added after build (B20)', async () => {
        const { $web, events } = stubWeb();
        const { app } = buildExpress(buildEngine({}), $web, { serverlessFile: FIXTURE });
        app.post('/echo', (req: any, res: any) => res.status(200).json({ body: req.body, q: req.query }));
        const echo = await request(app).post('/echo?x=1').send({ a: 'b' });
        expect([echo.status, echo.body]).toEqual([200, { body: { a: 'b' }, q: { x: '1' } }]);
        //* a route added after the first request still wins (the gateway stays the last layer).
        app.get('/late', (req: any, res: any) => res.status(200).send('late'));
        expect((await request(app).get('/late')).text).toBe('late');
        //* the gateway still forwards the raw JSON body text.
        expect((await request(app).post('/files/1').send({ a: 1 })).status).toBe(200);
        expect([events[0].body, events[0].isBase64Encoded]).toEqual(['{"a":1}', false]);
    });

    //* v5 B20: no `serverless.yml` → legacy `/{type}/{id}/{cmd}` (any method).
    it('should route the legacy table without serverless.yml (B20)', async () => {
        const { $web, events } = stubWeb();
        const app = appOf($web, { serverlessFile: 'no-such-dir/serverless.yml' });
        expect((await request(app).delete('/test/1/x')).status).toBe(200);
        expect((await request(app).get('/test/1/x/y')).status).toBe(403);
        expect([events[0].resource, events[0].pathParameters]).toEqual([
            '/{type}/{id}/{cmd}',
            { type: 'test', id: '1', cmd: 'x' },
        ]);
        //* preflight on any legacy path (cors on).
        expect((await request(app).options('/test/1')).headers['access-control-allow-origin']).toBe('*');
    });

    //* v5 B20: the real `LambdaWEBHandler` over a serverless route (type from the resource).
    it('should run the real web handler over the gateway (B20)', async () => {
        const $web = new LambdaWEBHandler(new LambdaHandler(), true);
        const decoder: NextDecoder = (mode, id, cmd) => async (i: string, param: any, body: any, ctx: any) => ({
            mode,
            id: i,
            cmd: cmd ?? '',
            param,
            body,
            domain: ctx.domain,
        });
        $web.setHandler('hello', decoder);
        const app = appOf($web);
        const get = await request(app).get('/hello/abc?q=1');
        expect([get.status, get.body]).toEqual([
            200,
            { mode: 'GET', id: 'abc', cmd: '', param: { q: '1' }, body: null, domain: '127.0.0.1' },
        ]);
        const put = await request(app).put('/hello/abc/do').send({ a: 1 });
        expect([put.status, put.body]).toEqual([
            200,
            { mode: 'PUT', id: 'abc', cmd: 'do', param: null, body: { a: 1 }, domain: '127.0.0.1' },
        ]);
    });
});
