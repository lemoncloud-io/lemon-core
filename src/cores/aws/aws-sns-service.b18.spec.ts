/**
 * `aws-sns-service.b18.spec.ts`
 * - v5 B18: offline unit test of `AWSSNSService` (the SNS/IAM/STS client `send()` is stubbed; no AWS call).
 * - checks the topic ARN resolution, the `PublishCommand` input, and the account-id fallback (IAM → STS).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { IAMClient, GetUserCommand } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { AWSSNSService } from './aws-sns-service';
import { GETERR } from '../../common/test-helper';

//* v5 B18: dummy account and topic (not real resources).
const ACCOUNT = '123456789012';
const TOPIC_ARN = `arn:aws:sns:ap-northeast-2:${ACCOUNT}:test-topic`;

describe('AWSSNSService (B18 offline)', () => {
    let sns: ReturnType<typeof vi.fn>;
    let iam: ReturnType<typeof vi.fn>;
    let sts: ReturnType<typeof vi.fn>;
    // stub the client boundaries; no local transport and no `REPORT_ERROR_ARN`.
    beforeEach(() => {
        vi.stubEnv('LOCAL_TRANSPORT', '');
        vi.stubEnv('REPORT_ERROR_ARN', '');
        vi.stubEnv('MY_SNS_ENDPOINT', undefined);
        vi.stubEnv('REGION', 'ap-northeast-2');
        sns = vi.fn();
        iam = vi.fn();
        sts = vi.fn();
        vi.spyOn(SNSClient.prototype, 'send').mockImplementation(((cmd: any) => sns(cmd)) as any);
        vi.spyOn(IAMClient.prototype, 'send').mockImplementation(((cmd: any) => iam(cmd)) as any);
        vi.spyOn(STSClient.prototype, 'send').mockImplementation(((cmd: any) => sts(cmd)) as any);
    });
    // restore the spies and env after each case.
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('B18 endpoint() keeps an ARN, and builds one from REPORT_ERROR_ARN', async () => {
        const svc = new AWSSNSService();
        expect(svc.name()).toBe('SNS');
        expect(svc.hello()).toBe('aws-sns-service:');
        expect(await svc.endpoint(TOPIC_ARN)).toBe(TOPIC_ARN);

        //* hello-arn gives the account; region from env.
        vi.stubEnv('REPORT_ERROR_ARN', `arn:aws:sns:us-east-1:${ACCOUNT}:lemon-hello-sns`);
        vi.stubEnv('REGION', 'eu-west-1');
        expect(await svc.endpoint('my-topic')).toBe(`arn:aws:sns:eu-west-1:${ACCOUNT}:my-topic`);
        //* an upper-case name is read from env; the default endpoint otherwise.
        vi.stubEnv('MY_TOPIC', 'env-topic');
        expect(await svc.endpoint('MY_TOPIC')).toBe(`arn:aws:sns:eu-west-1:${ACCOUNT}:env-topic`);
        expect(await new AWSSNSService().endpoint()).toBe(`arn:aws:sns:eu-west-1:${ACCOUNT}:lemon-hello-sns`);
        expect(iam).not.toHaveBeenCalled();
        //* an empty env endpoint is an error.
        vi.stubEnv('MY_SNS_ENDPOINT', '');
        expect(await new AWSSNSService().endpoint().catch(GETERR)).toBe(
            '@target (or env.MY_SNS_ENDPOINT) is required!',
        );
    });

    it('B18 endpoint() falls back to accountID() via IAM', async () => {
        iam.mockResolvedValueOnce({ User: { Arn: `arn:aws:iam::${ACCOUNT}:user/tester` } });
        const svc = new AWSSNSService('my-topic');
        expect(svc.hello()).toBe('aws-sns-service:my-topic');
        expect(await svc.endpoint()).toBe(`arn:aws:sns:ap-northeast-2:${ACCOUNT}:my-topic`);
        expect(iam.mock.calls[0][0]).toBeInstanceOf(GetUserCommand);
    });

    it('B18 accountID() uses STS for non-user credentials, and rejects other errors', async () => {
        const svc = new AWSSNSService();
        //* role credentials: IAM says no user → STS caller identity.
        iam.mockRejectedValueOnce(new Error('Must specify userName when calling with non-User credentials'));
        sts.mockResolvedValueOnce({ Account: ACCOUNT });
        expect(await svc.accountID()).toBe(ACCOUNT);
        expect(sts.mock.calls[0][0]).toBeInstanceOf(GetCallerIdentityCommand);

        //* STS error is rejected.
        iam.mockRejectedValueOnce(new Error('Must specify userName when calling with non-User credentials'));
        sts.mockRejectedValueOnce(new Error('ExpiredToken'));
        expect(await svc.accountID().catch(GETERR)).toBe('ExpiredToken');

        //* any other IAM error is rejected.
        iam.mockRejectedValueOnce(new Error('AccessDenied'));
        expect(await svc.accountID().catch(GETERR)).toBe('AccessDenied');
        expect(sts).toHaveBeenCalledTimes(2);
    });

    it('B18 publish() sends TopicArn, Subject and the json Message', async () => {
        const svc = new AWSSNSService();
        sns.mockResolvedValueOnce({ MessageId: 'mid-1' });
        expect(await svc.publish(TOPIC_ARN, 'hello', { a: 1 })).toBe('mid-1');
        const cmd = sns.mock.calls[0][0];
        expect(cmd).toBeInstanceOf(PublishCommand);
        expect(cmd.input).toEqual({
            TopicArn: TOPIC_ARN,
            Subject: 'hello',
            Message: JSON.stringify({ default: JSON.stringify({ a: 1 }) }),
            MessageStructure: 'json',
        });

        //* a string payload as is; empty result gives ''.
        sns.mockResolvedValueOnce(undefined);
        expect(await svc.publish(TOPIC_ARN, 'text', 'plain')).toBe('');
        expect(sns.mock.calls[1][0].input.Message).toBe(JSON.stringify({ default: 'plain' }));

        //* circular payload is stringified safely.
        const loop: any = { name: 'loop' };
        loop.self = loop;
        sns.mockResolvedValueOnce({ MessageId: 'mid-3' });
        expect(await svc.publish(TOPIC_ARN, 'loop', loop)).toBe('mid-3');
        expect(JSON.parse(JSON.parse(sns.mock.calls[2][0].input.Message).default).name).toBe('loop');

        //* error is thrown.
        sns.mockRejectedValueOnce(new Error('NotFound'));
        expect(await svc.publish(TOPIC_ARN, 'x', 'y').catch(GETERR)).toBe('NotFound');

        //* ARN without region.
        expect(await svc.publish('arn:aws:sns::123:t', 'x', 'y').catch(GETERR)).toBe(
            '@region is required. arn:arn:aws:sns::123:t',
        );
    });

    it('B18 reportError() publishes the error payload to REPORT_ERROR_ARN', async () => {
        const svc = new AWSSNSService();
        expect(await svc.reportError(null, 'x')).toBe('N/A');

        vi.stubEnv('REPORT_ERROR_ARN', TOPIC_ARN);
        sns.mockResolvedValueOnce({ MessageId: 'mid-err' });
        expect(await svc.reportError(new Error('boom'), { at: 'test' })).toBe('mid-err');
        const input = sns.mock.calls[0][0].input;
        expect(input.TopicArn).toBe(TOPIC_ARN);
        expect(input.Subject).toBe('error');
        expect(JSON.parse(JSON.parse(input.Message).default)).toMatchObject({ message: 'boom', at: 'test' });

        //* a publish error is returned as text.
        sns.mockRejectedValueOnce(new Error('Throttled'));
        expect(await svc.reportError(new Error('boom'), 'msg')).toBe('ERROR - Throttled');
    });
});
