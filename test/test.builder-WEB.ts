/**
 * `test.builder-WEB.ts`
 *
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-09 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//! load $engine via `index.ts`
import { $WEB } from '../src/';
import { $U, _log, _inf, _err } from '../src/'; //NOTE! - load after './index'

//! build dummy web-handler.
const WEB = $WEB('WEB', (mode, id, cmd) => {
    if (!mode && !id) return () => Promise.resolve('');
    else if (mode == 'LIST') return (id, param, body) => Promise.resolve({ mode, list: [] });
    else if (mode == 'GET' && id == '') return (id, param, body) => Promise.resolve({ mode, id });
    else if (mode == 'GET' && id == '0') return (id, param, body) => Promise.resolve({ mode, id });
    else if (mode == 'PUT' || mode == 'POST') return (id, param, body) => Promise.resolve({ mode, id, body });
    return null;
});

//! build event.
const $event = (method: string, id?: string, cmd?: string, param?: any, body?: any) => {
    return {
        httpMethod: `${method}`.toUpperCase(),
        path: cmd ? `/${id}/${cmd}` : id !== undefined ? `/${id}` : `/`,
        headers: {},
        pathParameters: { id, cmd },
        queryStringParameters: param,
        body: body,
        isBase64Encoded: false,
        stageVariables: null as any,
        requestContext: {},
        resource: '',
    };
};
const $context = () => {
    return {
        invokeid: '3152065e-c734-4c9c-a081-54a64860ba7c',
        invokedFunctionArn: 'arn:aws:lambda:ap-northeast-2:085403634746:function:lemon-hello-api',
    };
};

/** ********************************************************************************************************************
 *  Test Runners
 ** ********************************************************************************************************************/
describe(`test the $WEB builder`, () => {
    test('check web-hanlder: GET /', (done: any) => {
        WEB($event('get', ''), $context(), (err, res) => {
            expect(err).toEqual(null);
            expect(res.statusCode).toEqual(200);
            expect(res.body).toEqual($U.json({ mode: 'LIST', list: [] }));
            done();
        });
    });
    test('check web-hanlder: GET /0', (done: any) => {
        WEB($event('get', '0'), $context(), (err, res) => {
            expect(err).toEqual(null);
            expect(res.statusCode).toEqual(200);
            expect(res.body).toEqual($U.json({ mode: 'GET', id: '0' }));
            done();
        });
    });
});
