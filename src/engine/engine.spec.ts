/**
 * `core/engine.spec.ts`
 * - test runnder for `core/engine.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-08-08 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { do_parrallel, doReportError } from './engine';
import { convDate, convDateToTime, convDateToTS } from './engine';
import { GETERR, expect2, _it } from '../common/test-helper';

//! build context.
const $context = (source = 'express', account = '085403634746' /* profile: lemon */) => {
    return {
        source: `${source || ''}`,
        invokedFunctionArn: `arn:aws:lambda:ap-northeast-2:${account || ''}:function:lemon-hello-api`,
    };
};

//! main test body.
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

    test('check do_parallel(async)', (done: any) => {
        const list = [1, 2, 3, 4, 5, 6].map((n, i) => {
            return i == 4 ? null : { n };
        });
        do_parrallel(list, async (node, i) => {
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

    test('check do_parallel() w/ string x 1000', (done: any) => {
        const list: Promise<number>[] = [];
        for (let i = 1; i <= 1000; i++) list.push(Promise.resolve(i));
        do_parrallel(list, async (_n, i) => {
            const n: number = await _n;
            if (n % 2 == 0) throw new Error(`err ${n}:${i}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect((_[1] as any).message).toEqual('err 2:1');
            expect((_[999] as any).message).toEqual('err 1000:999');
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
        expect(convDateToTS(1564711704963)).toEqual('2019-08-02 11:08:24');
        expect(convDateToTime('2019-08-02 11:08:24')).toEqual(1564711704000);
        expect(convDate('2019-08-02 11:08:24').getTime()).toEqual(1564711704000);
    });

    //! doReportError()
    test('test doReportError() - ignore', async (done: any) => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        expect2(await doReportError(err, $context(), data).catch(GETERR)).toEqual('!ignore');
        done();
    });

    _it('test doReportError() - valid mid', async (done: any) => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        expect2((await doReportError(err, $context(''), data)).length).toEqual(
            '0eae767f-6457-5020-9d85-2025630fcdad'.length,
        );
        done();
    });

    test('test doReportError() - account id', async (done: any) => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        expect2(await doReportError(err, $context('', ''), data).catch(GETERR)).toEqual('!err - .accountId is missing');
        done();
    });
});
