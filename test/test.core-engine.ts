/**
 * `test.core-engine.ts`
 * - test runnder for `core/engine.ts`
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-08 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { AsyncIterable, do_parrallel } from '../src/core/engine';
import { conv_date, conv_date2time, conv_date2ts } from '../src/core/engine';
import { doReportError } from '../src/';

//! build context.
const $context = (source = 'express', account = '085403634746') => {
    return {
        source: `${source || ''}`,
        invokedFunctionArn: `arn:aws:lambda:ap-northeast-2:${account || ''}:function:lemon-hello-api`,
    };
};

describe(`test the 'core/engine.ts'`, () => {
    test('check do_parallel()', (done: any) => {
        const list = [1, 2].map(i => {
            return { i };
        });
        do_parrallel(list, (node, i) => {
            if (!(i % 2)) throw new Error(`2x${i}`);
            return node.i;
        }).then(_ => {
            expect((_[0] as AsyncIterable)._error.message).toEqual('2x0');
            expect((_[0] as AsyncIterable)._index).toEqual(0);
            expect(_[1]).toEqual(2);
            done();
        });
    });

    //! conv_date()
    test('test conv_date()', () => {
        expect(conv_date2ts(1564711704963)).toEqual('2019-08-02 11:08:24');
        expect(conv_date2time('2019-08-02 11:08:24')).toEqual(1564711704000);
        expect(conv_date('2019-08-02 11:08:24').getTime()).toEqual(1564711704000);
    });

    //! doReportError()
    test('test doReportError() - ignore', (done: any) => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        doReportError(err, $context(), data).then((_: any) => {
            expect(_).toEqual('!ignore');
            done();
        });
    });
    test('test doReportError() - valid mid', (done: any) => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        doReportError(err, $context(''), data).then((_: string) => {
            expect(/^[a-z0-9\-]{10,}$/.test(_) || _.indexOf('Missing credentials') > 0 ? 'ok' : _).toEqual('ok');
            done();
        });
    });
    test('test doReportError() - account id', (done: any) => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        doReportError(err, $context('', ''), data).then((_: string) => {
            expect(_).toEqual('!err - .accountId is missing');
            done();
        });
    });
});
