/**
 * `local-transport.spec.ts`
 * - unit test for `local-transport` (opt-in mock delivery of SNS/SQS/protocol in local mode).
 * - every AWS SDK client is mocked: the active path must create none, the inactive path must use them as before.
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GETERR } from '../../common/test-helper';

//* the SDK client mock: each `new <Client>()` and each `send()` is recorded by the package name.
const sdk = vi.hoisted(() => ({
    clients: [] as string[],
    sends: [] as { pkg: string; input: any }[],
}));

//* build a mocked SDK package: `send()` resolves a fixed output per package.
const mockSdk = (pkg: string, names: string[], output: (input: any) => any) => {
    //* a command keeps its input.
    class Command {
        public constructor(public readonly input: any) {}
    }
    //* a client records itself and each send.
    class Client {
        public constructor() {
            sdk.clients.push(pkg);
        }
        public send = async (cmd: Command) => {
            sdk.sends.push({ pkg, input: cmd.input });
            return output(cmd.input);
        };
    }
    return names.reduce((M: any, n) => ({ ...M, [n]: n.endsWith('Client') ? Client : Command }), {});
};
vi.mock('@aws-sdk/client-sns', () =>
    mockSdk('sns', ['SNSClient', 'PublishCommand'], () => ({ MessageId: 'aws-sns-1' })),
);
vi.mock('@aws-sdk/client-sqs', () =>
    mockSdk('sqs', ['SQSClient', 'SendMessageCommand'], () => ({ MessageId: 'aws-sqs-1' })),
);
vi.mock('@aws-sdk/client-lambda', () =>
    mockSdk('lambda', ['LambdaClient', 'InvokeCommand'], () => ({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify({ statusCode: 200, body: '{"via":"aws"}' })),
    })),
);
vi.mock('@aws-sdk/client-iam', () => mockSdk('iam', ['IAMClient', 'GetUserCommand'], () => ({})));
vi.mock('@aws-sdk/client-sts', () => mockSdk('sts', ['STSClient', 'GetCallerIdentityCommand'], () => ({})));

import { getHelloArn } from '../../engine';
import { AWSSNSService } from '../aws/aws-sns-service';
import { AWSSQSService } from '../aws/aws-sqs-service';
import $lambda from '../lambda';
import $protocol from './index';
import { MyProtocolService } from './protocol-service';
import { $localTransport, transportLog, LOCAL_ACCOUNT_ID, LOCAL_TRANSPORT_CAP } from './local-transport';

//* the region of the placeholder ARN/URL.
const REGION = 'ap-northeast-2';
//* the queue url of this service (env `MY_SQS_ENDPOINT`), placeholder account.
const MY_QUEUE_URL = `https://sqs.${REGION}.amazonaws.com/${LOCAL_ACCOUNT_ID}/loop-queue`;
//* a message id of the local transport.
const MOCK_ID = /^mock-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

//* env names this spec sets; `undefined` deletes the name.
const ENV: { [key: string]: string | undefined } = {
    LOCAL_MODE: '1',
    LOCAL_TRANSPORT: 'mock',
    AWS_LAMBDA_FUNCTION_NAME: undefined,
    MY_SNS_ENDPOINT: 'loop-topic',
    MY_SQS_ENDPOINT: MY_QUEUE_URL,
    REPORT_ERROR_ARN: undefined,
    REGION: undefined,
};
//* set (or delete) each name of a map in `process.env`.
const setEnv = (M: { [key: string]: string | undefined }) =>
    Object.entries(M).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));

//* the default protocol service (the one `$protocol()` uses) and the hosts of this service.
const proto = $protocol.service as MyProtocolService;
const selfHost = (type: 'sns' | 'sqs' | 'web') => new URL(proto.asProtocolURI(type, { service: 'self' })).host;

//* every listener call of the default SNS/SQS handlers, and the protocol controller calls.
const heard: { type: string; param: any; body: any }[] = [];
const served: { mode: string; id: string; cmd: string; body: any; depth: number }[] = [];
//* behaviour switches of the listeners (set per test).
const mode = { sqsThrows: false };
$lambda.sns.addListener(async (type, param, body) => {
    heard.push({ type, param, body });
    //* the forever listener: re-publish the same message to this topic (the loop cap must stop it).
    if (param?.subject === 'loop-forever') return new AWSSNSService().publish('', 'loop-forever', body);
    //* the fan-out listener: one delivery sends `body.n` messages at once (one burst; the deliveries cap must stop it).
    if (param?.subject === 'fan-out') {
        const sns = new AWSSNSService();
        const sent = Array.from({ length: body.n }, (_, i) => sns.publish('', 'fan-leaf', { i }).catch(GETERR));
        return (await Promise.all(sent)).filter(r => r.startsWith('508')).length;
    }
    return `heard:${body?.n ?? ''}`;
});
$lambda.sqs.addListener(async (type, param, body) => {
    heard.push({ type, param, body });
    if (mode.sqsThrows) throw new Error('boom');
    return `heard:${body?.n ?? ''}`;
});
//* the protocol receiver: `POST /loopt/<id>/recv` echoes the body (records the call).
$lambda.web.addController({
    hello: () => 'loopt-controller',
    type: () => 'loopt',
    decode: (m: any, i: any, c: any) =>
        c === 'recv'
            ? async (id: any, param: any, body: any, $ctx: any) => {
                  served.push({ mode: m, id, cmd: c, body, depth: $ctx?.depth ?? 0 });
                  return { id, echo: body };
              }
            : null,
});

//* a protocol param to `loopt/<id>/recv` of this service (no account in the context).
const recvParam = (id: string, body: any, service = 'self'): any => ({
    service,
    type: 'loopt',
    id,
    cmd: 'recv',
    mode: 'POST',
    body,
    context: { depth: 1 },
});

//! main test body.
describe('local-transport', () => {
    let saved: { [key: string]: string | undefined } = {};
    let logs: string[] = [];
    beforeEach(async () => {
        saved = Object.keys(ENV).reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
        setEnv(ENV);
        sdk.clients.splice(0);
        sdk.sends.splice(0);
        heard.splice(0);
        served.splice(0);
        mode.sqsThrows = false;
        logs = [];
        vi.spyOn(transportLog, 'inf').mockImplementation((line: string) => void logs.push(line));
        await $localTransport.drain();
        logs.splice(0);
    });
    afterEach(async () => {
        await $localTransport.drain();
        setEnv(saved);
        vi.restoreAllMocks();
    });

    //! -------------------------------------------------------------------------------------------------------------
    //! inactive: the AWS path is taken (byte-identical to the previous behaviour)
    //! -------------------------------------------------------------------------------------------------------------
    describe('inactive (no LOCAL_TRANSPORT)', () => {
        beforeEach(() => setEnv({ LOCAL_TRANSPORT: undefined }));

        it('should use the SNS/SQS/Lambda clients as before', async () => {
            expect($localTransport.isActive()).toBe(false);
            const arn = `arn:aws:sns:${REGION}:${LOCAL_ACCOUNT_ID}:loop-topic`;
            expect(await new AWSSNSService().publish(arn, 'hi', { n: 1 })).toEqual('aws-sns-1');
            expect(await new AWSSQSService(MY_QUEUE_URL).sendMessage({ n: 2 }, { a: 'b' })).toEqual('aws-sqs-1');
            const context = { accountId: LOCAL_ACCOUNT_ID, requestId: 'r-1' };
            expect(await proto.notify({ ...recvParam('1', { n: 3 }), context })).toEqual('aws-sns-1');
            expect(await proto.enqueue({ ...recvParam('1', { n: 4 }), context })).toEqual('aws-sqs-1');
            expect(await proto.execute({ ...recvParam('1', { n: 5 }), context })).toEqual({ via: 'aws' });
            expect(await proto.broadcast(context, arn, { n: 6 })).toEqual('aws-sns-1');
            expect(sdk.clients).toEqual(['sns', 'sqs', 'sns', 'sqs', 'lambda', 'sns']);
            expect(sdk.sends.map(s => s.pkg)).toEqual(['sns', 'sqs', 'sns', 'sqs', 'lambda', 'sns']);
            expect(sdk.sends[0].input).toEqual({
                TopicArn: arn,
                Subject: 'hi',
                Message: JSON.stringify({ default: '{"n":1}' }),
                MessageStructure: 'json',
            });
            expect(sdk.sends[1].input.QueueUrl).toEqual(MY_QUEUE_URL);
            //* nothing is delivered in-process.
            expect(heard).toEqual([]);
            expect(served).toEqual([]);
            expect(await $localTransport.drain()).toEqual([]);
            expect(logs).toEqual([]);
        });

        it('should keep getHelloArn() strict (no placeholder account)', () => {
            expect(() => getHelloArn({} as any, 'T:')).toThrow('.accountId[] is missing - getHelloArn(T:)');
        });

        it('should stay inactive without LOCAL_MODE (one warn line)', async () => {
            setEnv({ LOCAL_TRANSPORT: 'mock', LOCAL_MODE: undefined });
            expect($localTransport.isActive()).toBe(false);
            expect($localTransport.isActive()).toBe(false);
            const arn = `arn:aws:sns:${REGION}:${LOCAL_ACCOUNT_ID}:loop-topic`;
            expect(await new AWSSNSService().publish(arn, 'hi', { n: 1 })).toEqual('aws-sns-1');
            expect(sdk.clients).toEqual(['sns']);
            expect(logs).toEqual(['WARN! env.LOCAL_TRANSPORT[mock] is ignored - not local mode']);
        });
    });

    //! -------------------------------------------------------------------------------------------------------------
    //! Lambda: the env is ignored (one warn line), getHelloArn() keeps its Lambda rule
    //! -------------------------------------------------------------------------------------------------------------
    describe('in Lambda (AWS_LAMBDA_FUNCTION_NAME)', () => {
        beforeEach(() => setEnv({ AWS_LAMBDA_FUNCTION_NAME: 'lemon-test-lambda' }));

        it('should ignore LOCAL_TRANSPORT with one warn line, and use the clients', async () => {
            expect($localTransport.isActive()).toBe(false);
            const arn = `arn:aws:sns:${REGION}:${LOCAL_ACCOUNT_ID}:loop-topic`;
            expect(await new AWSSNSService().publish(arn, 'hi', { n: 1 })).toEqual('aws-sns-1');
            expect(await new AWSSQSService(MY_QUEUE_URL).sendMessage({ n: 2 })).toEqual('aws-sqs-1');
            expect(sdk.clients).toEqual(['sns', 'sqs']);
            expect(logs).toEqual(['WARN! env.LOCAL_TRANSPORT[mock] is ignored - in Lambda']);
        });

        it('should keep getHelloArn() strict', () => {
            expect(() => getHelloArn({} as any, 'T:')).toThrow('.accountId[] is missing - getHelloArn(T:)');
        });
    });

    //! -------------------------------------------------------------------------------------------------------------
    //! active: in-process delivery through the engine's `LambdaHandler.handle()`
    //! -------------------------------------------------------------------------------------------------------------
    describe('active (LOCAL_TRANSPORT=mock + LOCAL_MODE=1)', () => {
        it('should be active, and build the placeholder hello-arn without an account', () => {
            expect($localTransport.isActive()).toBe(true);
            expect(getHelloArn({} as any)).toEqual(`arn:aws:sns:${REGION}:${LOCAL_ACCOUNT_ID}:lemon-hello-sns`);
            //* a real account in the context is still used first.
            expect(getHelloArn({ accountId: '123456789012' } as any)).toEqual(
                `arn:aws:sns:${REGION}:123456789012:lemon-hello-sns`,
            );
        });

        it('should deliver sns.publish() to this topic asynchronously (drain)', async () => {
            const id = await new AWSSNSService().publish('', 'hello', { n: 1 });
            expect(id).toMatch(MOCK_ID);
            expect(heard).toEqual([]); //* async: not yet delivered.
            expect($localTransport.deliveries()).toEqual([]);
            const list = await $localTransport.drain();
            expect(list).toEqual([{ kind: 'sns', target: 'loop-topic', messageId: id, result: undefined }]);
            expect(heard).toEqual([{ type: 'SNS', param: { subject: 'hello' }, body: { n: 1 } }]);
            expect(logs).toEqual([`[MOCK] deliver kind=sns target=loop-topic message=${id}`]);
            //* drain clears.
            expect(await $localTransport.drain()).toEqual([]);
            expect(sdk.clients).toEqual([]);
        });

        it('should deliver to the topic by `sns://self`, an ARN of it, or the env name', async () => {
            const self = selfHost('sns');
            await new AWSSNSService().publish(self, 'a', { n: 1 });
            await new AWSSNSService().publish(`arn:aws:sns:${REGION}:123456789012:loop-topic`, 'b', { n: 2 });
            await new AWSSNSService().publish('MY_SNS_ENDPOINT', 'c', { n: 3 });
            const list = await $localTransport.drain();
            expect(list.map(d => d.target)).toEqual([self, 'loop-topic', 'loop-topic']);
            expect(heard.map(h => h.param.subject)).toEqual(['a', 'b', 'c']);
            expect(sdk.clients).toEqual([]);
        });

        it('should take this service for no target and no env (a local run)', async () => {
            setEnv({ MY_SNS_ENDPOINT: undefined, MY_SQS_ENDPOINT: undefined });
            await new AWSSNSService().publish('', 'a', { n: 1 });
            await new AWSSQSService().sendMessage({ n: 2 });
            const list = await $localTransport.drain();
            expect(list.map(d => [d.kind, d.target])).toEqual([
                ['sns', selfHost('sns')],
                ['sqs', selfHost('sqs')],
            ]);
            //* an explicit other topic is still refused (ex: the error-report topic).
            expect(await new AWSSNSService().publish('lemon-hello-sns', 'x', {}).catch(GETERR)).toEqual(
                '501 NOT SUPPORTED - local transport: lemon-hello-sns is not this service',
            );
            expect(sdk.clients).toEqual([]);
        });

        it('should refuse another topic or queue with 501 (no AWS call, no drop)', async () => {
            const sns = new AWSSNSService();
            expect(await sns.publish('other-topic', 'x', {}).catch(GETERR)).toEqual(
                '501 NOT SUPPORTED - local transport: other-topic is not this service',
            );
            expect(await sns.publish(`arn:aws:sns:${REGION}:123456789012:other-out`, 'x', {}).catch(GETERR)).toEqual(
                '501 NOT SUPPORTED - local transport: other-out is not this service',
            );
            const other = new AWSSQSService(`https://sqs.${REGION}.amazonaws.com/${LOCAL_ACCOUNT_ID}/other-queue`);
            expect(await other.sendMessage({ n: 1 }).catch(GETERR)).toEqual(
                '501 NOT SUPPORTED - local transport: other-queue is not this service',
            );
            expect(await $localTransport.drain()).toEqual([]);
            expect(sdk.clients).toEqual([]);
        });

        it('should deliver sqs.sendMessage() to this queue, and surface batchItemFailures', async () => {
            const sqs = new AWSSQSService(); //* env `MY_SQS_ENDPOINT`
            const id = await sqs.sendMessage({ n: 1 }, { Subject: 'hello', k: 2 });
            expect(id).toMatch(MOCK_ID);
            const list = await $localTransport.drain();
            expect(list).toEqual([
                { kind: 'sqs', target: 'loop-queue', messageId: id, result: { batchItemFailures: [] } },
            ]);
            expect(heard).toEqual([{ type: 'SQS', param: { Subject: 'hello', k: 2 }, body: { n: 1 } }]);
            //* a failing listener → the record is in `batchItemFailures`, and the delivery has an error.
            mode.sqsThrows = true;
            const id2 = await new AWSSQSService(selfHost('sqs')).sendMessage({ n: 2 });
            const [d2] = await $localTransport.drain();
            expect(d2.result).toEqual({ batchItemFailures: [{ itemIdentifier: id2 }] });
            expect(d2.error).toEqual(`500 BATCH ITEM FAILURES - ${id2}`);
            expect(sdk.clients).toEqual([]);
        });

        it('should deliver notify() through the SNS protocol path (no account needed)', async () => {
            const id = await proto.notify(recvParam('n1', { n: 1 }));
            expect(id).toMatch(MOCK_ID);
            expect(served).toEqual([]);
            const list = await $localTransport.drain();
            expect(list).toEqual([{ kind: 'sns', target: selfHost('sns'), messageId: id, result: undefined }]);
            expect(served).toEqual([{ mode: 'POST', id: 'n1', cmd: 'recv', body: { n: 1 }, depth: 1 }]);
            expect(heard).toEqual([]); //* the protocol path, not the listeners.
            expect(sdk.clients).toEqual([]);
        });

        it('should deliver enqueue() through the SQS protocol path', async () => {
            const id = await proto.enqueue(recvParam('q1', { n: 2 }), undefined, 0);
            const list = await $localTransport.drain();
            expect(list).toEqual([
                { kind: 'sqs', target: selfHost('sqs'), messageId: id, result: { batchItemFailures: [] } },
            ]);
            expect(served).toEqual([{ mode: 'POST', id: 'q1', cmd: 'recv', body: { n: 2 }, depth: 1 }]);
            expect(sdk.clients).toEqual([]);
        });

        it('should run execute() synchronously through the web handler', async () => {
            const res = await proto.execute(recvParam('e1', { n: 3 }));
            expect(res).toEqual({ id: 'e1', echo: { n: 3 } });
            expect(served).toEqual([{ mode: 'POST', id: 'e1', cmd: 'recv', body: { n: 3 }, depth: 1 }]);
            const list = await $localTransport.drain();
            expect(list).toEqual([
                { kind: 'protocol', target: selfHost('web'), messageId: expect.stringMatching(MOCK_ID), result: res },
            ]);
            expect(logs).toEqual([
                `[MOCK] deliver kind=protocol target=${selfHost('web')} message=${list[0].messageId}`,
            ]);
            //* a failure of the target is thrown like `invokeLambda()` (404 → status error).
            expect(await proto.execute({ ...recvParam('e2', {}), cmd: 'nope' }).catch(GETERR)).toMatch(
                /^404 NOT FOUND/,
            );
            expect(sdk.clients).toEqual([]);
        });

        it('should refuse execute/notify/enqueue to another service with 501', async () => {
            const other = recvParam('x', {}, 'lemon-other-api');
            const host = (type: string) => new URL(proto.asProtocolURI(type as any, other)).host;
            expect(await proto.execute(other).catch(GETERR)).toEqual(
                `501 NOT SUPPORTED - local transport: ${host('web')} is not this service`,
            );
            expect(await proto.notify(other).catch(GETERR)).toEqual(
                `501 NOT SUPPORTED - local transport: ${host('sns')} is not this service`,
            );
            expect(await proto.enqueue(other).catch(GETERR)).toEqual(
                `501 NOT SUPPORTED - local transport: ${host('sqs')} is not this service`,
            );
            expect(served).toEqual([]);
            expect(sdk.clients).toEqual([]);
        });

        it('should deliver broadcast() to this topic, and refuse another', async () => {
            const id = await proto.broadcast({ accountId: '', requestId: 'r-1' }, 'loop-topic', { n: 7 });
            const list = await $localTransport.drain();
            expect(list.map(d => [d.kind, d.target, d.messageId])).toEqual([['sns', 'loop-topic', id]]);
            expect(heard).toEqual([
                { type: 'SNS', param: { subject: 'x-protocol-service/broadcast', requestId: 'r-1' }, body: { n: 7 } },
            ]);
            expect(await proto.broadcast({}, 'lemon-hello-out', {}).catch(GETERR)).toEqual(
                '501 NOT SUPPORTED - local transport: lemon-hello-out is not this service',
            );
            expect(sdk.clients).toEqual([]);
        });

        it('should stop an endless re-publish at the depth cap (508, one cap line)', async () => {
            await new AWSSNSService().publish('', 'loop-forever', { n: 0 });
            const list = await $localTransport.drain();
            const ok = list.filter(d => !d.error);
            const refused = list.filter(d => d.error);
            expect(ok.length).toEqual(LOCAL_TRANSPORT_CAP.depth);
            expect(refused).toEqual([
                { kind: 'sns', target: 'loop-topic', messageId: '', error: '508 LOOP DETECTED - local transport' },
            ]);
            expect(heard.length).toEqual(LOCAL_TRANSPORT_CAP.depth);
            expect(logs.filter(l => l.startsWith('[MOCK] cap'))).toEqual([
                `[MOCK] cap kind=sns target=loop-topic deliveries=${LOCAL_TRANSPORT_CAP.depth} depth=${
                    LOCAL_TRANSPORT_CAP.depth + 1
                }`,
            ]);
            expect(sdk.clients).toEqual([]);
        });

        it('should refuse a fan-out over the delivery cap within one burst (508, one cap line)', async () => {
            const N = LOCAL_TRANSPORT_CAP.deliveries + 10;
            await new AWSSNSService().publish('', 'fan-out', { n: N });
            const list = await $localTransport.drain();
            //* the parent delivery counts as 1 of the cap.
            const refused = list.filter(d => d.error);
            expect(list.filter(d => !d.error).length).toEqual(LOCAL_TRANSPORT_CAP.deliveries);
            expect(refused.length).toEqual(N - (LOCAL_TRANSPORT_CAP.deliveries - 1));
            expect(refused.every(d => d.error === '508 LOOP DETECTED - local transport')).toBe(true);
            expect(logs.filter(l => l.startsWith('[MOCK] cap')).length).toEqual(1);
            expect(sdk.clients).toEqual([]);
        });

        it('should reset the burst count when idle (no drain), and keep the last 100 deliveries', async () => {
            const sns = new AWSSNSService();
            //* wait until the delivery of this message id has finished (idle: nothing pending).
            const idle = async (id: string) => {
                while (!$localTransport.deliveries().some(d => d.messageId === id))
                    await new Promise(r => setTimeout(r, 1));
            };
            const total = 2 * LOCAL_TRANSPORT_CAP.deliveries + 20; // 120 sends, no drain() in between.
            const ids: string[] = [];
            for (let i = 0; i < total; i++) {
                const id = await sns.publish('', 'steady', { n: i });
                expect(id).toMatch(MOCK_ID);
                await idle(id);
                ids.push(id);
            }
            expect(heard.length).toEqual(total);
            expect(logs.filter(l => l.startsWith('[MOCK] cap'))).toEqual([]);
            //* only the last 100 finished deliveries are kept (the oldest are dropped).
            const kept = $localTransport.deliveries();
            expect(kept.length).toEqual(LOCAL_TRANSPORT_CAP.kept);
            expect(kept.map(d => d.messageId)).toEqual(ids.slice(-LOCAL_TRANSPORT_CAP.kept));
            expect(kept.filter(d => d.error)).toEqual([]);
            //* a re-publishing listener still hits the depth cap.
            await sns.publish('', 'loop-forever', { n: 0 });
            const list = await $localTransport.drain();
            expect(list.filter(d => d.error).map(d => d.error)).toEqual(['508 LOOP DETECTED - local transport']);
        });
    });
});
