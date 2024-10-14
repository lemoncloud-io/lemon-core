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
import { $U } from '../../engine/';
import { NextDecoder, NextHandler, NextContext } from 'lemon-model';
import { expect2, GETERR, GETERR$, environ } from '../../common/test-helper';
import { loadJsonSync, credentials } from '../../tools/';
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

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaWEBHandler', () => {
    //! use `env.PROFILE`
    const PROFILE = credentials(environ('ENV'));
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    //! basic function
    it('should pass basic functions', async done => {
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

        done();
    });

    //! pass tools()
    it('should pass header tools', async done => {
        const { service } = instance();

        //! test `tools()` basic
        if (1) {
            const $t = service.tools({
                Host: 'localhost',
            }) as MyHttpHeaderTool;

            expect2(() => $t.isExternal()).toEqual(true);
            expect2(() => $t.parseLanguageHeader()).toEqual();
            expect2(() => $t.parseIdentityHeader()).toEqual({ lang: undefined as string });
        }

        //! test `tools()` of headers
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
            expect2(() => $t.parseIdentityHeader()).toEqual({ meta: '1122', lang: 'ko/kr' });

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
            expect2(await $t.parseIdentityJWT(null).catch(GETERR)).toEqual('@token (string) is required - but object');
            expect2(await $t.parseIdentityJWT(`${expectedHead}.`).catch(GETERR)).toEqual(
                '@iss[null] is invalid - unsupportable issuer!',
            );
        }

        //! test with valid profile
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
            expect2(await parse1(null)).toEqual('@token (string) is required - but object');
            expect2(await parse1($enc.message + '.')).toEqual('@signature (string|Buffer) is required - kms.verify()');
            expect2(await parse1($enc.message + '.' + 'xyz')).toEqual(`@signature[] is invalid - not be verified!`);
            expect2(await parse1($enc.message + '.' + $enc.signature.replace('0', '1'))).toEqual(
                `@signature[] is invalid - not be verified!`,
            );
            expect2(await parse1($enc.token + '.x')).toEqual(`@token[${$enc.token + '.x'}] is invalid format!`);
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
            expect2(await parse3($enc.token)).toEqual('.exp[2022-05-11 11:22:33] is invalid - expired!');
        }

        done();
    });

    //! list in web-handler
    it('should pass success GET / via web', async done => {
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = '';
        event.pathParameters['id'] = id;
        const res = await service.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body: $U.json({ hello: 'LIST' }) });

        //! service handlers
        expect2(Object.keys(service.getHandlerDecoders())).toEqual(['hello', 'lemon']); // must be maps
        expect2(typeof service.getHandlerDecoders()['lemon']).toEqual('function'); // must be decoder function

        /* eslint-disable prettier/prettier */
        //! GET `/lemon` controller
        event.resource = '/lemon/{id}'
        event.path = '/lemon';
        expect2(await service.handle(event, null), 'body').toEqual({ body:$U.json({ mode:'do-list', type:'lemon', hello:'my-lemon-web-controller:lemon' })});

        //! GET `/lemon/123` controller
        event.path = '/lemon/123'; event.pathParameters['id'] = '123';
        expect2(await service.handle(event, null), 'body').toEqual({ body:$U.json({ mode:'MY GET', id:'123', cmd:'', param:{ ts:"1574150700000" }, body:null })});

        //! PUT `/lemon` controller
        event.path = '/lemon'; event.httpMethod = 'PUT';
        expect2(await service.handle(event, null), 'body').toEqual({ body:'404 NOT FOUND - PUT /lemon/123'});
        /* eslint-enable prettier/prettier */

        done();
    });

    //! list via lambda-handler.
    it('should pass success GET / via lambda', async done => {
        /* eslint-enable prettier/prettier */
        const { lambda } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = '';
        event.pathParameters['id'] = id;
        const response = await lambda.handle(event, null).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body: $U.json({ hello: 'LIST' }) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /favicon.ico
    it('should pass success GET /favicon.ico', async done => {
        /* eslint-enable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.httpMethod = 'GET';
        event.path = '/favicon.ico';
        const res = await service.handle(event, null);
        expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => res.headers, 'Content-Type').toEqual({ 'Content-Type': 'image/x-icon' });
        expect2(() => res.body.substring(0, 32)).toEqual('AAABAAEAICAAAAEAIACoEAAAFgAAACgA');
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /abc
    it('should pass success GET /abc', async done => {
        /* eslint-enable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = 'abc';
        event.pathParameters['id'] = id;
        const res = await service.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body: $U.json({ id, hello: `${id}` }) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /{id}/{cmd}
    it('should pass success GET /abc/hi', async done => {
        /* eslint-enable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = 'abc';
        const cmd = 'hi';
        event.pathParameters['id'] = id;
        event.pathParameters['cmd'] = cmd;
        const res = await service.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body: $U.json({ id, cmd, hello: `${cmd} ${id}` }) });
        expect2(res, 'headers').toEqual({
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Headers': 'origin, x-lemon-language, x-lemon-identity',
            },
        });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! POST /{id}/{cmd}
    it('should pass success POST /abc/hi', async done => {
        /* eslint-enable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const id = 'abc';
        const cmd = 'hi';
        const origin = 'https://api.com/';
        event.httpMethod = 'POST';
        event.headers['origin'] = origin;
        event.pathParameters['id'] = id;
        event.pathParameters['cmd'] = cmd;
        const res = await service.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body: $U.json({ id, cmd, hello: `${cmd} ${id}` }) });
        expect2(res, 'headers').toEqual({
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Credentials': true,
                'Access-Control-Allow-Headers': 'origin, x-lemon-language, x-lemon-identity',
            },
        });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! POST / => 400
    it('should pass success POST / 400', async done => {
        /* eslint-enable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.httpMethod = 'POST';
        event.pathParameters['id'] = '';
        const res = await service.handle(event, null);
        expect2(() => res, 'statusCode').toEqual({ statusCode: 400 });
        expect2(() => res.headers, 'Content-Type').toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
        expect2(() => res, 'body').toEqual({ body: '@id[] (string) is required!' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /0 => 404
    it('should pass success GET /0 404', async done => {
        /* eslint-enable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        event.pathParameters['id'] = '0';
        const res = await service.handle(event, null);
        expect2(() => res, 'statusCode').toEqual({ statusCode: 404 });
        expect2(() => res.headers, 'Content-Type').toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
        expect2(() => res, 'body').toEqual({ body: '404 NOT FOUND - id:0' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /0 => 404
    it('should pass context.identity', async done => {
        const { lambda } = instance();
        const loadEventStock = (id: string): any => {
            const event = loadJsonSync('data/samples/events/sample.event.web.json');
            event.pathParameters['id'] = id; // call dump paramters.
            return event;
        };
        const id = '!';

        //! use default cofnig.
        if (1) {
            const event = loadEventStock(id);
            const response = await lambda.handle(event, null).catch(GETERR$);
            expect2(response, 'statusCode').toEqual({ statusCode: 200 });
            const result = JSON.parse(response.body);
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

        //! change identity..(External)
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: '', uid: 'guest' });
            const response = await lambda.handle(event, null).catch(GETERR$);
            expect2(response, 'statusCode').toEqual({ statusCode: 200 });
            const body = JSON.parse(response.body);
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

        //! change identity.. (Internal)
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: null, uid: 'guest' });
            const response = await lambda.handle(event, null).catch(GETERR$);
            expect2(response, 'statusCode').toEqual({ statusCode: 200 });
            const body = JSON.parse(response.body);
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

        //! change identity..
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: 'S', uid: 'guest' });
            const response = await lambda.handle(event, null).catch(GETERR$);
            expect2(response, 'statusCode').toEqual({ statusCode: 200 });
            const body = JSON.parse(response.body);
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

        //! change language..
        if (1) {
            const event = loadEventStock(id);
            delete event.headers['Host'];
            event.headers['x-lemon-identity'] = $U.json({ sid: 'S', lang: 'ko' });
            event.headers['x-lemon-language'] = ' ES '; //! should override `language`.
            const response = await lambda.handle(event, null).catch(GETERR$);
            expect2(response, 'statusCode').toEqual({ statusCode: 200 });
            const result = JSON.parse(response.body);
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

        /* eslint-disable prettier/prettier */
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test packContext() via lambda protocol
    it('should pass packContext(public) via lambda protocol', async done => {
        const { lambda, service: $web } = instance();
        const $pack = loadJsonSync('package.json');
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        // const identity: any = loadJsonSync('data/samples/events/sample.cognito.identity.json');
        const context: NextContext = {
            accountId: '796730245826',
            requestId: 'd8485d00-5624-4094-9a93-ce09c351ee5b',
            identity: { sid: 'A', uid: 'B', gid: 'C', roles: null },
        };

        //! packContext()
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
        });

        //! pack context by header
        event.headers['x-protocol-context'] = $U.json(context);
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const response = await lambda.handle(event, null).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        const body = JSON.parse(response.body);
        expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
        expect2(body.context, '').toEqual({ ...context });

        done();
    });

    //! test packContext() via lambda protocol
    it('should pass packContext(authed) via lambda protocol', async done => {
        const { lambda, service: $web } = instance();
        const $pack = loadJsonSync('package.json');
        const event: any = loadJsonSync('data/samples/events/sample.event.web.signed.json');
        const context: NextContext = {
            accountId: '796730245826',
            requestId: 'a9bff61d-8eaf-4e1d-8e8e-364ed1bef646',
        };

        //! packContext()
        expect2(await lambda.packContext(event, null).catch(GETERR)).toEqual({});
        expect2(await $web.packContext(event, null).catch(GETERR)).toEqual({
            ...context,
            identity: {
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
        });

        done();
    });

    //! test packContext() via web-handler-servce
    it('should pass packContext() via lambda protocol', async done => {
        const { service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const context: NextContext = {
            accountId: '796730245826',
            requestId: 'd8485d00-5624-4094-9a93-ce09c351ee5b',
            identity: { sid: 'A', uid: 'B', gid: 'C', roles: null },
        };

        //! no pack context by header
        // event.headers['x-protocol-context'] = $U.json(context);
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const response: any = await service.handle(event, context).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        const body = JSON.parse(response.body);
        expect2(() => body, 'id,param,body').toEqual({ id, param: { ts: '1574150700000' }, body: null });
        expect2(body.context, '').toEqual(context);

        done();
    });
});
