/**
 * `lambda-web-handler.spec.ts`
 * - unit test for `lambda-web-handler`
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-11-08 initial version
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
import { $U } from '../../engine';
import { NextDecoder, NextHandler, NextContext } from 'lemon-model';
import { expect2, GETERR, GETERR$, environ } from '../../common/test-helper';
import { loadJsonSync, credentials } from '../../tools';
import { ProtocolParam } from '../core-services';
import { FunctionWEBHandler, MyHttpHeaderTool, buildResponse } from './functions-web-handler';
import { CoreWEBController } from '../lambda';
import { FunctionHandler } from './functions-handler';
import * as $functions from './functions-handler.spec';
import { NextIdentity } from '..';

class FunctionWEBHandlerLocal extends FunctionWEBHandler {
    public constructor(functions: FunctionHandler) {
        super(functions, true);
    }
    public result: any = null;
    public async handleProtocol<TResult = any>(param: ProtocolParam, ctx: any): Promise<TResult> {
        const result: TResult = await super.handleProtocol(param, ctx);
        this.result = result;
        return result;
    }
}
export const instance = (_functions?: FunctionHandler) => {
    const { service: functions } = $functions.instance();
    const service = new FunctionWEBHandlerLocal(_functions || functions);
    const lemon = new MyLemonWebController();
    service.setHandler('hello', decode_next_handler);
    service.addController(lemon);
    return { functions, service, lemon };
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
describe('FunctionWEBHandler', () => {
    //! list in web-handler
    it('should pass success LIST / via web', async done => {
        const { service } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');

        // ! LIST `/helo` controller
        let id = '';
        context.req.url = `https://localhost:7071/api/hello/${id}`;
        context.req.params = {};
        const res = await service.handle(context, context.req);

        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body: $U.json({ hello: 'LIST' }) });

        //! service handlers
        expect2(Object.keys(service.getHandlerDecoders())).toEqual(['hello', 'lemon']); // must be maps
        expect2(typeof service.getHandlerDecoders()['lemon']).toEqual('function'); // must be decoder

        //! LIST `/lemon` controller
        let type = 'lemon';
        context.req.url = `https://localhost:7071/api/${type}/${id}`;
        context.req.params = {};

        expect2(await service.handle(context, context.req), 'body').toEqual({
            body: $U.json({ mode: 'do-list', type: 'lemon', hello: 'my-lemon-web-controller:lemon' }),
        });

        //! GET `/lemon/123` controller
        type = 'lemon';
        id = '123';
        context.req.url = `https://localhost:7071/api/${type}/${id}`;
        context.req.params['id'] = id;
        context.req.method = 'GET';

        expect2(await service.handle(context, context.req), 'body').toEqual({
            body: $U.json({ mode: 'do-list', type: 'lemon', hello: 'my-lemon-web-controller:lemon' }),
        });

        //! PUT `/lemon` controller
        context.req.url = `https://localhost:7071/api/${type}`;
        context.req.method = 'PUT';

        expect2(await service.handle(context, context.req), 'body').toEqual({ body: '404 NOT FOUND - PUT /lemon/123' });
        /* eslint-enable prettier/prettier */

        done();
    });

    //! list via functions-handler.
    it('should pass success GET / via functions', async done => {
        /* eslint-enable prettier/prettier */
        const { functions } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');

        // ! LIST `/helo` controller
        const id = '';
        context.req.url = `https://localhost:7071/api/hello/${id}`;
        context.req.params = {};
        const response = await functions.handle(context, context.req).catch(GETERR$);

        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body: $U.json({ hello: 'LIST' }) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /{id}
    it('should pass success GET /abc', async done => {
        /* eslint-enable prettier/prettier */
        const { functions } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');

        const id = 'abc';
        context.req.url = `https://localhost:7071/api/hello/${id}`;
        context.req.params['id'] = id;

        const res = await functions.handle(context, context.req);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body: $U.json({ id, hello: `${id}` }) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /{id}/{cmd}
    it('should pass success GET /abc/hi', async done => {
        /* eslint-enable prettier/prettier */
        const { functions } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');
        const id = 'abc';
        const cmd = 'hi';

        context.req.url = `https://localhost:7071/api/hello/${id}/${cmd}`;
        context.req.params['id'] = id;
        context.req.params['cmd'] = cmd;
        const res = await functions.handle(context, context.req);

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
        const { functions } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');
        const id = 'abc';
        const cmd = 'hi';

        context.req.method = 'POST';
        context.req.url = `https://localhost:7071/api/hello/${id}/${cmd}`;
        context.req.params['id'] = id;
        context.req.params['cmd'] = cmd;
        const res = await functions.handle(context, context.req);

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

    //! POST / => 400
    it('should pass success POST / 400', async done => {
        /* eslint-enable prettier/prettier */
        const { functions } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');
        context.req.method = 'POST';
        const id = '';
        context.req.params['id'] = id;
        context.req.url = `https://localhost:7071/api/hello/${id}`;
        const res = await functions.handle(context, context.req);

        expect2(() => res, 'statusCode').toEqual({ statusCode: 400 });
        expect2(() => res.headers, 'Content-Type').toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
        expect2(() => res, 'body').toEqual({ body: '@id[] (string) is required!' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /0 => 404
    it('should pass success GET /0 404', async done => {
        /* eslint-enable prettier/prettier */
        const { functions } = instance();
        const context: any = loadJsonSync('data/samples/functions-handler/context-web.json');
        const id = '0';
        context.req.params['id'] = id;
        context.req.url = `https://localhost:7071/api/hello/${id}`;
        const res = await functions.handle(context, context.req);

        expect2(() => res, 'statusCode').toEqual({ statusCode: 404 });
        expect2(() => res.headers, 'Content-Type').toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
        expect2(() => res, 'body').toEqual({ body: '404 NOT FOUND - id:0' });
        /* eslint-enable prettier/prettier */
        done();
    });
});
