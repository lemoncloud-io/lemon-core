/**
 * `tools/express.spec.ts`
 * - test runnder for `tools/express.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-26 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $engine, $U } from '../engine/';
import { expect2 } from '../common/test-helper';
import { NextDecoder, NextHandler } from '../cores/core-types';
import { buildExpress } from './express';
import { loadJsonSync } from './shared';
import request from 'supertest';

//! load all cores.
import $cores from '../cores/';

export const instance = async () => {
    await $engine.initialize();
    const $web = $cores.lambda.web;
    $web.setHandler('test', decode_next_handler);
    const genRequestId = () => 'express-test-request-id';
    const $express = buildExpress($engine, $web, { genRequestId });
    const $pack = loadJsonSync('package.json');
    return { $express, $engine: { ...$engine }, $web, $pack };
};

//! router of `/test/:id/:cmd?`
const decode_next_handler: NextDecoder = (mode, id, cmd) => {
    let next: NextHandler = null;
    /* eslint-disable prettier/prettier */
    // _log(`> decode: mode=${mode} /${id}/${cmd || ''}`)
    switch (mode) {
        case 'LIST':
            next = async () => ({ hello: 'LIST' });
            break;
        case 'GET':
            //TODO - serve binary like `/favicon.ico`
        case 'POST':
            if (false) false;
            else if (id == '0') next = async id => { throw new Error(`404 NOT FOUND - id:${id}`); };
            else if (id != '!' && cmd == '400') next = async id => { throw new Error(`400 INVALID ERROR - id:${id}`); };
            else if (id != '!' && cmd == '500') next = async id => { throw new Error(`500 SERVER ERROR - id:${id}`); };
            else if (id != '!' && cmd == '200' ) next = async (id, param, body, context) => ({ id, param, body, context });  // dump parameter if '!'
            else if (cmd) next = async id => ({ id, cmd, hello: `${cmd} ${id}` });
            else next = async id => ({ id, hello: `${id}` });
            break;
    }
    /* eslint-enable prettier/prettier */
    return next;
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('express', () => {
    it('should pass express route: GET /', async done => {
        const { $express, $engine, $web, $pack } = await instance();
        /* eslint-disable prettier/prettier */
        const app = $express.app;
        const res = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`lemon-core/${$pack.version}`);
        /* eslint-enable prettier/prettier */
        done();
    });

    //! check id + cmd param
    it('should pass express route: GET /test/abc/hi', async done => {
        const { $express, $engine, $web, $pack } = await instance();
        /* eslint-disable prettier/prettier */
        const app = $express.app;
        const res = await request(app).get('/test/abc/hi');
        expect2(res, 'status,body').toEqual({ status: 200, body: { id:'abc', cmd:'hi', hello:'hi abc'} });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! check mode
    it('should pass express routes', async done => {
        const { $express, $engine, $web, $pack } = await instance();
        const ACCOUNT_ID = $U.env('USER', 'travis'); // it must be 'travis' in `travis-ci.org`
        /* eslint-disable prettier/prettier */
        const app = $express.app;
        expect2(await request(app).get('/test/abc'), 'status').toEqual({ status: 200 });
        expect2(await request(app).get('/test1/abc'), 'status,body').toEqual({ status:404, body:{} });
        expect2(await request(app).get('/test/0'), 'status').toEqual({ status: 404 });
        expect2(await request(app).get('/test/0'), 'status,body,text').toEqual({ status:404, body:{}, text:'404 NOT FOUND - id:0' });
        expect2(await request(app).get('/test/a/400'), 'status,body').toEqual({ status:400, body:{} });
        expect2(await request(app).get('/test/a/500'), 'status,body').toEqual({ status:500, body:{} });
        expect2(await request(app).post('/test/a/500'), 'status,body').toEqual({ status:500, body:{} });
        expect2(await request(app).delete('/test/a'), 'status,body,text').toEqual({ status:404, body:{}, text:'404 NOT FOUND - DELETE /test/a' });
        /* eslint-enable prettier/prettier */
        //! echo request context.....
        expect2(
            await request(app)
                .post('/test/a/200')
                .set('Cookie', 'A=1; B=2')
                .send({ b: 3 }),
            'status,body',
        ).toEqual({
            status: 200,
            body: {
                id: 'a',
                param: {},
                body: { b: 3 },
                context: {
                    accountId: ACCOUNT_ID,
                    clientIp: '::ffff:127.0.0.1',
                    domain: ACCOUNT_ID == 'travis' ? '127.0.0.1' : '127.0.0.1',
                    identity: {},
                    requestId: 'express-test-request-id',
                    source: `api://${ACCOUNT_ID}@lemon-core-dev#${$pack.version}`,
                    userAgent: 'node-superagent/3.8.3',
                    cookie: { A: '1', B: '2' },
                },
            },
        });
        done();
    });
});
