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
 * @date        2026-10-28 v5 B7: `PerfTrace` for the per-request `PERF` lines.
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

/** a value of `PerfTrace.line()`: `undefined`, `null` and `''` drop the key. */
export type PerfValue = string | number | boolean | null | undefined;

/**
 * class: `PerfTrace`
 * - step marks of one request (v5 B7): each `mark(name)` keeps the ms since the previous mark (or the start).
 * - holds numbers only; the caller prints the line with its own logger.
 */
export class PerfTrace {
    //* start time (t0), and the cursor of the last mark.
    private readonly t0: number;
    private cursor: number;
    //* marks by name (the insertion order is kept).
    private readonly $marks: Record<string, number> = {};

    //* start the trace now.
    public constructor() {
        this.t0 = nowMs();
        this.cursor = this.t0;
    }

    /**
     * keep the ms since the previous mark (or t0) as `name`, then move the cursor.
     * @returns the ms of this mark.
     */
    public mark(name: string): number {
        const now = nowMs();
        const ms = now - this.cursor;
        this.$marks[name] = ms;
        this.cursor = now;
        return ms;
    }

    /** the ms since t0. */
    public elapsed(): number {
        return nowMs() - this.t0;
    }

    /** a copy of the marks. */
    public marks(): Record<string, number> {
        return { ...this.$marks };
    }

    /**
     * build the `key=value` tail in the given key order.
     * - `undefined`, `null` and `''` drop the key; a boolean is `1`/`0`; a number (ms) has one decimal.
     * - pass a number that is not ms (ex: an HTTP status) as a string.
     */
    public line(extra: Record<string, PerfValue>): string {
        //* format one value (or `null` to drop the key).
        const asText = (v: PerfValue): string | null => {
            if (v === undefined || v === null || v === '') return null;
            if (typeof v === 'boolean') return v ? '1' : '0';
            if (typeof v === 'number') return v.toFixed(1);
            return `${v}`;
        };
        return Object.entries(extra || {})
            .map(([k, v]) => [k, asText(v)])
            .filter(([, v]) => v !== null)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ');
    }
}
