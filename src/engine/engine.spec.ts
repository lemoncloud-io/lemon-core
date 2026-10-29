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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi, test } from 'vitest';
import { do_parrallel, doReportError, doReportSlack, getHelloArn } from './engine';
import { convDate, convDateToTime, convDateToTS } from './engine';
import { $U } from './index';
import { GETERR, expect2, _it } from '../common/test-helper';

//* build context.
const $context = (source = 'express', account = '085403634746' /* profile: lemon */) => {
    return {
        source: `${source || ''}`,
        invokedFunctionArn: `arn:aws:lambda:ap-northeast-2:${account || ''}:function:lemon-hello-api`,
    };
};

//! main test body.
describe(`test the 'core/engine.ts'`, () => {
    test('check do_parallel()', () => {
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
        });
    });

    test('check do_parallel(async)', () => {
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
        });
    });

    test('check do_parallel() w/ string', () => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel(list, (n, i) => {
            if (i == 2) throw new Error(`err ${n}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect((_[2] as any).message).toEqual('err 3');
        });
    });

    test('check do_parallel() w/ string x 1000', () => {
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
        });
    });

    test('check do_parallel() w/ param', () => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel({ list }, (n, i) => {
            if (i == 2) throw new Error(`err ${n}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect((_[2] as any).message).toEqual('err 3');
        });
    });

    test('check do_parallel() w/ param + ignoreError', () => {
        const list = [1, 2, 3, 4, 5, 6].map(n => {
            return `${n}`;
        });
        do_parrallel({ list, ignoreError: true }, (n, i) => {
            if (i == 2) throw new Error(`err ${n}`);
            return `N${n}:${i}`;
        }).then(_ => {
            expect(_[0] as any).toEqual('N1:0');
            expect(_[2] as any).toEqual('3'); // error ignored. and should get origin 3.
        });
    });

    test('check do_parallel() w/ param + reportError', () => {
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
        });
    });

    //* conv_date()
    test('test conv_date()', () => {
        expect(convDateToTS(1564711704963)).toEqual('2019-08-02 11:08:24');
        expect(convDateToTime('2019-08-02 11:08:24')).toEqual(1564711704000);
        expect(convDate('2019-08-02 11:08:24').getTime()).toEqual(1564711704000);
        //* v5 B5: `convDate(str)` and `$U.dt(str)` agree (E-48), and a `Date` argument is never mutated.
        const T = convDateToTime('2019-08-02 11:08:24');
        expect($U.dt('2019-08-02 11:08:24').getTime()).toEqual(T);
        const D = new Date(T + 963);
        expect(convDateToTS(D)).toEqual('2019-08-02 11:08:24');
        expect(D.getTime()).toEqual(T + 963);
        expect(convDate(D)).not.toBe(D);
    });

    //* v5: `convDate*` follow env `DEFAULT_TIME_ZONE` like `$U.dt()`/`$U.ts()` (owner 2026-10-28).
    test('test conv_date() with env DEFAULT_TIME_ZONE', () => {
        const saved = process.env.DEFAULT_TIME_ZONE;
        try {
            process.env.DEFAULT_TIME_ZONE = '0';
            expect(convDateToTS(1564711704963)).toEqual('2019-08-02 02:08:24');
            expect(convDate('2019-08-02 02:08:24').getTime()).toEqual(1564711704000);
            expect(convDate('2019-08-02').getTime()).toEqual($U.dt('2019-08-02').getTime());
        } finally {
            //* restore (delete if it was unset).
            if (saved === undefined) delete process.env.DEFAULT_TIME_ZONE;
            else process.env.DEFAULT_TIME_ZONE = saved;
        }
        expect(convDateToTS(1564711704963)).toEqual('2019-08-02 11:08:24');
    });

    //* doReportError()
    test('test doReportError() - ignore', async () => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        expect2(await doReportError(err, $context(), data).catch(GETERR)).toEqual('!ignore');
    });

    _it('test doReportError() - valid mid', async () => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        expect2((await doReportError(err, $context(''), data)).length).toEqual(
            '0eae767f-6457-5020-9d85-2025630fcdad'.length,
        );
    });

    test('test doReportError() - account id', async () => {
        const data = 'test-error-data';
        const err = new Error('via doReportError() in `lemon-core`');
        expect2(await doReportError(err, $context('', ''), data).catch(GETERR)).toEqual(
            '!err - .accountId[] is missing - getHelloArn(RPTE:)',
        );
    });

    //* v5 B10-6: account id candidates — `invokedFunctionArn` first, then context; 12 digits only.
    describe('getHelloArn() - account id (B10-6)', () => {
        const ACCOUNT = '123456789012'; // dummy account id.
        const LAMBDA_ARN = `arn:aws:lambda:us-west-2:${ACCOUNT}:function:x`;
        let savedArn: string | undefined;
        //* make sure the env override is not in the way.
        const clearEnv = () => {
            savedArn = process.env.REPORT_ERROR_ARN;
            delete process.env.REPORT_ERROR_ARN;
        };
        //* restore (delete if it was unset).
        const restoreEnv = () => {
            if (savedArn === undefined) delete process.env.REPORT_ERROR_ARN;
            else process.env.REPORT_ERROR_ARN = savedArn;
        };

        it('rejects a non-numeric accountId without echoing it', () => {
            clearEnv();
            try {
                let e = '';
                try {
                    getHelloArn({ accountId: 'dujung' } as any, 'T:');
                } catch (err) {
                    e = GETERR(err);
                }
                expect(e).toEqual('.accountId[] is missing - getHelloArn(T:)');
                expect(`${e}`.includes('dujung')).toEqual(false);
            } finally {
                restoreEnv();
            }
        });

        it('prefers the account (and region) of invokedFunctionArn over context.accountId', () => {
            clearEnv();
            try {
                const arn = getHelloArn({ invokedFunctionArn: LAMBDA_ARN, accountId: 'dujung' } as any);
                expect(arn).toEqual(`arn:aws:sns:us-west-2:${ACCOUNT}:lemon-hello-sns`);
            } finally {
                restoreEnv();
            }
        });

        it('uses a 12-digit context.accountId when there is no invokedFunctionArn', () => {
            clearEnv();
            try {
                const arn = getHelloArn({ accountId: ACCOUNT } as any);
                expect(arn).toEqual(`arn:aws:sns:ap-northeast-2:${ACCOUNT}:lemon-hello-sns`);
            } finally {
                restoreEnv();
            }
        });

        it('rejects an accountId that is not 12 digits', () => {
            clearEnv();
            try {
                expect(() => getHelloArn({ accountId: '12345' } as any, 'T:')).toThrow(
                    '.accountId[] is missing - getHelloArn(T:)',
                );
            } finally {
                restoreEnv();
            }
        });
    });

    //* v5 B10-6: local mode (`LOCAL_MODE=1` outside Lambda) never reports — no SNS call.
    test('doReportError()/doReportSlack() - ignore in local mode (B10-6)', async () => {
        const saved = { local: process.env.LOCAL_MODE, fn: process.env.AWS_LAMBDA_FUNCTION_NAME };
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        try {
            //* a context that would be reported outside local mode.
            const ctx = { source: 'api://123456789012@lemon-core-dev#5.0.4', accountId: '123456789012' };
            const err = new Error('via doReportError() in `lemon-core`');
            expect(await doReportError(err, ctx, null, 'test-error-data')).toEqual('!ignore');
            expect(await doReportSlack('public', { text: 'hello' } as any, ctx)).toEqual('!ignore');
        } finally {
            //* restore (delete if it was unset).
            if (saved.local === undefined) delete process.env.LOCAL_MODE;
            else process.env.LOCAL_MODE = saved.local;
            if (saved.fn !== undefined) process.env.AWS_LAMBDA_FUNCTION_NAME = saved.fn;
        }
    });

    //* v5 B10-2: a circular error object must not break the report path.
    describe('circular structure (B10-2)', () => {
        // http-response like object: `r.req.res === r`.
        const circular = (): any => {
            const r: any = { statusMessage: 'Bad' };
            r.req = { res: r };
            return r;
        };

        it('doReportError() reaches the report step with a circular non-Error', async () => {
            // before B10-2, `$message(e)` threw outside of `try` ('Converting circular structure to JSON').
            const e: any = { code: 'ECONNRESET' }; // no `message`·`statusMessage`, so the object itself is printed.
            e.req = { res: e };
            const res = await doReportError(e, $context('', ''), null, circular()).catch(GETERR);
            expect2(res).toEqual('!err - .accountId[] is missing - getHelloArn(RPTE:)');
        });

        it('do_parrallel() wraps a circular rejection into Error', async () => {
            const res = await do_parrallel([1, 2], async (n: number) => {
                if (n == 2) throw circular();
                return `N${n}`;
            });
            expect2(res[0] as any).toEqual('N1');
            expect(res[1]).toBeInstanceOf(Error);
            expect2((res[1] as Error).message).toEqual('{"statusMessage":"Bad","req":{"res":"[Circular]"}}');
        });
    });
});
