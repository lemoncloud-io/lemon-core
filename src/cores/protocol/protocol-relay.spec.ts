/**
 * `protocol-relay.spec.ts`
 * - v5 B14: relay envelope (`x-lemon-relay`, `r1.<base64url(JSON)>`), hop cap, trace, and the legacy
 *   `x-protocol-context` modes — sender (web/SNS/SQS transformers) to receiver (web/SNS/SQS handlers).
 * - no network: the engine is not initialized, env names come from `process.env` (restored after each test).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B14)
 * @date        2026-10-30 v5 B14: a safe trace id (local express requestId), the same-service callback hop.
 * @date        2026-10-30 v5 B15: `cid`/`aid` cross a hop, `TRACE … cross=1` (B15 T-08..T-10).
 * @date        2026-11-04 v5 B49 (#1194, D115): `ua`/`ip`/`dom` (request origin) and `path` (call path) cross a hop.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, it, afterEach, beforeEach } from 'vitest';
import { $engine, $U } from '../../engine/';
import { NextContext, NextDecoder, NextHandler } from 'lemon-model';
import { expect2, GETERR, keysOf, expectKeys } from '../../common/test-helper'; //* v5 #1194: key-presence helpers.
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from '../lambda/lambda-handler';
import { LambdaWEBHandler } from '../lambda/lambda-web-handler';
import { LambdaSQSHandler } from '../lambda/lambda-sqs-handler';
import { LambdaSNSHandler } from '../lambda/lambda-sns-handler';
import {
    MyProtocolService,
    WEBProtocolTransformer,
    SNSProtocolTransformer,
    SQSProtocolTransformer,
} from './protocol-service';
import { signContext, resetProtocolSign, HEADER_PROTOCOL_SIGNATURE, HEADER_PROTOCOL_CONTEXT } from './protocol-sign';
import {
    HEADER_LEMON_RELAY,
    RELAY_MAX_BYTES,
    buildRelay,
    encodeRelay,
    decodeRelay,
    asRelayContext,
    readLegacySend,
    readLegacyAccept,
    readMaxHop,
    traceLine,
    entryTrace,
    isCrossCloud,
    nextHopContext,
    RELAY_MAX_UA,
} from './protocol-relay';

//* a test-only key (not a secret).
const KEY = 'unit-test-sign-key';

//* env names this spec toggles.
const ENV_NAMES = [
    'PROTOCOL_SIGN_KEY',
    'PROTOCOL_VERIFY',
    'PROTOCOL_LEGACY_CONTEXT',
    'PROTOCOL_LEGACY_ACCEPT',
    'PROTOCOL_MAX_HOP',
    'LOCAL_MODE',
    'AWS_LAMBDA_FUNCTION_NAME',
];
const $envKeep = ENV_NAMES.reduce<{ [key: string]: string }>((M, k) => ({ ...M, [k]: process.env[k] }), {});
//* set or delete an env name.
const setEnv = (name: string, val?: string) => {
    if (val === undefined) delete process.env[name];
    else process.env[name] = val;
};

//* the caller: an external entry context with every field a request can carry (placeholder values only).
const caller: NextContext = {
    identity: {
        sid: 'S1',
        uid: 'U1',
        gid: 'G1',
        roles: ['user', 'admin'],
        identityId: 'ap-northeast-2:identity-dummy',
        lang: 'ko',
        meta: '{"token":"meta-dummy"}',
        accessKey: 'ACCESS-KEY-DUMMY',
        apiKey: 'API-KEY-DUMMY',
        identityPoolId: 'ap-northeast-2:pool-dummy',
        identityProvider: 'oauth.example.com,oauth.example.com:ap-northeast-2:pool-dummy:kakao_00000',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
    } as any,
    source: 'api://123456789012@lemon-hello-api-dev/hello/a_1/run#5.0.5',
    clientIp: '203.0.113.10',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
    requestId: 'req-caller-1',
    accountId: '123456789012',
    domain: 'api.example.com',
    cookie: { session: 'COOKIE-DUMMY' },
    authorization: 'Bearer AUTHORIZATION-DUMMY',
    referer: 'https://www.example.com/page',
    origin: 'https://www.example.com',
    channel: 'external',
    trace: { tid: 'req-caller-1', hop: 0 },
};
//* values that must never cross a hop (v5 B49 #1194: `clientIp`/`domain` do now — the request origin).
const SECRETS = [
    'meta-dummy',
    'ACCESS-KEY-DUMMY',
    'API-KEY-DUMMY',
    'COOKIE-DUMMY',
    'AUTHORIZATION-DUMMY',
    'www.example.com',
    'pool-dummy',
];
//* v5 B49 (#1194): the request origin of the caller that crosses a hop (as the receiver context has it).
const ORIGIN = { userAgent: caller.userAgent, clientIp: '203.0.113.10', domain: 'api.example.com' };
//* v5 B49 (#1194): the call path of the first hop (the host of `viaOf(caller)`).
const PATH1 = ['lemon-core-dev'];

//* the receiver's own Lambda context (placeholder account).
const lambdaCtx = (): any => ({
    awsRequestId: 'req-recv-1',
    invokedFunctionArn: 'arn:aws:lambda:ap-northeast-2:123456789012:function:lemon-recv-api-dev-lambda',
});

//* the via of the caller (the protocol service's own uri).
const viaOf = (context: NextContext) => new MyProtocolService().myProtocolURI(context);

//* lambda with web, sqs and sns handlers; `got` keeps the contexts the dump handler received.
//* - `service`: the lambda config's service name (a same-service callback runs in-process).
const instance = (service?: string) => {
    const got: NextContext[] = [];
    const decoder: NextDecoder = mode => {
        const dump: NextHandler = async (id, param, body, context) => {
            got.push(context);
            return { id, context };
        };
        return mode === 'GET' || mode === 'POST' ? dump : null;
    };
    const config: any = service ? { getService: () => service } : undefined;
    const lambda = new (class extends LambdaHandler {})(config);
    const web = new LambdaWEBHandler(lambda, true);
    web.setHandler('hello', decoder);
    const sqs = new LambdaSQSHandler(lambda, true);
    //* SNS handler with the last results (the reported messages).
    const sns = new (class extends LambdaSNSHandler {
        public last = () => this.$lastResult;
    })(lambda, true);
    return { lambda, web, sqs, sns, got };
};

//* the protocol param to `GET /hello/!` with a context.
const paramOf = (context: NextContext, body?: any): any => ({
    service: 'self',
    type: 'hello',
    mode: body ? 'POST' : 'GET',
    id: '!',
    cmd: '',
    context,
    body,
});
//* a host-less web event built by the real transformer.
const webEvent = (context: NextContext = caller, body?: any): any =>
    new WEBProtocolTransformer().transformToEvent('api://self/hello/!', paramOf(context, body));
//* SNS record from the real transformer (as the Lambda event has it).
const snsRecord = (context: NextContext = caller, messageId = 'sns-msg-1', callback?: string): any => {
    const $msg = new SNSProtocolTransformer(null).transformToEvent('sns://self/hello/!', paramOf(context), callback);
    const MessageAttributes = Object.entries($msg.MessageAttributes).reduce(
        (M: any, [k, v]) => ({ ...M, [k]: { Type: v.DataType, Value: v.StringValue } }),
        {},
    );
    return {
        EventSource: 'aws:sns',
        Sns: {
            MessageId: messageId,
            TopicArn: $msg.TopicArn,
            Subject: $msg.Subject,
            Message: JSON.parse($msg.Message).default,
            MessageAttributes,
        },
    };
};
//* SQS record from the real transformer (as the Lambda event has it).
const sqsRecord = (context: NextContext = caller, messageId = 'sqs-msg-1', callback?: string): any => {
    const $msg = new SQSProtocolTransformer(null).transformToEvent('sqs://self/hello/!', paramOf(context), callback);
    const messageAttributes = Object.entries($msg.MessageAttributes).reduce(
        (M: any, [k, v]) => ({ ...M, [k]: { dataType: v.DataType, stringValue: v.StringValue } }),
        {},
    );
    return {
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:ap-northeast-2:123456789012:lemon-recv-sqs-dev',
        messageId,
        body: $msg.MessageBody,
        messageAttributes,
    };
};

//* capture log lines (the engine logger is silent in `npm test`).
const captureLog = () => {
    const lines: string[] = [];
    const $console: any = $engine.$console;
    const org = $console.log;
    $console.log = (...args: any[]) => lines.push(args.map(a => `${a}`).join(' '));
    return { lines, restore: () => ($console.log = org) };
};
//* run with captured log lines.
const withLog = async <T>(fn: () => Promise<T>): Promise<{ res: T; lines: string[] }> => {
    const $log = captureLog();
    try {
        const res = await fn();
        return { res, lines: $log.lines };
    } finally {
        $log.restore();
    }
};
//* lines that contain the text.
const linesOf = (lines: string[], text: string) => lines.filter(s => s.includes(text));

//* the receiver context the plan (D2) expects for the caller's relay.
//* v5 B49 (#1194): + the origin (`userAgent`/`clientIp`/`domain`) and `trace.path` (default: the first hop's).
const expected = (
    relay: { hop: number; tid: string; via?: string; pid?: string; src?: string; path?: string[] },
    own: NextContext,
) => ({
    identity: {
        sid: 'S1',
        uid: 'U1',
        gid: 'G1',
        roles: ['user', 'admin'],
        identityId: 'ap-northeast-2:identity-dummy',
        lang: 'ko',
    },
    channel: 'internal',
    depth: relay.hop,
    source: relay.src,
    trace: {
        tid: relay.tid,
        hop: relay.hop,
        via: relay.via,
        pid: relay.pid,
        src: relay.src,
        path: relay.path ?? PATH1,
    },
    requestId: own.requestId,
    accountId: own.accountId,
    ...ORIGIN,
});

//* the report flags (off in this spec: a report with a 12-digit account would call SNS).
const REPORTS = [LambdaHandler, LambdaWEBHandler, LambdaSNSHandler, LambdaSQSHandler, MyProtocolService];
const $reportKeep = REPORTS.map(C => C.REPORT_ERROR);

describe('protocol-relay', () => {
    beforeEach(() => {
        ENV_NAMES.forEach(k => setEnv(k));
        REPORTS.forEach(C => (C.REPORT_ERROR = false));
        resetProtocolSign();
    });
    //* restore the env, the report flags and the module cache.
    afterEach(() => {
        Object.entries($envKeep).forEach(([key, val]) => setEnv(key, val));
        REPORTS.forEach((C, i) => (C.REPORT_ERROR = $reportKeep[i]));
        resetProtocolSign();
    });

    //* env defaults and values.
    //* v5 B49 (#1194, D116): the receive default is `reject` (was `warn`).
    it('should read the modes (defaults: off, reject, 8)', () => {
        expect2(() => [readLegacySend(), readLegacyAccept(), readMaxHop()]).toEqual(['off', 'reject', 8]);
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'WARN');
        expect2(() => readLegacyAccept()).toEqual('warn');
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'maybe');
        expect2(() => readLegacyAccept()).toEqual('reject');
        setEnv('PROTOCOL_LEGACY_ACCEPT');
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'SEND');
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'reject');
        setEnv('PROTOCOL_MAX_HOP', '3');
        expect2(() => [readLegacySend(), readLegacyAccept(), readMaxHop()]).toEqual(['send', 'reject', 3]);
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'x');
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'accept');
        setEnv('PROTOCOL_MAX_HOP', '0');
        expect2(() => [readLegacySend(), readLegacyAccept(), readMaxHop()]).toEqual(['off', 'accept', 8]);
    });

    //* D2: the relay from a caller context — whitelist identity + trace, nothing else.
    it('should build the relay from the caller (whitelist, trace)', () => {
        const via = viaOf(caller);
        const relay = buildRelay(caller, { via, now: 1800000000000 });
        expect2(() => relay).toEqual({
            idt: {
                sid: 'S1',
                uid: 'U1',
                gid: 'G1',
                roles: ['user', 'admin'],
                identityId: 'ap-northeast-2:identity-dummy',
                lang: 'ko',
            },
            tid: 'req-caller-1',
            hop: 1,
            src: caller.source,
            via,
            pid: 'req-caller-1',
            iat: 1800000000,
            ua: caller.userAgent,
            ip: '203.0.113.10',
            dom: 'api.example.com',
            path: PATH1,
        });
        const text = encodeRelay(relay);
        expect2(() => text.startsWith('r1.')).toEqual(true);
        //* no value outside the whitelist (cookie, authorization, meta, keys, referer, origin …).
        const json = Buffer.from(text.substring(3), 'base64url').toString('utf8');
        expect2(() => SECRETS.filter(s => json.includes(s))).toEqual([]);
        expect2(() => Object.keys(JSON.parse(json))).toEqual([
            ...['idt', 'tid', 'hop', 'src', 'via', 'pid', 'iat'],
            ...['ua', 'ip', 'dom', 'path'], //* v5 B49 (#1194)
        ]);

        //* the next hop: trace wins over requestId/source.
        const hop3: NextContext = {
            requestId: 'req-3',
            source: 'api://x@other-api-dev#1',
            trace: { tid: 'T0', hop: 3, src: 'api://x@first-api-dev/a#1' },
        };
        expect2(() => buildRelay(hop3), 'tid,hop,src,pid').toEqual({
            tid: 'T0',
            hop: 4,
            src: 'api://x@first-api-dev/a#1',
            pid: 'req-3',
        });
        //* v5 B49 (#1194): a caller hop without a path (a sender before #1194) → no `path` (unknown chain, no 400).
        expectKeys(buildRelay(hop3), { absent: ['path'] });
        //* no trace → `requestId` and `source`, hop 1; no identity → no `idt`.
        expect2(() => buildRelay({ requestId: 'r', source: 's' }), 'idt,tid,hop,src').toEqual({
            idt: undefined,
            tid: 'r',
            hop: 1,
            src: 's',
        });
        //* nothing at all → a new tid (a chain is still traceable from here).
        expect2(() => typeof buildRelay({}).tid).toEqual('string');
        expect2(() => buildRelay({}).tid.length > 0).toEqual(true);
    });

    //* decode validates the shape, types and size; unknown keys and non-whitelisted identity keys are dropped.
    it('should decode and validate a relay', () => {
        const relay = buildRelay(caller, { via: 'api://v#1', now: 1800000000000 });
        expect2(() => decodeRelay(encodeRelay(relay))).toEqual(relay);
        const enc = (o: any) => `r1.${Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')}`;
        //* dropped keys.
        expect2(() =>
            decodeRelay(enc({ tid: 't', hop: 1, x: 1, idt: { sid: 's', meta: 'm', accessKey: 'k' } })),
        ).toEqual({
            tid: 't',
            hop: 1,
            idt: { sid: 's' },
        });
        //* errors.
        const E = (s: string) => `400 INVALID CONTEXT - relay ${s}`;
        expect2(() => decodeRelay('')).toEqual(E('format'));
        expect2(() => decodeRelay('r2.e30')).toEqual(E('format'));
        expect2(() => decodeRelay('r1.%%%')).toEqual(E('json'));
        expect2(() => decodeRelay(enc([1]))).toEqual(E('shape'));
        expect2(() => decodeRelay(enc({ hop: 1 }))).toEqual(E('tid'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: '1' }))).toEqual(E('hop'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: -1 }))).toEqual(E('hop'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1.5 }))).toEqual(E('hop'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, via: 1 }))).toEqual(E('via'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, iat: 'x' }))).toEqual(E('iat'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, idt: [] }))).toEqual(E('idt'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, idt: { sid: 1 } }))).toEqual(E('idt.sid'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, idt: { roles: 'admin' } }))).toEqual(E('idt.roles'));
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, idt: { roles: [1] } }))).toEqual(E('idt.roles'));
        //* size cap (bytes of the header text).
        const big = enc({ tid: 't', hop: 1, src: 'x'.repeat(RELAY_MAX_BYTES) });
        expect2(() => decodeRelay(big)).toEqual(E('size'));
    });

    //* D2 table: the receiver context from a relay and the receiver's own ids.
    it('should build the receiver context (D2 table)', () => {
        const via = viaOf(caller);
        const relay = buildRelay(caller, { via });
        const own: NextContext = { requestId: 'req-recv-1', accountId: '123456789012' };
        expect2(() => asRelayContext(relay, own)).toEqual(
            expected({ hop: 1, tid: 'req-caller-1', via, pid: 'req-caller-1', src: caller.source }, own),
        );
        //* v5 #1194: the exact key set (`toEqual()` above ignores a key set to `undefined`).
        expect2(() => keysOf(asRelayContext(relay, own))).toEqual(
            keysOf(expected({ hop: 1, tid: 'req-caller-1', via, pid: 'req-caller-1', src: caller.source }, own)),
        );
        expect2(() => keysOf(asRelayContext(relay, own).identity)).toEqual(
            ['sid', 'uid', 'gid', 'roles', 'identityId', 'lang'].sort(),
        );
        expectKeys(asRelayContext(relay, own), {
            present: ['userAgent', 'clientIp', 'domain'], //* v5 B49 (#1194): the request origin crosses.
            absent: ['cookie', 'authorization', 'referer', 'origin'],
        });
        //* no idt → an empty identity (an object, as entry contexts have).
        expect2(() => asRelayContext({ tid: 't', hop: 2 }, {}), 'identity,channel,depth').toEqual({
            identity: {},
            channel: 'internal',
            depth: 2,
        });
    });

    //* #1194 (D115): the relay carries the request origin and the call path (build → encode → decode → receiver).
    it('should carry userAgent/clientIp/domain and the call path to the receiver (#1194)', () => {
        const ctx: any = asRelayContext(decodeRelay(encodeRelay(buildRelay(caller, { via: viaOf(caller) }))), {
            requestId: 'r2',
        });
        expect2(() => ctx, 'userAgent,clientIp,domain').toEqual(ORIGIN);
        expect2(() => ctx.trace, 'hop,path').toEqual({ hop: 1, path: PATH1 });
        expectKeys(ctx, { present: ['identity', 'channel', 'trace', 'userAgent', 'clientIp', 'domain'] });
        expectKeys(ctx, { absent: ['cookie', 'authorization', 'referer', 'origin'] });
        expectKeys(ctx.identity, { present: ['sid', 'uid', 'roles'], absent: ['userAgent', 'accessKey', 'meta'] });
    });

    //* #1194 (D115): a second hop keeps the first entry's origin and appends its host to the path (`hop === path.length`).
    it('should keep the origin and append the path on a second hop (#1194)', () => {
        const hop1 = asRelayContext(decodeRelay(encodeRelay(buildRelay(caller, { via: viaOf(caller) }))), {});
        const relay2 = buildRelay({ ...hop1, requestId: 'r2' }, { via: 'api://123456789012@lemon-b-api-dev#5.0.0' });
        expect2(() => relay2, 'hop,ua,ip,dom,path').toEqual({
            hop: 2,
            ua: caller.userAgent,
            ip: '203.0.113.10',
            dom: 'api.example.com',
            path: ['lemon-core-dev', 'lemon-b-api-dev'],
        });
        const hop2 = asRelayContext(decodeRelay(encodeRelay(relay2)), {});
        expect2(() => hop2, 'userAgent,clientIp,domain').toEqual(ORIGIN);
        expect2(() => [hop2.trace.hop, (hop2.trace as any).path.length]).toEqual([2, 2]);
        //* the same-service callback appends the same way.
        expect2(() => (nextHopContext(hop2, 'api://lemon-c-api-dev#1').trace as any).path).toEqual([
            'lemon-core-dev',
            'lemon-b-api-dev',
            'lemon-c-api-dev',
        ]);
    });

    //* #1194 (D115): the path must have one host per hop and at most the hop cap → else `400 … relay path`.
    it('should reject a bad relay path (#1194)', () => {
        const enc = (o: any) => `r1.${Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')}`;
        const E = '400 INVALID CONTEXT - relay path';
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, path: ['a', 'b'] }))).toEqual(E);
        expect2(() => decodeRelay(enc({ tid: 't', hop: 2, path: ['a'] }))).toEqual(E);
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, path: 'a' }))).toEqual(E);
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, path: [1] }))).toEqual(E);
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, path: ['x'.repeat(129)] }))).toEqual(E);
        //* over the hop cap (default 8): 9 hosts at hop 9.
        const nine = Array.from({ length: 9 }, (_, i) => `h${i}`);
        expect2(() => decodeRelay(enc({ tid: 't', hop: 9, path: nine }))).toEqual(E);
        setEnv('PROTOCOL_MAX_HOP', '10');
        expect2(() => decodeRelay(enc({ tid: 't', hop: 9, path: nine })).path).toEqual(nine);
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, path: ['a'] })).path).toEqual(['a']);
    });

    //* #1194 compatibility: unknown keys (a future sender) are dropped; an old relay (no ua/ip/dom/path) gives none.
    it('should tolerate unknown keys and an old relay without the origin (#1194)', () => {
        const enc = (o: any) => `r1.${Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')}`;
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, zz: 1, future: { a: 1 } }))).toEqual({ tid: 't', hop: 1 });
        //* a relay of a sender before #1194: only the B14/B15 keys.
        const old = { idt: { sid: 'S1', roles: ['user'] }, tid: 't', hop: 1, via: 'api://lemon-a-api-dev#5.0.20' };
        const ctx: any = asRelayContext(decodeRelay(enc(old)), {});
        expectKeys(ctx, { present: ['identity', 'channel', 'trace'], absent: ['userAgent', 'clientIp', 'domain'] });
        expectKeys(ctx.trace, { present: ['tid', 'hop', 'via'], absent: ['path'] });
    });

    //* #1194: a long `userAgent` is truncated to 512 chars on build (the relay stays far under 4096 bytes).
    it('should truncate a long userAgent on build (#1194)', () => {
        const relay = buildRelay({ ...caller, userAgent: 'U'.repeat(2000) }, { via: viaOf(caller) });
        expect2(() => relay.ua.length).toEqual(RELAY_MAX_UA);
        expect2(() => Buffer.byteLength(encodeRelay(relay), 'utf8') < RELAY_MAX_BYTES).toEqual(true);
    });

    //* the TRACE line: tid/hop/channel, the via host and the src path only (no identity, no account).
    it('should format the TRACE line', () => {
        const ctx = asRelayContext(buildRelay(caller, { via: viaOf(caller) }), { requestId: 'r2' });
        const line = traceLine(ctx);
        expect2(() => line).toEqual(
            'TRACE tid=req-caller-1 hop=1 ch=internal via=lemon-core-dev src=/hello/a_1/run path=lemon-core-dev',
        );
        expect2(() => [line.includes('S1'), line.includes('123456789012')]).toEqual([false, false]);
        expect2(() => traceLine({ requestId: 'x', channel: 'external', trace: { tid: 'x', hop: 0 } })).toEqual(
            'TRACE tid=x hop=0 ch=external via=- src=- path=-',
        );
        //* v5 B49 (#1194): the call path hosts joined by `>`.
        expect2(() => traceLine({ trace: { tid: 'x', hop: 2, path: ['a-api-dev', 'b-api-dev'] } as any })).toEqual(
            'TRACE tid=x hop=2 ch=- via=- src=- path=a-api-dev>b-api-dev',
        );
        //* whitespace in values cannot break the line.
        expect2(() => traceLine({ trace: { tid: 'a b\nc', hop: 1 } })).toEqual(
            'TRACE tid=a_b_c hop=1 ch=- via=- src=- path=-',
        );
    });

    //* web: sender → receiver round trip (relay only by default; with `send` both headers).
    it('should round-trip a web relay (default: no x-protocol-context)', async () => {
        const { lambda, got } = instance();
        const event = webEvent();
        expect2(() => Object.keys(event.headers)).toEqual([HEADER_LEMON_RELAY]);
        const { res, lines } = await withLog(() => lambda.handle(event, lambdaCtx()));
        expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
        const via = viaOf(caller);
        const own = { requestId: 'req-recv-1', accountId: '123456789012' };
        expect2(() => got[0]).toEqual(
            expected({ hop: 1, tid: 'req-caller-1', via, pid: 'req-caller-1', src: caller.source }, own),
        );
        expect2(() => SECRETS.filter(s => JSON.stringify(got[0]).includes(s))).toEqual([]);
        //* v5 #1194: the exact key set of the receiver context (no key set to `undefined`).
        expect2(() => keysOf(got[0])).toEqual(
            keysOf(expected({ hop: 1, tid: 'req-caller-1', via, pid: 'req-caller-1', src: caller.source }, own)),
        );
        //* one TRACE line, no deprecated line.
        expect2(() => linesOf(lines, 'TRACE ').length).toEqual(1);
        expect2(() => linesOf(lines, 'TRACE ')[0].includes('tid=req-caller-1 hop=1 ch=internal')).toEqual(true);
        expect2(() => linesOf(lines, 'PROTOCOL deprecated').length).toEqual(0);

        //* `PROTOCOL_LEGACY_CONTEXT=send` → both headers; the receiver uses the relay.
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
        const both = webEvent();
        expect2(() => Object.keys(both.headers).sort()).toEqual([HEADER_LEMON_RELAY, HEADER_PROTOCOL_CONTEXT].sort());
        expect2(() => JSON.parse(both.headers[HEADER_PROTOCOL_CONTEXT]).cookie).toEqual({ session: 'COOKIE-DUMMY' });
        const r2 = await withLog(() => lambda.handle(both, lambdaCtx()));
        expect2(() => r2.res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[1]).toEqual(got[0]);
        expect2(() => linesOf(r2.lines, 'PROTOCOL deprecated').length).toEqual(0);

        //* no Lambda context → the own requestId is a new id, the account from the request context.
        const r3 = await lambda.handle(webEvent(), null);
        expect2(() => r3, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => [typeof got[2].requestId, got[2].requestId === 'req-caller-1']).toEqual(['string', false]);
        expect2(() => got[2].accountId).toEqual('123456789012');
    });

    //* SNS/SQS: sender → receiver round trip (relay field; no `context` field by default).
    it('should round-trip a SNS/SQS relay', async () => {
        const { lambda, got } = instance();
        const via = viaOf(caller);
        const relayOf = { hop: 1, tid: 'req-caller-1', via, pid: 'req-caller-1', src: caller.source };

        //* SNS: the message has `relay` and no `context`.
        const sns = snsRecord();
        expect2(() => Object.keys(JSON.parse(sns.Sns.Message)).includes('context')).toEqual(false);
        expect2(() => JSON.parse(sns.Sns.Message).relay.startsWith('r1.')).toEqual(true);
        const r1 = await withLog(() => lambda.handle({ Records: [sns] }, lambdaCtx()));
        expect2(() => r1.res).toEqual(undefined);
        expect2(() => got[0]).toEqual(expected(relayOf, { requestId: 'req-recv-1', accountId: '123456789012' }));
        expect2(() => linesOf(r1.lines, 'TRACE ').length).toEqual(1);

        //* SQS.
        const sqs = sqsRecord();
        expect2(() => Object.keys(JSON.parse(sqs.body)).includes('context')).toEqual(false);
        const r2 = await withLog(() => lambda.handle({ Records: [sqs] }, lambdaCtx()));
        expect2(() => r2.res).toEqual({ batchItemFailures: [] });
        expect2(() => got[1]).toEqual(expected(relayOf, { requestId: 'req-recv-1', accountId: '123456789012' }));
        expect2(() => linesOf(r2.lines, 'TRACE ').length).toEqual(1);

        //* no Lambda context → the message id and the account of the source ARN.
        await lambda.handle({ Records: [snsRecord(caller, 'sns-2')] }, null);
        expect2(() => got[2], 'requestId,accountId').toEqual({ requestId: 'sns-2', accountId: '123456789012' });
        await lambda.handle({ Records: [sqsRecord(caller, 'sqs-2')] }, null);
        expect2(() => got[3], 'requestId,accountId').toEqual({ requestId: 'sqs-2', accountId: '123456789012' });

        //* `send` → both fields; the relay wins.
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
        const both = sqsRecord(caller, 'sqs-3');
        expect2(() => JSON.parse(both.body).context.cookie).toEqual({ session: 'COOKIE-DUMMY' });
        const r3 = await withLog(() => lambda.handle({ Records: [both] }, lambdaCtx()));
        expect2(() => r3.res).toEqual({ batchItemFailures: [] });
        expect2(() => got[4]).toEqual(got[1]);
        expect2(() => linesOf(r3.lines, 'PROTOCOL deprecated').length).toEqual(0);
    });

    //* the web signature covers the relay string (context slot); SNS/SQS sign the message as before.
    it('should verify the relay signature (warn, enforce)', async () => {
        const { lambda, got } = instance();
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        resetProtocolSign();

        //* signed → 200.
        const signed = webEvent(caller, { a: 1 });
        expect2(() => !!signed.headers[HEADER_PROTOCOL_SIGNATURE]).toEqual(true);
        expect2(await lambda.handle(signed, lambdaCtx()), 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[0]?.identity?.sid).toEqual('S1');

        //* a relay with another identity (re-encoded, same signature) → mismatch → 403.
        const forged = { ...signed, headers: { ...signed.headers } };
        const r = decodeRelay(signed.headers[HEADER_LEMON_RELAY]);
        forged.headers[HEADER_LEMON_RELAY] = encodeRelay({ ...r, idt: { ...r.idt, sid: 'X' } });
        expect2(await lambda.handle(forged, lambdaCtx()), 'statusCode,body').toEqual({
            statusCode: 403,
            body: '403 NOT ALLOWED - unsigned protocol context',
        });
        //* signed with another key → 403; unsigned → 403.
        const other = { ...signed, headers: { ...signed.headers } };
        other.headers[HEADER_PROTOCOL_SIGNATURE] = signContext(other.headers[HEADER_LEMON_RELAY], other.body, {
            key: 'other-key',
        });
        expect2(await lambda.handle(other, lambdaCtx()), 'statusCode').toEqual({ statusCode: 403 });
        const unsigned = { ...signed, headers: { [HEADER_LEMON_RELAY]: signed.headers[HEADER_LEMON_RELAY] } };
        expect2(await lambda.handle(unsigned, lambdaCtx()), 'statusCode').toEqual({ statusCode: 403 });

        //* SQS: the signature covers the body with the relay → a changed relay fails in enforce.
        const ok = sqsRecord(caller, 'm-ok');
        const bad = sqsRecord(caller, 'm-bad');
        const $body = JSON.parse(bad.body);
        bad.body = JSON.stringify({ ...$body, relay: encodeRelay({ ...decodeRelay($body.relay), hop: 2 }) });
        expect2(await lambda.handle({ Records: [ok, bad] }, lambdaCtx())).toEqual({
            batchItemFailures: [{ itemIdentifier: 'm-bad' }],
        });

        //* `warn` → forged and unsigned pass with one `PROTOCOL unsigned web` line each.
        setEnv('PROTOCOL_VERIFY', 'warn');
        const { lines } = await withLog(async () => {
            expect2(await lambda.handle(forged, lambdaCtx()), 'statusCode').toEqual({ statusCode: 200 });
            expect2(await lambda.handle(unsigned, lambdaCtx()), 'statusCode').toEqual({ statusCode: 200 });
        });
        expect2(() => linesOf(lines, 'PROTOCOL unsigned web').length).toEqual(2);
    });

    //* hop cap: the sender refuses the next hop over the cap; the receiver refuses a relay over the cap.
    it('should cap the hop (send and receive, 508)', async () => {
        const { lambda, sns, got } = instance();
        const deep: NextContext = { ...caller, trace: { tid: 'T', hop: 8 } };
        //* send: next hop 9 > 8 → 508 before any AWS call.
        expect2(() => webEvent(deep)).toEqual('508 LOOP DETECTED - protocol hop 9');
        expect2(() => snsRecord(deep)).toEqual('508 LOOP DETECTED - protocol hop 9');
        expect2(() => sqsRecord(deep)).toEqual('508 LOOP DETECTED - protocol hop 9');
        const service = new MyProtocolService();
        expect2(await service.execute(paramOf(deep)).catch(GETERR)).toEqual('508 LOOP DETECTED - protocol hop 9');
        expect2(await service.notify(paramOf(deep)).catch(GETERR)).toEqual('508 LOOP DETECTED - protocol hop 9');
        expect2(await service.enqueue(paramOf(deep)).catch(GETERR)).toEqual('508 LOOP DETECTED - protocol hop 9');
        //* hop 8 is still sent (= the cap).
        expect2(
            () => webEvent({ ...caller, trace: { tid: 'T', hop: 7 } }).headers[HEADER_LEMON_RELAY].length > 3,
        ).toEqual(true);

        //* receive: a relay of hop 9 (allowed by a sender with a larger cap).
        setEnv('PROTOCOL_MAX_HOP', '9');
        const web9 = webEvent(deep);
        const sns9 = snsRecord(deep);
        const sqs9 = sqsRecord(deep);
        setEnv('PROTOCOL_MAX_HOP');
        expect2(await lambda.handle(web9, lambdaCtx()), 'statusCode,body').toEqual({
            statusCode: 508,
            body: '508 LOOP DETECTED - protocol hop 9',
        });
        expect2(await lambda.handle({ Records: [sns9] }, lambdaCtx())).toEqual(undefined);
        expect2(() => sns.last()).toEqual(['508 LOOP DETECTED - protocol hop 9']);
        expect2(await lambda.handle({ Records: [sqs9] }, lambdaCtx())).toEqual({
            batchItemFailures: [{ itemIdentifier: 'sqs-msg-1' }],
        });
        expect2(() => got.length).toEqual(0);
        //* the env raises the cap.
        setEnv('PROTOCOL_MAX_HOP', '9');
        expect2(await lambda.handle(web9, lambdaCtx()), 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[0].trace, 'tid,hop').toEqual({ tid: 'T', hop: 9 });
    });

    //* D4: a legacy-only call (v4 sender) by `PROTOCOL_LEGACY_ACCEPT` — accept, warn, reject (default since B49 D116).
    it('should accept, warn or reject a legacy context (web, SNS, SQS)', async () => {
        const { lambda, sns, got } = instance();
        //* v4-style events: `x-protocol-context` / `context` only, unsigned.
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
        const legacyWeb = webEvent();
        delete legacyWeb.headers[HEADER_LEMON_RELAY];
        const legacySns = snsRecord();
        legacySns.Sns.Message = JSON.stringify({ ...JSON.parse(legacySns.Sns.Message), relay: undefined });
        const legacySqs = sqsRecord();
        legacySqs.body = JSON.stringify({ ...JSON.parse(legacySqs.body), relay: undefined });
        setEnv('PROTOCOL_LEGACY_CONTEXT');
        //* run the 3 events, returns results and the log lines.
        const runAll = () =>
            withLog(async () => [
                await lambda.handle(legacyWeb, lambdaCtx()),
                await lambda.handle({ Records: [legacySns] }, lambdaCtx()),
                await lambda.handle({ Records: [legacySqs] }, lambdaCtx()),
            ]);
        //* the legacy context as is + channel internal + an entry trace.
        const asLegacy = { ...caller, channel: 'internal', trace: { tid: 'req-caller-1', hop: 0 } };

        //* warn (explicit; the default is `reject` since B49 D116): accepted, one line per call.
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'warn');
        const w = await runAll();
        expect2(() => w.res[0], 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => w.res[2]).toEqual({ batchItemFailures: [] });
        expect2(() => got).toEqual([asLegacy, asLegacy, asLegacy]);
        const deprecated = linesOf(w.lines, 'PROTOCOL deprecated x-protocol-context');
        expect2(() => deprecated.length).toEqual(3);
        expect2(() => deprecated.map(s => s.substring(s.indexOf('PROTOCOL')))).toEqual([
            'PROTOCOL deprecated x-protocol-context lemon-hello-api-dev (web)',
            'PROTOCOL deprecated x-protocol-context lemon-hello-api-dev (sns)',
            'PROTOCOL deprecated x-protocol-context lemon-hello-api-dev (sqs)',
        ]);
        expect2(() => linesOf(w.lines, 'TRACE ').length).toEqual(3);

        //* accept: accepted, no line.
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'accept');
        const a = await runAll();
        expect2(() => a.res[0], 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got.length).toEqual(6);
        expect2(() => linesOf(a.lines, 'PROTOCOL deprecated').length).toEqual(0);

        //* reject: web 400, SNS reported, SQS record failure; nothing dispatched.
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'reject');
        const r = await runAll();
        expect2(() => r.res[0], 'statusCode,body').toEqual({
            statusCode: 400,
            body: '400 INVALID CONTEXT - legacy context rejected',
        });
        expect2(() => r.res[1]).toEqual(undefined);
        expect2(() => sns.last()).toEqual(['400 INVALID CONTEXT - legacy context rejected']);
        expect2(() => r.res[2]).toEqual({ batchItemFailures: [{ itemIdentifier: 'sqs-msg-1' }] });
        expect2(() => got.length).toEqual(6);

        //* a relay is never rejected by the legacy mode (relay + legacy → the relay).
        setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
        expect2(await lambda.handle(webEvent(), lambdaCtx()), 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[6].trace?.hop).toEqual(1);
    });

    //* a v4 caller (legacy, unsigned) is accepted in `warn` (sign verify `warn` too): 2 lines, the same context.
    it('should accept a v4-style event in warn', async () => {
        const { lambda, got } = instance();
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'warn'); //* v5 B49 (#1194, D116): explicit (default `reject`).
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        resetProtocolSign();
        //* v4: the header only, no signature.
        const v4: any = {
            headers: { [HEADER_PROTOCOL_CONTEXT]: $U.json({ ...caller, channel: undefined, trace: undefined }) },
            path: '/hello/!',
            httpMethod: 'GET',
            pathParameters: { type: 'hello', id: '!', cmd: '' },
            queryStringParameters: null,
            requestContext: {
                path: '/hello/!',
                httpMethod: 'GET',
                identity: null,
                stage: '',
                accountId: '123456789012',
                requestId: 'req-caller-1',
            },
            body: null,
        };
        const { res, lines } = await withLog(() => lambda.handle(v4, lambdaCtx()));
        expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[0], 'identity,channel,domain,trace').toEqual({
            identity: caller.identity,
            channel: 'internal',
            domain: 'api.example.com',
            trace: { tid: 'req-caller-1', hop: 0 },
        });
        expect2(() => linesOf(lines, 'PROTOCOL unsigned web (missing)').length).toEqual(1);
        expect2(() => linesOf(lines, 'PROTOCOL deprecated x-protocol-context').length).toEqual(1);

        //* the v4 SNS sample (a v4 sender) is accepted too.
        const sample = loadJsonSync('data/samples/events/protocol.event.sns.json');
        const s = await withLog(() => lambda.handle({ Records: sample.Records }, lambdaCtx()));
        expect2(() => s.res).toEqual(undefined);
        expect2(
            () => linesOf(s.lines, 'PROTOCOL deprecated x-protocol-context lemon-metrics-api-dev (sns)').length,
        ).toEqual(1);
    });

    //* a host-less JSON `x-lemon-identity`: the same behaviour, plus one deprecated line.
    it('should warn a JSON identity of an internal call', async () => {
        const { lambda, got } = instance();
        const event = webEvent();
        delete event.headers[HEADER_LEMON_RELAY];
        event.headers['x-lemon-identity'] = $U.json({ sid: 'S2', roles: ['admin'] });
        const { res, lines } = await withLog(() => lambda.handle(event, lambdaCtx()));
        expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[0], 'channel').toEqual({ channel: 'internal' });
        expect2(() => got[0].identity, 'sid,roles').toEqual({ sid: 'S2', roles: ['admin'] });
        expect2(() => linesOf(lines, 'PROTOCOL deprecated json identity (web)').length).toEqual(1);
        //* `accept` → no line.
        setEnv('PROTOCOL_LEGACY_ACCEPT', 'accept');
        const a = await withLog(() => lambda.handle(event, lambdaCtx()));
        expect2(() => linesOf(a.lines, 'PROTOCOL deprecated').length).toEqual(0);
    });

    //* a trace id is a safe token: an unsafe requestId (local express: `YYYY-MM-DD hh:mm:ss.SSS`) → a new uuid.
    it('should use a safe trace id', () => {
        const SAFE = /^[\w.:-]{1,128}$/;
        const local = '2026-10-30 03:32:57.040';
        const t1 = entryTrace({ requestId: local });
        const t2 = entryTrace({ requestId: local });
        expect2(() => [t1.tid === local, SAFE.test(t1.tid), t1.tid === t2.tid, t1.hop]).toEqual([
            false,
            true,
            false,
            0,
        ]);
        //* a Lambda / API Gateway id is kept as is.
        expect2(() => entryTrace({ requestId: 'd8485d00-5624-4094-9a93-ce09c351ee5b' })).toEqual({
            tid: 'd8485d00-5624-4094-9a93-ce09c351ee5b',
            hop: 0,
        });
        //* the relay of a caller without a trace: the same rule (the requestId is still the `pid`).
        const relay = buildRelay({ requestId: local });
        expect2(() => [relay.tid === local, SAFE.test(relay.tid), relay.pid]).toEqual([false, true, local]);
        expect2(() => buildRelay({ requestId: 'req-1' }).tid).toEqual('req-1');
    });

    //* a same-service callback (SNS/SQS) runs in-process as the next hop: hop + 1, same tid, via/pid of the receiver, cap.
    it('should advance the hop of a same-service callback (SNS/SQS)', async () => {
        const { lambda, sns, got } = instance('lemon-hello-api');
        const callback = 'api://lemon-hello-api-dev/hello/cb#1.0.0';
        const via = viaOf(caller);
        const own = { requestId: 'req-recv-1', accountId: '123456789012' };
        //* the callback context from the first receive.
        const nextOf = (first: NextContext) => ({
            ...first,
            depth: 2,
            trace: {
                ...{ tid: 'req-caller-1', hop: 2, via: viaOf(first), pid: 'req-recv-1', src: caller.source },
                path: [...PATH1, 'lemon-core-dev'], //* v5 B49 (#1194): + this service's host.
            },
        });

        //* SNS: the receive (hop 1), then the callback (hop 2) in-process.
        const r1 = await withLog(() =>
            lambda.handle({ Records: [snsRecord(caller, 'sns-cb', callback)] }, lambdaCtx()),
        );
        expect2(() => got.length).toEqual(2);
        expect2(() => got[0]).toEqual(
            expected({ hop: 1, tid: 'req-caller-1', via, pid: 'req-caller-1', src: caller.source }, own),
        );
        expect2(() => got[1]).toEqual(nextOf(got[0]));
        expect2(() => linesOf(r1.lines, 'TRACE ').map(s => s.substring(s.indexOf('TRACE')))).toEqual([
            'TRACE tid=req-caller-1 hop=1 ch=internal via=lemon-core-dev src=/hello/a_1/run path=lemon-core-dev',
            'TRACE tid=req-caller-1 hop=2 ch=internal via=lemon-core-dev src=/hello/a_1/run path=lemon-core-dev>lemon-core-dev',
        ]);

        //* SQS: the same.
        expect2(await lambda.handle({ Records: [sqsRecord(caller, 'sqs-cb', callback)] }, lambdaCtx())).toEqual({
            batchItemFailures: [],
        });
        expect2(() => got.length).toEqual(4);
        expect2(() => got[3]).toEqual(nextOf(got[2]));

        //* the cap: a receive at hop 8 → the callback would be hop 9 → 508 (SNS reported, SQS record failure).
        const deep: NextContext = { ...caller, trace: { tid: 'T', hop: 7 } };
        await lambda.handle({ Records: [snsRecord(deep, 'sns-cap', callback)] }, lambdaCtx());
        expect2(() => sns.last()).toEqual(['508 LOOP DETECTED - protocol hop 9']);
        expect2(await lambda.handle({ Records: [sqsRecord(deep, 'sqs-cap', callback)] }, lambdaCtx())).toEqual({
            batchItemFailures: [{ itemIdentifier: 'sqs-cap' }],
        });
        //* the receives ran (hop 8), the callbacks did not.
        expect2(() => got.slice(4).map(c => c.trace?.hop)).toEqual([8, 8]);
    });

    //* size: the relay vs the legacy context JSON (a representative external context, and a real API-GW one).
    it('should keep the relay small (vs the legacy context)', async () => {
        const via = viaOf(caller);
        const relay = encodeRelay(buildRelay(caller, { via }));
        const legacy = $U.json(caller);
        const relayBytes = Buffer.byteLength(relay, 'utf8');
        const legacyBytes = Buffer.byteLength(legacy, 'utf8');
        //* the context of a real API Gateway event (Cognito identity).
        const { web } = instance();
        const signed = await web.packContext(loadJsonSync('data/samples/events/sample.event.web.signed.json'), null);
        const relay2 = Buffer.byteLength(encodeRelay(buildRelay(signed, { via })), 'utf8');
        const legacy2 = Buffer.byteLength($U.json(signed), 'utf8');
        process.stdout.write(
            `! relay size: caller relay=${relayBytes} legacy=${legacyBytes}; api-gw relay=${relay2} legacy=${legacy2}\n`,
        );
        expect2(() => [relayBytes <= 1024, relayBytes < legacyBytes]).toEqual([true, true]);
        expect2(() => [relay2 <= 1024, relay2 < legacy2]).toEqual([true, true]);
    });
    //* v5 B15: a caller from another cloud (dummy accounts: the caller `cid` differs from the receiver's own).
    const OTHER_ACC = '210987654321';
    const crossCaller: NextContext = {
        ...caller,
        identity: { ...caller.identity, cid: OTHER_ACC, aid: 'AUTH-ID-1' } as any,
    };

    it('B15 T-08 the relay keeps `cid` and `aid` (build, decode, receiver context)', () => {
        const relay = buildRelay(crossCaller, { via: viaOf(crossCaller), now: 1800000000000 });
        expect2(() => relay.idt).toEqual({
            sid: 'S1',
            uid: 'U1',
            gid: 'G1',
            roles: ['user', 'admin'],
            identityId: 'ap-northeast-2:identity-dummy',
            lang: 'ko',
            cid: OTHER_ACC,
            aid: 'AUTH-ID-1',
        });
        expect2(() => decodeRelay(encodeRelay(relay))).toEqual(relay);
        const own: NextContext = { requestId: 'req-recv-1', accountId: '123456789012' };
        expect2(() => asRelayContext(relay, own).identity, 'cid,aid').toEqual({ cid: OTHER_ACC, aid: 'AUTH-ID-1' });
        //* typed like the other string fields; still nothing outside the whitelist.
        const enc = (o: any) => `r1.${Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')}`;
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, idt: { cid: 1 } }))).toEqual(
            '400 INVALID CONTEXT - relay idt.cid',
        );
        expect2(() => decodeRelay(enc({ tid: 't', hop: 1, idt: { aid: 'a', did: 'd' } })).idt).toEqual({ aid: 'a' });
        const json = Buffer.from(encodeRelay(relay).substring(3), 'base64url').toString('utf8');
        expect2(() => SECRETS.filter(S => json.includes(S))).toEqual([]);
    });

    it('B15 T-09 the TRACE line flags a cross-cloud identity (`cross=1`), never the account', () => {
        const own: NextContext = { requestId: 'r2', accountId: '123456789012' };
        const ctx = asRelayContext(buildRelay(crossCaller, { via: viaOf(crossCaller) }), own);
        const line = traceLine(ctx);
        expect2(() => isCrossCloud(ctx)).toEqual(true);
        expect2(() => line).toEqual(
            'TRACE tid=req-caller-1 hop=1 ch=internal via=lemon-core-dev src=/hello/a_1/run path=lemon-core-dev cross=1',
        );
        expect2(() => [line.includes(OTHER_ACC), line.includes('123456789012')]).toEqual([false, false]);
        //* same cloud, `#` or no `cid`, or no own account → no flag.
        const _line = (cid: string, accountId = '123456789012') =>
            traceLine({ identity: { cid } as any, accountId, channel: 'external', trace: { tid: 'x', hop: 0 } });
        expect2(() => _line('123456789012')).toEqual('TRACE tid=x hop=0 ch=external via=- src=- path=-');
        expect2(() => _line('#')).toEqual('TRACE tid=x hop=0 ch=external via=- src=- path=-');
        expect2(() => _line('')).toEqual('TRACE tid=x hop=0 ch=external via=- src=- path=-');
        expect2(() => _line(OTHER_ACC, '')).toEqual('TRACE tid=x hop=0 ch=external via=- src=- path=-');
        expect2(() => _line(OTHER_ACC)).toEqual('TRACE tid=x hop=0 ch=external via=- src=- path=- cross=1');
    });

    it('B15 T-10 web and SNS/SQS round trips keep `cid`/`aid` and log `cross=1`', async () => {
        const { lambda, got } = instance();
        //* web relay → the receiver identity has `cid`/`aid`; one TRACE line with the flag only.
        const r1 = await withLog(() => lambda.handle(webEvent(crossCaller), lambdaCtx()));
        expect2(() => r1.res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => got[0].identity, 'cid,aid').toEqual({ cid: OTHER_ACC, aid: 'AUTH-ID-1' });
        expect2(() => got[0], 'channel,accountId').toEqual({ channel: 'internal', accountId: '123456789012' });
        const trace1 = linesOf(r1.lines, 'TRACE ');
        expect2(() => trace1.length).toEqual(1);
        expect2(() => [trace1[0].endsWith(' cross=1'), trace1[0].includes(OTHER_ACC)]).toEqual([true, false]);
        expect2(() => trace1[0].includes('123456789012')).toEqual(false);
        //* SQS relay too.
        const r2 = await withLog(() => lambda.handle({ Records: [sqsRecord(crossCaller)] }, lambdaCtx()));
        expect2(() => r2.res).toEqual({ batchItemFailures: [] });
        expect2(() => got[1].identity, 'cid,aid').toEqual({ cid: OTHER_ACC, aid: 'AUTH-ID-1' });
        expect2(() => linesOf(r2.lines, 'TRACE ')[0].endsWith(' cross=1')).toEqual(true);
        //* the same-cloud caller → no flag.
        const same = { ...caller, identity: { ...caller.identity, cid: '123456789012' } as any };
        const r3 = await withLog(() => lambda.handle({ Records: [snsRecord(same)] }, lambdaCtx()));
        expect2(() => r3.res).toEqual(undefined);
        expect2(() => got[2].identity, 'cid').toEqual({ cid: '123456789012' });
        expect2(() => linesOf(r3.lines, 'TRACE ')[0].includes('cross=')).toEqual(false);
    });
    //* #1194 path 2 (D115/D116): the relay carries the request origin and the call path; a legacy-only call is rejected.
    describe('#1194 relay fields (web handler)', () => {
        //* the caller of the issue: an identity plus the request fields a WSS entry has (no `host` header on the hop).
        const caller1194: NextContext = {
            identity: { sid: 'S1', uid: 'U1', roles: ['user'] } as any,
            userAgent: 'UA/1',
            clientIp: '1.2.3.4',
            domain: 'wss.example.com',
            requestId: 'req-1194',
            accountId: '123456789012',
        };
        //* the origin the receiver context must have.
        const ORIGIN1194 = { userAgent: 'UA/1', clientIp: '1.2.3.4', domain: 'wss.example.com' };
        //* handle the event on a new receiver, returns the result, the received context and the log lines.
        const receive = async (event: any) => {
            const { lambda, got } = instance();
            const { res, lines } = await withLog(() => lambda.handle(event, lambdaCtx()));
            return { res, ctx: got[0], lines };
        };

        //* #1194 send side (D116): with the env unset, no legacy context is sent (web header, SNS/SQS `context` field).
        it('should not send x-protocol-context by default (web, SNS, SQS)', () => {
            expect2(() => keysOf(webEvent(caller1194).headers)).toEqual([HEADER_LEMON_RELAY]);
            const sns = JSON.parse(snsRecord(caller1194).Sns.Message);
            const sqs = JSON.parse(sqsRecord(caller1194).body);
            expectKeys(sns, { present: ['relay'], absent: ['context'] });
            expectKeys(sqs, { present: ['relay'], absent: ['context'] });
        });

        //* #1194 path 2 (default): relay only → channel internal, identity, the origin and `trace.path`.
        it('should carry userAgent/clientIp/domain and the path over a relay (default)', async () => {
            const { res, ctx, lines } = await receive(webEvent(caller1194));
            expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
            expect2(() => ctx, 'channel,userAgent,clientIp,domain').toEqual({ channel: 'internal', ...ORIGIN1194 });
            expect2(() => ctx.identity, 'sid,uid,roles').toEqual({ sid: 'S1', uid: 'U1', roles: ['user'] });
            expect2(() => ctx.trace, 'hop,path').toEqual({ hop: 1, path: PATH1 });
            expectKeys(ctx, { present: ['identity', 'channel', 'trace', 'requestId', 'accountId'] });
            expectKeys(ctx.identity, { absent: ['userAgent', 'clientIp', 'domain'] });
            //* one TRACE line with the path.
            const trace = linesOf(lines, 'TRACE ');
            expect2(() => trace.length).toEqual(1);
            expect2(() => trace[0].includes(' path=lemon-core-dev')).toEqual(true);
        });

        //* #1194 path 2 (`PROTOCOL_LEGACY_CONTEXT=send`): both headers, the relay wins (no rejection).
        it('should use the relay when x-protocol-context is also present (relay wins)', async () => {
            setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
            const event = webEvent(caller1194);
            expect2(() => keysOf(event.headers)).toEqual([HEADER_LEMON_RELAY, HEADER_PROTOCOL_CONTEXT].sort());
            const { res, ctx, lines } = await receive(event);
            expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
            expect2(() => ctx, 'channel,userAgent,clientIp,domain').toEqual({ channel: 'internal', ...ORIGIN1194 });
            //* from the relay: hop 1 with the path (a legacy context would be hop 0 without a path).
            expect2(() => ctx.trace, 'hop,path').toEqual({ hop: 1, path: PATH1 });
            expect2(() => linesOf(lines, 'PROTOCOL deprecated').length).toEqual(0);
            //* the same receiver context as the relay-only event.
            setEnv('PROTOCOL_LEGACY_CONTEXT');
            const { ctx: ctx0 } = await receive(webEvent(caller1194));
            expect2(() => keysOf(ctx)).toEqual(keysOf(ctx0));
            expect2(() => ({ ...ctx, requestId: '' })).toEqual({ ...ctx0, requestId: '' });
        });

        //* the legacy-only events of `caller1194` (web, SNS, SQS) as a v4 sender builds them (no relay).
        const legacyEvents = () => {
            setEnv('PROTOCOL_LEGACY_CONTEXT', 'send');
            const web = webEvent(caller1194);
            delete web.headers[HEADER_LEMON_RELAY];
            const sns = snsRecord(caller1194);
            sns.Sns.Message = JSON.stringify({ ...JSON.parse(sns.Sns.Message), relay: undefined });
            const sqs = sqsRecord(caller1194);
            sqs.body = JSON.stringify({ ...JSON.parse(sqs.body), relay: undefined });
            setEnv('PROTOCOL_LEGACY_CONTEXT');
            return { web, sns, sqs };
        };

        //* #1194 (D116): a legacy-only call is rejected by default — web 400, SNS reported, SQS record failure.
        it('should reject a legacy-only call by default (web, SNS, SQS)', async () => {
            const { web, sns, sqs } = legacyEvents();
            expect2(() => keysOf(web.headers)).toEqual([HEADER_PROTOCOL_CONTEXT]);
            const { lambda, sns: $sns, got } = instance();
            expect2(await lambda.handle(web, lambdaCtx()), 'statusCode,body').toEqual({
                statusCode: 400,
                body: '400 INVALID CONTEXT - legacy context rejected',
            });
            expect2(await lambda.handle({ Records: [sns] }, lambdaCtx())).toEqual(undefined);
            expect2(() => $sns.last()).toEqual(['400 INVALID CONTEXT - legacy context rejected']);
            expect2(await lambda.handle({ Records: [sqs] }, lambdaCtx())).toEqual({
                batchItemFailures: [{ itemIdentifier: 'sqs-msg-1' }],
            });
            expect2(() => got.length).toEqual(0);
        });

        //* #1194 path 2 (v4 caller, `PROTOCOL_LEGACY_ACCEPT=warn` explicit): the v4 context is kept (`userAgent`) + internal.
        it('should keep the v4 context of a legacy-only call with PROTOCOL_LEGACY_ACCEPT=warn', async () => {
            setEnv('PROTOCOL_LEGACY_ACCEPT', 'warn');
            const { web } = legacyEvents();
            const { res, ctx, lines } = await receive(web);
            expect2(() => res, 'statusCode').toEqual({ statusCode: 200 });
            expect2(() => ctx, 'channel,userAgent,clientIp,domain').toEqual({ channel: 'internal', ...ORIGIN1194 });
            expect2(() => ctx.trace, 'hop').toEqual({ hop: 0 });
            expectKeys(ctx.trace, { absent: ['path'] });
            expect2(() => linesOf(lines, 'PROTOCOL deprecated x-protocol-context').length).toEqual(1);
        });
    });
});
