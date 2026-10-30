/**
 * `lambda-web-handler.spec.ts`
 * - unit test for `lambda-web-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 * @date        2026-10-30 v5 B14: `channel`/`trace` in the packed context; a legacy context gets `channel: 'internal'`.
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../environ';
import { $U, $engine } from '../../engine/';
import { NextDecoder, NextHandler, NextContext } from 'lemon-model';
import { expect2, GETERR, GETERR$ } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { ProtocolParam } from './../core-services';
import { LambdaWEBHandler, CoreWEBController, MyHttpHeaderTool, buildResponse } from './lambda-web-handler';
import { LambdaHandler } from './lambda-handler';
import * as $lambda from './lambda-handler.spec';
import { NextIdentity } from '..';

class LambdaWEBHandlerLocal extends LambdaWEBHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
    public result: any = null;
    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        const result: TResult = await super.handleProtocol(param);
        this.result = result;
        return result;
    }
}
export const instance = (_lambda?: LambdaHandler) => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaWEBHandlerLocal(_lambda || lambda);
    const lemon = new MyLemonWebController();
    service.setHandler('hello', decode_next_handler);
    service.addController(lemon);
    return { lambda, service, lemon };
};

/**
 * Decode Target Next Handler (promised function).
 */
const decode_next_handler: NextDecoder = (mode, id, cmd) => {
    let next: NextHandler = null;
    switch (mode) {
        case 'LIST':
            next = async () => ({ hello: 'LIST' });
            break;
        case 'GET':
        case 'POST':
            if (cmd) next = async id => ({ id, cmd, hello: `${cmd} ${id}` });
            else if (id == '')
                next = async id => {
                    throw new Error(`@id[${id}] (string) is required!`);
                };
            else if (id == '0')
                next = async id => {
                    throw new Error(`404 NOT FOUND - id:${id}`);
                };
            // eslint-disable-next-line prettier/prettier
            else if (id == '!')
                next = async (id, param, body, context) => ({ id, param, body, context }); // dump parameter if '!'
            else next = async id => ({ id, hello: `${id}` });
    }
    return next;
};

class MyLemonWebController implements CoreWEBController {
    public constructor() {}
    public hello = () => `my-lemon-web-controller:${this.type()}`;
    public type = () => 'lemon';
    public decode: NextDecoder = (mode, id, cmd) => {
        const next: NextHandler = async (id, param, body) => ({ mode: `MY ${mode}`, id, cmd, param, body });
        if (mode == 'LIST') return this.doList;
        else if (mode == 'PUT') return null;
        return next;
    };
    public doList: NextHandler = async (id, param, body) => {
        return { mode: 'do-list', type: `${this.type()}`, hello: `${this.hello()}` };
    };
}

//! main test body.
describe('LambdaWEBHandler', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //* basic function
    it('should pass basic functions', async () => {
        const expectedRes = {
            body: 'null',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'origin, x-lemon-language, x-lemon-identity',
                'Access-Control-Allow-Credentials': true,
            },
            isBase64Encoded: false,
            statusCode: 200,
        };
        expect2(() => buildResponse(200, null)).toEqual({ ...expectedRes });
        expect2(() => buildResponse(200, 0)).toEqual({ ...expectedRes, body: '0' });
        expect2(() => buildResponse(200, {})).toEqual({ ...expectedRes, body: '{}' });
        expect2(() => buildResponse(200, '')).toEqual({
            ...expectedRes,
            body: '',
            headers: { ...expectedRes.headers, 'Content-Type': 'text/plain; charset=utf-8' },
        });
    });

    //* pass tools()
    it('should pass header tools', async () => {
        const { service } = instance();

        //* test `tools()` basic
        if (1) {
            const $t = service.tools({
                Host: 'localhost',
            }) as MyHttpHeaderTool;

            expect2(() => $t.isExternal()).toEqual(true);
            expect2(() => $t.parseLanguageHeader()).toEqual();
            expect2(await $t.parseIdentityHeader()).toEqual({ lang: undefined as string });
        }

        //* test `tools()` of headers
        if (1) {
            const $t = service.tools({
                'X-lemon': ' A',
                'X-Lemon': 'B ',
                'X-LEMON': 'C !',
                'X-Lemon-Language': 'ko/kr ',
                'x-lemon-identity': '1122 ',
            }) as MyHttpHeaderTool;
            expect2(() => $t.getHeaders('X-Lemon')).toEqual(['B']);
            expect2(() => $t.getHeader('X-Lemon')).toEqual('B');

            expect2(() => $t.getHeaders('X-lemon')).toEqual(['A']);
            expect2(() => $t.getHeader('X-lemon')).toEqual('A');

            expect2(() => $t.getHeaders('x-lemon')).toEqual(['A', 'B', 'C !']);
            expect2(() => $t.getHeader('x-lemon')).toEqual('C !');

            expect2(() => $t.isExternal()).toEqual(false);
            expect2(() => $t.parseLanguageHeader()).toEqual('ko/kr');
            expect2(await $t.parseIdentityHeader()).toEqual({ meta: '1122', lang: 'ko/kr' });

            const identity: NextIdentity = { sid: ' ㅎ힁', uid: 'U', gid: 'g', roles: ['&@ $+-'] };
            const current = ($U.dt('2022-05-10 11:22:33', 9) as Date).getTime();
            const expectedHead =
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiIg44WO7Z6BIiwidWlkIjoiVSIsImdpZCI6ImciLCJyb2xlcyI6WyImQCAkKy0iXSwiaXNzIjpudWxsLCJpYXQiOjE2NTIxNDkzNTMsImV4cCI6MTY1MjIzNTc1M30';
            expect2(() => current).toEqual(1652149353000);
            //* the fixture keeps a 1-day token through an explicit `exp` (the default is 30 min since key rotation).
            const exp = Math.floor(current / 1000) + 24 * 60 * 60;
            expect2(await $t.encodeIdentityJWT(identity, { current, exp }), 'token').toEqual({
                token: `${expectedHead}.`,
            });
            //* without `exp` → 30 min.
            const $short = await $t.encodeIdentityJWT(identity, { current });
            expect2(() => $U.jwt().decode($short.token).exp - Math.floor(current / 1000)).toEqual(30 * 60);
            expect2(() => $U.jwt().decode(`${expectedHead}.`)).toEqual({
                iss: null,
                exp: 1652235753,
                iat: 1652149353,
                ...identity,
            });
            expect2(await $t.parseIdentityJWT(null).catch(GETERR)).toEqual(
                '@token (string) is required (but object) - verifyJWT(http)',
            );
            expect2(await $t.parseIdentityJWT(`${expectedHead}.`).catch(GETERR)).toEqual(
                '@signature[] is invalid (@iss[null] is invalid (unsupportable issuer) - verifyToken()) - verifyJWT(http)',
            );
        }

        //* test with valid profile
        if (PROFILE) {
            const $t = service.tools({}) as MyHttpHeaderTool;
            const identity: NextIdentity = { sid: ' ㅎ힁', uid: 'U', gid: 'g', roles: ['&@ $+-'] };
            const current = ($U.dt('2022-05-10 11:22:33', 9) as Date).getTime();
            const alias = 'lemon-identity-key';
            const expectedHead =
                'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiIg44WO7Z6BIiwidWlkIjoiVSIsImdpZCI6ImciLCJyb2xlcyI6WyImQCAkKy0iXSwiaXNzIjoia21zL2xlbW9uLWlkZW50aXR5LWtleSIsImlhdCI6MTY1MjE0OTM1MywiZXhwIjoxNjUyMjM1NzUzfQ';
            const _alias = (iss: string, prefix = 'kms/') =>
                iss.includes(',') ? iss.substring(prefix.length, iss.indexOf(',')) : iss.substring(prefix.length);
            expect2(() => current).toEqual(1652149353000);
            expect2(() => _alias(`kms/abc`)).toEqual('abc');
            expect2(() => _alias(`kms/abc,ef`)).toEqual('abc');

            const $enc = await $t.encodeIdentityJWT(identity, {
                current,
                alias,
                exp: Math.floor(current / 1000) + 24 * 60 * 60,
            });
            expect2(() => $enc, 'token').toEqual({ token: `${expectedHead}.${$enc.signature}` });

            expect2(() => $U.jwt().decode($enc.token)).toEqual({
                iss: `kms/${alias}`,
                exp: 1652235753,
                iat: 1652149353,
                ...identity,
            });
            expect2(() => 1652235753 - 1652149353).toEqual(24 * 60 * 60);

            const parse1 = (t: string) => $t.parseIdentityJWT(t, { current }).catch(GETERR);
            expect2(await parse1(null)).toEqual('@token (string) is required (but object) - verifyJWT(http)');
            expect2(await parse1($enc.message + '.')).toEqual(
                '@signature[] is invalid (@signature (string|Buffer) is required - kms.verify()) - verifyJWT(http)',
            );
            const err1 = await parse1($enc.message + '.' + 'xyz');
            expect2(() => (err1 as string).startsWith('@signature[] is invalid')).toEqual(true);
            const err2 = await parse1($enc.message + '.' + $enc.signature.replace('0', '1'));
            expect2(() => (err2 as string).startsWith('@signature[] is invalid')).toEqual(true);
            expect2(await parse1($enc.token + '.x')).toEqual(
                `@token[masked:${($enc.token + '.x').length}] is invalid (format) - verifyJWT(http)`,
            );
            expect2(await parse1($enc.token)).toEqual({
                iss: `kms/${alias}`,
                exp: 1652235753,
                iat: 1652149353,
                ...identity,
            });

            const parse2 = (t: string) =>
                $t.parseIdentityJWT(t, { current: current + 24 * 60 * 60 * 1000 + 0 }).catch(GETERR);
            expect2(await parse2($enc.token)).toEqual({
                iss: `kms/${alias}`,
                exp: 1652235753,
                iat: 1652149353,
                ...identity,
            });

            const parse3 = (t: string) =>
                $t.parseIdentityJWT(t, { current: current + 24 * 60 * 60 * 1000 + 1 }).catch(GETERR);
            expect2(await parse3($enc.token)).toEqual(
                '.exp[2022-05-11 11:22:33] is invalid (expired) - verifyJWT(http)',
            );
        }
    });

    //* list in web-handler
    it('should pass success GET / via web', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = '';
        event.pathParameters['id'] = id;
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const $res = await service.handle(event, $ctx);
        expect2(() => $res, 'statusCode,body').toEqual({
            statusCode: 200,
            body: $U.json({ hello: 'LIST' }),
        });

        //* service handlers
        expect2(Object.keys(service.getHandlerDecoders())).toEqual(['hello', 'lemon']); // must be maps
        expect2(typeof service.getHandlerDecoders()['lemon']).toEqual('function'); // must be decoder function

        //* GET `/lemon` controller
        event.resource = '/lemon/{id}';
        event.path = '/lemon';
        expect2(await service.handle(event, $ctx), 'body').toEqual({
            body: $U.json({ mode: 'do-list', type: 'lemon', hello: 'my-lemon-web-controller:lemon' }),
        });

        //* GET `/lemon/123` controller
        event.path = '/lemon/123';
        event.pathParameters['id'] = '123';
        expect2(await service.handle(event, $ctx), 'body').toEqual({
            body: $U.json({ mode: 'MY GET', id: '123', cmd: '', param: { ts: '1574150700000' }, body: null }),
        });

        //* PUT `/lemon` controller
        event.path = '/lemon';
        event.httpMethod = 'PUT';
        expect2(await service.handle(event, $ctx), 'body').toEqual({ body: '404 NOT FOUND - PUT /lemon/123' });
    });

    //* list via lambda-handler.
    it('should pass success GET / via lambda', async () => {
        const { lambda } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = '';
        event.pathParameters['id'] = id;
        const response = await lambda.handle(event, null).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body: $U.json({ hello: 'LIST' }) });
    });

    //* GET /favicon.ico
    it('should pass success GET /favicon.ico', async () => {
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.httpMethod = 'GET';
        event.path = '/favicon.ico';
        const res = await service.handle(event, null);
        expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => res.headers, 'Content-Type').toEqual({ 'Content-Type': 'image/x-icon' });
        expect2(() => res.body.substring(0, 32)).toEqual('AAABAAEAICAAAAEAIACoEAAAFgAAACgA');
    });

    //* GET /abc
    it('should pass success GET /abc', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = 'abc';
        event.pathParameters['id'] = id;
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const $res = await service.handle(event, $ctx);
        expect2($res, 'statusCode').toEqual({ statusCode: 200 });
        expect2($res, 'body').toEqual({ body: $U.json({ id, hello: `${id}` }) });
    });

    //* GET /{id}/{cmd}
    it('should pass success GET /abc/hi', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = 'abc';
        const cmd = 'hi';
        event.pathParameters['id'] = id;
        event.pathParameters['cmd'] = cmd;
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const $res = await service.handle(event, $ctx);
        expect2($res, 'statusCode').toEqual({ statusCode: 200 });
        expect2($res, 'body').toEqual({ body: $U.json({ id, cmd, hello: `${cmd} ${id}` }) });
        expect2($res, 'headers').toEqual({
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Headers': 'origin, x-lemon-language, x-lemon-identity',
            },
        });
    });

    //* POST /{id}/{cmd}
    it('should pass success POST /abc/hi', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = 'abc';
        const cmd = 'hi';
        const origin = 'https://api.com/';
        event.httpMethod = 'POST';
        event.headers['origin'] = origin;
        event.pathParameters['id'] = id;
        event.pathParameters['cmd'] = cmd;
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const $res = await service.handle(event, $ctx);
        expect2($res, 'statusCode').toEqual({ statusCode: 200 });
        expect2($res, 'body').toEqual({ body: $U.json({ id, cmd, hello: `${cmd} ${id}` }) });
        expect2($res, 'headers').toEqual({
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Headers': 'origin, x-lemon-language, x-lemon-identity',
            },
        });
    });

    //* POST / => 400
    it('should pass success POST / 400', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.httpMethod = 'POST';
        event.pathParameters['id'] = '';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const $res = await service.handle(event, $ctx);
        expect2(() => $res, 'statusCode').toEqual({ statusCode: 400 });
        expect2(() => $res.headers, 'Content-Type').toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
        expect2(() => $res, 'body').toEqual({ body: '@id[] (string) is required!' });
    });

    //* GET /0 => 404
    it('should pass success GET /0 404', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.pathParameters['id'] = '0';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const $res = await service.handle(event, $ctx);
        expect2(() => $res, 'statusCode').toEqual({ statusCode: 404 });
        expect2(() => $res.headers, 'Content-Type').toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
        expect2(() => $res, 'body').toEqual({ body: '404 NOT FOUND - id:0' });
    });

    //* GET /0 => 404
    it('should pass context.identity', async () => {
        const { lambda } = instance();
        const loadEventStock = (id: string): any => {
            const event = loadJsonSync('data/samples/events/sample.event.web.json');
            event.pathParameters['id'] = id; // call dump paramters.
            return event;
        };
        const id = '!';

        //* use default cofnig.
        if (1) {
            const event = loadEventStock(id);
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2($res, 'statusCode').toEqual({ statusCode: 200 });
            const result = JSON.parse($res.body);
            expect2(() => result, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
            expect2(() => result.context, 'identity').toEqual({
                identity: {
                    sid: undefined,
                    uid: undefined,
                    accountId: null,
                    identityId: null,
                    identityPoolId: null,
                    identityProvider: null,
                    userAgent: 'HTTPie/1.0.2',
                },
            });
        }

        //* change identity..(External)
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: '', uid: 'guest' });
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2($res, 'statusCode').toEqual({ statusCode: 200 });
            const body = JSON.parse($res.body);
            expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
            expect2(() => body.context, 'identity').toEqual({
                identity: {
                    accountId: null,
                    identityId: null,
                    identityPoolId: null,
                    identityProvider: null,
                    meta: '{"sid":"","uid":"guest"}',
                    error: '.sid[] is required - IdentityHeader',
                    userAgent: 'HTTPie/1.0.2',
                },
            });
        }

        //* change identity.. (Internal)
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: null, uid: 'guest' });
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2($res, 'statusCode').toEqual({ statusCode: 200 });
            const body = JSON.parse($res.body);
            expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
            expect2(() => body.context, 'identity').toEqual({
                identity: {
                    accountId: null,
                    identityId: null,
                    identityPoolId: null,
                    identityProvider: null,
                    meta: '{"sid":null,"uid":"guest"}',
                    error: '.sid[null] is required - IdentityHeader',
                    userAgent: 'HTTPie/1.0.2',
                },
            });
        }

        //* change identity..
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: 'S', uid: 'guest' });
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2($res, 'statusCode').toEqual({ statusCode: 200 });
            const body = JSON.parse($res.body);
            expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
            expect2(() => body.context, 'identity').toEqual({
                identity: {
                    sid: 'S',
                    uid: 'guest',
                    accountId: null,
                    identityId: null,
                    identityPoolId: null,
                    identityProvider: null,
                    userAgent: 'HTTPie/1.0.2',
                },
            });
        }

        //* change language..
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: 'S', lang: 'ko' });
            event.headers['x-lemon-language'] = ' ES '; //* should override `language`.
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2($res, 'statusCode').toEqual({ statusCode: 200 });
            const result = JSON.parse($res.body);
            expect2(() => result, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
            expect2(() => result.context, 'identity').toEqual({
                identity: {
                    sid: 'S',
                    lang: 'es',
                    accountId: null,
                    identityId: null,
                    identityPoolId: null,
                    identityProvider: null,
                    userAgent: 'HTTPie/1.0.2',
                },
            });
        }
    });

    //* test packContext() via lambda protocol
    it('should pass packContext(public) via lambda protocol', async () => {
        const { lambda, service: $web } = instance();
        const $pack = loadJsonSync('package.json');
        const event = loadJsonSync('data/samples/events/sample.event.web.json');
        expect2(() => event?.headers, 'Authorization,origin,referer,User-Agent').toEqual({
            Authorization: 'Bearer 12345678',
            origin: 'http://localhost:5004',
            referer: 'http://localhost:5004/',
            'User-Agent': 'HTTPie/1.0.2',
        });

        // const identity: any = loadJsonSync('data/samples/events/sample.cognito.identity.json');
        const context: NextContext = {
            accountId: '796730245826',
            requestId: 'd8485d00-5624-4094-9a93-ce09c351ee5b',
            identity: { sid: 'A', uid: 'B', gid: 'C', roles: null },
        };

        //* packContext()
        expect2(await lambda.packContext(event, null).catch(GETERR)).toEqual({});
        expect2(await $web.packContext(event, null).catch(GETERR)).toEqual({
            ...context,
            identity: {
                accountId: null,
                identityId: null,
                identityPoolId: null,
                identityProvider: null,
                caller: undefined,
                lang: undefined,
                userAgent: 'HTTPie/1.0.2',
            },
            domain: 'na12ibnzu4.execute-api.ap-northeast-2.amazonaws.com',
            cookie: undefined,
            clientIp: '221.149.250.0',
            userAgent: 'HTTPie/1.0.2',
            source: `api://796730245826@lemon-core-dev/hello/a_123_test#${$pack.version}`, // v5 B10: + request path
            authorization: 'Bearer 12345678',
            origin: 'http://localhost:5004',
            referer: 'http://localhost:5004/',
            channel: 'external', // v5 B14: `Host` → external
            trace: { tid: context.requestId, hop: 0 }, // v5 B14: entry → hop 0
        });

        //* v5 B5: the fixture has `Host` (external) → `x-protocol-context` is ignored whatever it holds (S-29).
        if (1) {
            event.headers['x-protocol-context'] = null;
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,error').toEqual({ statusCode: 200 });
        }
        if (1) {
            event.headers['x-protocol-context'] = {};
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,error').toEqual({ statusCode: 200 });
        }
        if (1) {
            event.headers['x-protocol-context'] = '-';
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,error').toEqual({ statusCode: 200 });
        }

        //* v5 B5: a forged admin context with `Host` is not trusted (flipped from v4, A1).
        const forged = { identity: { sid: 'X', roles: ['admin'], accessKey: 'x' }, domain: 'localhost' };
        event.headers['x-protocol-context'] = $U.json(forged);
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const $res = await lambda.handle(event, null).catch(GETERR$);
        expect2(() => $res, 'statusCode,error').toEqual({ statusCode: 200 });
        const body = JSON.parse($res.body);
        expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
        expect2(() => body.context?.domain).toEqual('na12ibnzu4.execute-api.ap-northeast-2.amazonaws.com');
        expect2(() => body.context?.identity?.roles).toEqual(undefined);
        expect2(() => body.context?.identity?.accessKey).toEqual(undefined);

        //* v5 B5: host-less (internal) event → the header is read (mode `off` without a key).
        const internal = { ...event, headers: { ...event.headers } };
        Object.keys(internal.headers)
            .filter(key => key.toLowerCase() === 'host')
            .forEach(key => delete internal.headers[key]);
        if (1) {
            //* bad header → `400 INVALID CONTEXT` response (resolved, not rejected).
            internal.headers['x-protocol-context'] = {};
            const $res = await lambda.handle(internal, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,body').toEqual({
                statusCode: 400,
                body: '400 INVALID CONTEXT - @context (NextContext) should be string - web.transformToParam(/hello/a_123_test)',
            });
        }
        if (1) {
            internal.headers['x-protocol-context'] = '-';
            const $res = await lambda.handle(internal, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,body').toEqual({
                statusCode: 400,
                body: '400 INVALID CONTEXT - @context[-] is not valid JSON - web.transformToParam(/hello/a_123_test)',
            });
        }
        internal.headers['x-protocol-context'] = $U.json(context);
        const $res2 = await lambda.handle(internal, null).catch(GETERR$);
        expect2(() => $res2, 'statusCode,error').toEqual({ statusCode: 200 });
        const body2 = JSON.parse($res2.body);
        //* v5 B14: a legacy context is kept as is + channel `internal` + an entry trace.
        expect2(body2.context, '').toEqual({
            ...context,
            channel: 'internal',
            trace: { tid: context.requestId, hop: 0 },
        });
    });

    //* test packContext() via lambda protocol
    it('should pass packContext(authed) via lambda protocol', async () => {
        const { lambda, service: $web } = instance();
        const $pack = loadJsonSync('package.json');
        const event = loadJsonSync('data/samples/events/sample.event.web.signed.json');
        expect2(() => event?.headers, 'origin,referer,User-Agent').toEqual({
            origin: 'http://localhost:8888',
            referer: 'http://localhost:8888/?code=auth:bc7dd7fe-5d27-45d8-ba45-fa5dc64a7c0a',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_4) AppleWebKit/537.36 (KHTML, like Gecko)',
        });

        const context: NextContext = {
            accountId: '796730245826',
            requestId: 'a9bff61d-8eaf-4e1d-8e8e-364ed1bef646',
        };

        //* packContext()
        expect2(await lambda.packContext(event, null).catch(GETERR)).toEqual({});
        expect2(await $web.packContext(event, null).catch(GETERR)).toEqual({
            ...context,
            identity: {
                accessKey: 'ASIARHYTUBQ5JTV4FX4Q',
                accountId: '796730245826',
                caller: 'AROAIBXAJA2J7SUQOWJMO:CognitoIdentityCredentials',
                identityId: 'ap-northeast-2:dbd95fb4-1234-2345-4567-56e5bc95e444',
                identityPoolId: 'ap-northeast-2:618ce9d2-1234-2345-4567-e248ea51425e',
                identityProvider:
                    'oauth.lemoncloud.io,oauth.lemoncloud.io:ap-northeast-2:618ce9d2-1234-2345-4567-e248ea51425e:kakao_00000',
                lang: 'ko',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_4) AppleWebKit/537.36 (KHTML, like Gecko)',
            },
            domain: 'dev.oauth.lemoncloud.io',
            cookie: undefined,
            clientIp: '221.149.50.0',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_4) AppleWebKit/537.36 (KHTML, like Gecko)',
            source: `api://796730245826@lemon-core-dev/user/0#${$pack.version}`, // v5 B10: + request path
            origin: 'http://localhost:8888',
            referer: 'http://localhost:8888/?code=auth:bc7dd7fe-5d27-45d8-ba45-fa5dc64a7c0a',
            channel: 'external', // v5 B14: `Host` → external
            trace: { tid: context.requestId, hop: 0 }, // v5 B14: entry → hop 0
        });
    });

    //* v5 B10: `context.source` carries the first request path, and an internal call keeps the caller's source.
    it('should pass context.source with the first request path (v5 B10)', async () => {
        const { service: $web } = instance();
        const $pack = loadJsonSync('package.json');
        const base = `api://796730245826@lemon-core-dev`;
        const sourceOf = async (event: any) => (await $web.packContext(event, null).catch(GETERR))?.source;

        //* with `pathParameters` → `/{type}/{id}/{cmd}` (encoded by `asPath()`).
        if (1) {
            const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
            event.pathParameters = { type: 'hello', id: 'a b', cmd: 'c/d' };
            expect2(await sourceOf(event)).toEqual(`${base}/hello/a%20b/c/d#${$pack.version}`);
        }

        //* without `pathParameters` → the service uri only (same as v4).
        if (1) {
            const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
            event.pathParameters = null;
            expect2(await sourceOf(event)).toEqual(`${base}#${$pack.version}`);
        }

        //* internal call (host-less, `x-protocol-context`) → the caller's source is kept as is.
        if (1) {
            const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
            Object.keys(event.headers)
                .filter(key => key.toLowerCase() === 'host')
                .forEach(key => delete event.headers[key]);
            const source = 'api://caller@lemon-caller-api-dev/first/1/start#1.0.0';
            const context: NextContext = {
                accountId: '796730245826',
                requestId: 'd8485d00-5624-4094-9a93-ce09c351ee5b',
                source,
            };
            event.headers['x-protocol-context'] = $U.json(context);
            expect2(await sourceOf(event)).toEqual(source);
        }
    });

    //* test packContext() via web-handler-servce
    it('should pass packContext() via lambda protocol', async () => {
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const context: NextContext = {
            accountId: '796730245826',
            requestId: 'd8485d00-5624-4094-9a93-ce09c351ee5b',
            identity: { sid: 'A', uid: 'B', gid: 'C', roles: null },
        };

        //* no pack context by header
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const response: any = await service.handle(event, context).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        const body = JSON.parse(response.body);
        expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
        expect2(body.context, '').toEqual(context);
    });

    //* test encodeIdentityJWT with useHs256 and verifyToken
    it('should pass encodeIdentityJWT and verifyToken tests', async () => {
        const $t = new MyHttpHeaderTool({});

        //* test of validation - encodeIdentityJWT
        expect2(await $t.encodeIdentityJWT(null as any).catch(GETERR)).toEqual(
            '@identity (object) is required - but object',
        );
        expect2(await $t.encodeIdentityJWT(undefined as any).catch(GETERR)).toEqual(
            '@identity (object) is required - but undefined',
        );
        expect2(await $t.encodeIdentityJWT('abc' as any).catch(GETERR)).toEqual(
            '@identity (object) is required - but string',
        );

        //* test of encodeIdentityJWT with useHs256: true (HS256)
        const identity: NextIdentity = { sid: 'S', uid: 'U', gid: 'G', roles: ['admin'] };
        const current = ($U.dt('2026-02-12 20:00:00', 9) as unknown as Date).getTime();

        const $encHs256 = await $t.encodeIdentityJWT(identity, { current, useHs256: true });
        expect2(() => $encHs256.token.split('.').length).toEqual(3);
        expect2(() => $encHs256.signature.length > 0).toEqual(true);

        //* verify HS256 JWT structure
        const decodedHs256 = await $t.parseIdentityJWT($encHs256.token, { verify: false });
        expect2(() => decodedHs256, 'sid,uid,gid,roles').toEqual({ sid: 'S', uid: 'U', gid: 'G', roles: ['admin'] });
        expect2(() => decodedHs256?.iss?.startsWith('api/')).toEqual(true);
        expect2(() => decodedHs256?.iat).toEqual(Math.floor(current / 1000));
        expect2(() => decodedHs256?.exp).toEqual(Math.floor(current / 1000) + 30 * 60); //* default 30 min.

        //* test of encodeIdentityJWT without useHs256 (V1 동작 - signature empty, iss null)
        const $encV1 = await $t.encodeIdentityJWT(identity, { current });
        expect2(() => $encV1.signature).toEqual('');
        expect2(() => $encV1.token.endsWith('.')).toEqual(true);
        const decodedV1 = $U.jwt().decode($encV1.token);
        expect2(() => decodedV1, 'iss').toEqual({ iss: null });

        //* test of validation - parseIdentityJWT
        expect2(await $t.parseIdentityJWT(null as any).catch(GETERR)).toEqual(
            '@token (string) is required (but object) - verifyJWT(http)',
        );
        expect2(await $t.parseIdentityJWT(undefined as any).catch(GETERR)).toEqual(
            '@token (string) is required (but undefined) - verifyJWT(http)',
        );
        expect2(await $t.parseIdentityJWT('').catch(GETERR)).toEqual(
            '@token (string) is required (but string) - verifyJWT(http)',
        );

        //* match err cases - parseIdentityJWT
        expect2(await $t.parseIdentityJWT('abc.def').catch(GETERR)).toEqual(
            '@token[masked:7] is invalid (format) - verifyJWT(http)',
        );
        expect2(await $t.parseIdentityJWT('a.b.c.d').catch(GETERR)).toEqual(
            '@token[masked:7] is invalid (format) - verifyJWT(http)',
        );

        //* test of parseIdentityJWT - HS256 token verification
        const $parsed = await $t.parseIdentityJWT($encHs256.token, { current });
        expect2(() => $parsed, 'sid,uid,gid,roles').toEqual({ sid: 'S', uid: 'U', gid: 'G', roles: ['admin'] });

        //* tampered signature should fail
        const badSignature = `${$encHs256.signature.slice(0, -1)}${$encHs256.signature.endsWith('A') ? 'B' : 'A'}`;
        const tamperedToken = `${$encHs256.message}.${badSignature}`;
        expect2(await $t.parseIdentityJWT(tamperedToken, { current }).catch(GETERR)).toEqual(
            `@signature[] is invalid (failed to verify by ${decodedHs256.iss}) - verifyJWT(http)`,
        );

        //* test of parseIdentityJWT - expiration
        expect2(
            await $t.parseIdentityJWT($encHs256.token, { current: current + 30 * 60 * 1000 }).catch(GETERR),
            'sid',
        ).toEqual({
            sid: 'S',
        });
        const expiredCurrent = current + 30 * 60 * 1000 + 1;
        expect2(await $t.parseIdentityJWT($encHs256.token, { current: expiredCurrent }).catch(GETERR)).toEqual(
            '.exp[2026-02-12 20:30:00] is invalid (expired) - verifyJWT(http)',
        );

        //* test of parseIdentityJWT - null iss should fail
        expect2(await $t.parseIdentityJWT($encV1.token, { current }).catch(GETERR)).toEqual(
            '@signature[] is invalid (@iss[null] is invalid (unsupportable issuer) - verifyToken()) - verifyJWT(http)',
        );

        //* test of signToken - validation
        expect2(await $t.signToken('', '').catch(GETERR)).toEqual('@message (string) is required - signToken()');
        expect2(await $t.signToken('abc', '').catch(GETERR)).toEqual('@message (string) is required - signToken(abc)');

        //* test of signToken - HS256
        const testMessage = 'test.message';
        const signature = await $t.signToken('', testMessage);
        expect2(() => signature.length > 0).toEqual(true);

        //* test of verifyToken - validation
        expect2(await $t.verifyToken(null as any, 'msg', 'sig')).toEqual({
            valid: false,
            error: '@iss[null] is invalid (unsupportable issuer) - verifyToken()',
        });
        expect2(await $t.verifyToken(undefined as any, 'msg', 'sig')).toEqual({
            valid: false,
            error: '@iss[undefined] is invalid (unsupportable issuer) - verifyToken()',
        });
        expect2(await $t.verifyToken('invalid/issuer', 'msg', 'sig')).toEqual({
            valid: false,
            error: '@iss[invalid/issuer] is invalid (unsupportable issuer) - verifyToken(invalid/issuer)',
        });
        expect2(await $t.verifyToken('kms/', 'msg', 'sig')).toEqual({
            valid: false,
            error: '@alias (string) is required - verifyToken(kms/)',
        });
        expect2(await $t.verifyToken('api/Abc', 'msg', 'sig')).toEqual({
            valid: false,
            error: '@issuer[Abc] is invalid - verifyToken(api/Abc)',
        });
        expect2(await $t.verifyToken('api/abc/def', 'msg', 'sig')).toEqual({
            valid: false,
            error: '@issuer[abc/def] is invalid - verifyToken(api/abc/def)',
        });
        expect2(await $t.verifyToken('api/abc@def', 'msg', 'sig')).toEqual({
            valid: false,
            error: '@issuer[abc@def] is invalid - verifyToken(api/abc@def)',
        });

        //* test of verifyToken - api/ local verify
        const [header, payload, sig] = $encHs256.token.split('.');
        const message = `${header}.${payload}`;
        const iss = (decodedHs256 as { iss: string }).iss;
        expect2(await $t.verifyToken(iss, message, sig)).toEqual({ valid: true });

        const badSig = sig.endsWith('A') ? sig.slice(0, -1) + 'B' : sig.slice(0, -1) + 'A';
        expect2(await $t.verifyToken(iss, message, badSig)).toEqual({ valid: false });

        //* test of verifyToken - api/ remote (protocol error expected)
        const remoteResult = await $t.verifyToken('api/other-service', 'msg', 'sig');
        expect2(remoteResult.valid).toEqual(false);
        expect2(typeof remoteResult.error).toEqual('string'); // error varies by environment

        //* test of buildJwtSecret - same accountId generates same secret
        const $t2 = new MyHttpHeaderTool({});
        const secret1 = await $t.buildJwtSecret();
        const secret2 = await $t2.buildJwtSecret();
        expect2(() => secret1 === secret2).toEqual(true);

        //* test of header cloning
        const originalHeaders = { Host: 'api.example.com', 'X-Test': 'original' };
        const $t3 = new MyHttpHeaderTool(originalHeaders);
        originalHeaders['X-Test'] = 'modified';
        expect2(() => $t3.getHeader('X-Test')).toEqual('original');

        //* test of parseIdentityJWT - unsupportable issuer
        const base64url = (t: string) =>
            Buffer.from(t).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const invalidIssToken = (() => {
            const h = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
            const p = base64url(
                JSON.stringify({
                    sid: 'S',
                    iss: 'unknown/issuer',
                    iat: Math.floor(current / 1000),
                    exp: Math.floor(current / 1000) + 3600,
                }),
            );
            return `${h}.${p}.fakesig`;
        })();
        expect2(await $t.parseIdentityJWT(invalidIssToken, { current }).catch(GETERR)).toEqual(
            '@signature[] is invalid (@iss[unknown/issuer] is invalid (unsupportable issuer) - verifyToken(unknown/issuer)) - verifyJWT(http)',
        );
    });

    //* key rotation: JWT HS256 key A (`JWT_SIGN_KEY`) and previous key B (`JWT_SIGN_KEY_PREV` + `_PREV_UNTIL`).
    it('should verify HS256 tokens with the sign key A and the previous key B', async () => {
        const names = ['JWT_SIGN_KEY', 'JWT_SIGN_KEY_PREV', 'JWT_SIGN_KEY_PREV_UNTIL'];
        const keep = names.map(n => process.env[n]);
        //* set or delete an env name.
        const setEnv = (name: string, val?: string) =>
            val === undefined ? delete process.env[name] : (process.env[name] = val);
        const $t = new MyHttpHeaderTool({});
        const identity: NextIdentity = { sid: 'S', uid: 'U', roles: ['admin'] };
        const current = $U.current_time_ms();
        const now = Math.floor(current / 1000);
        try {
            //* unset → the default key, same secret as before.
            names.forEach(n => setEnv(n));
            expect2(await $t.buildJwtSecret()).toEqual(await $t.buildJwtSecret('lemon'));
            const $old = await $t.encodeIdentityJWT(identity, { current, useHs256: true });
            expect2(await $t.parseIdentityJWT($old.token, { current }), 'sid').toEqual({ sid: 'S' });

            //* A set → sign and verify with A. the old (default-key) token fails without B.
            setEnv('JWT_SIGN_KEY', 'unit-test-jwt-key-a');
            const $a = await $t.encodeIdentityJWT(identity, { current, useHs256: true });
            expect2(() => $a.signature === $old.signature).toEqual(false);
            expect2(await $t.parseIdentityJWT($a.token, { current }), 'sid').toEqual({ sid: 'S' });
            const iss = $U.jwt().decode($old.token).iss;
            expect2(await $t.verifyToken(iss, $old.message, $old.signature)).toEqual({ valid: false });

            //* B = the old key, valid → the old token verifies; A still verifies.
            setEnv('JWT_SIGN_KEY_PREV', 'lemon-old-key-b');
            setEnv('JWT_SIGN_KEY', 'lemon-old-key-b');
            const $b = await $t.encodeIdentityJWT(identity, { current, useHs256: true });
            setEnv('JWT_SIGN_KEY', 'unit-test-jwt-key-a');
            setEnv('JWT_SIGN_KEY_PREV_UNTIL', `${now + 60}`);
            expect2(await $t.verifyToken(iss, $b.message, $b.signature)).toEqual({ valid: true });
            expect2(await $t.verifyToken(iss, $a.message, $a.signature)).toEqual({ valid: true });

            //* B expired, or no `_PREV_UNTIL` → the old token fails.
            setEnv('JWT_SIGN_KEY_PREV_UNTIL', `${now - 1}`);
            expect2(await $t.verifyToken(iss, $b.message, $b.signature)).toEqual({ valid: false });
            setEnv('JWT_SIGN_KEY_PREV_UNTIL');
            expect2(await $t.verifyToken(iss, $b.message, $b.signature)).toEqual({ valid: false });
            expect2(await $t.parseIdentityJWT($b.token, { current }).catch(GETERR)).toEqual(
                `@signature[] is invalid (failed to verify by ${iss}) - verifyJWT(http)`,
            );

            //* A configured but failed to decrypt → no fallback to the default key (sign throws, verify fails).
            setEnv('JWT_SIGN_KEY', 'ERROR - decrypt failed');
            expect2(await $t.encodeIdentityJWT(identity, { current, useHs256: true }).catch(GETERR)).toEqual(
                '500 INVALID CONFIG - JWT_SIGN_KEY decrypt failed',
            );
            expect2(await $t.verifyToken(iss, $old.message, $old.signature), 'valid').toEqual({ valid: false });
        } finally {
            names.forEach((n, i) => setEnv(n, keep[i]));
        }
    });
});

//! v5 B7: the per-request `PERF` lines.
describe('LambdaWEBHandler PERF (v5 B7)', () => {
    //* the parts of `PERF: > <label> <ms> ms <tail>` in the logged args (`LS=1` → spy on the engine console).
    const perfLines = (calls: any[][], label: string) =>
        calls
            .map(args => args.map(a => `${a}`))
            .filter(a => a.indexOf(label) > 0 && a[a.indexOf(label) - 1] === '>' && a.some(x => x.includes('PERF')))
            .map(a => ({ total: a[a.indexOf(label) + 1], tail: a[a.indexOf(label) + 2] || '' }));
    //* the keys and the values of a `key=value` tail.
    const keysOf = (tail: string) => tail.split(' ').map(kv => kv.split('=')[0]);
    const valuesOf = (tail: string) =>
        tail.split(' ').reduce<Record<string, string>>((M, kv) => ({ ...M, [kv.split('=')[0]]: kv.split('=')[1] }), {});
    //* a fresh web event for the `hello` type.
    const eventOf = (id: string, cmd?: string): any => {
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.pathParameters['id'] = id;
        if (cmd) event.pathParameters['cmd'] = cmd;
        return event;
    };
    const MS = /^\d+\.\d$/;

    //* request lines: key order, `cmd` only when present, failure status, and `cold` only on the first line.
    it('should print one request line per request', async () => {
        //* fresh modules → a fresh `cold` counter in this test file.
        vi.resetModules();
        const $web = await import('./lambda-web-handler');
        const $lam = await import('./lambda-handler');
        const service = new $web.LambdaWEBHandler(new $lam.LambdaHandler(), true);
        service.setHandler('hello', decode_next_handler);
        const spy = vi.spyOn($engine.$console, 'log');
        try {
            //* 1) success: GET /hello/abc
            const e1 = eventOf('abc');
            expect2((await service.handle(e1, await service.packContext(e1, null))).statusCode).toEqual(200);
            //* 2) success with cmd: GET /hello/abc/hi
            const e2 = eventOf('abc', 'hi');
            expect2((await service.handle(e2, await service.packContext(e2, null))).statusCode).toEqual(200);
            //* 3) failure: GET /hello/0 → 404
            const e3 = eventOf('0');
            expect2((await service.handle(e3, await service.packContext(e3, null))).statusCode).toEqual(404);
            //* 4) no `packContext()` for this event object (reuse a context) → `context=0.0`
            const $ctx = await service.packContext(eventOf('ctx'), null);
            expect2((await service.handle(eventOf('xyz'), $ctx)).statusCode).toEqual(200);

            const lines = perfLines(spy.mock.calls, 'request');
            expect2(lines.length).toEqual(4);
            const [l1, l2, l3, l4] = lines;
            expect2(keysOf(l1.tail)).toEqual('mode,type,status,context,param,handler,response,cold'.split(','));
            expect2(keysOf(l2.tail)).toEqual('mode,type,cmd,status,context,param,handler,response,cold'.split(','));
            expect2(keysOf(l3.tail)).toEqual(keysOf(l1.tail));
            expect2(valuesOf(l1.tail), 'mode,type,status,cold').toEqual({
                mode: 'GET',
                type: 'hello',
                status: '200',
                cold: '1',
            });
            expect2(valuesOf(l2.tail), 'cmd,status,cold').toEqual({ cmd: 'hi', status: '200', cold: '0' });
            expect2(valuesOf(l3.tail), 'status,cold').toEqual({ status: '404', cold: '0' });
            expect2(valuesOf(l4.tail), 'context,cold').toEqual({ context: '0.0', cold: '0' });
            //* every ms has one decimal, and no id/path is in the line.
            lines.forEach(({ total, tail }) => {
                expect2(total).toMatch(/^\d+\.\d ms$/);
                const v = valuesOf(tail);
                ['context', 'param', 'handler', 'response'].forEach(k => expect2(v[k]).toMatch(MS));
                expect2(tail.includes('abc') || tail.includes('xyz') || tail.includes('/')).toEqual(false);
            });
        } finally {
            spy.mockRestore();
        }
    });

    //* the `LambdaModule` wrapper: one handle line per call (with `initialize()`), `type=unknown` for a bad event.
    it('should print one handle line per lambda call', async () => {
        vi.resetModules();
        const $mod = await import('./index');
        const inf = vi.fn();
        const engine: any = { register: () => {}, initialize: vi.fn(async () => {}), inf };
        const mod = new $mod.LambdaModule(engine);
        mod.web.setHandler('hello', decode_next_handler);

        //* web event → `type=web cold=1`
        expect2((await mod.lambda.handle(eventOf('abc'), null)).statusCode).toEqual(200);
        //* unknown event → resolved failure, `type=unknown cold=0`
        await mod.lambda.handle({}, null);
        //* init failure → resolved failure, still one line.
        engine.initialize.mockRejectedValueOnce(new Error('boom'));
        await mod.lambda.handle(eventOf('abc'), null);

        expect2(engine.initialize.mock.calls.length).toEqual(3);
        const lines = perfLines(inf.mock.calls, 'handle');
        expect2(lines.map(_ => _.tail)).toEqual(['type=web cold=1', 'type=unknown cold=0', 'type=web cold=0']);
        lines.forEach(({ total }) => expect2(total).toMatch(/^\d+\.\d ms$/));
    });
});
