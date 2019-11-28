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
import { expect2, GETERR$ } from '../common/test-helper';
import { $U } from '../engine/';
import { loadJsonSync } from '../tools/';

import * as $lambda from './lambda-handler.spec';
import { NextDecoder, NextHandler, NextContext } from './core-types';
import { LambdaWEBHandler } from './lambda-web-handler';
import { LambdaHandler } from './lambda-handler';

class LambdaWEBHandlerLocal extends LambdaWEBHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const $web = () => {
    const { service: lambda } = $lambda.instance();
    const instance = new LambdaWEBHandlerLocal(lambda);
    instance.setHandler('hello', decode_next_handler);
    return { lambda, instance };
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
            if (cmd) next = async id => ({ id, cmd, hello: `${cmd} ${id}` });
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

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaWEBHandler', () => {
    //! list in web-handler
    it('should pass success GET / via web', async done => {
        /* eslint-disable prettier/prettier */
        const { instance } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        const id = '';
        event.pathParameters['id'] = id;
        const res = await instance.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body:$U.json({ hello: 'LIST'}) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! list via lambda-handler.
    it('should pass success GET / via lambda', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        const id = '';
        event.pathParameters['id'] = id;
        const response = await lambda.handle(event, null).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body:$U.json({ hello: 'LIST'}) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /abc
    it('should pass success GET /abc', async done => {
        /* eslint-disable prettier/prettier */
        const { instance } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        const id = 'abc';
        event.pathParameters['id'] = id;
        const res = await instance.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body:$U.json({ id, hello: `${id}` }) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /{id}/{cmd}
    it('should pass success GET /abc/hi', async done => {
        /* eslint-disable prettier/prettier */
        const { instance } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        const id = 'abc';
        const cmd = 'hi';
        event.pathParameters['id'] = id;
        event.pathParameters['cmd'] = cmd;
        const res = await instance.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(res, 'body').toEqual({ body:$U.json({ id, cmd, hello: `${cmd} ${id}` }) });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /0 => 404
    it('should pass success GET /0 404', async done => {
        /* eslint-disable prettier/prettier */
        const { instance } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        const id = '0';
        event.pathParameters['id'] = id;
        const res = await instance.handle(event, null);
        expect2(res, 'statusCode').toEqual({ statusCode: 404 });
        expect2(res, 'body').toEqual({ body:'404 NOT FOUND - id:0' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! GET /0 => 404
    it('should pass context.identity', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, instance } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        event.headers['x-lemon-identity'] = $U.json({ sid:'', uid:'guest' });
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const response = await lambda.handle(event, null).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        const body = JSON.parse(response.body);
        expect2(body.id, '').toEqual('!');
        expect2(body.param, '').toEqual({ ts:'1574150700000' });
        expect2(body.body, '').toEqual(null);
        expect2(body.context, 'identity').toEqual({ identity:{ sid:'', uid:'guest' } });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test packContext() via lambda protocol
    it('should pass packContext() via lambda protocol', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, instance } = $web();
        const event: any = loadJsonSync('data/sample.event.web.json');
        const context: NextContext = { accountId:'796730245826', requestId:'d8485d00-5624-4094-9a93-ce09c351ee5b', identity:{ sid:'A', uid:'B', gid:'C', roles:null } };
        event.headers['x-protocol-context'] = $U.json(context);
        const id = '!'; // call dump paramters.
        event.pathParameters['id'] = id;
        const response = await lambda.handle(event, null).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        const body = JSON.parse(response.body);
        expect2(body.id, '').toEqual('!');
        expect2(body.param, '').toEqual({ ts:'1574150700000' });
        expect2(body.body, '').toEqual(null);
        expect2(body.context, '').toEqual(context);
        /* eslint-enable prettier/prettier */
        done();
    });
});
