/**
 * `perf.spec.ts`
 * - unit test for `measure()` / `measureAsync()` (v5 B2-c, D40)
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { measure, measureAsync, nowMs } from './perf';

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
});
