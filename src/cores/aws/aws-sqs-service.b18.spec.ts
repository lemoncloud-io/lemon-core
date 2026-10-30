/**
 * `aws-sqs-service.b18.spec.ts`
 * - v5 B18: offline unit test of `AWSSQSService` (the SDK client `send()` is stubbed; no AWS call),
 *   and of the in-memory `MyDummySQSService`.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SQSClient,
    SendMessageCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { AWSSQSService, MyDummySQSService } from './aws-sqs-service';
import { GETERR } from '../../common/test-helper';

//* v5 B18: dummy queue url (not a real queue).
const QUEUE = 'https://sqs.ap-northeast-2.amazonaws.com/123456789012/test-queue';

describe('AWSSQSService (B18 offline)', () => {
    let send: ReturnType<typeof vi.fn>;
    // stub the client boundary; local transport off, so the SDK path is taken.
    beforeEach(() => {
        vi.stubEnv('LOCAL_TRANSPORT', '');
        send = vi.fn();
        vi.spyOn(SQSClient.prototype, 'send').mockImplementation(((cmd: any) => send(cmd)) as any);
    });
    // restore the spy and env after each case.
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });
    // the command passed to `send()` at call `n`.
    const cmdOf = (n = 0) => send.mock.calls[n][0];

    it('B18 constructor reads region and endpoint from env', () => {
        vi.stubEnv('MY_SQS_REGION', 'us-west-2');
        vi.stubEnv('MY_SQS_ENDPOINT', QUEUE);
        const sqs = new AWSSQSService();
        expect(sqs.region()).toBe('us-west-2');
        expect(sqs.endpoint()).toBe(QUEUE);
        expect(sqs.hello()).toBe(`aws-sqs-service:${QUEUE}`);

        const sqs2 = new AWSSQSService('q2', 'eu-west-1');
        expect([sqs2.region(), sqs2.endpoint()]).toEqual(['eu-west-1', 'q2']);
    });

    it('B18 sendMessage() builds QueueUrl, MessageBody and MessageAttributes', async () => {
        const sqs = new AWSSQSService(QUEUE, 'ap-northeast-2');
        expect(await sqs.sendMessage(null).catch(GETERR)).toBe('@data(object) is required - sqs.sendMessage()');

        send.mockResolvedValueOnce({ MessageId: 'm-1' });
        expect(await sqs.sendMessage({ hello: 'lemon' }, { count: 2, name: 'x' })).toBe('m-1');
        expect(cmdOf()).toBeInstanceOf(SendMessageCommand);
        expect(cmdOf().input).toEqual({
            QueueUrl: QUEUE,
            MessageBody: JSON.stringify({ hello: 'lemon' }),
            MessageAttributes: {
                count: { DataType: 'Number', StringValue: '2' },
                name: { DataType: 'String', StringValue: 'x' },
            },
        });

        //* a non-object is wrapped as `{ data }`, no attributes; empty result gives ''.
        send.mockResolvedValueOnce(undefined);
        expect(await sqs.sendMessage('text')).toBe('');
        expect(cmdOf(1).input.MessageBody).toBe(JSON.stringify({ data: 'text' }));
        expect(cmdOf(1).input.MessageAttributes).toEqual({});
    });

    it('B18 receiveMessage() maps messages and attributes', async () => {
        const sqs = new AWSSQSService(QUEUE, 'ap-northeast-2');
        expect(await sqs.receiveMessage(0).catch(GETERR)).toBe('@size(number) is required - sqs.receiveMessage()');

        send.mockResolvedValueOnce({
            Messages: [
                {
                    MessageId: 'id-1',
                    ReceiptHandle: 'h-1',
                    Body: '{"a":1}',
                    Attributes: { SentTimestamp: '1700000000000' },
                    MessageAttributes: {
                        n: { DataType: 'Number', StringValue: '3' },
                        s: { DataType: 'String', StringValue: 'x' },
                        e: null,
                    },
                },
                { MessageId: 'id-2', ReceiptHandle: 'h-2' },
            ],
        });
        const { list } = await sqs.receiveMessage(5);
        expect(cmdOf()).toBeInstanceOf(ReceiveMessageCommand);
        expect(cmdOf().input).toEqual({
            MessageSystemAttributeNames: ['SentTimestamp'],
            MaxNumberOfMessages: 5,
            MessageAttributeNames: ['All'],
            QueueUrl: QUEUE,
            WaitTimeSeconds: 0,
        });
        expect(list).toEqual([
            { sent: 1700000000000, attr: { n: 3, s: 'x', e: '' }, data: { a: 1 }, id: 'id-1', handle: 'h-1' },
            { sent: 0, attr: {}, data: {}, id: 'id-2', handle: 'h-2' },
        ]);

        //* default size 1, and no messages.
        send.mockResolvedValueOnce({});
        expect(await sqs.receiveMessage()).toEqual({ list: [] });
        expect(cmdOf(1).input.MaxNumberOfMessages).toBe(1);
    });

    it('B18 deleteMessage() sends the receipt handle', async () => {
        const sqs = new AWSSQSService(QUEUE, 'ap-northeast-2');
        expect(await sqs.deleteMessage('').catch(GETERR)).toBe('@handle(string) is required - sqs.deleteMessage()');

        send.mockResolvedValueOnce({});
        expect(await sqs.deleteMessage('h-1')).toBeUndefined();
        expect(cmdOf()).toBeInstanceOf(DeleteMessageCommand);
        expect(cmdOf().input).toEqual({ QueueUrl: QUEUE, ReceiptHandle: 'h-1' });
    });

    it('B18 statistics() maps queue attributes', async () => {
        const sqs = new AWSSQSService(QUEUE, 'ap-northeast-2');
        send.mockResolvedValueOnce({
            Attributes: {
                ApproximateNumberOfMessages: '4',
                ApproximateNumberOfMessagesNotVisible: '2',
                ApproximateNumberOfMessagesDelayed: '1',
                VisibilityTimeout: '30',
            },
        });
        expect(await sqs.statistics()).toEqual({ available: 4, inflight: 2, delayed: 1, timeout: 30 });
        expect(cmdOf()).toBeInstanceOf(GetQueueAttributesCommand);
        expect(cmdOf().input).toEqual({ QueueUrl: QUEUE, AttributeNames: ['All'] });

        send.mockResolvedValueOnce({});
        expect(await sqs.statistics()).toEqual({ available: 0, inflight: 0, delayed: 0, timeout: 0 });
    });
});

describe('MyDummySQSService (B18)', () => {
    // restore timers after each case.
    afterEach(() => {
        vi.useRealTimers();
    });

    it('B18 timeout > 0 sets the id after the timer', async () => {
        //* v5 B18: fake timers make the delayed id deterministic.
        vi.useFakeTimers();
        const sqs = new MyDummySQSService('dummy-q', 30);
        expect(sqs.hello()).toBe('dummy-sqs-service:dummy-q');
        const id = await sqs.sendMessage({ a: 1 });
        expect(id).toBe('aabbccdd-dummy-sqs-b29b-f2cb20000001');
        expect((await sqs.statistics()).available).toBe(0);
        vi.advanceTimersByTime(30);
        expect(await sqs.statistics()).toEqual({ available: 1, inflight: 0, delayed: 0, timeout: 30 });
    });

    it('B18 timeout 0 sets the id at once; receive and delete', async () => {
        const sqs = new MyDummySQSService('dummy-q', 0);
        const id = await sqs.sendMessage({ a: 1 }, { k: 'v' });
        const { list } = await sqs.receiveMessage(1);
        expect(list).toEqual([{ sent: list[0].sent, attr: { k: 'v' }, data: { a: 1 }, id, handle: id }]);
        //* received: not available until deleted.
        expect((await sqs.statistics()).available).toBe(0);
        await sqs.deleteMessage(id);
        expect((await sqs.receiveMessage(5)).list).toEqual([]);
    });

    it('B18 timeout < 0 never sets the id', async () => {
        const sqs = new MyDummySQSService('dummy-q', -1);
        await sqs.sendMessage('text');
        expect((await sqs.receiveMessage()).list).toEqual([]);
    });
});
