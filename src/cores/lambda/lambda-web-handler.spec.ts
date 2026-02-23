/**
 * `lambda-web-handler.spec.ts`
 * - unit test for `lambda-web-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { $U } from '../../engine/';
import { NextDecoder, NextHandler, NextContext } from 'lemon-model';
import { expect2, GETERR, GETERR$ } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { ProtocolParam } from './../core-services';
import {
    LambdaWEBHandler,
    CoreWEBController,
    MyHttpHeaderTool,
    buildResponse,
} from './lambda-web-handler';
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
            else if (id == '!') next = async (id, param, body, context) => ({ id, param, body, context });  // dump parameter if '!'
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
            expect2(await $t.encodeIdentityJWT(identity, { current }), 'token').toEqual({
                token: `${expectedHead}.`,
            });
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

            const $enc = await $t.encodeIdentityJWT(identity, { current, alias });
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
            expect2(await parse1($enc.token + '.x')).toEqual(`@token[${$enc.token + '.x'}] is invalid (format) - verifyJWT(http)`);
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
            expect2(await parse3($enc.token)).toEqual('.exp[2022-05-11 11:22:33] is invalid (expired) - verifyJWT(http)');
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
            source: `api://796730245826@lemon-core-dev#${$pack.version}`,
            authorization: 'Bearer 12345678',
            origin: 'http://localhost:5004',
            referer: 'http://localhost:5004/',
        });

        //* pre-condition.
        if (1) {
            event.headers['x-protocol-context'] = null;
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,error').toEqual({ statusCode: 200 });
        }
        if (1) {
            event.headers['x-protocol-context'] = {};
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,error').toEqual({
                error: '@context (NextContext) should be string - web.transformToParam(/hello/a_123_test)',
            });
        }
        if (1) {
            event.headers['x-protocol-context'] = '-';
            const $res = await lambda.handle(event, null).catch(GETERR$);
            expect2(() => $res, 'statusCode,error').toEqual({
                error: '@context[-] is not valid JSON - web.transformToParam(/hello/a_123_test)',
            });
        }

        //* pack context by header
        event.headers['x-protocol-context'] = $U.json(context);
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const $res = await lambda.handle(event, null).catch(GETERR$);
        expect2(() => $res, 'statusCode,error').toEqual({ statusCode: 200 });

        const body = JSON.parse($res.body);
        expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
        expect2(body.context, '').toEqual({ ...context });
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
            source: `api://796730245826@lemon-core-dev#${$pack.version}`,
            origin: 'http://localhost:8888',
            referer: 'http://localhost:8888/?code=auth:bc7dd7fe-5d27-45d8-ba45-fa5dc64a7c0a',
        });
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
        expect2(() => decodedHs256?.exp).toEqual(Math.floor(current / 1000) + 24 * 60 * 60);

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
            '@token[abc.def] is invalid (format) - verifyJWT(http)',
        );
        expect2(await $t.parseIdentityJWT('a.b.c.d').catch(GETERR)).toEqual(
            '@token[a.b.c.d] is invalid (format) - verifyJWT(http)',
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
        const expiredCurrent = current + 24 * 60 * 60 * 1000 + 1;
        expect2(await $t.parseIdentityJWT($encHs256.token, { current: expiredCurrent }).catch(GETERR)).toEqual(
            '.exp[2026-02-13 20:00:00] is invalid (expired) - verifyJWT(http)',
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
});
