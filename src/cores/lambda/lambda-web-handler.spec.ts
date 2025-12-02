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
import { LambdaWEBHandler, CoreWEBController, MyHttpHeaderTool, buildResponse } from './lambda-web-handler';
import { LambdaHandler } from './lambda-handler';
import * as $lambda from './lambda-handler.spec';
import { NextIdentity } from '..';

/**
 * Mock AWSKMSService for testing without AWS credentials
 */
class MockAWSKMSService {
    private _keyId: string;
    private mockSignature: string;
    private mockVerifyResult: boolean | null;

    public constructor(keyId: string, mockSig?: string, mockVerify?: boolean | null) {
        this._keyId = keyId;
        this.mockSignature = mockSig || 'mock_signature_base64';
        this.mockVerifyResult = mockVerify !== undefined ? mockVerify : true;
    }

    public hello() {
        return `mock-kms-service:${this._keyId}`;
    }

    public keyId() {
        return this._keyId;
    }

    public instance() {
        return null as any;
    }

    public sign = async (message: string, forJwtSignature = true): Promise<string> => {
        return this.mockSignature;
    };

    public verify = async (message: string, signature: string, options?: { throwable?: boolean }): Promise<boolean> => {
        if (this.mockVerifyResult === false) {
            return false;
        }
        if (this.mockVerifyResult === null) {
            throw new Error('Mock KMS verify error');
        }
        return true;
    };

    public setMockSignature(sig: string) {
        this.mockSignature = sig;
    }

    public setMockVerifyResult(result: boolean | null) {
        this.mockVerifyResult = result;
    }
}

/**
 * Mock MyHttpHeaderTool that uses Mock KMS
 */
class MockMyHttpHeaderTool extends MyHttpHeaderTool {
    private mockKMSService: MockAWSKMSService | null = null;

    protected findKMSService(keyId: string): any {
        if (!this.mockKMSService) {
            this.mockKMSService = new MockAWSKMSService(keyId);
        }
        return this.mockKMSService;
    }

    public getMockKMS(): MockAWSKMSService | null {
        return this.mockKMSService;
    }
}

/**
 * LambdaWEBHandler with Mock KMS
 */
class LambdaWEBHandlerWithMockKMS extends LambdaWEBHandler {
    private toolInstance: MockMyHttpHeaderTool | null = null;

    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }

    public result: any = null;

    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        const result: TResult = await super.handleProtocol(param);
        this.result = result;
        return result;
    }

    public tools = (headers: any): any => {
        if (!this.toolInstance) {
            this.toolInstance = new MockMyHttpHeaderTool(headers);
        }
        return this.toolInstance;
    };

    public getMockKMS(): MockAWSKMSService | null {
        if (!this.toolInstance) {
            this.toolInstance = new MockMyHttpHeaderTool({});
        }
        return this.toolInstance.getMockKMS();
    }
}

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

export const instanceWithMockKMS = (_lambda?: LambdaHandler) => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaWEBHandlerWithMockKMS(_lambda || lambda);
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
                '@iss[null] is invalid (unsupportable issuer) - verifyJWT(http)',
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
            expect2(await parse1(null)).toEqual('@token (string) is required - but object');
            expect2(await parse1($enc.message + '.')).toEqual('@signature (string|Buffer) is required - kms.verify()');
            expect2(await parse1($enc.message + '.' + 'xyz')).toEqual(
                `@signature[] is invalid - not be verified by iss:kms/${alias}!`,
            );
            expect2(await parse1($enc.message + '.' + $enc.signature.replace('0', '1'))).toEqual(
                `@signature[] is invalid - not be verified by iss:kms/${alias}!`,
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

    //* Test 301/302 redirect error
    it('should handle 301/302 redirect error', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        //* Add handler that throws 301 redirect
        service.setHandler('redirect', (mode, id) => {
            if (id == '301')
                return async () => {
                    throw new Error('301 REDIRECT - https://example.com/new');
                };
            if (id == '302')
                return async () => {
                    throw new Error('302 REDIRECT - https://example.com/temp');
                };
            return null;
        });

        //* Test 301 redirect
        event.resource = '/redirect/{id}';
        event.path = '/redirect/301';
        event.pathParameters['id'] = '301';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const res301 = await service.handle(event, $ctx);
        expect2(() => res301.statusCode).toEqual(301);
        expect2(() => res301.headers['Location']).toEqual('https://example.com/new');

        //* Test 302 redirect
        event.path = '/redirect/302';
        event.pathParameters['id'] = '302';
        const res302 = await service.handle(event, $ctx);
        expect2(() => res302.statusCode).toEqual(302);
        expect2(() => res302.headers['Location']).toEqual('https://example.com/temp');
    });

    //* Test 400 SIGNATURE error
    it('should handle 400 SIGNATURE error', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        service.setHandler('sig', (mode, id) => {
            if (id == 'bad')
                return async () => {
                    throw new Error('400 SIGNATURE - fail to verify!');
                };
            return null;
        });

        event.resource = '/sig/{id}';
        event.path = '/sig/bad';
        event.pathParameters['id'] = 'bad';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const res = await service.handle(event, $ctx);
        expect2(() => res.statusCode).toEqual(400);
        expect2(() => res.body).toEqual('400 SIGNATURE - fail to verify!');
    });

    //* Test .name format error
    it('should handle .name format error', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        service.setHandler('dot', (mode, id) => {
            if (id == 'err')
                return async () => {
                    throw new Error('.name (string) is required!');
                };
            return null;
        });

        event.resource = '/dot/{id}';
        event.path = '/dot/err';
        event.pathParameters['id'] = 'err';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const res = await service.handle(event, $ctx);
        expect2(() => res.statusCode).toEqual(400);
        expect2(() => res.body).toEqual('.name (string) is required!');
    });

    //* Test @name format error
    it('should handle @name format error', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        service.setHandler('at', (mode, id) => {
            if (id == 'err')
                return async () => {
                    throw new Error('@param (object) is required!');
                };
            return null;
        });

        event.resource = '/at/{id}';
        event.path = '/at/err';
        event.pathParameters['id'] = 'err';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const res = await service.handle(event, $ctx);
        expect2(() => res.statusCode).toEqual(400);
        expect2(() => res.body).toEqual('@param (object) is required!');
    });

    //* Test REPORT_ERROR=true paths
    it('should handle REPORT_ERROR=true error paths', async () => {
        const { lambda, service } = instance();
        const { LambdaHandler } = await import('./lambda-handler');
        const originalReportError = LambdaHandler.REPORT_ERROR;

        //* Enable REPORT_ERROR
        LambdaHandler.REPORT_ERROR = true;

        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        service.setHandler('err', (mode, id) => {
            if (id == '500')
                return async () => {
                    throw new Error('500 INTERNAL ERROR');
                };
            if (id == 'dot')
                return async () => {
                    throw new Error('.field is required');
                };
            if (id == 'at')
                return async () => {
                    throw new Error('@id is required');
                };
            if (id == 'gen')
                return async () => {
                    throw new Error('General error');
                };
            return null;
        });

        event.resource = '/err/{id}';
        const $ctx = await lambda.getHandler('web').packContext(event, null);

        //* Test 500 error with REPORT_ERROR
        event.path = '/err/500';
        event.pathParameters['id'] = '500';
        const res500 = await service.handle(event, $ctx);
        expect2(() => res500.statusCode).toEqual(500);
        expect2(() => res500.body).toEqual('500 INTERNAL ERROR');

        //* Test .field error with REPORT_ERROR
        event.path = '/err/dot';
        event.pathParameters['id'] = 'dot';
        const resDot = await service.handle(event, $ctx);
        expect2(() => resDot.statusCode).toEqual(400);
        expect2(() => resDot.body).toEqual('.field is required');

        //* Test @id error with REPORT_ERROR
        event.path = '/err/at';
        event.pathParameters['id'] = 'at';
        const resAt = await service.handle(event, $ctx);
        expect2(() => resAt.statusCode).toEqual(400);
        expect2(() => resAt.body).toEqual('@id is required');

        //* Test general error with REPORT_ERROR
        event.path = '/err/gen';
        event.pathParameters['id'] = 'gen';
        const resGen = await service.handle(event, $ctx);
        expect2(() => resGen.statusCode).toEqual(503);
        expect2(() => resGen.body).toEqual('General error');

        //* Restore original value
        LambdaHandler.REPORT_ERROR = originalReportError;
    });

    //* Test hasHandler method
    it('should test hasHandler method', async () => {
        const { service } = instance();

        expect2(() => service.hasHandler('hello')).toEqual(true);
        expect2(() => service.hasHandler('lemon')).toEqual(true);
        expect2(() => service.hasHandler('unknown')).toEqual(false);
        expect2(() => service.hasHandler('notexist')).toEqual(false);
    });

    //* Test handleProtocol with body
    it('should handle protocol with body', async () => {
        const { service } = instance();
        const param: ProtocolParam = {
            type: 'hello',
            mode: 'POST',
            id: 'test',
            cmd: '',
            param: {},
            body: { data: 'test-data', value: 123 },
            context: null,
        };

        const result = await service.handleProtocol(param);
        expect2(() => result).toEqual({ id: 'test', hello: 'test' });
    });

    //* Test default handler (GET /)
    it('should handle default route GET /', async () => {
        const { lambda } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        const $pack = loadJsonSync('package.json');

        //* Simulate GET / request
        event.httpMethod = 'GET';
        event.resource = '/';
        event.path = '/';
        event.pathParameters = {};

        const res = await lambda.handle(event, null);
        expect2(() => res.statusCode).toEqual(200);
        //* lemon-core project itself doesn't have lemon-core as dependency
        expect2(() => res.body).toEqual(`${$pack.name}/${$pack.version}`);
    });

    //* Test decoder returns null
    it('should handle decoder returning null', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        //* Use lemon controller which returns null for PUT mode
        event.httpMethod = 'PUT';
        event.resource = '/lemon/{id}';
        event.path = '/lemon/test';
        event.pathParameters['id'] = 'test';

        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const res = await service.handle(event, $ctx);
        expect2(() => res.statusCode).toEqual(404);
        expect2(() => res.body).toEqual('404 NOT FOUND - PUT /lemon/test');
    });

    //* Test Promise.reject in handleProtocol
    it('should handle Promise.reject in handleProtocol', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        service.setHandler('throw', (mode, id) => {
            if (id == 'sync')
                return () => {
                    throw new Error('Sync error');
                };
            return null;
        });

        event.resource = '/throw/{id}';
        event.path = '/throw/sync';
        event.pathParameters['id'] = 'sync';
        const $ctx = await lambda.getHandler('web').packContext(event, null);
        const res = await service.handle(event, $ctx);
        expect2(() => res.statusCode).toEqual(503);
        expect2(() => res.body).toEqual('Sync error');
    });

    //* Test MyHttpHeaderTool methods
    it('should test MyHttpHeaderTool methods', async () => {
        const { service } = instance();

        //* Test hello()
        const $t = service.tools({});
        expect2(() => $t.hello()).toEqual('header-tool-by-default');

        //* Test getHeaders with invalid types
        const $t2 = service.tools({
            'X-Test': ['valid', 123 as any, 'another'],
            'X-Other': 456 as any,
        });
        expect2(() => $t2.getHeaders('X-Test')).toEqual(['valid', 'another']);
        expect2(() => $t2.getHeaders('X-Other')).toEqual([]);

        //* Test parseCookiesHeader
        const $t3 = service.tools({
            cookie: 'name=value; session=abc123; token=xyz',
        });
        expect2(() => $t3.parseCookiesHeader()).toEqual({
            name: 'value',
            session: 'abc123',
            token: 'xyz',
        });

        //* Test parseCookiesHeader with no cookie
        const $t4 = service.tools({});
        expect2(() => $t4.parseCookiesHeader()).toEqual(undefined);
    });

    //* Test parseIdentityJWT external call
    it('should test parseIdentityJWT external call', async () => {
        const { service } = instance();

        //* External call (host is present)
        const $t = service.tools({
            Host: 'api.example.com',
            'x-lemon-identity': 'header.payload.signature',
        }) as MyHttpHeaderTool;

        const result = await $t.parseIdentityHeader();
        expect2(() => result.meta).toEqual('header.payload.signature');
        expect2(() => result.error).toEqual(
            '@token[header.payload.signature] is invalid (failed to decode) - verifyJWT(http)',
        );
    });

    //* Test encodeIdentityJWT validation
    it('should test encodeIdentityJWT validation', async () => {
        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;

        const err = await $t.encodeIdentityJWT(null).catch(GETERR);
        expect2(() => err).toEqual('@identity (object) is required - but object');
    });

    //* Test parseIdentityJWT isVerify=false
    it('should test parseIdentityJWT isVerify=false', async () => {
        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const identity: NextIdentity = { sid: 'S', uid: 'U' };
        const current = 1652149353000;

        const $enc = await $t.encodeIdentityJWT(identity, { current });
        const decoded = await $t.parseIdentityJWT($enc.token, { verify: false });
        expect2(() => decoded.sid).toEqual('S');
        expect2(() => decoded.uid).toEqual('U');
        expect2(() => decoded.iss).toEqual(null);
    });

    //* Test parseIdentityJWT _alias with comma
    it('should test parseIdentityJWT _alias with comma', async () => {
        if (!PROFILE) return; // Skip if no PROFILE

        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const identity: NextIdentity = { sid: 'S', uid: 'U' };
        const current = 1652149353000;
        const alias = 'lemon-identity-key';

        //* Encode with alias
        const $enc = await $t.encodeIdentityJWT(identity, { current, alias });

        //* Test parsing
        const decoded = await $t.parseIdentityJWT($enc.token, { current });
        expect2(() => decoded.sid).toEqual('S');
        expect2(() => decoded.uid).toEqual('U');
        expect2(() => decoded.iss).toEqual(`kms/${alias}`);
    });

    //* Test findKMSService and verify paths
    it('should test findKMSService and KMS verify paths', async () => {
        if (!PROFILE) return; // Skip if no PROFILE

        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const identity: NextIdentity = { sid: 'S', uid: 'U' };
        const current = 1652149353000;
        const alias = 'lemon-identity-key';

        const $enc = await $t.encodeIdentityJWT(identity, { current, alias });

        //* Test with invalid signature
        const badToken = $enc.message + '.' + 'invalidsignature';
        const err1 = (await $t.parseIdentityJWT(badToken, { current }).catch(GETERR)) as string;
        expect2(() => err1).toEqual(`@signature[] is invalid - not be verified by iss:kms/${alias}!`);

        //* Test with no alias
        const badIss = $enc.token.replace(`kms/${alias}`, 'kms/');
        const err2 = (await $t.parseIdentityJWT(badIss, { current }).catch(GETERR)) as string;
        expect2(() => err2).toEqual('@signature[] is invalid - not be verified by iss:kms/!');
    });

    //* Test REPORT_ERROR=false paths
    it('should handle errors with REPORT_ERROR=false', async () => {
        const { lambda, service } = instance();
        const { LambdaHandler } = await import('./lambda-handler');
        const originalReportError = LambdaHandler.REPORT_ERROR;

        LambdaHandler.REPORT_ERROR = false;

        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
        service.setHandler('err', (mode, id) => {
            if (id == '500')
                return async () => {
                    throw new Error('500 INTERNAL ERROR');
                };
            if (id == 'dot')
                return async () => {
                    throw new Error('.field is required');
                };
            if (id == 'at')
                return async () => {
                    throw new Error('@id is required');
                };
            if (id == 'gen')
                return async () => {
                    throw new Error('General error');
                };
            return null;
        });

        event.resource = '/err/{id}';
        const $ctx = await lambda.getHandler('web').packContext(event, null);

        //* Test 500 error without REPORT_ERROR
        event.path = '/err/500';
        event.pathParameters['id'] = '500';
        const res500 = await service.handle(event, $ctx);
        expect2(() => res500.statusCode).toEqual(500);
        expect2(() => res500.body).toEqual('500 INTERNAL ERROR');

        //* Test .field error without REPORT_ERROR
        event.path = '/err/dot';
        event.pathParameters['id'] = 'dot';
        const resDot = await service.handle(event, $ctx);
        expect2(() => resDot.statusCode).toEqual(400);
        expect2(() => resDot.body).toEqual('.field is required');

        //* Test @field error without REPORT_ERROR
        event.path = '/err/at';
        event.pathParameters['id'] = 'at';
        const resAt = await service.handle(event, $ctx);
        expect2(() => resAt.statusCode).toEqual(400);
        expect2(() => resAt.body).toEqual('@id is required');

        //* Test general error without REPORT_ERROR
        event.path = '/err/gen';
        event.pathParameters['id'] = 'gen';
        const resGen = await service.handle(event, $ctx);
        expect2(() => resGen.statusCode).toEqual(503);
        expect2(() => resGen.body).toEqual('General error');

        LambdaHandler.REPORT_ERROR = originalReportError;
    });

    //* Test decoder that is neither function nor object
    it('should handle decoder that is neither function nor object', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.web.json');

        //* Set decoder to a string (not function or object)
        service.setHandler('string-decoder', 'not-a-decoder' as any);

        event.resource = '/string-decoder/{id}';
        event.path = '/string-decoder/test';
        event.pathParameters['id'] = 'test';
        const $ctx = await lambda.getHandler('web').packContext(event, null);

        const res = await service.handle(event, $ctx);
        expect2(() => res.statusCode).toEqual(404);
        expect2(() => res.body).toEqual('404 NOT FOUND - GET /string-decoder/test');
    });

    //* Test real findKMSService instantiation
    it('should test real findKMSService instantiation without AWS credentials', async () => {
        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const identity: NextIdentity = { sid: 'S', uid: 'U' };
        const current = 1652149353000;
        const alias = 'test-key';

        //* This will execute (creating AWSKMSService), then fail when trying to sign
        const err = await $t.encodeIdentityJWT(identity, { current, alias }).catch(GETERR);
        expect2(() => typeof err).toEqual('string');
    });

    //* Test setHandler with invalid type
    it('should throw error when setHandler called with non-string type', async () => {
        const { service } = instance();
        const err = await Promise.resolve()
            .then(() => service.setHandler(null as any, () => null))
            .catch(GETERR);
        expect2(() => err).toEqual('@type (string) is required!');
    });

    //* Test addController with invalid controller
    it('should throw error when addController called with non-object controller', async () => {
        const { service } = instance();
        const err = await Promise.resolve()
            .then(() => service.addController('string' as any))
            .catch(GETERR);
        expect2(() => err).toEqual('@controller (object) is required!');
    });

    //* Test getHandlerDecoders with CoreWEBController
    it('should get decoders with CoreWEBController handler', async () => {
        const { service } = instance();
        const decoders = service.getHandlerDecoders();
        expect2(() => typeof decoders['lemon']).toEqual('function');

        //* Actually call the decoder to execute (the else branch)
        const decoder = decoders['lemon'];
        const result = decoder('GET', 'test-id', 'test-cmd');
        expect2(() => typeof result).toEqual('function');
    });

    //* Test handleProtocol with null param
    it('should throw error when handleProtocol called with null param', async () => {
        const { service } = instance();
        const err = await service.handleProtocol(null as any).catch(GETERR);
        expect2(() => err).toEqual('@param (protocol-param) is required!');
    });

    //* Test packContext with null event
    it('should return null when packContext called with null event', async () => {
        const { service } = instance();
        const res = await service.packContext(null as any);
        expect2(() => res).toEqual(null);
    });

    //* Test parseIdentityJson with non-string val
    it('should throw error when parseIdentityJson called with non-string', async () => {
        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const err = await $t.parseIdentityJson(123 as any).catch(GETERR);
        expect2(() => err).toEqual('@val[123] is invalid - not string!');
    });

    //* Test parseIdentityJWT with invalid token format
    it('should throw error when parseIdentityJWT called with invalid format token', async () => {
        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const err = await $t.parseIdentityJWT('invalid.token').catch(GETERR);
        expect2(() => err).toEqual('@token[invalid.token] is invalid (format) - verifyJWT(http)');
    });

    //* Test parseIdentityJWT with invalid iss type
    it('should throw error when parseIdentityJWT called with invalid iss/iat/exp types', async () => {
        const { service } = instance();
        const $t = service.tools({}) as MyHttpHeaderTool;

        //* Create token with invalid iss type (number instead of string)
        const invalidIssPayload = { iss: 123, iat: 1652149353, exp: 1652235753 };
        const invalidIssToken =
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
            Buffer.from(JSON.stringify(invalidIssPayload))
                .toString('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_') +
            '.signature';
        const err1 = await $t.parseIdentityJWT(invalidIssToken, { verify: false }).catch(GETERR);
        expect2(() => err1).toEqual('.iss (string) is required - verifyJWT(http)');

        //* Create token with invalid iat type (string instead of number)
        const invalidIatPayload = { iss: 'test', iat: 'invalid', exp: 1652235753 };
        const invalidIatToken =
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
            Buffer.from(JSON.stringify(invalidIatPayload))
                .toString('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_') +
            '.signature';
        const err2 = await $t.parseIdentityJWT(invalidIatToken, { verify: false }).catch(GETERR);
        expect2(() => err2).toEqual('.iat (number) is required - verifyJWT(http)');

        //* Create token with invalid exp type (string instead of number)
        const invalidExpPayload = { iss: 'test', iat: 1652149353, exp: 'invalid' };
        const invalidExpToken =
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
            Buffer.from(JSON.stringify(invalidExpPayload))
                .toString('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_') +
            '.signature';
        const err3 = await $t.parseIdentityJWT(invalidExpToken, { verify: false }).catch(GETERR);
        expect2(() => err3).toEqual('.exp (number) is required - verifyJWT(http)');
    });

    //* Test handleProtocol with null decoder
    it('should return null when handleProtocol finds no decoder', async () => {
        const { service } = instance();
        const param: ProtocolParam = { type: 'nonexistent', mode: 'GET', id: 'test', cmd: '', context: null as any };
        const err = await service.handleProtocol(param).catch(GETERR);
        expect2(() => err).toEqual('404 NOT FOUND - GET /nonexistent/test');
    });

    //* Test KMS JWT with Mock
    it('should test KMS JWT with mocked AWSKMSService', async () => {
        const { service } = instanceWithMockKMS();
        const $t = service.tools({}) as MyHttpHeaderTool;
        const identity: NextIdentity = { sid: 'S', uid: 'U' };
        const current = 1652149353000;
        const alias = 'mock-key';

        //* Test encodeIdentityJWT (covers findKMSService call)
        const $enc = await $t.encodeIdentityJWT(identity, { current, alias });
        expect2(() => $enc.signature).toEqual('mock_signature_base64');

        //* Test parseIdentityJWT with KMS verification
        const decoded = await $t.parseIdentityJWT($enc.token, { current });
        expect2(() => decoded.sid).toEqual('S');
        expect2(() => decoded.uid).toEqual('U');
        expect2(() => decoded.iss).toEqual(`kms/${alias}`);

        //* Test _alias with comma
        const aliasWithComma = 'mock-key2,extra';
        const $enc2 = await $t.encodeIdentityJWT({ sid: 'S2', uid: 'U2' }, { current, alias: aliasWithComma });
        const decoded2 = await $t.parseIdentityJWT($enc2.token, { current });
        expect2(() => decoded2.sid).toEqual('S2');
        expect2(() => decoded2.uid).toEqual('U2');

        //* Test KMS verify throwing error
        const mockKMS = service.getMockKMS();
        if (mockKMS) mockKMS.setMockVerifyResult(null);
        const err0 = await $t.parseIdentityJWT($enc.token, { current }).catch(GETERR);
        expect2(() => err0).toEqual('@signature[] is invalid (kms: Mock KMS verify error) - verifyJWT(http)');

        //* Test verify failure
        if (mockKMS) mockKMS.setMockVerifyResult(false);
        const err1 = await $t.parseIdentityJWT($enc.token, { current }).catch(GETERR);
        expect2(() => err1).toEqual(`@signature[] is invalid (failed to verify by iss:kms/${alias}) - verifyJWT(http)`);

        //* Reset verify to true for next tests
        if (mockKMS) mockKMS.setMockVerifyResult(true);

        //* Test missing exp
        const noExpPayload = {
            sid: 'S',
            uid: 'U',
            iss: `kms/${alias}`,
            iat: Math.floor(current / 1000),
            exp: null as any,
        };
        const noExpToken = `${$enc.token.split('.')[0]}.${Buffer.from(JSON.stringify(noExpPayload))
            .toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')}.${$enc.signature}`;
        const err2 = await $t.parseIdentityJWT(noExpToken, { current }).catch(GETERR);
        expect2(() => err2).toEqual('.exp[null] is invalid (empty) - verifyJWT(http)');

        //* Test expired token
        const expiredCurrent = current + 25 * 60 * 60 * 1000;
        const err3 = await $t.parseIdentityJWT($enc.token, { current: expiredCurrent }).catch(GETERR);
        const expTs = $U.ts(Math.floor(current / 1000) * 1000 + 24 * 60 * 60 * 1000);
        expect2(() => err3).toEqual(`.exp[${expTs}] is invalid (expired) - verifyJWT(http)`);
    });
});
