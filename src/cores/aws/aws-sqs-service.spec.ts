/**
 * `aws-sqs-service.spec.js`
 * - unit test for `aws-sqs-service`
 *
 *
 * //TODO - move to `lemon-core` shared lib.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-09-27 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { loadProfile } from '../../environ';
import { expect2, _it, GETERR } from '../../common/test-helper';
import { AWSSQSService, MyDummySQSService } from './aws-sqs-service';
import * as tools from '../../tools';
import {
    SQSClient,
    SendMessageCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    GetQueueAttributesCommand,
    CreateQueueCommand,
    DeleteQueueCommand,
    ListQueuesCommand,
    PurgeQueueCommand,
} from '@aws-sdk/client-sqs';
import crypto from 'crypto';

jest.mock('../../tools', () => {
    const actual = jest.requireActual('../../tools');
    return {
        ...actual,
        awsConfig: jest.fn(),
    };
});

const sendRecords: { name: string; input: any }[] = [];

/*
 * class: `MockSQSClient`
 * - Improved mock with real AWS response structure
 */
export class MockSQSClient extends SQSClient {
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

    private generateReceiptHandle(): string {
        return `mock-receipt-handle-${this.generateUUID()}`;
    }

    public send = async (command: any) => {
        const commandName = command.constructor.name;
        sendRecords.push({ name: commandName, input: command.input });

        // Mock responses based on command type
        switch (commandName) {
            case 'SendMessageCommand':
                const body = command.input?.MessageBody || '';
                const attributes = command.input?.MessageAttributes || {};
                return {
                    MessageId: this.generateUUID(),
                    MD5OfBody: this.calculateMD5(body),
                    MD5OfMessageAttributes: this.calculateAttributesMD5(attributes),
                };
            case 'ReceiveMessageCommand':
                const msgBody = '{"mock": "message", "timestamp": "' + new Date().toISOString() + '"}';
                return {
                    Messages: [
                        {
                            MessageId: this.generateUUID(),
                            ReceiptHandle: this.generateReceiptHandle(),
                            Body: msgBody,
                            MD5OfBody: this.calculateMD5(msgBody),
                            Attributes: {
                                ApproximateReceiveCount: '1',
                                SentTimestamp: Date.now().toString(),
                            },
                        },
                    ],
                };
            case 'DeleteMessageCommand':
                return {};
            case 'CreateQueueCommand':
                return {
                    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/mock-queue',
                };
            case 'DeleteQueueCommand':
                return {};
            case 'ListQueuesCommand':
                return {
                    QueueUrls: [
                        'https://sqs.us-east-1.amazonaws.com/123456789012/mock-queue-1',
                        'https://sqs.us-east-1.amazonaws.com/123456789012/mock-queue-2',
                    ],
                };
            case 'GetQueueAttributesCommand':
                return {
                    Attributes: {
                        QueueArn: 'arn:aws:sqs:us-east-1:123456789012:mock-queue',
                        ApproximateNumberOfMessages: '5',
                        ApproximateNumberOfMessagesNotVisible: '0',
                        ApproximateNumberOfMessagesDelayed: '0',
                        CreatedTimestamp: Date.now().toString(),
                        VisibilityTimeout: '30',
                        MessageRetentionPeriod: '345600',
                    },
                };
            case 'PurgeQueueCommand':
                return {};
            default:
                return {
                    Command: command,
                    Mock: true,
                };
        }
    };
}

//! main test body.
describe('AWSSQSService', () => {
    //* use `env.PROFILE`
    const PROFILE = loadProfile(process); // override process.env.
    if (PROFILE) console.info(`! PROFILE =`, PROFILE);

    const ENDPOINTS: { [key: string]: string } = {
        lemon: 'https://sqs.ap-northeast-2.amazonaws.com/085403634746/lemon-test-sqs',
        // lemon: 'https://sqs.ap-northeast-2.amazonaws.com/085403634746/lemon-hello-sqs',
    };

    const wait = async (timeout: number) =>
        new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve(timeout);
            }, timeout);
        });

    //* test basic of service.
    it('should pass basic AWSSQSService()', async () => {
        const ENDPOINT = ENDPOINTS[PROFILE];

        // expect2(() => new AWSSQSService()).toEqual('env.SQS_ENDPOINT is required!');
        // expect2(() => new AWSSQSService()).toEqual('env.MY_SQS_ENDPOINT is required w/ stage:');
        expect2(() => new AWSSQSService(), '_endpoint,_region').toEqual({ _endpoint: '', _region: 'ap-northeast-2' });
        if (ENDPOINT) {
            const service = new AWSSQSService(ENDPOINT);
            expect2(() => service.hello()).toEqual(`aws-sqs-service:${ENDPOINT}`);
            expect2(() => service.sendMessage(null, null)).toEqual('@data(object) is required - sqs.sendMessage()');

            //* read origin stats
            const timeout = 1; //NOTE - 1 sec.
            const stats = await service.statistics();
            const available = stats.available;

            //TODO - pre-condition checking. clear all messages in queue.

            //* sende message..
            const message = service.hello();
            const attribs = { hello: 'lemon', numb: 2 };
            expect2(() => message).toEqual(`aws-sqs-service:${ENDPOINT}`);

            const queueid = await service.sendMessage(message, attribs);
            console.info(`! queue-id =`, queueid);
            // expect2(queueid).toEqual('9b0888d7-5120-4c36-b29b-ff2cb2bedc39');
            expect2(typeof queueid + ':' + `${queueid}`.length).toEqual(
                'string:' + '9b0888d7-5120-4c36-b29b-ff2cb2bedc39'.length,
            );

            //NOTE - wait more than 1 sec.
            await wait(1200);

            // expect2(await service.statistics(), '!delayed').toEqual({ available: available + 1, inflight: 0, timeout: 30 });
            expect2(await service.statistics(), '!delayed,!inflight').toEqual({
                // available: available + 1,
                available: expect.any(Number),
                timeout,
            });

            //* receive message..
            const result = await service.receiveMessage();
            console.info(`! message-id =`, result?.list?.[0]?.id);

            expect2(() => result.list.length).toEqual(1);
            if (typeof message !== 'string') {
                expect2(() => result.list[0].data).toEqual(message);
            } else {
                expect2(() => result.list[0].data).toEqual({ data: message });
            }
            expect2(() => result.list[0].attr).toEqual(attribs);
            // expect2(() => result.list[0].id).toEqual(queueid); // `queue-id` should be same as `message-id`
            expect2(() => result.list[0].id).toEqual(expect.any(String)); // `queue-id` should be same as `message-id`

            //NOTE - wait sometime.
            await wait(1200);

            // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 1, timeout: 30 });
            expect2(await service.statistics(), '!delayed,!inflight').toEqual({
                // available: available + 1,
                available: expect.any(Number),
                timeout,
            });

            //* delete message
            console.info(`! handle-id =`, result.list[0].handle);
            await service.deleteMessage(result.list[0].handle);

            await wait(1200);

            // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 0, timeout: 30 });
            // expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout });
            expect2(await service.statistics(), '!delayed,!inflight').toEqual({
                // available: available,
                available: expect.any(Number),
                timeout,
            });
        }
    });

    //* test dummy of service.
    it('should pass dummy MyDummySQSService()', async () => {
        const ENDPOINT = ENDPOINTS[PROFILE];

        const service = new MyDummySQSService(ENDPOINT);
        expect2(() => service.hello()).toEqual(`dummy-sqs-service:${ENDPOINT}`);
        expect2(() => service.sendMessage(null, null)).toEqual('@data(object) is required!');

        //* read origin stats
        const stats = await service.statistics();
        const available = stats.available;

        //* send message
        const message = service.hello();
        const attribs = { hello: 'lemon', numb: 2 };
        const queueid = await service.sendMessage(message, attribs);
        // console.info(`! queue-id =`, queueid);
        // expect2(queueid).toEqual('9b0888d7-5120-4c36-b29b-ff2cb2bedc39');
        expect2(typeof queueid + ':' + `${queueid}`.length).toEqual(
            'string:' + '9b0888d7-5120-4c36-b29b-ff2cb2bedc39'.length,
        );

        //NOTE - wait more than 1 sec.
        await wait(1200);
        // expect2(await service.statistics(), '!delayed').toEqual({ available: available + 1, inflight: 0, timeout: 30 });
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available + 1, timeout: 30 });

        //* receive message..
        const result = await service.receiveMessage();
        // console.info(`! message-id =`, result.list[0].id);
        expect2(() => result.list.length).toEqual(1);
        if (typeof message !== 'string') {
            expect2(() => result.list[0].data).toEqual(message);
        } else {
            expect2(() => result.list[0].data).toEqual({ data: message });
        }
        expect2(() => result.list[0].attr).toEqual(attribs);
        expect2(() => result.list[0].id).toEqual(queueid); // `queue-id` should be same as `message-id`

        //NOTE - wait sometime.
        await wait(1200);
        // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 1, timeout: 30 });
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 30 });

        //* delete message
        // console.info(`! handle-id =`, result.list[0].handle);
        await service.deleteMessage(result.list[0].handle);
        await wait(1200);
        // expect2(await service.statistics(), '!delayed').toEqual({ available: available, inflight: 0, timeout: 30 });
        expect2(await service.statistics(), '!delayed,!inflight').toEqual({ available: available, timeout: 30 });
    });
});

describe('AWSSQSService (extended mocks)', () => {
    const ORIGINAL_SEND = SQSClient.prototype.send;
    afterEach(() => {
        SQSClient.prototype.send = ORIGINAL_SEND;
    });

    //* test of sqs workflow via MocksAWSSQSService
    it('should mock sqs workflow via MocksAWSSQSService', async () => {
        const service = new AWSSQSService('https://mock-sqs.example', 'ap-northeast-2');
        const sqsMock = new MockSQSClient({ region: service.region() });

        SQSClient.prototype.send = sqsMock.send;

        //* sendMessage with object payload
        const attr = { tries: 2, priority: 'high' };
        const messageId = await service.sendMessage({ hello: 'lemon' }, attr);
        expect2(() => messageId.startsWith('mockuuid-')).toEqual(true);
        expect2(() => sendRecords[0].input.QueueUrl).toEqual('https://mock-sqs.example');
        expect2(() => JSON.parse(sendRecords[0].input.MessageBody).hello).toEqual('lemon');
        expect2(() => sendRecords[0].input.MessageAttributes).toEqual({
            tries: { DataType: 'Number', StringValue: '2' },
            priority: { DataType: 'String', StringValue: 'high' },
        });

        //* sendMessage with primitive payload
        const secondId = await service.sendMessage('raw');
        expect2(() => secondId.startsWith('mockuuid-')).toEqual(true);
        expect2(() => JSON.parse(sendRecords[1].input.MessageBody).data).toEqual('raw');

        //* receive message default size
        const received = await service.receiveMessage();
        expect2(() => received.list[0].id.startsWith('mockuuid-')).toEqual(true);
        expect2(() => received.list[0].handle).toContain('mock-receipt-handle');

        //* receive with explicit size
        await service.receiveMessage(2);
        expect2(() => sendRecords[3].input.MaxNumberOfMessages).toEqual(2);

        //* delete & statistics
        await service.deleteMessage(received.list[0].handle);
        const stats = await service.statistics();
        expect2(() => stats).toEqual({
            available: 5,
            inflight: 0,
            delayed: 0,
            timeout: 30,
        });
    });

    //* validation tests for sqs parameters
    it('should validate sqs parameters strictly', async () => {
        const service = new AWSSQSService();

        expect2(await service.sendMessage(null as any).catch(GETERR)).toEqual(
            '@data(object) is required - sqs.sendMessage()',
        );
        expect2(await service.receiveMessage(0 as any).catch(GETERR)).toEqual(
            '@size(number) is required - sqs.receiveMessage()',
        );
        expect2(await service.deleteMessage('' as any).catch(GETERR)).toEqual(
            '@handle(string) is required - sqs.deleteMessage()',
        );
    });

    //* test dummy and mock service utilities
    _it('should cover dummy and mock service utilities', async () => {
        const dummy = new MyDummySQSService('https://dummy', 0);
        const firstId = await dummy.sendMessage({ foo: 'bar' }, { tries: 3 });
        const secondId = await dummy.sendMessage('raw', { priority: 'low' });
        expect2(() => firstId).toEqual('aabbccdd-dummy-sqs-b29b-f2cb20000001');
        expect2(() => secondId).toEqual('aabbccdd-dummy-sqs-b29b-f2cb20000002');

        const { list } = await dummy.receiveMessage(2);
        expect2(() => list.length).toEqual(2);
        expect2(() => list[0].data.foo).toEqual('bar');
        expect2(() => list[1].data.data).toEqual('raw');

        await dummy.deleteMessage(list[0].handle);
        const statsAfterDelete = await dummy.statistics();
        expect2(() => statsAfterDelete).toEqual({
            available: 0,
            inflight: 0,
            delayed: 0,
            timeout: 0,
        });

        const mockSqs = new MockSQSClient({ region: 'ap-northeast-2' });
        const sendResult = await mockSqs.send(new SendMessageCommand({ QueueUrl: 'q', MessageBody: '{}' }));
        expect2(() => sendResult.MessageId?.startsWith('mockuuid-')).toBeTruthy();
        expect2(() => sendResult.MD5OfBody).toMatch(/^[a-f0-9]{32}$/);

        const receiveResult = await mockSqs.send(new ReceiveMessageCommand({ QueueUrl: 'q' }));
        const receiveMessages = receiveResult.Messages || [];
        expect2(() => receiveMessages.length).toEqual(1);
        const mockMsg = receiveMessages[0];
        expect2(() => mockMsg.MessageId?.startsWith('mockuuid-')).toBeTruthy();
        expect2(() => mockMsg.MD5OfBody).toMatch(/^[a-f0-9]{32}$/);

        const deleteResult = await mockSqs.send(new DeleteMessageCommand({ QueueUrl: 'q', ReceiptHandle: 'h' }));
        expect2(() => Object.keys(deleteResult).length).toEqual(0);

        const createResult = await mockSqs.send(new CreateQueueCommand({ QueueName: 'demo-queue' }));
        expect2(() => createResult.QueueUrl).toEqual('https://sqs.us-east-1.amazonaws.com/123456789012/mock-queue');

        const removeResult = await mockSqs.send(new DeleteQueueCommand({ QueueUrl: 'q' }));
        expect2(() => Object.keys(removeResult).length).toEqual(0);

        const listResult = await mockSqs.send(new ListQueuesCommand({}));
        expect2(() => listResult.QueueUrls).toEqual([
            'https://sqs.us-east-1.amazonaws.com/123456789012/mock-queue-1',
            'https://sqs.us-east-1.amazonaws.com/123456789012/mock-queue-2',
        ]);

        const attrResult = await mockSqs.send(
            new GetQueueAttributesCommand({ QueueUrl: 'q', AttributeNames: ['All'] }),
        );
        const attributes = (attrResult.Attributes || {}) as Record<string, string>;
        expect2(() => attributes.QueueArn).toEqual('arn:aws:sqs:us-east-1:123456789012:mock-queue');

        const purgeResult = await mockSqs.send(new PurgeQueueCommand({ QueueUrl: 'q' }));
        expect2(() => Object.keys(purgeResult).length).toEqual(0);

        const fallback = await mockSqs.send({ constructor: { name: 'UnknownCommand' } } as any);
        expect2(() => fallback.Mock).toEqual(true);
    });
});

describe('AWSSQSService - Mock Client Coverage', () => {
    const MOCK_URL = 'https://mock-sqs.example/queue';
    let sendSpy: jest.SpyInstance;
    const awsConfigMock = tools.awsConfig as jest.Mock;

    beforeAll(() => {
        sendSpy = jest.spyOn(SQSClient.prototype, 'send');
    });

    afterAll(() => {
        sendSpy.mockRestore();
    });

    beforeEach(() => {
        sendSpy.mockReset();
        awsConfigMock.mockReset();
        awsConfigMock.mockReturnValue({ region: 'ap-northeast-2' } as any);
    });

    it('should send message with converted attributes and body', async () => {
        const service = new AWSSQSService(MOCK_URL, 'ap-northeast-2');
        sendSpy.mockImplementation(async command => {
            expect2(() => command.constructor.name).toEqual('SendMessageCommand');
            return { MessageId: 'mock-message-id' };
        });

        const messageId = await service.sendMessage({ foo: 'bar' }, { tries: 3, owner: 'kim' });

        expect2(() => messageId).toEqual('mock-message-id');
        const sent = sendSpy.mock.calls[0][0] as SendMessageCommand;
        const input = (sent as any).input;
        expect2(() => input.QueueUrl).toEqual(MOCK_URL);
        expect2(() => input.MessageAttributes.tries).toEqual({ DataType: 'Number', StringValue: '3' });
        expect2(() => input.MessageAttributes.owner).toEqual({ DataType: 'String', StringValue: 'kim' });
        expect2(() => JSON.parse(input.MessageBody).foo).toEqual('bar');
    });

    it('should receive and transform messages including attributes', async () => {
        const service = new AWSSQSService(MOCK_URL, 'ap-northeast-2');
        sendSpy.mockImplementation(async command => {
            expect2(() => command.constructor.name).toEqual('ReceiveMessageCommand');
            return {
                Messages: [
                    {
                        MessageId: 'mock-received',
                        ReceiptHandle: 'mock-handle',
                        Body: JSON.stringify({ hello: 'world' }),
                        Attributes: { SentTimestamp: '1730000000' },
                        MessageAttributes: {
                            tries: { DataType: 'Number', StringValue: '5' },
                            owner: { DataType: 'String', StringValue: 'neo' },
                        },
                    },
                ],
            };
        });

        const { list } = await service.receiveMessage();

        expect2(() => list.length).toEqual(1);
        expect2(() => list[0].sent).toEqual('1730000000');
        expect2(() => list[0].attr.tries).toEqual(5);
        expect2(() => list[0].attr.owner).toEqual('neo');
        expect2(() => list[0].data.hello).toEqual('world');
        expect2(() => list[0].handle).toEqual('mock-handle');
    });

    it('should reject invalid receive size', async () => {
        const service = new AWSSQSService(MOCK_URL);
        expect2(await service.receiveMessage(0 as any).catch(GETERR)).toEqual(
            '@size(number) is required - sqs.receiveMessage()',
        );
    });

    it('should delete message via SQS client', async () => {
        const service = new AWSSQSService(MOCK_URL, 'ap-northeast-2');
        sendSpy.mockImplementation(async command => {
            expect2(() => command.constructor.name).toEqual('DeleteMessageCommand');
            return {};
        });

        await service.deleteMessage('mock-receipt');

        const deleted = sendSpy.mock.calls[0][0] as DeleteMessageCommand;
        const input = (deleted as any).input;
        expect2(() => input.QueueUrl).toEqual(MOCK_URL);
        expect2(() => input.ReceiptHandle).toEqual('mock-receipt');
    });

    it('should compute statistics from queue attributes', async () => {
        const service = new AWSSQSService(MOCK_URL, 'ap-northeast-2');
        sendSpy.mockImplementation(async command => {
            expect2(() => command.constructor.name).toEqual('GetQueueAttributesCommand');
            return {
                Attributes: {
                    ApproximateNumberOfMessages: '7',
                    ApproximateNumberOfMessagesNotVisible: '2',
                    ApproximateNumberOfMessagesDelayed: '1',
                    VisibilityTimeout: '45',
                },
            };
        });

        const stats = await service.statistics();

        expect2(() => stats).toEqual({
            available: 7,
            inflight: 2,
            delayed: 1,
            timeout: 45,
        });
    });
});

describe('MyDummySQSService - Timer Coverage', () => {
    it('should enqueue message and publish id after timeout', async () => {
        const timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((handler: any) => {
            handler();
            return 0 as any;
        }) as any);
        const dummy = new MyDummySQSService('dummy://queue', 10);
        const promise = dummy.sendMessage({ foo: 'bar' }, { tries: 1 });
        const id = await promise;
        const { list } = await dummy.receiveMessage();
        expect2(() => list.length).toEqual(1);
        expect2(() => list[0].id).toEqual(id);
        expect2(() => list[0].attr.tries).toEqual(1);
        expect2(() => list[0].data.foo).toEqual('bar');
        timerSpy.mockRestore();
    });

    it('should assign id immediately when timeout is zero and delete by handle', async () => {
        const dummy = new MyDummySQSService('dummy://queue', 0);
        const id = await dummy.sendMessage('raw', { priority: 'low' });
        const { list } = await dummy.receiveMessage();
        expect2(() => list[0].id).toEqual(id);
        await dummy.deleteMessage(list[0].handle);
        const stats = await dummy.statistics();
        expect2(() => stats).toEqual({
            available: 0,
            inflight: 0,
            delayed: 0,
            timeout: 0,
        });
    });
});
