/**
 * `lambda-channel.spec.ts`
 * - v5 B14 D1: `context.channel` is set once at the entry (web host/host-less, local mode, protocol receive, ALB),
 *   and `context.trace` starts at hop 0 for an entry without a relay.
 * - no network: the engine is not initialized, env names come from `process.env` (restored after each test).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B14)
 * @date        2026-10-30 v5 B14: a safe trace id for the local express requestId.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, it, afterEach, beforeEach } from 'vitest';
import { NextContext, NextDecoder, NextHandler } from 'lemon-model';
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaWEBHandler } from './lambda-web-handler';
import { LambdaSNSHandler } from './lambda-sns-handler';
import { LambdaSQSHandler } from './lambda-sqs-handler';
import { LambdaALBHandler } from './lambda-alb-handler';
import { WEBProtocolTransformer, SNSProtocolTransformer, SQSProtocolTransformer } from '../protocol/protocol-service';
import { HEADER_LEMON_RELAY } from '../protocol/protocol-relay';

//* env names this spec toggles.
const ENV_NAMES = ['LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME', 'PROTOCOL_LEGACY_CONTEXT', 'PROTOCOL_LEGACY_ACCEPT'];
const $envKeep = ENV_NAMES.reduce<{ [key: string]: string }>((M, k) => ({ ...M, [k]: process.env[k] }), {});
//* set or delete an env name.
const setEnv = (name: string, val?: string) => {
    if (val === undefined) delete process.env[name];
    else process.env[name] = val;
};
//* local mode on (the express harness): `LOCAL_MODE=1` and not Lambda.
const localMode = () => {
    setEnv('LOCAL_MODE', '1');
    setEnv('AWS_LAMBDA_FUNCTION_NAME');
};

//* a sample API Gateway event (with `Host`, and `requestContext.domainName`).
const apiEvent = (): any => loadJsonSync('data/samples/events/sample.event.web.json');
//* the same event without a `host` key (a direct invoke); `domainName` is kept.
const hostless = (): any => {
    const event = apiEvent();
    Object.keys(event.headers)
        .filter(key => key.toLowerCase() === 'host')
        .forEach(key => delete event.headers[key]);
    return event;
};

//* the caller of the protocol cases.
const caller: NextContext = {
    accountId: '123456789012',
    requestId: 'req-caller-1',
    identity: { sid: 'S', roles: ['user'] },
    source: 'api://123456789012@lemon-hello-api-dev/hello/1#5.0.5',
};
//* the protocol param to `GET /hello/!`.
const paramOf = (context: NextContext): any => ({
    service: 'self',
    type: 'hello',
    mode: 'GET',
    id: '!',
    cmd: '',
    context,
});

//* lambda with web, sns, sqs handlers; `got` keeps the contexts the handler received.
const instance = () => {
    const got: NextContext[] = [];
    const decoder: NextDecoder = mode => {
        const dump: NextHandler = async (id, param, body, context) => {
            got.push(context);
            return { id };
        };
        return mode === 'GET' ? dump : null;
    };
    const lambda = new (class extends LambdaHandler {})();
    const web = new LambdaWEBHandler(lambda, true);
    web.setHandler('hello', decoder);
    new LambdaSNSHandler(lambda, true);
    new LambdaSQSHandler(lambda, true);
    return { lambda, web, got };
};

describe('context.channel (B14 D1)', () => {
    beforeEach(() => ENV_NAMES.forEach(k => setEnv(k)));
    //* restore the env.
    afterEach(() => Object.entries($envKeep).forEach(([key, val]) => setEnv(key, val)));

    //* web with `Host` → external; the trace starts at hop 0 with the requestId.
    it('should set external for a web request with Host', async () => {
        const { web } = instance();
        const $ctx = await web.packContext(apiEvent(), null);
        expect2(() => $ctx, 'channel,trace,domain').toEqual({
            channel: 'external',
            trace: { tid: 'd8485d00-5624-4094-9a93-ce09c351ee5b', hop: 0 },
            domain: 'na12ibnzu4.execute-api.ap-northeast-2.amazonaws.com',
        });
        //* a forged relay with `Host` is ignored like `x-protocol-context`.
        const forged = apiEvent();
        forged.headers[HEADER_LEMON_RELAY] = new WEBProtocolTransformer().transformToEvent(
            'api://self/hello/!',
            paramOf({ ...caller, identity: { sid: 'X', roles: ['admin'] } }),
        ).headers[HEADER_LEMON_RELAY];
        const $ctx2 = await web.packContext(forged, null);
        expect2(() => $ctx2, 'channel').toEqual({ channel: 'external' });
        expect2(() => $ctx2.identity?.roles).toEqual(undefined);
    });

    //* web without `Host` (no protocol header) → internal, even with `requestContext.domainName` (domain kept).
    it('should set internal for a host-less web event with domainName', async () => {
        const { web } = instance();
        const $ctx = await web.packContext(hostless(), null);
        expect2(() => $ctx, 'channel,trace,domain').toEqual({
            channel: 'internal',
            trace: { tid: 'd8485d00-5624-4094-9a93-ce09c351ee5b', hop: 0 },
            domain: 'na12ibnzu4.execute-api.ap-northeast-2.amazonaws.com',
        });
    });

    //* local mode → local (wins over the Host rule); a protocol receive stays internal.
    it('should set local in local mode', async () => {
        localMode();
        const { web, lambda, got } = instance();
        expect2(await web.packContext(apiEvent(), null), 'channel').toEqual({ channel: 'local' });
        expect2(await web.packContext(hostless(), null), 'channel').toEqual({ channel: 'local' });
        //* a relay (protocol receive) is internal also in local mode (the local transport = the Lambda path).
        const event = new WEBProtocolTransformer().transformToEvent('api://self/hello/!', paramOf(caller));
        expect2(await lambda.handle(event, null), 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[0], 'channel').toEqual({ channel: 'internal' });
    });

    //* local express: the requestId is a ms time string (`YYYY-MM-DD hh:mm:ss.SSS`) → the trace id is a new uuid.
    it('should use a safe trace id for a local express requestId', async () => {
        localMode();
        const { web } = instance();
        const event = apiEvent();
        event.requestContext.requestId = '2026-10-30 03:32:57.040';
        const $ctx = await web.packContext(event, null);
        expect2(() => $ctx, 'channel,requestId').toEqual({ channel: 'local', requestId: '2026-10-30 03:32:57.040' });
        expect2(() => [/^[\w.:-]{1,128}$/.test($ctx.trace.tid), $ctx.trace.tid === $ctx.requestId]).toEqual([
            true,
            false,
        ]);
        //* two requests in the same ms → two trace ids.
        const $ctx2 = await web.packContext(event, null);
        expect2(() => $ctx2.trace.tid === $ctx.trace.tid).toEqual(false);
    });

    //* protocol receive (web relay, web legacy, SNS, SQS) → internal.
    it('should set internal for a protocol receive', async () => {
        const { lambda, got } = instance();
        //* web relay, then web legacy (v4 caller).
        const relay = new WEBProtocolTransformer().transformToEvent('api://self/hello/!', paramOf(caller));
        expect2(await lambda.handle(relay, null), 'statusCode').toEqual({ statusCode: 200 });
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
        const legacy = new WEBProtocolTransformer().transformToEvent('api://self/hello/!', paramOf(caller));
        delete legacy.headers[HEADER_LEMON_RELAY];
        expect2(await lambda.handle(legacy, null), 'statusCode').toEqual({ statusCode: 200 });
        setEnv('PROTOCOL_LEGACY_CONTEXT');
        //* SNS and SQS.
        const $sns = new SNSProtocolTransformer(null).transformToEvent('sns://self/hello/!', paramOf(caller));
        const Sns = {
            MessageId: 'm-sns',
            Subject: $sns.Subject,
            Message: JSON.parse($sns.Message).default,
            MessageAttributes: { requestId: { Type: 'String', Value: 'req-caller-1' } },
        };
        await lambda.handle({ Records: [{ EventSource: 'aws:sns', Sns }] }, null);
        const $sqs = new SQSProtocolTransformer(null).transformToEvent('sqs://self/hello/!', paramOf(caller));
        const messageAttributes = {
            Subject: { dataType: 'String', stringValue: 'x-protocol-service' },
            requestId: { dataType: 'String', stringValue: 'req-caller-1' },
        };
        const sqs = { eventSource: 'aws:sqs', messageId: 'm-sqs', body: $sqs.MessageBody, messageAttributes };
        expect2(await lambda.handle({ Records: [sqs] }, null)).toEqual({ batchItemFailures: [] });
        expect2(() => got.map(c => c.channel)).toEqual(['internal', 'internal', 'internal', 'internal']);
        expect2(() => got.map(c => c.trace?.hop)).toEqual([1, 0, 1, 1]);
    });

    //* ALB (always with `Host`) → external; local mode → local.
    it('should set the channel of an ALB request', async () => {
        const alb = new LambdaALBHandler(new LambdaHandler(), true);
        const event = loadJsonSync('data/samples/events/sample.event.alb.json');
        expect2(await alb.packContext(event, null), 'channel').toEqual({ channel: 'external' });
        localMode();
        expect2(await alb.packContext(event, null), 'channel').toEqual({ channel: 'local' });
    });
});
