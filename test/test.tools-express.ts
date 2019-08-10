/**
 * `test.hello-api.ts`
 * - test runnder of hello-api
 *
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-01 initial version with `supertest`.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import request from 'supertest';
import { $WEB } from '../src/';
import { buildExpress } from '../src/tools/express';
import { $engine } from '../src/core/engine';

//! build dummy web-handler.
const hello = $WEB('WEB', (mode, id, cmd) => {
    const $hello = (msg: string) => {
        return async (id: any, param: any, body: any, ctx: any) => {
            return { msg, mode, hello: { id, cmd, param, body, ctx } };
        };
    };
    if (!id) return $hello('null');
    return $hello('echo');
});
Object.assign($engine, { hello });
const { app, createServer } = buildExpress($engine);

// Test Hello
describe('Test Hello API', () => {
    //! test /
    test('It should response the GET method (w/o done)', () => {
        return request(app)
            .get('/')
            .expect(200);
    });

    //! test GET.
    test('It should response the GET method', done => {
        request(app)
            .get('/hello')
            .then((res: any) => {
                expect(res.statusCode).toBe(200);
                expect(res.body.msg).toBe('null');
                expect(res.body.mode).toBe('LIST');
                done();
            });
    });

    //! test POST.
    test('It should response the POST method', done => {
        request(app)
            .post('/hello/1234/4444')
            .then((res: any) => {
                expect(res.statusCode).toBe(200);
                expect(res.body.mode).toBe('POST');
                expect(res.body.hello.id).toBe('1234');
                expect(res.body.hello.cmd).toBe('4444');
                expect(res.body.hello.ctx.source).toBe('express');
                done();
            });
    });

    //! test PUT.
    test('It should response the PUT method', done => {
        request(app)
            .put('/hello/1234')
            .send({ data: '5555' })
            .then((res: any) => {
                expect(res.statusCode).toBe(200);
                expect(res.body.mode).toBe('PUT');
                expect(res.body.hello.id).toBe('1234');
                expect(res.body.hello.cmd).toBe('');
                expect(res.body.hello.body).toEqual({ data: '5555' });
                expect(res.body.hello.ctx.source).toBe('express');
                done();
            });
    });

    //! test DELETE.
    test('It should response the DELETE method', done => {
        request(app)
            .delete('/hello/1234')
            .then((res: any) => {
                expect(res.statusCode).toBe(200);
                expect(res.body.mode).toBe('DELETE');
                done();
            });
    });

    //! test DELETE.
    test('It should run createServer()', done => {
        const server = createServer();
        request(server)
            .get('/hello/1234')
            .then((res: any) => {
                expect(res.statusCode).toBe(200);
                expect(res.body.mode).toBe('GET');
                done();
            });
    });
});
