/**
 * `protocol-sign.spec.ts`
 * - v5 B5: protocol signature (HMAC-SHA256) and the trust rules of `packContext` / SNS / SQS (SPEC § 6.2).
 * - no network: the engine is not initialized, the key comes from `process.env` (restored after each test).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (v5 B5)
 * @date        2026-10-30 v5 B14: the outgoing web event carries the relay (signed in the context slot).
 * @date        2026-10-30 key rotation: dual keys A/B (web, SNS, SQS).
 * @date        2026-10-30 key rotation: v2 signature with a nonce (`PROTOCOL_SIGN_VERSION`), v1 still verified.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, it, afterEach, beforeEach } from 'vitest';
import { $engine, $U } from '../../engine/';
import { NextContext, NextDecoder, NextHandler } from 'lemon-model';
import { expect2, GETERR$ } from '../../common/test-helper';
import { LambdaHandler } from '../lambda/lambda-handler';
import { LambdaWEBHandler } from '../lambda/lambda-web-handler';
import { LambdaSQSHandler } from '../lambda/lambda-sqs-handler';
import { LambdaSNSHandler } from '../lambda/lambda-sns-handler';
import { WEBProtocolTransformer, SQSProtocolTransformer } from './protocol-service';
import {
    signContext,
    verifyContext,
    signMessage,
    verifyMessage,
    readVerifyMode,
    resetProtocolSign,
    assertSigned,
    readPrevSignKey,
    readSignVersion,
    HEADER_PROTOCOL_SIGNATURE,
} from './protocol-sign';

//* a test-only key (not a secret).
const KEY = 'unit-test-sign-key';
//* key rotation: a test-only previous key B (not a secret).
const PREV = 'unit-test-prev-key';

//* env names this spec toggles.
const $envKeep: { [key: string]: string } = {
    PROTOCOL_SIGN_KEY: process.env.PROTOCOL_SIGN_KEY,
    PROTOCOL_VERIFY: process.env.PROTOCOL_VERIFY,
    PROTOCOL_SIGN_KEY_PREV: process.env.PROTOCOL_SIGN_KEY_PREV,
    PROTOCOL_SIGN_KEY_PREV_UNTIL: process.env.PROTOCOL_SIGN_KEY_PREV_UNTIL,
    PROTOCOL_SIGN_VERSION: process.env.PROTOCOL_SIGN_VERSION,
};
//* set or delete an env name.
const setEnv = (name: string, val?: string) => {
    if (val === undefined) delete process.env[name];
    else process.env[name] = val;
};

//* dump decoder: `GET /hello/!` returns the context it got.
const decoder: NextDecoder = (mode, id) => {
    const dump: NextHandler = async (id, param, body, context) => ({ id, param, body, context });
    return mode === 'GET' || mode === 'POST' ? (id === '!' ? dump : async () => ({ id })) : null;
};

//* lambda with web, sqs and sns handlers.
const instance = () => {
    const lambda = new (class extends LambdaHandler {})();
    const web = new LambdaWEBHandler(lambda, true);
    web.setHandler('hello', decoder);
    const sqs = new LambdaSQSHandler(lambda, true);
    const sns = new LambdaSNSHandler(lambda, true);
    return { lambda, web, sqs, sns };
};

//* a protocol web event (host-less) built by the real transformer.
const context: NextContext = {
    accountId: '123456789012', //* v5 B10-6: `getHelloArn()` accepts a 12-digit account only (SQS/SNS transformer builds its ARN from it).
    requestId: 'req-1',
    identity: { sid: 'S', uid: 'U', roles: ['admin'] },
};
const webEvent = (body?: any): any =>
    new WEBProtocolTransformer().transformToEvent('api://self/hello/!', {
        service: 'self',
        type: 'hello',
        mode: body ? 'POST' : 'GET',
        id: '!',
        cmd: '',
        context,
        body,
    });

//* capture log lines (the engine logger is silent in `npm test`).
const captureLog = () => {
    const lines: string[] = [];
    const $console: any = $engine.$console;
    const org = $console.log;
    $console.log = (...args: any[]) => lines.push(args.map(a => `${a}`).join(' '));
    return { lines, restore: () => ($console.log = org) };
};

describe('protocol-sign', () => {
    beforeEach(() => resetProtocolSign());
    //* restore the env and the module cache.
    afterEach(() => {
        Object.entries($envKeep).forEach(([key, val]) => setEnv(key, val));
        resetProtocolSign();
    });

    //* the value format and the canonical strings.
    it('should sign and verify a web context', () => {
        const now = 1800000000;
        const sig = signContext('{"a":1}', 'body', { key: KEY, now });
        expect2(() => sig.split('.').length).toEqual(3);
        expect2(() => sig.startsWith(`v1.${now}.`)).toEqual(true);
        expect2(() => verifyContext(sig, '{"a":1}', 'body', { key: KEY, now })).toEqual({ ok: true, ts: now });
        //* the raw string is compared (no re-serialization): a space changes the result.
        expect2(() => verifyContext(sig, '{ "a":1}', 'body', { key: KEY, now }).reason).toEqual('mismatch');
        expect2(() => verifyContext(sig, '{"a":1}', 'bodY', { key: KEY, now }).reason).toEqual('mismatch');
        expect2(() => verifyContext(sig, '{"a":1}', 'body', { key: 'other', now }).reason).toEqual('mismatch');
        //* freshness 300 s.
        expect2(() => verifyContext(sig, '{"a":1}', 'body', { key: KEY, now: now + 300 }).ok).toEqual(true);
        expect2(() => verifyContext(sig, '{"a":1}', 'body', { key: KEY, now: now + 301 }).reason).toEqual('stale');
        //* format and missing.
        expect2(() => verifyContext('', '{}', null, { key: KEY }).reason).toEqual('missing');
        expect2(() => verifyContext('v2.1.x', '{}', null, { key: KEY }).reason).toEqual('format');
        expect2(() => verifyContext(sig, '{}', null, { key: '' }).reason).toEqual('no-key');
        //* null body = empty string.
        const sig2 = signContext('{}', null, { key: KEY, now });
        expect2(() => verifyContext(sig2, '{}', '', { key: KEY, now }).ok).toEqual(true);
        //* no key → no signature.
        expect2(() => signContext('{}', null, { key: '' })).toEqual('');
    });

    //* SNS/SQS: no freshness window.
    it('should sign and verify a message', () => {
        const sig = signMessage('hello', { key: KEY, now: 1000 });
        expect2(() => verifyMessage(sig, 'hello', { key: KEY }).ok).toEqual(true);
        expect2(() => verifyMessage(sig, 'hellO', { key: KEY }).reason).toEqual('mismatch');
        expect2(() => verifyMessage('', 'hello', { key: KEY }).reason).toEqual('missing');
    });

    //* default mode: `warn` if the key is set, else `off`.
    it('should read the verify mode', () => {
        setEnv('PROTOCOL_SIGN_KEY');
        setEnv('PROTOCOL_VERIFY');
        expect2(() => readVerifyMode()).toEqual('off');
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        resetProtocolSign();
        expect2(() => readVerifyMode()).toEqual('warn');
        setEnv('PROTOCOL_VERIFY', 'ENFORCE');
        expect2(() => readVerifyMode()).toEqual('enforce');
        setEnv('PROTOCOL_VERIFY', 'off');
        expect2(() => readVerifyMode()).toEqual('off');
        //* an encrypted `*...` value is never used as is before the config is decrypted.
        setEnv('PROTOCOL_SIGN_KEY', '*AAAA');
        setEnv('PROTOCOL_VERIFY');
        resetProtocolSign();
        expect2(() => readVerifyMode()).toEqual('off');
        //* assertSigned by mode.
        const bad = () => ({ ok: false, reason: 'missing' });
        expect2(() => assertSigned('web', bad, 'off')).toEqual(true);
        expect2(() => assertSigned('web', bad, 'warn')).toEqual(false);
        expect2(() => assertSigned('web', bad, 'enforce')).toEqual('403 NOT ALLOWED - unsigned protocol context');
    });

    //* the transformer signs when the key is set.
    it('should sign the outgoing web event and messages', () => {
        setEnv('PROTOCOL_SIGN_KEY');
        expect2(() => webEvent().headers[HEADER_PROTOCOL_SIGNATURE]).toEqual(undefined);
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        resetProtocolSign();
        const event = webEvent({ a: 1 });
        const sig = event.headers[HEADER_PROTOCOL_SIGNATURE];
        //* v5 B14: the relay header (no `x-protocol-context` by default), signed in the context slot.
        expect2(() => Object.keys(event.headers)).toEqual(['x-lemon-relay', HEADER_PROTOCOL_SIGNATURE]);
        expect2(() => verifyContext(sig, event.headers['x-lemon-relay'], event.body).ok).toEqual(true);
    });

    //* gate 7: host-less web event by mode.
    it('should verify a host-less web event by mode (enforce/warn/off)', async () => {
        const { lambda } = instance();
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');

        //* signed → passes, the context is applied.
        const signed = webEvent();
        const $res = await lambda.handle(signed, null).catch(GETERR$);
        expect2(() => $res, 'statusCode').toEqual({ statusCode: 200 });
        expect2(() => JSON.parse($res.body).context?.identity?.sid).toEqual('S');

        //* unsigned → 403.
        const unsigned = webEvent();
        delete unsigned.headers[HEADER_PROTOCOL_SIGNATURE];
        expect2(await lambda.handle(unsigned, null), 'statusCode,body').toEqual({
            statusCode: 403,
            body: '403 NOT ALLOWED - unsigned protocol context',
        });

        //* tampered body (1 byte) → 403.
        const tampered = webEvent({ a: 1 });
        tampered.body = tampered.body.replace('1', '2');
        expect2(await lambda.handle(tampered, null), 'statusCode').toEqual({ statusCode: 403 });

        //* stale ts (301 s ago) → 403.
        const stale = webEvent();
        const old = Math.floor(Date.now() / 1000) - 301;
        stale.headers[HEADER_PROTOCOL_SIGNATURE] = signContext(stale.headers['x-lemon-relay'], stale.body, {
            now: old,
        });
        expect2(await lambda.handle(stale, null), 'statusCode').toEqual({ statusCode: 403 });

        //* host-less JSON `x-lemon-identity` follows the same rule.
        const idt: any = webEvent();
        delete idt.headers['x-lemon-relay']; //* v5 B14: the relay header of the transformer.
        delete idt.headers['x-protocol-context'];
        delete idt.headers[HEADER_PROTOCOL_SIGNATURE];
        idt.headers['x-lemon-identity'] = $U.json({ sid: 'S2', roles: ['admin'] });
        expect2(await lambda.handle(idt, null), 'statusCode').toEqual({ statusCode: 403 });

        //* `warn` → all pass with 1 log line each.
        setEnv('PROTOCOL_VERIFY', 'warn');
        const $log = captureLog();
        try {
            expect2(await lambda.handle(unsigned, null), 'statusCode').toEqual({ statusCode: 200 });
            expect2(await lambda.handle(tampered, null), 'statusCode').toEqual({ statusCode: 200 });
        } finally {
            $log.restore();
        }
        expect2(() => $log.lines.filter(s => s.includes('PROTOCOL unsigned web')).length).toEqual(2);

        //* no key → `off` (unsigned passes, no log).
        setEnv('PROTOCOL_SIGN_KEY');
        setEnv('PROTOCOL_VERIFY');
        resetProtocolSign();
        expect2(() => readVerifyMode()).toEqual('off');
        expect2(await lambda.handle(unsigned, null), 'statusCode').toEqual({ statusCode: 200 });
    });

    //* gate 6: with `host` the header is dropped even in `enforce`, and even if signed.
    it('should ignore x-protocol-context when a host header is present', async () => {
        const { lambda } = instance();
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        const event = webEvent();
        //* any case of `host`.
        for (const host of ['Host', 'host', 'HOST']) {
            const ext = { ...event, headers: { ...event.headers, [host]: 'api.example.com' } };
            const $res = await lambda.handle(ext, null).catch(GETERR$);
            expect2(() => $res, 'statusCode').toEqual({ statusCode: 200 });
            const ctx = JSON.parse($res.body).context;
            expect2(() => ctx?.identity?.sid).toEqual(undefined);
            expect2(() => ctx?.identity?.roles).toEqual(undefined);
            expect2(() => ctx?.domain).toEqual('api.example.com');
        }
    });

    //* SQS: an unsigned protocol record fails in `enforce` (1 of 2 → 1 `batchItemFailures`).
    it('should verify SQS protocol records before dispatch', async () => {
        const { lambda } = instance();
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        //* a record from the real transformer (signed).
        const asRecord = (messageId: string) => {
            const $msg = new SQSProtocolTransformer(null).transformToEvent('api://self/hello/!', {
                service: 'self',
                type: 'hello',
                mode: 'GET',
                id: 'x',
                cmd: '',
                context,
            } as any);
            const messageAttributes = Object.entries($msg.MessageAttributes).reduce((M: any, [k, v]) => {
                M[k] = { dataType: v.DataType, stringValue: v.StringValue };
                return M;
            }, {});
            return { eventSource: 'aws:sqs', messageId, body: $msg.MessageBody, messageAttributes };
        };
        const ok = asRecord('m-ok');
        const bad = asRecord('m-bad');
        delete bad.messageAttributes['signature'];
        const res = await lambda.handle({ Records: [ok, bad] }, null);
        expect2(res).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-bad' }] });

        //* `warn` → both pass.
        setEnv('PROTOCOL_VERIFY', 'warn');
        expect2(await lambda.handle({ Records: [ok, bad] }, null)).toEqual({ batchItemFailures: [] });
    });

    //* SNS: a rejected record is reported and the handler resolves `void`.
    it('should resolve SNS with an unsigned record in enforce', async () => {
        const { lambda } = instance();
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        const record = { Sns: { Subject: 'x-protocol-service', Message: '{}', MessageAttributes: {} } };
        expect2(await lambda.handle({ Records: [record] }, null)).toEqual(undefined);
    });

    //* key rotation: A first, then B only while `now <= until` (web, by options).
    it('should verify a web context with the previous key B within its window', () => {
        const now = 1800000000;
        const until = now + 100;
        const sigA = signContext('{"a":1}', 'body', { key: KEY, now });
        const sigB = signContext('{"a":1}', 'body', { key: PREV, now });
        const $v = (sig: string, opts: any) => verifyContext(sig, '{"a":1}', 'body', { key: KEY, now, ...opts });
        //* A ok (no `prev` flag), with or without B.
        expect2(() => $v(sigA, {})).toEqual({ ok: true, ts: now });
        expect2(() => $v(sigA, { prevKey: PREV, prevUntil: until })).toEqual({ ok: true, ts: now });
        //* B ok within the window → `prev: true`.
        expect2(() => $v(sigB, { prevKey: PREV, prevUntil: until })).toEqual({ ok: true, ts: now, prev: true });
        expect2(() => $v(sigB, { prevKey: PREV, prevUntil: now })).toEqual({ ok: true, ts: now, prev: true });
        //* B after the window, B without `until`, `key` only → mismatch.
        expect2(() => $v(sigB, { prevKey: PREV, prevUntil: now - 1 }).reason).toEqual('mismatch');
        expect2(() => $v(sigB, { prevKey: PREV }).reason).toEqual('mismatch');
        expect2(() => $v(sigB, {}).reason).toEqual('mismatch');
        //* both keys wrong → mismatch.
        expect2(() => $v(sigB, { key: 'other-key-1', prevKey: 'other-key-2', prevUntil: until }).reason).toEqual(
            'mismatch',
        );
        //* format and freshness are checked once, before any key (B does not widen them).
        expect2(() => $v(sigB, { prevKey: PREV, prevUntil: until, now: now + 301 }).reason).toEqual('stale');
        expect2(() => $v('v1.x.y', { prevKey: PREV, prevUntil: until }).reason).toEqual('format');
        //* no A → `no-key` even with B.
        expect2(() => $v(sigB, { key: '', prevKey: PREV, prevUntil: until }).reason).toEqual('no-key');
    });

    //* key rotation: the message path (SNS/SQS) uses `now` only for the B window.
    it('should verify a message with the previous key B within its window', () => {
        const now = 1800000000;
        const sigB = signMessage('hello', { key: PREV, now: 1000 });
        const $v = (opts: any) => verifyMessage(sigB, 'hello', { key: KEY, now, ...opts });
        expect2(() => $v({ prevKey: PREV, prevUntil: now + 1 })).toEqual({ ok: true, ts: 1000, prev: true });
        expect2(() => $v({ prevKey: PREV, prevUntil: now - 1 }).reason).toEqual('mismatch');
        expect2(() => $v({ prevKey: PREV }).reason).toEqual('mismatch');
        expect2(() => $v({}).reason).toEqual('mismatch');
        expect2(() => verifyMessage(signMessage('hello', { key: KEY }), 'hello', { key: KEY, now }).prev).toEqual(
            undefined,
        );
    });

    //* key rotation: B from the env (`PROTOCOL_SIGN_KEY_PREV` + `_PREV_UNTIL`), fail-closed without `_PREV_UNTIL`.
    it('should read the previous key B from the env', () => {
        const now = Math.floor(Date.now() / 1000);
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_SIGN_KEY_PREV', PREV);
        setEnv('PROTOCOL_SIGN_KEY_PREV_UNTIL');
        expect2(() => readPrevSignKey(now)).toEqual('');
        resetProtocolSign();
        setEnv('PROTOCOL_SIGN_KEY_PREV_UNTIL', `${now + 60}`);
        expect2(() => readPrevSignKey(now)).toEqual(PREV);
        expect2(() => readPrevSignKey(now + 61)).toEqual('');
        //* not a number, zero, negative → not used.
        for (const bad of ['abc', '0', '-5']) {
            resetProtocolSign();
            setEnv('PROTOCOL_SIGN_KEY_PREV_UNTIL', bad);
            expect2(() => readPrevSignKey(now)).toEqual('');
        }
        //* a failed KMS decrypt is not a key.
        resetProtocolSign();
        setEnv('PROTOCOL_SIGN_KEY_PREV', 'ERROR - fake decrypt failure');
        setEnv('PROTOCOL_SIGN_KEY_PREV_UNTIL', `${now + 60}`);
        expect2(() => readPrevSignKey(now)).toEqual('');
        //* verify without options reads B from the env.
        resetProtocolSign();
        setEnv('PROTOCOL_SIGN_KEY_PREV', PREV);
        const sigB = signMessage('hello', { key: PREV });
        expect2(() => verifyMessage(sigB, 'hello')).toEqual({ ok: true, ts: Number(sigB.split('.')[1]), prev: true });
        expect2(() => verifyMessage(sigB, 'hello', { now: now + 3600 }).reason).toEqual('mismatch');
        //* signing always uses A.
        expect2(() => verifyMessage(signMessage('hello'), 'hello', { key: KEY }).ok).toEqual(true);
    });

    //* key rotation: web, SQS and SNS handlers accept B while valid, and reject it after (enforce).
    it('should accept the previous key B in the web, SQS and SNS handlers', async () => {
        const { lambda } = instance();
        const now = Math.floor(Date.now() / 1000);
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        setEnv('PROTOCOL_SIGN_KEY_PREV', PREV);
        setEnv('PROTOCOL_SIGN_KEY_PREV_UNTIL', `${now + 60}`);
        //* web: a call signed by B.
        const web = webEvent({ a: 1 });
        web.headers[HEADER_PROTOCOL_SIGNATURE] = signContext(web.headers['x-lemon-relay'], web.body, { key: PREV });
        expect2(await lambda.handle(web, null), 'statusCode').toEqual({ statusCode: 200 });
        //* SQS: a record signed by B.
        const $msg = new SQSProtocolTransformer(null).transformToEvent('api://self/hello/!', {
            service: 'self',
            type: 'hello',
            mode: 'GET',
            id: 'x',
            cmd: '',
            context,
        } as any);
        const messageAttributes = Object.entries($msg.MessageAttributes).reduce((M: any, [k, v]) => {
            M[k] = { dataType: v.DataType, stringValue: v.StringValue };
            return M;
        }, {});
        messageAttributes['signature'].stringValue = signMessage($msg.MessageBody, { key: PREV });
        const sqsRecord = { eventSource: 'aws:sqs', messageId: 'm-b', body: $msg.MessageBody, messageAttributes };
        expect2(await lambda.handle({ Records: [sqsRecord] }, null)).toEqual({ batchItemFailures: [] });
        //* SNS: B-signed → no `unsigned` line in `warn`.
        const snsRecord = {
            Sns: {
                Subject: 'x-protocol-service',
                Message: '{}',
                MessageAttributes: { signature: { Type: 'String', Value: signMessage('{}', { key: PREV }) } },
            },
        };
        setEnv('PROTOCOL_VERIFY', 'warn');
        const $log1 = captureLog();
        try {
            await lambda.handle({ Records: [snsRecord] }, null);
        } finally {
            $log1.restore();
        }
        expect2(() => $log1.lines.filter(s => s.includes('PROTOCOL unsigned sns')).length).toEqual(0);

        //* B expired → web 403, SQS fails the record, SNS logs `mismatch`.
        resetProtocolSign();
        setEnv('PROTOCOL_SIGN_KEY_PREV_UNTIL', `${now - 1}`);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        expect2(await lambda.handle(web, null), 'statusCode').toEqual({ statusCode: 403 });
        expect2(await lambda.handle({ Records: [sqsRecord] }, null)).toEqual({
            batchItemFailures: [{ itemIdentifier: 'm-b' }],
        });
        setEnv('PROTOCOL_VERIFY', 'warn');
        const $log2 = captureLog();
        try {
            await lambda.handle({ Records: [snsRecord] }, null);
        } finally {
            $log2.restore();
        }
        expect2(() => $log2.lines.filter(s => s.includes('PROTOCOL unsigned sns (mismatch)')).length).toEqual(1);
    });

    //* nonce: `v2.<ts>.<nonce>.<sig>` — a fresh nonce per signature, in the canonical; v1 still verified.
    it('should sign and verify v2 (nonce) next to v1', () => {
        const now = 1000;
        const v2 = (nonce?: string) => signContext('{"a":1}', 'body', { key: KEY, now, version: 'v2', nonce });
        const [s1, s2] = [v2(), v2()];
        const parts = s1.split('.');
        expect2(() => [parts.length, parts[0], parts[1], parts[2].length]).toEqual([4, 'v2', `${now}`, 22]);
        //* same input, same second → different signatures (the nonce).
        expect2(() => [s1 !== s2, s1.split('.')[2] !== s2.split('.')[2]]).toEqual([true, true]);
        expect2(() => verifyContext(s1, '{"a":1}', 'body', { key: KEY, now })).toEqual({ ok: true, ts: now });
        //* the nonce is signed: another nonce with the same sig is a mismatch.
        const forged = ['v2', now, 'Z'.repeat(22), parts[3]].join('.');
        expect2(() => verifyContext(forged, '{"a":1}', 'body', { key: KEY, now }).reason).toEqual('mismatch');
        //* a v2 sig is not a v1 sig: dropping the nonce does not verify.
        expect2(() => verifyContext(`v1.${now}.${parts[3]}`, '{"a":1}', 'body', { key: KEY, now }).reason).toEqual(
            'mismatch',
        );
        //* malformed nonce → format.
        expect2(() => verifyContext(v2('short'), '{"a":1}', 'body', { key: KEY, now }).reason).toEqual('format');
        expect2(() => verifyContext(v2('bad.nonce-0123456789'), '{"a":1}', 'body', { key: KEY, now }).reason).toEqual(
            'format',
        );
        //* v1 keeps verifying, and B works for v2.
        const v1 = signContext('{"a":1}', 'body', { key: KEY, now, version: 'v1' });
        expect2(() => v1.split('.').length).toEqual(3);
        expect2(() => verifyContext(v1, '{"a":1}', 'body', { key: KEY, now })).toEqual({ ok: true, ts: now });
        const b2 = signContext('{"a":1}', 'body', { key: PREV, now, version: 'v2' });
        expect2(() => verifyContext(b2, '{"a":1}', 'body', { key: KEY, prevKey: PREV, prevUntil: now, now })).toEqual({
            ok: true,
            ts: now,
            prev: true,
        });
        //* messages: same rules.
        const m2 = signMessage('hello', { key: KEY, now, version: 'v2' });
        expect2(() => m2.startsWith(`v2.${now}.`)).toEqual(true);
        expect2(() => verifyMessage(m2, 'hello', { key: KEY, now })).toEqual({ ok: true, ts: now });
        expect2(() => verifyMessage(m2, 'hello!', { key: KEY, now }).reason).toEqual('mismatch');
    });

    it('should write v2 only with PROTOCOL_SIGN_VERSION=v2, and the handlers take it', async () => {
        const { lambda } = instance();
        setEnv('PROTOCOL_SIGN_KEY', KEY);
        setEnv('PROTOCOL_VERIFY', 'enforce');
        resetProtocolSign();
        //* default v1 — the wire is unchanged until the switch.
        setEnv('PROTOCOL_SIGN_VERSION');
        expect2(() => [readSignVersion(), signMessage('x').split('.')[0]]).toEqual(['v1', 'v1']);
        setEnv('PROTOCOL_SIGN_VERSION', 'other');
        expect2(() => readSignVersion()).toEqual('v1');
        setEnv('PROTOCOL_SIGN_VERSION', 'V2');
        expect2(() => readSignVersion()).toEqual('v2');
        //* web: the outgoing event carries v2, the enforce receiver takes it.
        const web = webEvent({ a: 1 });
        expect2(() => web.headers[HEADER_PROTOCOL_SIGNATURE].split('.')[0]).toEqual('v2');
        expect2(await lambda.handle(web, null), 'statusCode').toEqual({ statusCode: 200 });
        //* SQS: a v2 record passes enforce.
        const $msg = new SQSProtocolTransformer(null).transformToEvent('api://self/hello/!', {
            service: 'self',
            type: 'hello',
            mode: 'GET',
            id: 'x',
            cmd: '',
            context,
        } as any);
        const messageAttributes = Object.entries($msg.MessageAttributes).reduce((M: any, [k, v]) => {
            M[k] = { dataType: v.DataType, stringValue: v.StringValue };
            return M;
        }, {});
        expect2(() => messageAttributes['signature'].stringValue.split('.')[0]).toEqual('v2');
        const sqsRecord = { eventSource: 'aws:sqs', messageId: 'm-2', body: $msg.MessageBody, messageAttributes };
        expect2(await lambda.handle({ Records: [sqsRecord] }, null)).toEqual({ batchItemFailures: [] });
    });
});
