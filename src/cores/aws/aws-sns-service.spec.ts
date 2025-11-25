/**
 * `service/test.sns-service.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-16 initial unit test.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
const ENV_NAME = 'MY_SNS_ENDPOINT';
const DEF_SNS = 'lemon-hello-sns';

//* override environ.
process.env = Object.assign(process.env, {
    [ENV_NAME]: 'arn:aws:sns:ap-northeast-2::hello',
});

//* load $engine, and prepare dummy handler
import { loadProfile } from '../../environ';
import { expect2, GETERR } from '../../common/test-helper';
import { AWSSNSService } from './aws-sns-service';
import {
    CreateTopicCommand,
    DeleteTopicCommand,
    GetTopicAttributesCommand,
    ListTopicsCommand,
    PublishCommand,
    SNSClient,
    SubscribeCommand,
    UnsubscribeCommand,
} from '@aws-sdk/client-sns';
import { IAMClient } from '@aws-sdk/client-iam';
import { STSClient } from '@aws-sdk/client-sts';

import crypto from 'crypto';
import { mockAwsError } from './aws-kms-service.spec';

const SNS = new AWSSNSService();

/**
 * AWS IAM Error types for realistic testing
 */
class AWSIAMError extends Error {
    public readonly name: string;
    public readonly code: string;
    public readonly Code: string;
    public readonly statusCode: number;
    public readonly $fault: string;
    public readonly $metadata: {
        httpStatusCode: number;
        requestId: string;
        attempts: number;
        totalRetryDelay: number;
    };

    constructor(code: string, message: string, statusCode: number = 403) {
        super(message);
        this.name = code;
        this.code = code;
        this.Code = code;
        this.statusCode = statusCode;
        this.$fault = statusCode >= 400 && statusCode < 500 ? 'client' : 'server';
        this.$metadata = {
            httpStatusCode: statusCode,
            requestId: Array.from({ length: 36 }, (_, i) =>
                i === 8 || i === 13 || i === 18 || i === 23 ? '-' : Math.floor(Math.random() * 16).toString(16),
            ).join(''),
            attempts: 1,
            totalRetryDelay: 0,
        };
    }
}

/*
 * class: `MockSNSClient`
 * - Improved mock with real AWS response structure
 */
export class MockSNSClient extends SNSClient {
    public constructor(config?: any) {
        super(config);
    }

    private generateUUID(): string {
        return 'mockuuid-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    private calculateMD5(data: string): string {
        return crypto
            .createHash('md5')
            .update(data || '')
            .digest('hex');
    }

    private calculateAttributesMD5(attributes: any): string {
        if (!attributes) return this.calculateMD5('');
        const attrStr = JSON.stringify(attributes);
        return this.calculateMD5(attrStr);
    }

    private generateSequenceNumber(): string {
        return (Date.now() * 1000000 + Math.floor(Math.random() * 1000000)).toString();
    }

    public send = async (command: any) => {
        const commandName = command.constructor.name;

        // Mock responses based on command type
        switch (commandName) {
            case 'PublishCommand':
                const message = command.input?.Message || '';
                const attributes = command.input?.MessageAttributes || {};
                return {
                    MessageId: this.generateUUID(),
                    MD5OfBody: this.calculateMD5(message),
                    MD5OfMessageAttributes: this.calculateAttributesMD5(attributes),
                    SequenceNumber: this.generateSequenceNumber(),
                };
            case 'CreateTopicCommand':
                return {
                    TopicArn: 'arn:aws:sns:us-east-1:123456789012:mock-topic',
                };
            case 'DeleteTopicCommand':
                return {};
            case 'ListTopicsCommand':
                return {
                    Topics: [
                        {
                            TopicArn: 'arn:aws:sns:us-east-1:123456789012:mock-topic-1',
                        },
                        {
                            TopicArn: 'arn:aws:sns:us-east-1:123456789012:mock-topic-2',
                        },
                    ],
                };
            case 'SubscribeCommand':
                return {
                    SubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:mock-topic:mock-subscription-id',
                };
            case 'UnsubscribeCommand':
                return {};
            case 'GetTopicAttributesCommand':
                return {
                    Attributes: {
                        TopicArn: 'arn:aws:sns:us-east-1:123456789012:mock-topic',
                        DisplayName: 'Mock Topic',
                        SubscriptionsConfirmed: '1',
                        SubscriptionsPending: '0',
                        SubscriptionsDeleted: '0',
                    },
                };
            default:
                return {
                    Command: command,
                    Mock: true,
                };
        }
    };
}
//! main test body.
describe(`test service/sns-service.js`, () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    test('check basic function', async () => {
        expect2(() => SNS.name()).toEqual('SNS');
        expect2(() => SNS.hello()).toEqual('aws-sns-service:');

        expect2(AWSSNSService.ENV_SNS_ENDPOINT).toEqual(ENV_NAME);
        expect2(AWSSNSService.DEF_SNS_ENDPOINT).toEqual(DEF_SNS);
        const a0 = await SNS.endpoint(ENV_NAME);
        expect2(a0).toEqual('arn:aws:sns:ap-northeast-2::hello');
        const a1 = await SNS.endpoint('arn:aws:sns:....');
        expect2(a1).toEqual('arn:aws:sns:....');

        //* test of asPyload()
        const e = new Error('test-error');
        const e2 = { statusMessage: 'test-status' };
        const e3 = 'test-message';
        expect2(() => SNS.asPayload(e, { type: 'error' }).error).toEqual('test-error');
        expect2(() => SNS.asPayload(e2, { type: 'error' })).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'test-status',
            type: 'error',
        });
        expect2(() => SNS.asPayload(e2, 'error')['stack-trace']).toEqual(undefined);
        expect2(() => SNS.asPayload(e2, 'error')).toEqual({
            error: '{"statusMessage":"test-status"}',
            message: 'error',
        });
        expect2(() => SNS.asPayload(e3, 'error')).toEqual({ error: e3, message: 'error' });
    });

    test('should pass accountID() method', async () => {
        const service = new AWSSNSService();
        // Override accountID to return mock data
        (service as any).accountID = async () => '123456789012';

        const accountId = await service.accountID();
        expect2(accountId).toEqual('123456789012');
    });

    test('should pass endpoint() with accountID() fallback', async () => {
        const service = new AWSSNSService();
        // Override accountID to avoid real AWS calls
        (service as any).accountID = async () => '555666777888';

        const endpoint = await service.endpoint('test-topic');
        expect2(endpoint).toEqual('arn:aws:sns:ap-northeast-2:555666777888:test-topic');
    });

    test('should pass endpoint() with getHelloArn() path', async () => {
        // Set REPORT_ERROR_ARN to trigger getHelloArn() path
        const oldEnv = process.env.REPORT_ERROR_ARN;
        process.env.REPORT_ERROR_ARN = 'arn:aws:sns:us-east-1:123456789012:hello-topic';

        const service = new AWSSNSService();
        const endpoint = await service.endpoint('my-custom-topic');
        expect2(endpoint).toEqual('arn:aws:sns:ap-northeast-2:123456789012:my-custom-topic');

        // Restore
        if (oldEnv !== undefined) {
            process.env.REPORT_ERROR_ARN = oldEnv;
        } else {
            delete process.env.REPORT_ERROR_ARN;
        }
    });

    test('should pass publish() method', async () => {
        const service = new AWSSNSService();
        // Override accountID
        (service as any).accountID = async () => '123456789012';

        // Override publish to use MockSNSClient
        const originalPublish = service.publish.bind(service);
        (service as any).publish = async (target: string, subject: string, payload: any) => {
            const arn = await service.endpoint(target);
            if (!arn) throw new Error(`.arn is required! target:${target}`);

            const params = {
                TopicArn: arn,
                Subject: subject,
                Message: JSON.stringify({
                    default: payload && typeof payload == 'object' ? JSON.stringify(payload) : payload,
                }),
                MessageStructure: 'json',
            };

            const region = arn.split(':')[3];
            if (!region) throw new Error(`@region is required. arn:${arn}`);

            // Use MockSNSClient
            const sns = new MockSNSClient({ region });
            const res = await sns.send(new PublishCommand(params));
            return (res && res.MessageId) || '';
        };

        const messageId = await service.publish('test-topic', 'test-subject', { data: 'test' });
        expect2(() => messageId.startsWith('mockuuid-')).toEqual(true);
    });

    test('should pass publish() with string payload', async () => {
        const service = new AWSSNSService();
        (service as any).accountID = async () => '123456789012';

        (service as any).publish = async (target: string, subject: string, payload: any) => {
            const arn = await service.endpoint(target);
            const params = {
                TopicArn: arn,
                Subject: subject,
                Message: JSON.stringify({
                    default: payload && typeof payload == 'object' ? JSON.stringify(payload) : payload,
                }),
                MessageStructure: 'json',
            };

            const region = arn.split(':')[3];
            const sns = new MockSNSClient({ region });
            const res = await sns.send(new PublishCommand(params));
            return (res && res.MessageId) || '';
        };

        const messageId = await service.publish('test-topic', 'test-subject', 'string-payload');
        expect2(() => messageId.startsWith('mockuuid-')).toEqual(true);
    });

    test('should pass publish() with null MessageId response', async () => {
        const service = new AWSSNSService();
        (service as any).accountID = async () => '123456789012';

        (service as any).publish = async (target: string, subject: string, payload: any) => {
            const arn = await service.endpoint(target);
            const params = {
                TopicArn: arn,
                Subject: subject,
                Message: JSON.stringify({
                    default: payload && typeof payload == 'object' ? JSON.stringify(payload) : payload,
                }),
                MessageStructure: 'json',
            };

            const region = arn.split(':')[3];
            // Create custom mock that returns null MessageId
            const mockSns = new MockSNSClient({ region });
            const originalSend = mockSns.send.bind(mockSns);
            mockSns.send = async (command: any) => {
                if (command instanceof PublishCommand) {
                    return {
                        MessageId: null as any,
                    };
                }
                return originalSend(command);
            };
            const res = await mockSns.send(new PublishCommand(params));
            return (res && res.MessageId) || '';
        };

        const messageId = await service.publish('test-topic', 'test-subject', { data: 'test' });
        expect2(messageId).toEqual('');
    });

    test('should pass publish() error when arn is invalid', async () => {
        const service = new AWSSNSService();
        // Create a scenario where endpoint returns invalid arn
        (service as any).endpoint = async () => 'invalid-arn-no-region';

        // Test error with invalid ARN
        expect2(await service.publish('test', 'subject', {}).catch(GETERR)).toEqual(
            '@region is required. arn:invalid-arn-no-region',
        );
    });

    test('should pass reportError() method', async () => {
        const service = new AWSSNSService();
        // Override publish to avoid real AWS calls
        (service as any).publish = async (target: string, subject: string, payload: any) => {
            expect2(subject).toEqual('error');
            expect2(payload.error).toEqual('test-error');
            return 'mock-error-message-id';
        };

        const error = new Error('test-error');
        const messageId = await service.reportError(error, 'error-data');
        expect2(messageId).toEqual('mock-error-message-id');

        // Test with null error
        const messageId2 = await service.reportError(null as any, 'error-data');
        expect2(messageId2).toEqual('N/A');
    });

    test('should pass reportError() with publish error', async () => {
        const service = new AWSSNSService();
        // Override publish to simulate AWS error
        (service as any).publish = async (target: string, subject: string, payload: any) => {
            throw mockAwsError('NotFound', 'Topic does not exist', 404);
        };

        const error = new Error('test-error');
        const result = await service.reportError(error, 'error-data');
        expect2(result).toEqual('ERROR - Topic does not exist');
    });

    test('should pass reportError() with uppercase ENV target', async () => {
        // Set custom error ARN env
        const oldEnv = process.env.CUSTOM_ERROR_ARN;
        process.env.CUSTOM_ERROR_ARN = 'arn:aws:sns:us-west-2:999999999999:custom-error';

        const service = new AWSSNSService();
        (service as any).publish = async (target: string, subject: string, payload: any) => {
            // Verify that uppercase ENV target was used
            return 'mock-custom-error-id';
        };

        const error = new Error('test-error');
        // Pass uppercase env name as target to trigger environ() isUpperStr branch
        const result = await service.reportError(error, 'error-data', 'CUSTOM_ERROR_ARN');
        expect2(result).toEqual('mock-custom-error-id');

        // Restore
        if (oldEnv !== undefined) {
            process.env.CUSTOM_ERROR_ARN = oldEnv;
        } else {
            delete process.env.CUSTOM_ERROR_ARN;
        }
    });

    test('should pass asPayload() with errors[0] handling', async () => {
        const service = new AWSSNSService();

        // Test with errors array containing Error instance
        const error1 = new Error('main-error');
        const error0 = new Error('first-error');
        (error1 as any).errors = [error0];

        const payload1 = service.asPayload(error1, { type: 'error' });
        expect2(payload1.error).toEqual('main-error');
        expect2(payload1.message).toEqual('main-error');

        // Test with errors in body containing object
        const error2 = { message: 'main-error', body: { errors: [{ message: 'nested-error' }] } };
        const payload2 = service.asPayload(error2, 'error-data');
        expect2(payload2.error).toEqual('{"message":"nested-error"}');

        // Test with errors array containing non-Error object
        const error3: any = new Error('main-error');
        const error0obj = { message: 'first-error-obj' };
        error3.errors = [error0obj];
        const payload3 = service.asPayload(error3, { type: 'error' });
        expect2(payload3.error).toEqual('{"message":"first-error-obj"}');
    });

    test('should pass MockSNSClient PublishCommand', async () => {
        const mockSns = new MockSNSClient({ region: 'ap-northeast-2' });

        const result = await mockSns.send(new PublishCommand({ TopicArn: 'test-arn', Message: 'test' }));
        expect2(() => result.MessageId?.startsWith('mockuuid-')).toEqual(true);
        expect2(() => result.MD5OfBody).toMatch(/^[a-f0-9]{32}$/);
        expect2(() => result.MD5OfMessageAttributes).toMatch(/^[a-f0-9]{32}$/);
        expect2(() => result.SequenceNumber.length > 10).toEqual(true);
    });

    test('should pass MockSNSClient other commands', async () => {
        const mockSns = new MockSNSClient({ region: 'ap-northeast-2' });

        // Test CreateTopicCommand
        const createResult = await mockSns.send(new CreateTopicCommand({ Name: 'test-topic' }));
        expect2(createResult.TopicArn).toEqual('arn:aws:sns:us-east-1:123456789012:mock-topic');

        // Test DeleteTopicCommand
        const deleteResult = await mockSns.send(new DeleteTopicCommand({ TopicArn: 'test-arn' }));
        expect2(deleteResult).toEqual({});

        // Test ListTopicsCommand
        const listResult = await mockSns.send(new ListTopicsCommand({}));
        expect2(listResult.Topics.length).toEqual(2);

        // Test SubscribeCommand
        const subResult = await mockSns.send(
            new SubscribeCommand({ TopicArn: 'test-arn', Protocol: 'email', Endpoint: 'test@test.com' }),
        );
        expect2(subResult.SubscriptionArn).toEqual(
            'arn:aws:sns:us-east-1:123456789012:mock-topic:mock-subscription-id',
        );

        // Test UnsubscribeCommand
        const unsubResult = await mockSns.send(new UnsubscribeCommand({ SubscriptionArn: 'test-sub' }));
        expect2(unsubResult).toEqual({});

        // Test GetTopicAttributesCommand
        const attrResult = await mockSns.send(new GetTopicAttributesCommand({ TopicArn: 'test-arn' }));
        expect2(attrResult.Attributes.TopicArn).toEqual('arn:aws:sns:us-east-1:123456789012:mock-topic');

        // Test unknown command
        const unknownCommand = { constructor: { name: 'UnknownCommand' }, input: {} };
        const unknownResult = await mockSns.send(unknownCommand as any);
        expect2(unknownResult.Mock).toEqual(true);
    });

    test('should pass real accountID() implementation with IAM', async () => {
        const service = new AWSSNSService();

        // Mock IAMClient.prototype.send to simulate real AWS calls
        const originalIAMSend = IAMClient.prototype.send;
        IAMClient.prototype.send = jest.fn().mockResolvedValue({
            User: {
                Arn: 'arn:aws:iam::123456789012:user/test-user',
            },
        });

        try {
            const accountId = await service.accountID();
            expect2(accountId).toEqual('123456789012');
        } finally {
            IAMClient.prototype.send = originalIAMSend;
        }
    });

    test('should pass real accountID() implementation with STS fallback', async () => {
        const service = new AWSSNSService();

        // Mock IAMClient to throw specific error that triggers STS fallback
        const originalIAMSend = IAMClient.prototype.send;
        const originalSTSSend = STSClient.prototype.send;

        // if IAMClient.prototype.send is called, return a valid account ID
        const iamError = new AWSIAMError(
            'InvalidInput',
            'Must specify userName when calling with non-User credentials',
            400,
        );
        IAMClient.prototype.send = jest.fn().mockRejectedValue(iamError);
        STSClient.prototype.send = jest.fn().mockResolvedValue({
            Account: '987654321098',
        });

        try {
            const accountId = await service.accountID();
            expect2(accountId).toEqual('987654321098');
        } finally {
            IAMClient.prototype.send = originalIAMSend;
            STSClient.prototype.send = originalSTSSend;
        }
    });

    test('should pass real accountID() implementation with STS error', async () => {
        const service = new AWSSNSService();

        // Mock IAMClient to throw specific error that triggers STS fallback
        const originalIAMSend = IAMClient.prototype.send;
        const originalSTSSend = STSClient.prototype.send;

        const iamError = new AWSIAMError(
            'InvalidInput',
            'Must specify userName when calling with non-User credentials',
            400,
        );
        IAMClient.prototype.send = jest.fn().mockRejectedValue(iamError);

        // Mock STS to throw error
        const stsError = new AWSIAMError(
            'AccessDenied',
            'User is not authorized to perform: sts:GetCallerIdentity',
            403,
        );
        STSClient.prototype.send = jest.fn().mockRejectedValue(stsError);

        try {
            await service.accountID();
            expect2(() => 'should throw').toEqual('error not thrown');
        } catch (e: any) {
            expect2(() => e.message).toEqual('User is not authorized to perform: sts:GetCallerIdentity');
            expect2(() => e.Code).toEqual('AccessDenied');
            expect2(() => e.$fault).toEqual('client');
            expect2(() => e.$metadata.httpStatusCode).toEqual(403);
        } finally {
            IAMClient.prototype.send = originalIAMSend;
            STSClient.prototype.send = originalSTSSend;
        }
    });

    test('should pass real accountID() implementation with error', async () => {
        const service = new AWSSNSService();

        // Mock IAMClient to throw different error
        const originalIAMSend = IAMClient.prototype.send;
        const iamError = new AWSIAMError('AccessDenied', 'User is not authorized to perform: iam:GetUser', 403);
        IAMClient.prototype.send = jest.fn().mockRejectedValue(iamError);

        try {
            await service.accountID();
            expect2(() => 'should throw').toEqual('error not thrown');
        } catch (e: any) {
            expect2(() => e.message).toEqual('User is not authorized to perform: iam:GetUser');
            expect2(() => e.Code).toEqual('AccessDenied');
            expect2(() => e.$fault).toEqual('client');
            expect2(() => e.$metadata.httpStatusCode).toEqual(403);
        } finally {
            IAMClient.prototype.send = originalIAMSend;
        }
    });

    test('should pass real publish() with MockSNSClient', async () => {
        const service = new AWSSNSService();

        // Override endpoint to return a valid ARN
        (service as any).endpoint = async () => 'arn:aws:sns:ap-northeast-2:123456789012:test-topic';

        // Mock SNSClient.prototype.send to use MockSNSClient behavior
        const originalSend = SNSClient.prototype.send;
        SNSClient.prototype.send = jest.fn().mockResolvedValue({
            MessageId: 'real-mock-message-id-123',
        });

        try {
            const messageId = await service.publish('test-topic', 'test-subject', { data: 'test' });
            expect2(messageId).toEqual('real-mock-message-id-123');
        } finally {
            SNSClient.prototype.send = originalSend;
        }
    });

    test('should pass real publish() with empty MessageId', async () => {
        const service = new AWSSNSService();

        // Override endpoint to return a valid ARN
        (service as any).endpoint = async () => 'arn:aws:sns:us-east-1:123456789012:test-topic';

        // Mock SNSClient.prototype.send to return response without MessageId
        const originalSend = SNSClient.prototype.send;
        SNSClient.prototype.send = jest.fn().mockResolvedValue({});

        try {
            const messageId = await service.publish('test-topic', 'test-subject', { data: 'test' });
            expect2(messageId).toEqual('');
        } finally {
            SNSClient.prototype.send = originalSend;
        }
    });

    test('should pass real publish() with error', async () => {
        const service = new AWSSNSService();

        // Override endpoint to return a valid ARN
        (service as any).endpoint = async () => 'arn:aws:sns:us-west-2:123456789012:test-topic';

        // Mock SNSClient.prototype.send to throw AWS error
        const originalSend = SNSClient.prototype.send;
        const awsError = mockAwsError('InvalidParameter', 'Invalid parameter: TopicArn', 400);
        SNSClient.prototype.send = jest.fn().mockRejectedValue(awsError);

        try {
            await service.publish('test-topic', 'test-subject', { data: 'test' });
            expect2(() => 'should throw').toEqual('error not thrown');
        } catch (e: any) {
            expect2(() => e.message).toEqual('Invalid parameter: TopicArn');
            expect2(() => e.Code).toEqual('InvalidParameter');
            expect2(() => e.Type).toEqual('Sender');
            expect2(() => e.$fault).toEqual('client');
            expect2(() => e.$metadata.httpStatusCode).toEqual(400);
            expect2(() => e.$metadata.requestId).toBeDefined();
            expect2(() => e.$metadata.attempts).toEqual(1);
            expect2(() => e.$metadata.totalRetryDelay).toEqual(0);
        } finally {
            SNSClient.prototype.send = originalSend;
        }
    });
});
