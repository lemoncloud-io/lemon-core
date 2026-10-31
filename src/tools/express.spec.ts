/**
 * `tools/express.spec.ts`
 * - test runnder for `tools/express.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-26 initial unit test.
 * @date        2025-05-20 cleanup `express` out of this module.
 * @date        2026-10-31 v5 B20: no `lemon-devkit` — the local API Gateway in lemon-core (express as optional peer).
 * @date        2026-10-31 v5 B21: no `express` — the built-in mini app (extension routes) before the gateway.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import { expect2 } from '../common/test-helper';
import { buildEngine } from '../engine';
import { EnvironmentSet } from '../environ';
import { buildExpress, BuildExpressOptions } from './express';
import { loadJsonSync } from './tools';
import { AddressInfo } from 'net';
import $cores, { NextDecoder, NextHandler } from '../cores/index';
import request from 'supertest';

/**
 * local test instance
 */
export const instance = (scope = global, env?: EnvironmentSet, opts?: BuildExpressOptions) => {
    // STEP.1 - build basic engine
    const $engine = buildEngine(scope, { env: { ...env } });
    const genRequestId = () => 'express-test-request';

    // STEP.2 - build express factory.
    const $web = $cores.lambda.web;
    $web.setHandler('test', decode_next_handler);
    /** factory function to build express */
    const $express = () => buildExpress($engine, $web, { genRequestId, ...opts });
    return { $engine, $express };
};

//* router of `/test/:id/:cmd?`
const decode_next_handler: NextDecoder = (mode, id, cmd): NextHandler => {
    switch (mode) {
        case 'LIST':
        case 'GET':
            return async () => ({ hello: `${mode} /null/${id ?? '-'}/${cmd ?? '-'}` });
    }
    return;
};

//* v5 B21: the fixture `serverless.yml` (`/{type}/{proxy+}` ANY, `binaryMediaTypes`).
const FIXTURE = 'src/tools/local-gateway/fixtures/serverless.gateway.yml';

//* v5 B21: a stub web handler that records each event (and answers 200 `{"ok":1}`).
const stubWeb = () => {
    const events: any[] = [];
    const $web: any = {
        packContext: async (event: any, org: any) => ({ org }),
        handle: async (event: any) => (events.push(event), { statusCode: 200, headers: {}, body: '{"ok":1}' }),
    };
    return { $web, events };
};

//* v5 B21: the app over the fixture with a stub web handler.
const fixtureApp = () => {
    const { $web, events } = stubWeb();
    const $engine = buildEngine({}, { env: { LS: '1' } });
    const { app } = buildExpress($engine, $web, { serverlessFile: FIXTURE, argv: ['node', 'run', '--port', '0'] });
    return { $engine, $web, events, app };
};

//* v5 B21: sha256 (hex) of bytes.
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

//* v5 B21: 4 KB with every byte value (0x00, 0xff, CR/LF …).
const BLOB = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) % 256));

//* v5 B21: one raw request on loopback (status + body bytes).
const call = (port: number, method: string, path: string, headers: Record<string, string>, body?: Buffer) =>
    new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end(body);
    });

//! main test body.
describe('express', () => {
    it('should pass basic buildExpress', async () => {
        expect2(() => buildExpress(null, null)).toEqual('$engine(LemonEngine) is required - buildExpress()');
        expect2(() => buildExpress({} as any, null)).toEqual('$web(LambdaWEBHandler) is required - buildExpress()');
    });

    //* v5 B21: no `express` at all (neither a peer nor a devDependency); `loadModule` is ignored.
    it('should not depend on express (B21)', async () => {
        const $pack = loadJsonSync('package.json');
        expect2(() => $pack.peerDependencies['express']).toEqual(undefined);
        expect2(() => $pack.peerDependenciesMeta['express']).toEqual(undefined);
        expect2(() => $pack.devDependencies['express']).toEqual(undefined);
        expect2(() => $pack.dependencies['express']).toEqual(undefined);
        const loadModule = vi.fn(() => null);
        const $res = instance(null, {}, { loadModule }).$express();
        expect2(() => [typeof $res.app, $res.express, loadModule.mock.calls.length]).toEqual([
            'function',
            undefined,
            0,
        ]);
    });

    //* v5 B20: the banner of `GET /` (no `serverless.yml` here → legacy routes) and a legacy route.
    it('should pass buildExpress w/ banner and legacy routes (B20)', async () => {
        const $pack = loadJsonSync('package.json');
        const { $express } = instance();
        const $res = $express();
        expect2(() => Object.keys($res)).toEqual(['express', 'app', 'createServer']);

        const app = $res.app;
        const res: any = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`lemon-core/${$pack.version}`);
        expect2(() => res.text.split('\n')[1]).toEqual(`lemon-core/`);

        const hello: any = await request(app).get('/test/a/b');
        expect2(() => hello.body).toEqual({ hello: 'GET /null/a/b' });
        const list: any = await request(app).get('/test');
        expect2(() => list.body).toEqual({ hello: 'LIST /null//' });
    });

    //* v5 B20: `createServer()` listens on `--port` (0 = any) and initializes the engine on listening.
    it('should listen on --port and initialize the engine (B20)', async () => {
        const { $engine, $express } = instance(global, {}, { argv: ['node', 'express', '--port', '0'] });
        const spy = vi.spyOn($engine, 'initialize');
        const server = $express().createServer();
        await new Promise<void>(resolve => server.on('listening', () => resolve()));
        const port = (server.address() as AddressInfo).port;
        expect2(() => port > 0).toEqual(true);
        expect2(() => spy.mock.calls.length).toEqual(1);
        const res: any = await request(`http://127.0.0.1:${port}`).get('/test/1');
        expect2(() => res.body).toEqual({ hello: 'GET /null/1/' });
        await new Promise(resolve => server.close(resolve));
    });

    //* v5 B21: `POST /echo` added after build (as services do) wins and gets method/headers/body/query.
    it('should run an extension route added after build (B21)', async () => {
        const { app, events } = fixtureApp();
        app.post('/echo', (req: any, res: any) => {
            const method = req.method;
            const headers = req.headers;
            const body = req.body;
            const param = req.query;
            res.status(200).json({ method, headers, body, param });
        });
        const res: any = await request(app)
            .post('/echo?a=1&b=x%20y&a=2')
            .set('X-Test', 'yes')
            .send({ hi: [1, 2] });
        expect2(() => [res.status, res.headers['content-type']]).toEqual([200, 'application/json; charset=utf-8']);
        expect2(() => res.body.method).toEqual('POST');
        expect2(() => res.body.headers['x-test']).toEqual('yes');
        expect2(() => res.body.body).toEqual({ hi: [1, 2] });
        expect2(() => res.body.param).toEqual({ a: '2', b: 'x y' });
        //* a trailing `/` matches too; another method on the same path falls through to the gateway (403).
        expect2(() => events.length).toEqual(0);
        expect((await request(app).post('/echo/').send({})).status).toBe(200);
        expect((await request(app).get('/echo')).status).toBe(403);
        //* a route added after the first request still wins.
        app.get('/late', (req: any, res: any) => res.send('late'));
        const late: any = await request(app).get('/late');
        expect2(() => [late.status, late.text, late.headers['content-type']]).toEqual([
            200,
            'late',
            'text/html; charset=utf-8',
        ]);
        //* no `X-Powered-By` from the app.
        expect2(() => late.headers['x-powered-by']).toEqual(undefined);
    });

    //* v5 B21: `:name` params, `app.all`, `app.use` (prefix + `next()`), and the response helpers.
    it('should support params, use() and the response helpers (B21)', async () => {
        const { app, events } = fixtureApp();
        const seen: string[] = [];
        app.use((req: any, res: any, next: any) => (seen.push(`use ${req.method} ${req.url}`), next()));
        app.use('/local', (req: any, res: any, next: any) => (res.set('X-Local', '1'), next()));
        app.get('/local/:id/:cmd', (req: any, res: any) => res.json(req.params));
        app.all('/local/any', (req: any, res: any) => res.status(201).send({ method: req.method }));
        app.get('/local/buf', (req: any, res: any) => res.send(Buffer.from([0, 1, 2])));
        app.get('/local/gone', (req: any, res: any) => res.sendStatus(410));
        app.get('/local/hdr', (req: any, res: any) => res.header({ 'X-A': 'a' }).set('X-B', ['b1', 'b2']).send());

        const p: any = await request(app).get('/local/a%20b/c');
        expect2(() => [p.status, p.body, p.headers['x-local']]).toEqual([200, { id: 'a b', cmd: 'c' }, '1']);
        const any: any = await request(app).delete('/local/any');
        expect2(() => [any.status, any.body]).toEqual([201, { method: 'DELETE' }]);
        const buf: any = await request(app).get('/local/buf');
        expect2(() => [buf.headers['content-type'], [...buf.body]]).toEqual(['application/octet-stream', [0, 1, 2]]);
        const gone: any = await request(app).get('/local/gone');
        expect2(() => [gone.status, gone.text]).toEqual([410, 'Gone']);
        const hdr: any = await request(app).get('/local/hdr');
        expect2(() => [hdr.status, hdr.headers['x-a'], hdr.headers['x-b'], hdr.text]).toEqual([200, 'a', 'b1, b2', '']);
        //* `HEAD` runs a `GET` route (node sends no body).
        const head: any = await request(app).head('/local/a/b');
        const size = `${JSON.stringify({ id: 'a', cmd: 'b' }).length}`;
        expect2(() => [head.status, head.headers['content-length']]).toEqual([200, size]);
        //* `use()` → `next()` → no route → the gateway (route `GET /files/{id}` of the fixture).
        const gw: any = await request(app).get('/files/1');
        expect2(() => [gw.status, gw.body, events.length]).toEqual([200, { ok: 1 }, 1]);
        expect2(() => seen.slice(-1)).toEqual(['use GET /files/1']);
        //* a path deeper than the route is not the route → the gateway (`/{type}/{proxy+}`).
        const deep: any = await request(app).get('/local/a/b/c');
        expect2(() => [deep.status, deep.body, events[1].resource]).toEqual([200, { ok: 1 }, '/{type}/{proxy+}']);
        //* a handler is required.
        expect2(() => app.get('/x', null)).toEqual('@handler (function) is required - GET /x');
    });

    //* v5 B21: request bodies: form → map, text → string, other → Buffer, empty / bad JSON → undefined.
    it('should parse the request body by content type (B21)', async () => {
        const { app } = fixtureApp();
        app.post('/body', (req: any, res: any) =>
            res.json({
                kind: Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body,
                body: Buffer.isBuffer(req.body) ? [...req.body] : req.body ?? null,
                raw: req.rawBody.length,
            }),
        );
        const post = async (type: string, data: string | Buffer) =>
            (await request(app).post('/body').set('Content-Type', type).send(data)).body;
        expect(await post('application/x-www-form-urlencoded', 'a=1&b=2&a=3')).toEqual({
            kind: 'object',
            body: { a: '3', b: '2' },
            raw: 11,
        });
        expect(await post('text/plain', 'hello')).toEqual({ kind: 'string', body: 'hello', raw: 5 });
        expect(await post('application/octet-stream', Buffer.from([9, 0, 255]))).toEqual({
            kind: 'buffer',
            body: [9, 0, 255],
            raw: 3,
        });
        expect(await post('application/json', '{bad')).toEqual({ kind: 'undefined', body: null, raw: 4 });
        expect((await request(app).post('/body')).body).toEqual({ kind: 'undefined', body: null, raw: 0 });
    });

    //* v5 B21: a throwing / rejecting handler or `next(err)` → 500 at once (logged, never hangs).
    it('should answer 500 when an extension route fails (B21)', async () => {
        const { app, $engine } = fixtureApp();
        const spy = vi.spyOn($engine, 'err').mockImplementation(() => '');
        app.get('/throw', () => {
            throw new Error('boom');
        });
        app.get('/reject', async () => {
            throw new Error('async boom');
        });
        app.get('/next-err', (req: any, res: any, next: any) => next(new Error('next boom')));
        app.get('/late-err', (req: any, res: any) => {
            res.status(200).set('X-Late', '1');
            res.write('partial');
            throw new Error('after write');
        });
        for (const path of ['/throw', '/reject', '/next-err']) {
            const res: any = await request(app).get(path);
            expect2(() => [path, res.status, res.text]).toEqual([path, 500, '{"message":"Internal server error"}']);
        }
        //* the response already started → it is ended (no hang).
        const late: any = await request(app).get('/late-err');
        expect2(() => [late.status, late.text]).toEqual([200, 'partial']);
        expect2(() => spy.mock.calls.map(c => `${c[2]?.message}`)).toEqual([
            'boom',
            'async boom',
            'next boom',
            'after write',
        ]);
    });

    //* v5 B21: a body over 10 MB on an extension route → 413 (as the gateway).
    it('should answer 413 over 10 MB on an extension route (B21)', { timeout: 10000 }, async () => {
        const { app } = fixtureApp();
        const handler = vi.fn((req: any, res: any) => res.send('ok'));
        app.post('/echo', handler);
        const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
        const res: any = await request(app).post('/echo').set('Content-Type', 'text/plain').send(big);
        expect2(() => [res.status, res.text, handler.mock.calls.length]).toEqual([
            413,
            '{"message":"Request Too Long"}',
            0,
        ]);
    });

    //* v5 B21: a binary request reaches the gateway intact — untouched (no route), or read once by `use()`.
    it('should keep binary bodies intact for the gateway (B21)', async () => {
        const { $web, events } = stubWeb();
        const $engine = buildEngine({}, { env: { LS: '1' } });
        const opts = { serverlessFile: FIXTURE, argv: ['node', 'run', '--port', '0'] };
        const { app, createServer } = buildExpress($engine, $web, opts);
        const touched = vi.fn((req: any, res: any, next: any) => next());
        app.use('/blobs/seen', touched);
        app.post('/echo', (req: any, res: any) => res.json({ body: req.body }));
        const server: http.Server = createServer();
        await new Promise<void>(resolve => (server.listening ? resolve() : server.once('listening', () => resolve())));
        const port = (server.address() as AddressInfo).port;
        try {
            const type = { 'Content-Type': 'application/octet-stream' };
            for (const path of ['/blobs/up/raw', '/blobs/seen/raw']) {
                const res = await call(port, 'POST', path, type, BLOB);
                expect2(() => [path, res.status, res.body.toString('utf8')]).toEqual([path, 200, '{"ok":1}']);
            }
            expect2(() => touched.mock.calls.length).toEqual(1);
            const bytes = events.map(e => (e.isBase64Encoded ? Buffer.from(e.body, 'base64') : Buffer.from(e.body)));
            expect2(() => events.map(e => e.isBase64Encoded)).toEqual([true, true]);
            expect2(() => bytes.map(b => [b.length, sha(b)])).toEqual([
                [4096, sha(BLOB)],
                [4096, sha(BLOB)],
            ]);
            //* the extension route on the same server.
            const echo = await call(port, 'POST', '/echo', { 'Content-Type': 'application/json' }, Buffer.from('[1]'));
            expect2(() => [echo.status, JSON.parse(echo.body.toString('utf8'))]).toEqual([200, { body: [1] }]);
            //* unknown path → the gateway's 403.
            expect((await call(port, 'GET', '/nowhere', {})).status).toBe(403);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});
