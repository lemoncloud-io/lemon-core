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
import { $engine } from '../engine/';
import { expect2, _it } from '../common/test-helper';
import { NextDecoder, NextHandler } from '../cores/core-types';
import $web from '../cores/lambda-web-handler';
import { buildExpress } from './express';
import request from 'supertest';
import { loadJsonSync } from './shared';

export const instance = () => {
    $web.setHandler('test', decode_next_handler);
    const $express = buildExpress($engine, $web);
    const $pack = loadJsonSync('package.json');
    return { $express, $engine: { ...$engine }, $web, $pack };
};

//! router of `/test/:id/:cmd?`
const decode_next_handler: NextDecoder = (mode, id, cmd) => {
    let next: NextHandler = null;
    /* eslint-disable prettier/prettier */
    // console.info(`> decode: mode=${mode} /${id}/${cmd || ''}`)
    switch (mode) {
        case 'LIST':
            next = async () => ({ hello: 'LIST' });
            break;
        case 'GET':
        case 'POST':
            if (false) false;
            else if (id == '0') next = async id => { throw new Error(`404 NOT FOUND - id:${id}`); };
            else if (id != '!' && cmd == '400') next = async id => { throw new Error(`400 INVALID ERROR - id:${id}`); };
            else if (id != '!' && cmd == '500') next = async id => { throw new Error(`500 SERVER ERROR - id:${id}`); };
            else if (id == '!') next = async (id, param, body, context) => ({ id, param, body, context });  // dump parameter if '!'
            else if (cmd) next = async id => ({ id, cmd, hello: `${cmd} ${id}` });
            else next = async id => ({ id, hello: `${id}` });
    }
    /* eslint-enable prettier/prettier */
    return next;
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('express', () => {
    _it('should pass express route: GET /', async done => {
        const { $express, $engine, $web, $pack } = instance();
        /* eslint-disable prettier/prettier */
        const app = $express.app;
        const res = await request(app).get('/');
        expect2(res).toMatchObject({
            status: 200,
            text: `lemon-core/${$pack.version}`,
        });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! check id + cmd param
    it('should pass express route: GET /test/abc/hi', async done => {
        const { $express, $engine, $web, $pack } = instance();
        /* eslint-disable prettier/prettier */
        const app = $express.app;
        const res = await request(app).get('/test/abc/hi');
        expect2(res, 'status').toEqual({ status: 200 });
        expect2(res, 'body').toEqual({ body: { id:'abc', cmd:'hi', hello:'hi abc'} });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! check mode
    it('should pass express routes', async done => {
        const { $express, $engine, $web, $pack } = instance();
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
        done();
    });
});