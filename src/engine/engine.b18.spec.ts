/**
 * `engine.b18.spec.ts`
 * - v5 B18-c: report helpers of `engine.ts` with a fake SNS service (no AWS call).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//* v5 B18: one fake SNS for every report; `mode` makes it resolve or reject.
const $sns = vi.hoisted(() => ({ mode: 'ok', calls: [] as any[] }));
vi.mock('../cores/aws/aws-sns-service', async importOriginal => {
    const org: any = await importOriginal();
    //* same shape as the real service (arrow members), no client.
    class FakeSNS {
        public constructor(public readonly arn?: string) {}
        public publish = async (target: string, subject: string, payload: any) => {
            $sns.calls.push({ kind: 'publish', target, subject, payload });
            if ($sns.mode === 'fail') throw new Error('B18 SNS');
            return 'mid-publish';
        };
        public reportError = async (e: Error, data: any, target?: string) => {
            $sns.calls.push({ kind: 'reportError', target, data });
            if ($sns.mode === 'fail') throw new Error('B18 SNS');
            return 'mid-error';
        };
    }
    return { ...org, AWSSNSService: FakeSNS };
});

import { doReportError, doReportSlack, doReportMetric, doReportCallback, getHelloArn, convDateToTime } from './engine';

//* placeholder topic (fake account, never called).
const ARN = 'arn:aws:sns:ap-northeast-2:000000000000:lemon-hello-sns';

describe('engine B18', () => {
    const KEYS = ['REPORT_ERROR_ARN', 'LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME'];
    const $env: Record<string, string> = KEYS.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
    beforeEach(() => {
        delete process.env.LOCAL_MODE;
        process.env.REPORT_ERROR_ARN = ARN;
        $sns.mode = 'ok';
        $sns.calls = [];
    });
    afterEach(() => {
        KEYS.forEach(k => ($env[k] === undefined ? delete process.env[k] : (process.env[k] = $env[k])));
    });

    it('B18 getHelloArn() from env', () => {
        expect(getHelloArn()).toEqual(ARN);
    });

    it('B18 doReportError() sns result and failure', async () => {
        expect(await doReportError(new Error('B18'), { stage: 'b18' }, null, { a: 1 })).toEqual('mid-error');
        expect($sns.calls[0].target).toEqual(ARN);
        $sns.mode = 'fail';
        expect(await doReportError(new Error('B18'), {})).toEqual('');
    });

    it('B18 doReportSlack() sns result, failure and bad context', async () => {
        expect(await doReportSlack('public', { channel: 'b18' } as any, { stage: 's' })).toEqual('mid-publish');
        expect($sns.calls[0]).toMatchObject({ subject: 'slack', target: ARN });
        expect($sns.calls[0].payload.context.stage).toEqual('s');
        $sns.mode = 'fail';
        expect(await doReportSlack('public', {} as any, {})).toEqual('');
        //* no arn, no context -> the error string.
        delete process.env.REPORT_ERROR_ARN;
        expect(await doReportSlack('public', {} as any)).toEqual(
            '!err - @context (RequestContext) is required - getHelloArn(RPTS:)',
        );
    });

    it('B18 doReportMetric() formats, target and failure', async () => {
        await expect(doReportMetric('1x', 'a', {} as any)).rejects.toThrow('Invalid text-format @ns:1x');
        await expect(doReportMetric('ns', '!', {} as any)).rejects.toThrow('Invalid text-format @id:!');
        expect(await doReportMetric('b18ns', 'id-1', { v: 1 } as any, { stage: 's' })).toEqual('mid-publish');
        //* the topic name is replaced by the metrics topic.
        expect($sns.calls[0].target).toEqual('arn:aws:sns:ap-northeast-2:000000000000:lemon-metrics-sns');
        expect($sns.calls[0].payload).toMatchObject({
            type: 'metrics',
            cmd: 'report',
            param: { ns: 'b18ns', id: 'id-1' },
        });
        $sns.mode = 'fail';
        expect(await doReportMetric('b18ns', 'id-1', {} as any)).toEqual('');
        delete process.env.REPORT_ERROR_ARN;
        expect(await doReportMetric('b18ns', 'id-1', {} as any)).toEqual(
            '!err - @context (RequestContext) is required - getHelloArn(RPTM:)',
        );
    });

    it('B18 doReportCallback() publish, failure, error report', async () => {
        expect(await doReportCallback({ b18: 1 } as any, 'api://b18')).toEqual('mid-publish');
        expect($sns.calls[0]).toMatchObject({ subject: 'callback', target: '', payload: { service: 'api://b18' } });
        expect(
            (await doReportCallback({} as any).then(() => $sns.calls[1].payload.service)).startsWith('api://'),
        ).toEqual(true);
        $sns.mode = 'fail';
        expect(await doReportCallback({} as any)).toEqual('');
        //* no arn -> reported through `doReportError()` (ignored in local mode).
        delete process.env.REPORT_ERROR_ARN;
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        expect(await doReportCallback({} as any)).toEqual('!ignore');
    });

    it('B18 convDateToTime() of empty values', () => {
        expect([convDateToTime(''), convDateToTime('0'), convDateToTime(0)]).toEqual([0, 0, 0]);
    });
});
