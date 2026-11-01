/**
 * `local-transport.ts`
 * - opt-in local transport (mock delivery): in local mode, `sns.publish()`, `sqs.sendMessage()` and the protocol
 *   `execute/notify/enqueue/broadcast` deliver to this service in-process, with no AWS SDK client.
 * - on only if env `LOCAL_TRANSPORT=mock` and `$U.isLocalMode()` (`LOCAL_MODE=1`, no `AWS_LAMBDA_FUNCTION_NAME`).
 *   in Lambda the env is ignored (one warn line). without the env nothing changes.
 * - self only: a target that is not this service throws `501 NOT SUPPORTED` (no AWS call, no silent drop).
 *   no target and no env `MY_SNS_ENDPOINT`/`MY_SQS_ENDPOINT` (a local run) = this service's topic/queue.
 * - fidelity: each delivery is a real Lambda event record, run by the engine's `LambdaHandler.handle()`.
 *   SNS/SQS kinds are async (`setImmediate`), `execute` is sync. `drain()` waits for all and returns them.
 * - loop guard: over `LOCAL_TRANSPORT_CAP` (deliveries in one burst, or chain depth) → `508 LOOP DETECTED`.
 *   a burst ends at `drain()` or when nothing is pending (idle), so a long-running server never stays capped.
 * - keeps only the last `LOCAL_TRANSPORT_CAP.kept` (100) finished deliveries (the oldest are dropped).
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version.
 * @date        2026-10-30 the burst count resets when idle (not only at `drain()`); keep the last 100 deliveries.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { createHash, randomUUID } from 'crypto';
import URL from 'url';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { InvokeCommandOutput } from '@aws-sdk/client-lambda';
import { $engine, $U, _inf } from '../../engine/';
import { GETERR } from '../../common/test-helper';
import type { ProtocolParam } from '../core-services';
import type { MyProtocolService } from './protocol-service';
//* lazy namespace: this file is in the engine closure (via `aws-sns-service`), so nothing runs `$U` at load.
const NS = (() => {
    let ns: string | undefined;
    return () => (ns ??= $U.NS('MOCK', 'magenta'));
})();

/**
 * env name of the local transport (`mock` = on, in local mode only).
 */
export const LOCAL_TRANSPORT = 'LOCAL_TRANSPORT';

/**
 * placeholder account of the local ARNs, URLs and the fake Lambda context.
 */
export const LOCAL_ACCOUNT_ID = '000000000000';

/**
 * loop guard: max deliveries in one burst (until `drain()` or idle), and max chain depth (a send from a delivery is +1).
 * - `kept`: max finished deliveries kept for `drain()`/`deliveries()` (the oldest are dropped).
 */
export const LOCAL_TRANSPORT_CAP = { deliveries: 50, depth: 8, kept: 100 };

/**
 * kind of a local delivery (`notify` = sns, `enqueue` = sqs, `execute` = protocol).
 */
export type LocalDeliveryKind = 'sns' | 'sqs' | 'protocol';

/**
 * one delivery of the local transport.
 */
export interface LocalDelivery {
    /** transport of the delivery */
    kind: LocalDeliveryKind;
    /** topic, queue or function name (this service) */
    target: string;
    /** `mock-<uuid>` ('' if refused by the loop guard) */
    messageId: string;
    /** result of `LambdaHandler.handle()` (sqs: `{ batchItemFailures }`; protocol: the parsed body) */
    result?: any;
    /** error message (thrown, refused, SQS `batchItemFailures`, or the SNS failure result) */
    error?: string;
}

/**
 * a message attribute as the SDK input (`DataType`, `StringValue`).
 */
interface LocalAttributeValue {
    DataType?: string;
    StringValue?: string;
}

/**
 * the log writer (one `_inf` line); an object, so a spec can spy on `inf`.
 */
export const transportLog = {
    inf: (line: string): void => _inf(NS(), line),
};

//* chain of the current delivery: `depth` (1 = sent by a client request), `async` (inside an SNS/SQS delivery).
const $chain = new AsyncLocalStorage<{ depth: number; async: boolean }>();

//* process-wide state: pending deliveries, running sync `execute()`s, finished deliveries, count in this burst,
//* cap logged, warned keys.
const $state = {
    pending: new Set<Promise<void>>(),
    running: 0,
    list: [] as LocalDelivery[],
    count: 0,
    capped: false,
    warned: new Set<string>(),
};

//* keep one finished delivery (the last `LOCAL_TRANSPORT_CAP.kept` only).
const record = (delivery: LocalDelivery) => {
    $state.list.push(delivery);
    if ($state.list.length > LOCAL_TRANSPORT_CAP.kept)
        $state.list.splice(0, $state.list.length - LOCAL_TRANSPORT_CAP.kept);
};

//* end of a burst: nothing pending and no sync `execute()` running → reset the count and the cap line.
const resetIfIdle = () => {
    if ($state.pending.size || $state.running) return;
    $state.count = 0;
    $state.capped = false;
};

//* the configured region (env `REGION`, as the SNS service).
const region = (): string => `${$engine.environ('REGION', 'ap-northeast-2') || 'ap-northeast-2'}`;

//* log one warn line per reason (never twice in a process).
const warnOnce = (key: string, line: string) => {
    if ($state.warned.has(key)) return;
    $state.warned.add(key);
    transportLog.inf(line);
};

/**
 * true if the local transport is on: env `LOCAL_TRANSPORT=mock` and local mode (never in Lambda).
 * - read from `process.env` on every call. an ignored value logs one warn line.
 */
export const isActive = (): boolean => {
    const val = `${process.env[LOCAL_TRANSPORT] ?? ''}`;
    if (!val) return false;
    //* the reason to ignore ('' = active).
    const why =
        val !== 'mock'
            ? 'unknown value'
            : process.env.AWS_LAMBDA_FUNCTION_NAME
            ? 'in Lambda'
            : !$U.isLocalMode()
            ? 'not local mode'
            : '';
    if (!why) return true;
    warnOnce(`${val}/${why}`, `WARN! env.${LOCAL_TRANSPORT}[${val.substring(0, 32)}] is ignored - ${why}`);
    return false;
};

//* topic name of an SNS target: `arn:aws:sns:<region>:<account>:<topic>` → `<topic>`, a name as is.
export const topicOf = (target: string): string => `${target || ''}`.split(':').pop() || '';

//* queue name of an SQS endpoint: `https://sqs.<region>.amazonaws.com/<account>/<queue>` → `<queue>`, a name as is.
export const queueOf = (endpoint: string): string =>
    `${endpoint || ''}`
        .split('/')
        .filter(_ => !!_)
        .pop() || '';

//* host of a protocol uri like `sns://<acct>@<host>/<path>#<ver>`.
const hostOf = (uri: string): string => `${URL.parse(uri).hostname || ''}`;

/**
 * host of this service by protocol (`sns://self`, `sqs://self`, `web://self`).
 *
 * @param type      protocol type.
 * @param service   (optional) the protocol service (default: the engine's).
 * @param config    (optional) its config service.
 */
export const selfHostOf = async (
    type: 'sns' | 'sqs' | 'web',
    service?: MyProtocolService,
    config?: MyProtocolService['config'],
): Promise<string> => {
    //* lazy: the protocol module loads the AWS services (no import cycle at load).
    const svc = service ?? ((await import('./index')).default.service as MyProtocolService);
    return hostOf(svc.asProtocolURI(type, { service: 'self' } as ProtocolParam, config));
};

//* throw `501` if the name is not one of this service's names.
const assertSelf = (name: string, selves: string[]) => {
    if (!name || !selves.filter(_ => !!_).includes(name))
        throw new Error(`501 NOT SUPPORTED - local transport: ${name} is not this service`);
};

//* loop guard: admit one delivery (returns its depth), or refuse with `508` (one `[MOCK] cap` line until `drain()`).
const admit = (kind: LocalDeliveryKind, target: string): number => {
    const depth = ($chain.getStore()?.depth ?? 0) + 1;
    if ($state.count >= LOCAL_TRANSPORT_CAP.deliveries || depth > LOCAL_TRANSPORT_CAP.depth) {
        if (!$state.capped) {
            $state.capped = true;
            transportLog.inf(`[MOCK] cap kind=${kind} target=${target} deliveries=${$state.count} depth=${depth}`);
        }
        const error = `508 LOOP DETECTED - local transport`;
        record({ kind, target, messageId: '', error });
        throw new Error(error);
    }
    $state.count++;
    return depth;
};

//* a fake Lambda context of this service (placeholder account).
const asContext = (name: string): Context => ({
    callbackWaitsForEmptyEventLoop: true,
    functionName: name,
    functionVersion: '$LATEST',
    invokedFunctionArn: `arn:aws:lambda:${region()}:${LOCAL_ACCOUNT_ID}:function:${name}`,
    memoryLimitInMB: '1024',
    awsRequestId: randomUUID(),
    logGroupName: `/aws/lambda/${name}`,
    logStreamName: 'local-transport',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
});

//* run one event through the engine's `LambdaHandler.handle()` (never rejects, as in Lambda).
const handleEvent = async (event: any): Promise<any> => {
    //* lazy: the lambda module imports the protocol and AWS modules (no import cycle at load).
    const $lambda = (await import('../lambda')).default;
    const context = asContext(await selfHostOf('web'));
    return $lambda.lambda.handle(event, context);
};

//* the error of a finished SNS/SQS delivery ('' if none): SQS `batchItemFailures`, or the failure result `{ error }`.
const errorOf = (result: any): string => {
    const failures: any[] = Array.isArray(result?.batchItemFailures) ? result.batchItemFailures : [];
    if (failures.length) return `500 BATCH ITEM FAILURES - ${failures.map(_ => _?.itemIdentifier).join(',')}`;
    if (result && typeof result === 'object' && typeof result.error === 'string') return result.error;
    return '';
};

//* schedule one async delivery (`setImmediate`), tracked until `drain()`.
const deliverAsync = (kind: LocalDeliveryKind, target: string, depth: number, messageId: string, event: any) => {
    transportLog.inf(`[MOCK] deliver kind=${kind} target=${target} message=${messageId}`);
    const job = new Promise<void>(resolve =>
        setImmediate(() => {
            $chain
                .run({ depth, async: true }, () => handleEvent(event))
                .then(result => {
                    const error = errorOf(result);
                    record({ kind, target, messageId, result, ...(error ? { error } : {}) });
                })
                .catch(e => record({ kind, target, messageId, error: GETERR(e) }))
                .finally(() => resolve());
        }),
    );
    $state.pending.add(job);
    //* done: forget it, and end the burst if this was the last one.
    job.then(() => {
        $state.pending.delete(job);
        resetIfIdle();
    });
};

/**
 * SNS publish input (the fields a Lambda record needs).
 */
export interface LocalSnsMessage {
    Subject?: string;
    Message: string;
    MessageAttributes?: Record<string, LocalAttributeValue>;
}

/**
 * deliver an SNS message to this service: a `aws:sns` record → `LambdaHandler.handle()` (async).
 *
 * @param target    topic name or ARN.
 * @param msg       subject, message (the `default` string), attributes.
 * @param selfHost  (optional) `sns://self` host (default: by the engine's protocol service).
 * @returns         the message id `mock-<uuid>`.
 */
export const localSns = async (target: string, msg: LocalSnsMessage, selfHost?: string): Promise<string> => {
    const self = selfHost ?? (await selfHostOf('sns'));
    //* '' (no target, no env `MY_SNS_ENDPOINT`) → this service's topic, as the Lambda deploy sets the env.
    const topic = topicOf(target) || self;
    assertSelf(topic, [topicOf(`${$engine.environ('MY_SNS_ENDPOINT', '') || ''}`), self]);
    const depth = admit('sns', topic);
    const messageId = `mock-${randomUUID()}`;
    const TopicArn = `arn:aws:sns:${region()}:${LOCAL_ACCOUNT_ID}:${topic}`;
    //* attributes as the Lambda record has them (`Type`, `Value`).
    const MessageAttributes = Object.entries(msg.MessageAttributes || {}).reduce(
        (M: any, [k, v]) => ({ ...M, [k]: { Type: v.DataType, Value: v.StringValue } }),
        {},
    );
    const record = {
        EventSource: 'aws:sns',
        EventVersion: '1.0',
        EventSubscriptionArn: `${TopicArn}:${randomUUID()}`,
        Sns: {
            Type: 'Notification',
            MessageId: messageId,
            TopicArn,
            Subject: msg.Subject ?? null,
            Message: msg.Message,
            Timestamp: new Date().toISOString(),
            MessageAttributes,
        },
    };
    deliverAsync('sns', topic, depth, messageId, { Records: [record] });
    return messageId;
};

/**
 * SQS send input (the fields a Lambda record needs).
 */
export interface LocalSqsMessage {
    MessageBody?: string;
    MessageAttributes?: Record<string, LocalAttributeValue>;
}

/**
 * deliver an SQS message to this service: a `aws:sqs` record → `LambdaHandler.handle()` (async, no delay).
 *
 * @param endpoint  queue url or name.
 * @param msg       body and attributes.
 * @param selfHost  (optional) `sqs://self` host (default: by the engine's protocol service).
 * @returns         the message id `mock-<uuid>`.
 */
export const localSqs = async (endpoint: string, msg: LocalSqsMessage, selfHost?: string): Promise<string> => {
    const self = selfHost ?? (await selfHostOf('sqs'));
    //* '' (no endpoint, no env `MY_SQS_ENDPOINT`) → this service's queue, as the Lambda deploy sets the env.
    const queue = queueOf(endpoint) || self;
    assertSelf(queue, [queueOf(`${$engine.environ('MY_SQS_ENDPOINT', '') || ''}`), self]);
    const depth = admit('sqs', queue);
    const messageId = `mock-${randomUUID()}`;
    const now = `${Date.now()}`;
    //* attributes as the Lambda record has them (`dataType`, `stringValue`).
    const messageAttributes = Object.entries(msg.MessageAttributes || {}).reduce(
        (M: any, [k, v]) => ({
            ...M,
            [k]: { dataType: v.DataType, stringValue: v.StringValue, stringListValues: [], binaryListValues: [] },
        }),
        {},
    );
    const record = {
        messageId,
        receiptHandle: `mock-${randomUUID()}`,
        body: msg.MessageBody,
        attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: now,
            SenderId: LOCAL_ACCOUNT_ID,
            ApproximateFirstReceiveTimestamp: now,
        },
        messageAttributes,
        md5OfBody: createHash('md5')
            .update(`${msg.MessageBody ?? ''}`)
            .digest('hex'),
        eventSource: 'aws:sqs',
        eventSourceARN: `arn:aws:sqs:${region()}:${LOCAL_ACCOUNT_ID}:${queue}`,
        awsRegion: region(),
    };
    deliverAsync('sqs', queue, depth, messageId, { Records: [record] });
    return messageId;
};

/**
 * run a protocol `execute()` on this service: the web event → `LambdaHandler.handle()` (sync, like a sync invoke).
 * - the result is parsed like `invokeLambda()` (a non-2xx throws). `useEvent` → async, returns the 202 output.
 *
 * @param fn        function name (host of the `web://` uri).
 * @param event     the web event of `WEBProtocolTransformer`.
 * @param selfHost  `web://self` host of the calling protocol service.
 * @param options   `param` for logging, `useEvent` for an async invoke.
 */
export const localWeb = async <T = any>(
    fn: string,
    event: APIGatewayProxyEvent,
    selfHost: string,
    options?: { param?: ProtocolParam; useEvent?: boolean },
): Promise<T> => {
    assertSelf(fn, [selfHost]);
    const depth = admit('protocol', fn);
    //* lazy: `aws-lambda-helper` runs `$U` at load (this file is in the engine closure).
    const { asInvokeResult } = await import('./aws-lambda-helper');
    const messageId = `mock-${randomUUID()}`;
    //* async invoke (`InvocationType: Event`): deliver later, return the 202 output.
    if (options?.useEvent) {
        deliverAsync('protocol', fn, depth, messageId, event);
        return asInvokeResult(fn, { StatusCode: 202 } as InvokeCommandOutput, { ...options, useEvent: true });
    }
    transportLog.inf(`[MOCK] deliver kind=protocol target=${fn} message=${messageId}`);
    $state.running++;
    try {
        const result = await $chain.run({ depth, async: false }, () => handleEvent(event));
        const Payload = new TextEncoder().encode(JSON.stringify(result ?? {}));
        const body = await asInvokeResult(fn, { StatusCode: 200, Payload } as InvokeCommandOutput, options);
        record({ kind: 'protocol', target: fn, messageId, result: body });
        return body as T;
    } catch (e) {
        record({ kind: 'protocol', target: fn, messageId, error: GETERR(e) });
        throw e;
    } finally {
        //* the sync call is over: end the burst if nothing else is pending.
        $state.running--;
        resetIfIdle();
    }
};

/**
 * wait for every pending delivery (incl. the ones they send), then return the finished list and clear it.
 * - resets the loop-guard count (idle also does). process-wide: it takes every delivery, not only the caller's.
 * - must not be called inside an SNS/SQS delivery (it would wait for itself).
 */
export const drain = async (): Promise<LocalDelivery[]> => {
    if ($chain.getStore()?.async) throw new Error(`500 INVALID STATE - drain() inside a delivery (local transport)`);
    while ($state.pending.size) await Promise.all([...$state.pending]);
    const list = $state.list.splice(0);
    $state.count = 0;
    $state.capped = false;
    return list;
};

/**
 * the finished deliveries since the last `drain()`, the last 100 only (a copy; it does not wait or clear).
 */
export const deliveries = (): LocalDelivery[] => [...$state.list];

/**
 * the public API of the local transport (exported from the package root).
 */
export const $localTransport = {
    /** true if `LOCAL_TRANSPORT=mock` and local mode */
    isActive,
    /** wait for all pending deliveries, return them, and clear */
    drain,
    /** the finished deliveries since the last `drain()` */
    deliveries,
};
