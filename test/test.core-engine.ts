/**
 * `test.core-engine.ts`
 * - test runnder for `core/engine.ts`
 *
 * @author Steve <steve@lemoncloud.io>
 * @date   2019-08-08 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { do_parrallel } from '../src/core/engine';
import { convDate, conv_date2time, conv_date2ts } from '../src/core/engine';
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
        const list = [1, 2, 3, 4, 5, 6].map((n, i) => {
            return i == 4 ? null : { n };
        });
        do_parrallel(list, (node, i) => {
            const n = (node && node.n) || 0;
            const msg = `N${n}:${i}`;
            if (i === 0) return msg;
            else if (i === 1) return Promise.resolve(Object.assign(node, { msg }));
            else if (i === 2) return Promise.reject(msg);
            else if (i === 3) throw new Error(msg);
            return msg;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect((_[1] as any).msg).toEqual('N2:1');
            expect((_[2] as any) instanceof Error).toEqual(true);
            expect((_[2] as any).message).toEqual('N3:2');
            expect((_[3] as any) instanceof Error).toEqual(true);
            expect((_[3] as any).message).toEqual('N4:3');
            expect((_[4] as any) instanceof Error).toEqual(false);
            expect(_[4] as any).toEqual('N0:4');
            expect(_[5] as any).toEqual('N6:5');
            done();
        });
    });

    test('check do_parallel() w/ string', (done: any) => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel(list, (n, i) => {
            if (i == 2) throw new Error(`err ${n}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect((_[2] as any).message).toEqual('err 3');
            done();
        });
    });

    test('check do_parallel() w/ param', (done: any) => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel({ list }, (n, i) => {
            if (i == 2) throw new Error(`err ${n}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect((_[2] as any).message).toEqual('err 3');
            done();
        });
    });

    test('check do_parallel() w/ param + ignoreError', (done: any) => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel({ list, ignoreError: true }, (n, i) => {
            if (i == 2) throw new Error(`err ${n}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect(_[2] as any).toEqual('3'); // error ignored. and should get origin 3.
            done();
        });
    });

    test('check do_parallel() w/ param + reportError', (done: any) => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel(
            { list, ignoreError: true, reportError: false, message: 'test by 6' },
            (n, i) => {
                if (i == 2) throw new Error(`err ${n}`);
                return `N${n}:${i}`;
            },
            1,
        ).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect(_[2] as any).toEqual('3'); // error ignored. and should get origin 3.
            done();
        });
    });

    //! conv_date()
    test('test conv_date()', () => {
        expect(conv_date2ts(1564711704963)).toEqual('2019-08-02 11:08:24');
        expect(conv_date2time('2019-08-02 11:08:24')).toEqual(1564711704000);
        expect(convDate('2019-08-02 11:08:24').getTime()).toEqual(1564711704000);
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
            expect(
                /^[a-z0-9\-]{10,}$/.test(_) || _.indexOf('Missing credentials') > 0 || _.startsWith('ERROR - ')
                    ? 'ok'
                    : _,
            ).toEqual('ok');
            done();
        });
    });
});
