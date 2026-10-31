/**
 * `helpers.b18.spec.ts`
 * - v5 B18-c: table tests of `$T`, `$protocol`, `$slack`, `$event` and the SigV4 proxy (no network).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

//* v5 B18: the proxy transport is a fake; it echoes the request.
vi.mock('../lib/http-fetch', async importOriginal => {
    const org: any = await importOriginal();
    return { ...org, fetchProxyBody: vi.fn(async (req: any) => ({ data: { url: req.url }, headers: req.headers })) };
});

import $cores from '../cores/';
import { $U } from '../engine/';
import { $T, $protocol, $slack, $event, $info, createSigV4Proxy, parsePaginateParam } from './helpers';

describe('helpers B18', () => {
    const KEYS = ['MAX_LIMIT', 'EVENT_RELAY_SNS', 'LOCAL_MODE', 'AWS_LAMBDA_FUNCTION_NAME', 'NS'];
    const $env: Record<string, string> = KEYS.reduce((M, k) => ({ ...M, [k]: process.env[k] }), {});
    afterEach(() => {
        vi.restoreAllMocks();
        KEYS.forEach(k => ($env[k] === undefined ? delete process.env[k] : (process.env[k] = $env[k])));
    });

    it('B18 $T number, bool and list conversions', () => {
        expect([$T.BN(null, 1), $T.BN(true), $T.BN(false), $T.BN('Yes'), $T.BN('t'), $T.BN('0'), $T.BN('2')]).toEqual([
            1, 1, 0, 1, 1, 0, 1,
        ]);
        expect($T.SS(['a', 1])).toEqual(['a', '1']);
        //* `SS()` has no default: empty input gives `[]`; a non-list value is one item.
        expect([$T.SS(null), $T.SS([]), $T.SS(''), $T.SS(12)]).toEqual([[], [], [], ['12']]);
        expect([$T.NN(null), $T.NN(''), $T.NN('1,2'), $T.NN(['3']), $T.NN([]), $T.NN(4)]).toEqual([
            [],
            [],
            [1, 2],
            [3],
            [],
            [4],
        ]);
        expect([$T.FF(undefined), $T.FF(''), $T.FF('1.5,2'), $T.FF([0.5]), $T.FF([]), $T.FF(2.5)]).toEqual([
            [],
            [],
            [1.5, 2],
            [0.5],
            [],
            [2.5],
        ]);
    });

    it('B18 $T time and date formats', () => {
        expect($T.T('2020-01-02 00:00:00')).toEqual($U.dt('2020-01-02 00:00:00').getTime());
        expect(() => $T.T('20-x-y')).toThrow('@val[20-x-y] is invalid!');
        expect($T.DT('2021-3-4')).toEqual('2021-03-04');
        expect($T.DT('2021')).toEqual('2021-01-01');
        expect($T.DT('', '2000-02-03')).toEqual('2000-02-03');
        expect($T.DT('x', '2000--')).toEqual('2000-01-01');
    });

    it('B18 $T simples, clear, nul2str, asLut, diff, asMeta', () => {
        expect($T.simples(undefined)).toEqual(undefined);
        expect([$T.simples(null), $T.simples('')]).toEqual([{ _: null }, { _: null }]);
        expect([$T.simples('a'), $T.simples(1)]).toEqual([{ _: 'a' }, { _: 1 }]);
        expect($T.simples([1])).toEqual({});
        expect(() => $T.simples([1], true)).toThrow('@val[object] is invalid!');
        expect($T.clear({ a: 1, b: undefined })).toEqual({ a: 1 });
        expect([$T.nul2str(undefined), $T.nul2str(null), $T.nul2str(1)]).toEqual([undefined, '', '1']);
        expect(() => $T.asLut('x', { a: 'A' }, { errScope: '' })).toThrow('.name[x] is invalid!');
        expect($T.diff({ a: 1 }, 'b' as any)).toEqual('b');
        expect($T.diff(null, { a: 1 })).toEqual({ a: 1 });
        expect($T.asMeta(null)).toEqual({});
        expect(() => $T.asMeta('x', { errScope: '@b18' })).toThrow('@body (object) is required @b18');
        expect(() => $T.asMeta(1)).toThrow(/^@body \(object\) is required$/);
        expect($T.asMeta({ a: 1, b: 's', c: [1, 'x', {}], d: {}, e: null })).toEqual({ a: 1, b: 's', c: [1, 'x'] });
    });

    it('B18 $T.reduceAggr()', () => {
        const aggr = {
            doc_count: 10,
            names: { doc_count: 3, buckets: [{ key: 'a', doc_count: 2 }, { key: 1, doc_count: 1 }, { key: 'b' }] },
            other: { x: 1 },
        };
        expect($T.reduceAggr(aggr)).toEqual({ doc_count: { total: 10 }, names: { total: 3, a: 2 }, other: {} });
    });

    it('B18 parsePaginateParam() with an invalid MAX_LIMIT', () => {
        process.env.MAX_LIMIT = '0';
        expect(() => parsePaginateParam({ limit: 1 })).toThrow('@env.MAX_LIMIT[0] (number) is invalid!');
    });

    it('B18 $protocol() builds params and calls the protocol service', async () => {
        const service = $cores.protocol.service;
        //* v5 B18: the protocol sends are stubbed; `fromURL()` stays real.
        const execute = vi.spyOn(service, 'execute').mockResolvedValue('ok' as any);
        const enqueue = vi.spyOn(service, 'enqueue').mockResolvedValue('qid');
        const notify = vi.spyOn(service, 'notify').mockResolvedValue('nid');

        expect(() => $protocol(null, '//b18-api/x')).toThrow('@context (NextContext) is required!');
        expect(() => $protocol({}, '')).toThrow('@service (string) is required!');
        expect(() => $protocol({}, 'b18-api').asTargetUrl()).toThrow('@service[b18-api] (string) is invalid!');

        const $p = $protocol({}, '//b18-api/items', { isProd: true, param: { a: 1 } });
        expect($p.hello()).toEqual('helper:protocol://b18-api/items');
        expect($p.asTargetUrl()).toEqual('api://b18-api/items');
        expect(await $p.execute(null, { b: 2 }, 'PUT')).toEqual('ok');
        expect(execute.mock.calls[0][0]).toMatchObject({ mode: 'PUT', stage: 'prod', param: { a: 1 }, body: { b: 2 } });
        expect(await $p.enqueue({ q: 1 }, null, undefined, 'items/1/go?x=1', 3)).toEqual('qid');
        expect(enqueue.mock.calls[0][1]).toEqual({ type: 'items', id: '1', cmd: 'go', param: { x: '1' } });
        expect(enqueue.mock.calls[0][2]).toEqual(3);
        expect(await $p.enqueue()).toEqual('qid');
        expect(enqueue.mock.calls[1][1]).toEqual(undefined);
        expect(await $p.notify(null, null, 'POST', '?x=1')).toEqual('nid');
        expect(notify.mock.calls[0][1]).toEqual(undefined);
    });

    //* v5 B22: the legacy form used to map `stage` only (its `param` was read after `service` was reassigned).
    it('B22 legacy $protocol(service, param, body) maps param and body', async () => {
        const execute = vi.spyOn($cores.protocol.service, 'execute').mockResolvedValue('ok' as any);
        //* legacy form: `$protocol(service, param, body)`; `NS=SS` means prod.
        process.env.NS = 'SS';
        const $p2 = ($protocol as any)('//self/items', { p: 1 }, { b: 1 });
        expect($p2.hello()).toEqual('helper:protocol://self/items');
        expect($p2.asTargetUrl().startsWith('api://')).toEqual(true);
        expect($p2.asTargetUrl().endsWith('/items')).toEqual(true);
        await $p2.execute();
        //* v5 B22: the legacy form maps the 2nd argument to `param` and the 3rd to `body`.
        expect(execute.mock.calls[0][0]).toMatchObject({ stage: 'prod', param: { p: 1 }, body: { b: 1 } });
        //* v5 B22: arguments of `execute()` still win over the legacy defaults.
        await $p2.execute({ q: 2 }, { c: 2 }, 'PUT');
        expect(execute.mock.calls[1][0]).toMatchObject({ mode: 'PUT', param: { q: 2 }, body: { c: 2 } });
        //* v5 B22: in the legacy form the 3rd argument is the body only (no `isProd` from it).
        process.env.NS = 'B22';
        await ($protocol as any)('//b22-api/items', { p: 1 }, { isProd: true }).execute();
        expect(execute.mock.calls[2][0].stage).not.toEqual('prod');
        expect(execute.mock.calls[2][0]).toMatchObject({ param: { p: 1 }, body: { isProd: true } });
        //* v5 B22: the 1-argument form (`$protocol(service)`) has no default param or body.
        await ($protocol as any)('//b22-api/items').execute();
        expect(execute.mock.calls[3][0].param).toEqual(undefined);
        expect(execute.mock.calls[3][0].body).toEqual(undefined);
    });

    it('B18 $info(), $slack() in local mode, $event()', async () => {
        const info = $info();
        expect(Object.keys(info)).toEqual(['service', 'version', 'stage']);
        //* local mode: the slack report is ignored (no SNS).
        process.env.LOCAL_MODE = '1';
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        expect(await $slack('B18', { a: 1 }, null, { scope: 's', footer: null, ts: null })).toEqual('!ignore');
        expect(await $slack('B18', 'text', undefined, { channel: 'b18', fields: [] })).toEqual('!ignore');
        expect(await $slack()).toEqual('!ignore');

        delete process.env.EVENT_RELAY_SNS;
        expect(() => $event({})).toThrow('env[EVENT_RELAY_SNS] is required - $event()');
        const broadcast = vi.spyOn($cores.protocol.service, 'broadcast').mockResolvedValue('bid');
        const $e = $event({}, 'sns://b18-topic');
        expect(await $e.publish({ a: 1 })).toEqual('bid');
        expect(broadcast).toHaveBeenCalledWith({}, 'sns://b18-topic', { a: 1 });
    });

    it('B18 createSigV4Proxy() relays headers and picks the result key', async () => {
        const $px = createSigV4Proxy('b18', 'https://b18.invalid', undefined, {
            headers: { 'x-b18': 'v', n: 1 } as any,
            relayHeaderKey: 'r-',
            resultKey: 'data',
            verbose: true,
        });
        expect(await $px.doProxy('GET', 'h', 'p', { q: 1 })).toEqual({ url: 'https://b18.invalid/h/p?q=1' });
        //* without the key in the result, the whole result.
        const $px2 = createSigV4Proxy('b18', 'https://b18.invalid', undefined, {
            headers: { a: 'b' },
            resultKey: 'none',
        });
        expect(await $px2.doProxy('POST', 'h', null, null, { a: 1 })).toMatchObject({ headers: { a: 'b' } });
    });
});
