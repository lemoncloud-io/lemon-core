/**
 * `test.builder-SQS.ts`
 *
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-09 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//! load $engine, and prepare dummy handler
import { $engine, $WEB } from '../src/';
const loop = $WEB('LOOP', (mode, id, cmd) => {
    return async (id, param, body, $ctx) => {
        return { mode, id, cmd, param, body };
    };
});
Object.assign($engine, { loop });

//! get sns instance...
import { $SQS } from '../src/';
const SQS = $SQS('loop');
const TYPE = 1 ? '' : 'loop'; //NOTE - '' should work due to default-type.

//! prepare dummy event.
const event = {
    Records: [
        {
            messageAttributes: {
                callback: {
                    stringValue: 1 ? '' : 'lemon://messages/chat/public/slack',
                    stringListValues: null as any,
                    binaryListValues: null as any,
                    dataType: 'String',
                },
            },
            body: `{"type":"${TYPE}","id":""}`,
        },
        {
            messageAttributes: {
                callback: {
                    stringValue: 1 ? '' : 'lemon://messages/chat/public/slack',
                    stringListValues: null as any,
                    binaryListValues: null as any,
                    dataType: 'String',
                },
            },
            body: `{"type":"${TYPE}","id":"lemon"}`,
        },
    ],
};
const context = {
    invokeid: '3152065e-c734-4c9c-a081-54a64860ba7c',
    invokedFunctionArn: 'arn:aws:lambda:ap-northeast-2:085403634746:function:lemon-hello-api',
};

//! runs.
describe(`test the 'SQS.ts'`, () => {
    test('check SQS() handler', (done: any) => {
        SQS(event, context, (err, res) => {
            // console.log('! err =', err);
            // console.log('! res =', res);
            expect(err).toEqual(null);
            expect(res[0].id).toEqual('');
            expect(res[1].id).toEqual('lemon');
            done();
        });
        done();
    });
});
