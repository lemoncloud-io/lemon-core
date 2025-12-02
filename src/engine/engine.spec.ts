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
import {
    doReportCallback,
    doReportSlack,
    doReportMetric,
    getHelloArn,
    convDate,
    convDateToTime,
    convDateToTS,
} from './engine';
import { GETERR, expect2, _it } from '../common/test-helper';
import * as engine from './engine';

//* build context.
const $context = (source = 'express', account = '085403634746' /* profile: lemon */) => {
    return {
        source: `${source || ''}`,
        invokedFunctionArn: `arn:aws:lambda:ap-northeast-2:${account || ''}:function:lemon-hello-api`,
    };
};

jest.mock('../cores/aws/aws-sns-service', () => {
    const publish = jest.fn();
    const reportError = jest.fn();
    const MockAWSSNSService = jest.fn().mockImplementation(() => ({
        publish,
        reportError,
    }));
    return {
        AWSSNSService: MockAWSSNSService,
        __mockPublish: publish,
        __mockReportError: reportError,
    };
});
const snsModule = jest.requireMock('../cores/aws/aws-sns-service') as {
    __mockPublish: jest.Mock;
    __mockReportError: jest.Mock;
};

const buildContext = (source: string = 'lambda', account: string = '085403634746') =>
    ({
        source,
        invokedFunctionArn: `arn:aws:lambda:ap-northeast-2:${account}:function:lemon-hello-api`,
        accountId: account,
        apiId: 'api-id',
        domainPrefix: 'domain',
        resourcePath: '/resource',
        identity: { user: 'tester' },
        stage: 'dev',
        name: 'hello',
    } as any);

const buildSlackBody = (text: string) => ({
    text,
    attachments: [{ color: 'good', title: text }],
});

const restoreEnv = (name: string, prev?: string) => {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
};

afterEach(() => {
    jest.restoreAllMocks();
    snsModule.__mockPublish.mockReset();
    snsModule.__mockReportError.mockReset();
});

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
        expect2(await doReportError(err, $context('', ''), data).catch(GETERR)).toEqual('!err - .accountId is missing');
    });
});

describe(`test the 'core/engine.ts'`, () => {
    describe('do_parrallel()', () => {
        it('should handle mixed sync and async nodes', async () => {
            const list = [1, 2, 3, 4, 5, 6].map((n, i) => (i === 4 ? null : { n }));
            const res = await do_parrallel(list, (node, i) => {
                const n = (node && node.n) || 0;
                const msg = `N${n}:${i}`;
                if (i === 0) return msg;
                if (i === 1) {
                    const current = node ? { ...node } : {};
                    return Promise.resolve({ ...current, msg });
                }
                if (i === 2) return Promise.reject(msg);
                if (i === 3) throw new Error(msg);
                return msg;
            });
            expect2(res[0]).toEqual('N1:0');
            expect2((res[1] as any).msg).toEqual('N2:1');
            expect2(res[2] instanceof Error).toEqual(true);
            expect2((res[2] as Error).message).toEqual('N3:2');
            expect2(res[3] instanceof Error).toEqual(true);
            expect2((res[3] as Error).message).toEqual('N4:3');
            expect2(res[4]).toEqual('N0:4');
            expect2(res[5]).toEqual('N6:5');
        });

        it('should handle param object with ignoreError + reportError', async () => {
            const spy = jest.spyOn(engine, 'doReportError').mockResolvedValue('reported');
            const list = ['1', '2', '3', '4'];
            const res = await do_parrallel(
                {
                    list,
                    ignoreError: true,
                    reportError: true,
                    event: { type: 'test' },
                    context: buildContext(),
                    message: 'parallel-test',
                },
                (n, i) => {
                    if (i === 1) throw new Error(`err ${n}`);
                    return `N${n}:${i}`;
                },
                2,
            );
            expect2(spy.mock.calls.length).toEqual(1);
            expect2(res[0]).toEqual('N1:0');
            expect2(res[1]).toEqual('2');
        });

        it('should handle promise list with 1000 items', async () => {
            const list = Array.from({ length: 1000 }, (_, idx) => Promise.resolve(idx + 1));
            const res = await do_parrallel(list, async (valPromise, i) => {
                const value = await valPromise;
                if (value % 2 === 0) throw new Error(`err ${value}:${i}`);
                return `N${value}:${i}`;
            });
            expect2(res[0]).toEqual('N1:0');
            expect2((res[1] as Error).message).toEqual('err 2:1');
            expect2((res[999] as Error).message).toEqual('err 1000:999');
        });

        it('should resolve immediately for empty list', async () => {
            const res = await do_parrallel([], () => 'noop');
            expect2(res).toEqual([]);
        });

        it('should convert thrown instanceof errors to Error instances', async () => {
            const OriginalPromise: any = Promise;
            const sentinelError = new Error('instance-error');
            const ThrowingPromise = class extends OriginalPromise {};
            Object.defineProperty(ThrowingPromise, Symbol.hasInstance, {
                value(value: any) {
                    if (value && value.__throw) throw sentinelError;
                    return OriginalPromise[Symbol.hasInstance].call(this, value);
                },
            });
            (global as any).Promise = ThrowingPromise;
            const node: any = { __throw: true };
            const res = await do_parrallel([node], value => value);
            expect2(res[0] instanceof Error).toEqual(true);
            expect2((res[0] as Error).message).toEqual('instance-error');
            (global as any).Promise = OriginalPromise;
        });
    });

    describe('getHelloArn()', () => {
        it('should build ARN from context', () => {
            const context = buildContext();
            expect2(() => getHelloArn(context)).toEqual('arn:aws:sns:ap-northeast-2:085403634746:lemon-hello-sns');
        });

        it('should return env override ARN when configured', () => {
            const prev = process.env.REPORT_ERROR_ARN;
            process.env.REPORT_ERROR_ARN = 'arn:aws:sns:us-west-2:123456789012:test-sns';
            expect2(() => getHelloArn()).toEqual('arn:aws:sns:us-west-2:123456789012:test-sns');
            restoreEnv('REPORT_ERROR_ARN', prev);
        });

        it('should throw when context is missing', () => {
            const prev = process.env.REPORT_ERROR_ARN;
            delete process.env.REPORT_ERROR_ARN;
            expect2(() => getHelloArn()).toEqual('@context (RequestContext) is required!');
            restoreEnv('REPORT_ERROR_ARN', prev);
        });
    });

    describe('doReportError()', () => {
        it('should ignore express context', async () => {
            const result = await doReportError(new Error('ignore'), buildContext('express'));
            expect2(result).toEqual('!ignore');
        });

        it('should publish error via SNS', async () => {
            snsModule.__mockReportError.mockResolvedValue('mocked-message-id-12345');
            const context = buildContext('lambda');
            const result = await doReportError(new Error('Test error'), context, {}, 'test-data');
            expect2(result).toEqual('mocked-message-id-12345');
        });

        it('should return empty string when SNS publish fails', async () => {
            snsModule.__mockReportError.mockRejectedValue(new Error('sns failure'));
            const context = buildContext('lambda');
            const result = await doReportError(new Error('Test error'), context);
            expect2(result).toEqual('');
        });

        it('should surface account id error', async () => {
            const context = buildContext('lambda', '');
            const result = await doReportError(new Error('missing account'), context);
            expect2(result).toEqual('!err - .accountId is missing');
        });
    });

    describe('doReportCallback()', () => {
        it('should publish callback payload', async () => {
            snsModule.__mockPublish.mockResolvedValue('callback-message-id');
            const context = buildContext('lambda');
            const callbackData = { id: 'test-id', status: 'success' };
            const result = await doReportCallback(callbackData, undefined, context);
            expect2(result).toEqual('callback-message-id');
            expect2(snsModule.__mockPublish.mock.calls[0][1]).toEqual('callback');
        });

        it('should use custom service when provided', async () => {
            snsModule.__mockPublish.mockResolvedValue('callback-id-2');
            const context = buildContext('lambda');
            const result = await doReportCallback({ id: 'test', result: 'ok' }, 'custom-service', context);
            expect2(result).toEqual('callback-id-2');
            expect2((snsModule.__mockPublish.mock.calls[0][2] as any).service).toEqual('custom-service');
        });

        it('should return empty string when publish fails', async () => {
            snsModule.__mockPublish.mockRejectedValue(new Error('SNS publish failed'));
            const context = buildContext('express');
            const result = await doReportCallback({ id: 'fallback' }, undefined, context);
            expect2(result).toEqual('');
        });

        it('should fallback to doReportError when ARN cannot be resolved', async () => {
            const spy = jest.spyOn(engine, 'getHelloArn').mockImplementation(() => {
                throw new Error('mocked-arn-error');
            });
            const result = await doReportCallback({ id: 'fail-arn' }, undefined, buildContext('lambda'));
            expect2(result).toEqual('!err - mocked-arn-error');
            spy.mockRestore();
        });
    });

    describe('doReportSlack()', () => {
        it('should publish slack payload', async () => {
            snsModule.__mockPublish.mockResolvedValue('slack-message-id');
            const context = buildContext('lambda');
            const result = await doReportSlack('#general', buildSlackBody('Test slack message'), context);
            expect2(result).toEqual('slack-message-id');
        });

        it('should return empty string when SNS publish fails', async () => {
            snsModule.__mockPublish.mockRejectedValue(new Error('SNS publish failed'));
            const context = buildContext('lambda');
            const result = await doReportSlack('#test', buildSlackBody('Test'), context);
            expect2(result).toEqual('');
        });

        it('should return error string when ARN cannot be resolved', async () => {
            const context = buildContext('lambda', '');
            const result = await doReportSlack('#fail', buildSlackBody('fail'), context);
            expect2(result).toEqual('!err - .accountId is missing');
        });
    });

    describe('doReportMetric()', () => {
        it('should publish metric payload to lemon-metrics-sns', async () => {
            snsModule.__mockPublish.mockResolvedValue('metric-message-id');
            const context = buildContext('lambda');
            const result = await doReportMetric('testNs', 'testId123', { value: 100, unit: 'count' }, context);
            expect2(result).toEqual('metric-message-id');
            expect2(snsModule.__mockPublish.mock.calls[0][1]).toEqual('metric');
            expect2((snsModule.__mockPublish.mock.calls[0][0] as string).endsWith(':lemon-metrics-sns')).toEqual(true);
        });

        it('should validate namespace format', async () => {
            const context = buildContext('lambda');
            expect2(await doReportMetric('123invalid', 'testId', { value: 50 }, context).catch(GETERR)).toEqual(
                'Invalid text-format @ns:123invalid',
            );
        });

        it('should validate id format', async () => {
            const context = buildContext('lambda');
            expect2(await doReportMetric('validNs', '-invalid', { value: 50 }, context).catch(GETERR)).toEqual(
                'Invalid text-format @id:-invalid',
            );
        });

        it('should return empty string when publish fails', async () => {
            snsModule.__mockPublish.mockRejectedValue(new Error('Metric publish failed'));
            const context = buildContext('lambda');
            const result = await doReportMetric('testNs', 'testId', { value: 200 }, context);
            expect2(result).toEqual('');
        });

        it('should return error string when ARN cannot be resolved for metrics', async () => {
            const context = buildContext('lambda', '');
            const result = await doReportMetric('testNs', 'testId', { value: 10 }, context);
            expect2(result).toEqual('!err - .accountId is missing');
        });
    });

    describe('convDate helpers', () => {
        it('should convert date/time correctly', () => {
            expect2(convDateToTS(1564711704963)).toEqual('2019-08-02 11:08:24');
            expect2(convDateToTime('2019-08-02 11:08:24')).toEqual(1564711704000);
            expect2(convDate('2019-08-02 11:08:24').getTime()).toEqual(1564711704000);
            expect2(convDateToTime(0)).toEqual(0);
        });
    });
});
