/**
 * `perf-contract.spec.ts`
 * - contract test for the two Lambda `PERF` lines (v5 B9, D56): `request` and `handle`.
 * - the consumer is the templates-api harness `perf:lambda`; it parses these lines by key name.
 * - offline: no AWS, no network.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-29 v5 B9 (D56)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextDecoder, NextHandler } from 'lemon-model';
import { $engine } from '../../engine/';
import { loadJsonSync } from '../../tools/';

/**
 * the keys of the `request` line, in order (`cmd` is printed only when the route has one).
 * - 5.x contract (D56): appending keys at the end is the only allowed change; rename, remove or reorder = major.
 */
const REQUEST_KEYS = ['mode', 'type', 'cmd', 'status', 'context', 'param', 'handler', 'response', 'cold'];

/**
 * the keys of the `handle` line, in order.
 * - 5.x contract (D56): appending keys at the end is the only allowed change; rename, remove or reorder = major.
 */
const HANDLE_KEYS = ['type', 'cold'];

//* the stage keys of the `request` line (ms with one decimal).
const STAGE_KEYS = ['context', 'param', 'handler', 'response'];
//* a number with exactly one decimal.
const ONE_DECIMAL = /^\d+\.\d$/;

//* a minimal decoder for the `hello` type: `cmd` → ok, id `0` → 404, else ok.
const decoder: NextDecoder = (mode, id, cmd) => {
    if (mode !== 'GET') return null;
    if (cmd) return (async (id: string) => ({ id, cmd })) as NextHandler;
    if (id === '0')
        return (async (id: string) => {
            throw new Error(`404 NOT FOUND - id:${id}`);
        }) as NextHandler;
    return (async (id: string) => ({ id })) as NextHandler;
};

//* a fresh web event for the `hello` type (the B7 fixture).
const eventOf = (id: string, cmd?: string): any => {
    const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
    event.pathParameters['id'] = id;
    if (cmd) event.pathParameters['cmd'] = cmd;
    return event;
};

//* rebuild the printed lines (`PERF: > <label> …`) from the logged args: drop the ts/level prefix and colors.
const linesOf = (calls: any[][], label: string): string[] =>
    calls
        .map(args => args.map(a => `${a}`.replace(/\x1b\[[0-9;]*m/g, '')))
        .map(args => args.slice(args.findIndex(a => a.trim() === 'PERF:')))
        .filter(args => args.length > 2 && args[0].trim() === 'PERF:' && args[1] === '>' && args[2] === label)
        .map(args => args.map(a => a.trim()).join(' '));

//* parse one line by spaces: `PERF: > <label> <n.n> ms k=v …`.
const parse = (line: string) => {
    const tokens = line.split(' ');
    const [prefix, arrow, label, total, unit, ...pairs] = tokens;
    const keys = pairs.map(kv => kv.split('=')[0]);
    const values = pairs.reduce<Record<string, string>>((M, kv) => {
        const i = kv.indexOf('=');
        return { ...M, [kv.substring(0, i)]: kv.substring(i + 1) };
    }, {});
    return { prefix: `${prefix} ${arrow} ${label}`, total, unit, pairs, keys, values };
};

//* the checks shared by both lines: one `k=v` per token, and no `/`, `:` or `@` in any value.
const expectPairs = (pairs: string[], values: Record<string, string>) => {
    pairs.forEach(kv => expect(kv).toMatch(/^[a-z]+=[^\s=]+$/));
    Object.values(values).forEach(v => expect(v).not.toMatch(/[/:@]/));
};

//! v5 B9 (D56): the `PERF` line contract.
describe('PERF line contract (v5 B9, D56)', () => {
    //* request lines: success, success with `cmd`, failure (404); `cold=1` on the first line only.
    it('request line: prefix, total, key order, values', async () => {
        //* fresh modules → a fresh `cold` counter (like a new process).
        vi.resetModules();
        const $web = await import('./lambda-web-handler');
        const $lam = await import('./lambda-handler');
        const service = new $web.LambdaWEBHandler(new $lam.LambdaHandler(), true);
        service.setHandler('hello', decoder);
        const spy = vi.spyOn($engine.$console, 'log');
        try {
            //* 1) success: GET /hello/abc
            const e1 = eventOf('abc');
            expect((await service.handle(e1, await service.packContext(e1, null))).statusCode).toBe(200);
            //* 2) failure: GET /hello/0 → 404
            const e2 = eventOf('0');
            expect((await service.handle(e2, await service.packContext(e2, null))).statusCode).toBe(404);
            //* 3) success with cmd: GET /hello/abc/hi
            const e3 = eventOf('abc', 'hi');
            expect((await service.handle(e3, await service.packContext(e3, null))).statusCode).toBe(200);

            const lines = linesOf(spy.mock.calls, 'request');
            expect(lines.length).toBe(3);
            const [l1, l2, l3] = lines.map(parse);

            //* prefix and total (`<n>.<d> ms`).
            [l1, l2, l3].forEach(l => {
                expect(l.prefix).toBe('PERF: > request');
                expect(l.total).toMatch(ONE_DECIMAL);
                expect(l.unit).toBe('ms');
            });

            //* key order: exactly `REQUEST_KEYS`, `cmd` only when the route has one, no extra keys.
            const noCmd = REQUEST_KEYS.filter(k => k !== 'cmd');
            expect(l1.keys).toEqual(noCmd);
            expect(l2.keys).toEqual(noCmd);
            expect(l3.keys).toEqual(REQUEST_KEYS);

            //* values: route words, numeric status, stage ms with one decimal, `cold` 1 then 0.
            [l1, l2, l3].forEach(l => {
                expectPairs(l.pairs, l.values);
                expect(l.values.status).toMatch(/^\d{3}$/);
                STAGE_KEYS.forEach(k => expect(l.values[k]).toMatch(ONE_DECIMAL));
                expect(l.values.mode).toBe('GET');
                expect(l.values.type).toBe('hello');
            });
            expect([l1, l2, l3].map(l => l.values.status)).toEqual(['200', '404', '200']);
            expect(l3.values.cmd).toBe('hi');
            expect([l1, l2, l3].map(l => l.values.cold)).toEqual(['1', '0', '0']);
            //* no id from the event in the line.
            lines.forEach(line => expect(line.includes('abc')).toBe(false));
        } finally {
            spy.mockRestore();
        }
    });

    //* handle line: the `LambdaModule` handler prints `PERF: > handle <n.n> ms type=<type> cold=<1|0>`.
    it('handle line: prefix, total, key order, values', async () => {
        //* fresh modules → a fresh `cold` counter (like a new process).
        vi.resetModules();
        const $mod = await import('./index');
        const inf = vi.fn();
        const engine: any = { register: () => {}, initialize: vi.fn(async () => {}), inf };
        const mod = new $mod.LambdaModule(engine);
        mod.web.setHandler('hello', decoder);

        //* two web calls → `cold=1` then `cold=0`.
        expect((await mod.lambda.handle(eventOf('abc'), null)).statusCode).toBe(200);
        expect((await mod.lambda.handle(eventOf('0'), null)).statusCode).toBe(404);

        const lines = linesOf(inf.mock.calls, 'handle');
        expect(lines.length).toBe(2);
        const parsed = lines.map(parse);
        parsed.forEach(l => {
            expect(l.prefix).toBe('PERF: > handle');
            expect(l.total).toMatch(ONE_DECIMAL);
            expect(l.unit).toBe('ms');
            expect(l.keys).toEqual(HANDLE_KEYS);
            expectPairs(l.pairs, l.values);
            expect(l.values.type).toBe('web');
        });
        expect(parsed.map(l => l.values.cold)).toEqual(['1', '0']);
    });
});
