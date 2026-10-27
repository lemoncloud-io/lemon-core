/**
 * `lib/perf.ts`
 * - (internal) performance checkpoint helpers for the `PERF` log lines (v5 B2-c, D40).
 * - not exported by the `lib` barrel.
 * - imports nothing from `engine/`: the caller passes its logger and namespace,
 *   so `tools/` and other engine-free files can use it too.
 *
 * line format: `log(ns, '>', label, '<ms> ms')` with one decimal, e.g. `PERF: > lazy-load <package> 12.3 ms`.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 v5 B2-c (D40)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */

/** a logger like `_inf` or `$engine.inf`. */
export type PerfLogger = (...args: any[]) => void;

/**
 * current monotonic time in ms (from `process.hrtime.bigint()`).
 */
export const nowMs = (): number => Number(process.hrtime.bigint()) / 1e6;

// format the elapsed ms with one decimal.
const asMs = (t0: number): string => `${(nowMs() - t0).toFixed(1)} ms`;

/**
 * run `fn` and print one line with its elapsed ms; returns the result.
 * - an exception is thrown as is, and no line is printed.
 *
 * @param log   logger (e.g. `_inf`)
 * @param ns    namespace (e.g. `$U.NS('PERF', 'cyan')`)
 * @param label checkpoint label (no values, no hosts)
 * @param fn    the work to measure
 */
export const measure = <T>(log: PerfLogger, ns: string, label: string, fn: () => T): T => {
    const t0 = nowMs();
    const res = fn();
    log(ns, '>', label, asMs(t0));
    return res;
};

/**
 * the async version of `measure()`: the line is printed after `fn()` resolves.
 * - a rejection is passed through, and no line is printed.
 */
export const measureAsync = async <T>(log: PerfLogger, ns: string, label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = nowMs();
    const res = await fn();
    log(ns, '>', label, asMs(t0));
    return res;
};
