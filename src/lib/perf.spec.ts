/**
 * `perf.spec.ts`
 * - unit test for `measure()` / `measureAsync()` (v5 B2-c, D40), and `PerfTrace` (v5 B7)
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { measure, measureAsync, nowMs, PerfTrace } from './perf';

describe('perf', () => {
    // sync: returns the result and logs one line `(ns, '>', label, '<n.n> ms')`.
    it('measure() returns the result and logs once', () => {
        const log = vi.fn();
        const t0 = nowMs();
        expect(measure(log, 'PERF:', 'work', () => 42)).toBe(42);
        expect(nowMs()).toBeGreaterThanOrEqual(t0);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('PERF:', '>', 'work', expect.stringMatching(/^\d+\.\d ms$/));
    });

    // async: the same after the promise resolves.
    it('measureAsync() resolves the result and logs once', async () => {
        const log = vi.fn();
        await expect(measureAsync(log, 'PERF:', 'work', async () => 'ok')).resolves.toBe('ok');
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('PERF:', '>', 'work', expect.stringMatching(/^\d+\.\d ms$/));
    });

    // errors pass through, and nothing is logged.
    it('errors are passed through without a line', async () => {
        const log = vi.fn();
        expect(() =>
            measure(log, 'PERF:', 'bad', () => {
                throw new Error('boom');
            }),
        ).toThrow('boom');
        await expect(measureAsync(log, 'PERF:', 'bad', async () => Promise.reject(new Error('boom2')))).rejects.toThrow(
            'boom2',
        );
        expect(log).not.toHaveBeenCalled();
    });

    // PerfTrace: each mark keeps the ms since the previous mark; `elapsed()` covers all marks.
    it('PerfTrace marks the steps in order', async () => {
        const trace = new PerfTrace();
        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
        await wait(5);
        const a = trace.mark('a');
        await wait(5);
        const b = trace.mark('b');
        const marks = trace.marks();
        expect(Object.keys(marks)).toEqual(['a', 'b']);
        expect(marks).toEqual({ a, b });
        expect(a).toBeGreaterThanOrEqual(3);
        expect(b).toBeGreaterThanOrEqual(3);
        expect(trace.elapsed()).toBeGreaterThanOrEqual(a + b);
        // `marks()` is a copy.
        marks.a = -1;
        expect(trace.marks().a).toBe(a);
    });

    // PerfTrace.line(): the given key order, empty values dropped, boolean as 1/0, numbers with one decimal.
    it('PerfTrace.line() builds the key=value tail', () => {
        const trace = new PerfTrace();
        expect(
            trace.line({
                mode: 'GET',
                type: 'hello',
                cmd: '',
                id: undefined,
                host: null,
                status: '200',
                context: 0,
                param: 1.26,
                handler: 12,
                cold: true,
                warm: false,
            }),
        ).toBe('mode=GET type=hello status=200 context=0.0 param=1.3 handler=12.0 cold=1 warm=0');
        expect(trace.line({ z: 1, a: 2 })).toBe('z=1.0 a=2.0');
        expect(trace.line({})).toBe('');
    });
});
