/**
 * `bin/lib/perf.mjs` (lemon-core)
 * - parse the Lambda log tail or the full CloudWatch log of one request (`REPORT` line + lemon-core `PERF: >` lines)
 *   and summarize repeated runs.
 * - pure functions for `lemon-lambda-perf`: no AWS SDK, no fs, no printing, no `process.exit`.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/perf.mjs` (snapshot d57dc5b) unchanged.

// metrics summarized per phase (cold / warm), in table order.
export const METRICS = [
    'took',
    'duration',
    'billed',
    'init',
    'loadedLemonCore',
    'loadedEngine',
    'initialize',
    'handle',
    'request',
    'context',
    'param',
    'handler',
    'response',
    'memUsed',
];

// drop ANSI escapes (CSI / OSC / others) so colored local lines parse like CloudWatch lines.
const stripAnsi = text =>
    `${text}`
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
        .replace(/\x1b[ -/]*[0-~]?/g, '');

// a finite number from a text, or null.
const num = v => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// `cold=1` → true, `cold=0` → false, absent → null.
const flag = v => (v === undefined ? null : v === '1' || v === 'true');

// first capture of `re` in `line` as a number, or null.
const pick = (line, re) => {
    const m = line.match(re);
    return m ? num(m[1]) : null;
};

// parse the `k=v k=v` tail of a PERF line into a plain object (values stay text).
const parseKv = text =>
    Object.fromEntries(
        `${text}`
            .split(/\s+/)
            .filter(t => t.includes('='))
            .map(t => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)]),
    );

// the `REPORT RequestId: …` line → `{ duration, billed, memSize, memUsed, init }` (ms / MB).
const parseReport = line => ({
    duration: pick(line, /(?<!Billed )(?<!Init )Duration:\s*([\d.]+)\s*ms/),
    billed: pick(line, /Billed Duration:\s*([\d.]+)\s*ms/),
    memSize: pick(line, /Memory Size:\s*([\d.]+)\s*MB/),
    memUsed: pick(line, /Max Memory Used:\s*([\d.]+)\s*MB/),
    init: pick(line, /Init Duration:\s*([\d.]+)\s*ms/),
});

// an empty `report` (no REPORT line in the tail).
const emptyReport = () => ({ duration: null, billed: null, memSize: null, memUsed: null, init: null });

// an empty `perf` (no PERF line in the tail).
const emptyPerf = () => ({ initialize: null, loadedLemonCore: null, loadedEngine: null, handle: null, request: null });

// `handle <ms> ms type=<t> cold=<0|1>` body → `{ ms, type, cold }`.
const parseHandle = (ms, rest) => {
    const kv = parseKv(rest);
    return { ms: num(ms), type: kv.type ?? null, cold: flag(kv.cold) };
};

// `request <ms> ms mode=… type=… [cmd=…] status=… context=… param=… handler=… response=… cold=…` body.
const parseRequest = (ms, rest) => {
    const kv = parseKv(rest);
    return {
        ms: num(ms),
        mode: kv.mode ?? null,
        type: kv.type ?? null,
        cmd: kv.cmd ? kv.cmd : null,
        status: num(kv.status),
        context: num(kv.context),
        param: num(kv.param),
        handler: num(kv.handler),
        response: num(kv.response),
        cold: flag(kv.cold),
    };
};

// one PERF body (after `PERF: >`) into `perf`; returns true when the kind is known.
const applyPerf = (perf, body) => {
    const m = body.match(/^(initialize|loaded lemon-core|loaded engine|handle|request)\s+([\d.]+)\s*ms\b(.*)$/);
    if (!m) return false;
    const [, kind, ms, rest] = m;
    // the last line of each kind wins.
    if (kind === 'initialize') perf.initialize = num(ms);
    else if (kind === 'loaded lemon-core') perf.loadedLemonCore = num(ms);
    else if (kind === 'loaded engine') perf.loadedEngine = num(ms);
    else if (kind === 'handle') perf.handle = parseHandle(ms, rest);
    else perf.request = parseRequest(ms, rest);
    return true;
};

// parse a decoded log tail (or a full request log) → `{ report, perf, lines }` (`lines` = PERF lines of a known kind).
// other lines (`START`, `END`, `INIT_START`, `INIT_REPORT`, app lines) are skipped.
export const parseTail = text => {
    const report = emptyReport();
    const perf = emptyPerf();
    let lines = 0;
    for (const raw of `${text ?? ''}`.split(/\r?\n/)) {
        const line = stripAnsi(raw);
        // `REPORT RequestId: …` (the last one wins).
        if (/\bREPORT RequestId:/.test(line)) {
            Object.assign(report, parseReport(line));
            continue;
        }
        // `… PERF: > <kind> <ms> ms …` with any CloudWatch / local prefix before it.
        const m = line.match(/PERF:\s*>\s*(.+?)\s*$/);
        if (m && applyPerf(perf, m[1])) lines++;
    }
    return { report, perf, lines };
};

// first non-null of two values (`a` wins).
const prefer = (a, b) => (a !== null && a !== undefined ? a : b ?? null);

// merge two parse results item by item: `primary` (full log) wins, empty items come from `fallback` (tail).
export const mergeParsed = (primary, fallback) => {
    const p = primary || parseTail('');
    const f = fallback || parseTail('');
    const report = Object.fromEntries(Object.keys(emptyReport()).map(k => [k, prefer(p.report?.[k], f.report?.[k])]));
    const perf = Object.fromEntries(Object.keys(emptyPerf()).map(k => [k, prefer(p.perf?.[k], f.perf?.[k])]));
    return { report, perf, lines: Math.max(p.lines || 0, f.lines || 0) };
};

// true when the run was a cold start: `Init Duration` in REPORT, else the lemon-core `cold=1` flags.
export const isCold = run => {
    if (run?.report?.init != null) return true;
    return run?.perf?.handle?.cold === true || run?.perf?.request?.cold === true;
};

// one metric of one run, or null when it is not there.
export const metricOf = (run, key) => {
    const { report = {}, perf = {} } = run || {};
    const req = perf?.request || {};
    const values = {
        took: run?.took,
        duration: report?.duration,
        billed: report?.billed,
        init: report?.init,
        loadedLemonCore: perf?.loadedLemonCore,
        loadedEngine: perf?.loadedEngine,
        initialize: perf?.initialize,
        handle: perf?.handle?.ms,
        request: req.ms,
        context: req.context,
        param: req.param,
        handler: req.handler,
        response: req.response,
        memUsed: report?.memUsed,
    };
    return num(values[key]);
};

// round to 2 decimals (keeps medians like 12.35 readable, removes float noise).
const round2 = v => Math.round(v * 100) / 100;

// `{ n, median, p95, max }` of the values; p95 by nearest rank; all null when n = 0.
export const stats = values => {
    const xs = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
    const n = xs.length;
    if (!n) return { n: 0, median: null, p95: null, max: null };
    const mid = Math.floor(n / 2);
    // even n: mean of the two middle values.
    const median = n % 2 ? xs[mid] : round2((xs[mid - 1] + xs[mid]) / 2);
    const p95 = xs[Math.ceil(0.95 * n) - 1];
    return { n, median, p95, max: xs[n - 1] };
};

// stats of every metric for a group of runs → `{ n, took: {…}, duration: {…}, … }`.
const groupStats = runs => ({
    n: runs.length,
    ...Object.fromEntries(METRICS.map(key => [key, stats(runs.map(r => metricOf(r, key)))])),
});

// `--logs` stats: `{ n, complete, wait: { n, median, p95, max } }`, or null when no run fetched logs.
export const logsStats = (runs = []) => {
    const withLogs = runs.filter(r => r?.logs);
    if (!withLogs.length) return null;
    const complete = withLogs.filter(r => r.logs.complete).length;
    return { n: withLogs.length, complete, wait: stats(withLogs.map(r => num(r.logs.took))) };
};

// summarize runs → `{ cold: { n, …metrics }, warm: { n, …metrics }, all: { n }, [logs] }` (`logs` with `--logs`).
export const summarize = (runs = []) => {
    const cold = runs.filter(isCold);
    const warm = runs.filter(r => !isCold(r));
    const logs = logsStats(runs);
    return { cold: groupStats(cold), warm: groupStats(warm), all: { n: runs.length }, ...(logs ? { logs } : {}) };
};

// a number for a table cell (`n/a` when missing, at most 2 decimals).
export const cell = v => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : `${round2(v)}`);

// fixed-width text table: the first `left` columns left-aligned, the rest right-aligned.
const table = (rows, left = 1) => {
    const widths = rows[0].map((_, i) => Math.max(...rows.map(r => `${r[i]}`.length)));
    return rows
        .map(r => r.map((c, i) => (i < left ? `${c}`.padEnd(widths[i]) : `${c}`.padStart(widths[i]))).join('  '))
        .map(s => s.replace(/\s+$/, ''))
        .join('\n');
};

// run-table columns after `error`: `[header, metric key]`.
const RUN_COLUMNS = [
    ['took', 'took'],
    ['duration', 'duration'],
    ['billed', 'billed'],
    ['init', 'init'],
    ['loadedCore', 'loadedLemonCore'],
    ['loadedEngine', 'loadedEngine'],
    ['initialize', 'initialize'],
    ['handle', 'handle'],
    ['request', 'request'],
    ['handler', 'handler'],
    ['memUsed', 'memUsed'],
];

// one row per run: phase, http, function error, and the main timings.
export const formatRuns = (runs = []) => {
    const head = ['run', 'phase', 'http', 'error', ...RUN_COLUMNS.map(([h]) => h)];
    const rows = runs.map((r, i) => [
        `#${i + 1}`,
        isCold(r) ? 'cold' : 'warm',
        r.http ?? 'n/a',
        r.functionError || '-',
        ...RUN_COLUMNS.map(([, k]) => cell(metricOf(r, k))),
    ]);
    return table([head, ...rows], 2);
};

// summary table: one row per metric, `n / median / p95 / max` for cold and for warm (ms; memUsed in MB).
export const formatSummary = summary => {
    const s = summary || summarize([]);
    const head = ['metric', 'cold.n', 'median', 'p95', 'max', 'warm.n', 'median', 'p95', 'max'];
    // the four columns of one phase for one metric.
    const cols = (phase, key) => {
        const x = phase?.[key] || { n: 0 };
        return [x.n ?? 0, cell(x.median), cell(x.p95), cell(x.max)];
    };
    const rows = METRICS.map(key => [key, ...cols(s.cold, key), ...cols(s.warm, key)]);
    const line = `runs=${s.all?.n ?? 0} cold=${s.cold?.n ?? 0} warm=${s.warm?.n ?? 0}`;
    return `${line}\n${table([head, ...rows])}`;
};

// the `--logs` line under the summary: `logs: complete=<n>/<runs> wait=<median>ms` ('' without `--logs`).
export const formatLogs = summary => {
    const l = summary?.logs;
    if (!l) return '';
    const wait = cell(l.wait?.median);
    return `logs: complete=${l.complete}/${summary.all?.n ?? l.n} wait=${wait === 'n/a' ? wait : `${wait}ms`}`;
};

// exit code: 0 when every run answered http 2xx with no FunctionError, else 1 (also for no runs).
export const exitCode = (runs = []) => {
    if (!runs.length) return 1;
    const ok = runs.every(r => typeof r.http === 'number' && r.http >= 200 && r.http < 300 && !r.functionError);
    return ok ? 0 : 1;
};
