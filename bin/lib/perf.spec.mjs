/**
 * `bin/lib/perf.spec.mjs` (lemon-core)
 * - offline tests for `lib/perf.mjs` (log-tail parser, summary, tables, exit code) and the `lemon-lambda-perf` CLI
 *   with `--dry` / `--help` / bad arguments only (no AWS).
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/perf.test.mjs` (node:test -> vitest); the CLI runs in a temp root.
import { test, describe, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTail, summarize, stats, formatRuns, formatSummary, exitCode, isCold, METRICS } from './perf.mjs';
import { makeConsumer, SERVICE } from './fixtures/consumer.mjs';

// the CLI entry, run with `--dry` / `--help` / bad arguments only.
const SCRIPT = fileURLToPath(new URL('../lemon-lambda-perf.mjs', import.meta.url));

// the temp consumer root the CLI runs in.
let C;
beforeAll(() => {
    C = makeConsumer();
});
afterAll(() => C.done());

// CloudWatch line prefix (timestamp, request id, level) in front of a lemon-core log line.
const CW = 'INFO\t 2026-10-28 20:16:34';
const P = (ts, msg) => `${ts}\t00000000-0000-0000-0000-000000000000\t${CW} ${msg}`;

// (a) cold: Init Duration + initialize + handle + request lines.
const COLD = [
    P('2026-10-28T11:16:33.700Z', 'I PERF: > loaded lemon-core 420.5 ms'),
    P('2026-10-28T11:16:34.100Z', 'I PERF: > loaded engine 980.2 ms'),
    P('2026-10-28T11:16:34.261Z', 'I PERF: > initialize 998.9 ms'),
    P('2026-10-28T11:16:34.262Z', '- LMDA: main(web)...'),
    P('2026-10-28T11:16:34.263Z', 'I PERF: > handle 12.3 ms type=web cold=1'),
    P(
        '2026-10-28T11:16:34.264Z',
        'I PERF: > request 4.2 ms mode=GET type=hello status=200 context=0.8 param=0.3 handler=2.6 response=0.1 cold=1',
    ),
    P('2026-10-28T11:16:34.266Z', '- LMDA: ! res = {"statusCode":200}'),
    'END RequestId: 00000000-0000-0000-0000-000000000000',
    'REPORT RequestId: 00000000-0000-0000-0000-000000000000\tDuration: 1037.05 ms\tBilled Duration: 1556 ms\tMemory Size: 512 MB\tMax Memory Used: 117 MB\tInit Duration: 518.53 ms\t',
].join('\n');

// (b) warm: no Init Duration, cold=0.
const warmTail = (handle, request, duration, used = 118) =>
    [
        P('2026-10-28T11:16:40.000Z', '- LMDA: main(web)...'),
        P('2026-10-28T11:16:40.001Z', `I PERF: > handle ${handle} ms type=web cold=0`),
        P(
            '2026-10-28T11:16:40.002Z',
            `I PERF: > request ${request} ms mode=GET type=hello status=200 context=0.2 param=0.1 handler=1.1 response=0.1 cold=0`,
        ),
        'END RequestId: 00000000-0000-0000-0000-000000000001',
        `REPORT RequestId: 00000000-0000-0000-0000-000000000001\tDuration: ${duration} ms\tBilled Duration: ${Math.ceil(
            duration,
        )} ms\tMemory Size: 512 MB\tMax Memory Used: ${used} MB\t`,
    ].join('\n');
const WARM = warmTail(3.1, 1.6, 4.42);

// (c) failure: the web handler answered 404.
const FAIL = [
    P('2026-10-28T11:16:50.001Z', 'I PERF: > handle 2.5 ms type=web cold=0'),
    P(
        '2026-10-28T11:16:50.002Z',
        'I PERF: > request 1.9 ms mode=GET type=nope status=404 context=0.2 param=0.1 handler=1.4 response=0.1 cold=0',
    ),
    'REPORT RequestId: 00000000-0000-0000-0000-000000000002\tDuration: 3.80 ms\tBilled Duration: 4 ms\tMemory Size: 512 MB\tMax Memory Used: 118 MB\t',
].join('\n');

// (d) cut tail: only the REPORT line survived the 4 KB cut.
const CUT =
    '{"statusCode":200,"body":"…"}\nEND RequestId: x\nREPORT RequestId: x\tDuration: 990.00 ms\tBilled Duration: 1500 ms\tMemory Size: 512 MB\tMax Memory Used: 116 MB\tInit Duration: 510.00 ms\t';

// a run record from a tail, like `perf-lambda.mjs` builds it.
const run = (tail, { took, http = 200, functionError = null } = {}) => ({
    took,
    http,
    functionError,
    ...parseTail(tail),
});

describe('parseTail', () => {
    test('(a) cold tail: REPORT with Init Duration and every PERF line', () => {
        const { report, perf, lines } = parseTail(COLD);
        assert.deepEqual(report, { duration: 1037.05, billed: 1556, memSize: 512, memUsed: 117, init: 518.53 });
        assert.equal(perf.loadedLemonCore, 420.5);
        assert.equal(perf.loadedEngine, 980.2);
        assert.equal(perf.initialize, 998.9);
        assert.deepEqual(perf.handle, { ms: 12.3, type: 'web', cold: true });
        assert.deepEqual(perf.request, {
            ms: 4.2,
            mode: 'GET',
            type: 'hello',
            cmd: null,
            status: 200,
            context: 0.8,
            param: 0.3,
            handler: 2.6,
            response: 0.1,
            cold: true,
        });
        assert.equal(lines, 5);
    });
    test('(b) warm tail: no Init Duration, cold=0', () => {
        const { report, perf, lines } = parseTail(WARM);
        assert.equal(report.init, null);
        assert.equal(report.duration, 4.42);
        assert.equal(report.billed, 5);
        assert.equal(perf.initialize, null);
        assert.equal(perf.handle.cold, false);
        assert.equal(perf.request.cold, false);
        assert.equal(lines, 2);
    });
    test('(c) failure tail: request status=404', () => {
        const { perf } = parseTail(FAIL);
        assert.equal(perf.request.status, 404);
        assert.equal(perf.request.type, 'nope');
    });
    test('(d) cut tail: REPORT only, every perf item null', () => {
        const { report, perf, lines } = parseTail(CUT);
        assert.equal(report.init, 510);
        assert.deepEqual(perf, {
            initialize: null,
            loadedLemonCore: null,
            loadedEngine: null,
            handle: null,
            request: null,
        });
        assert.equal(lines, 0);
    });
    test('a local line with ANSI colors parses after stripping', () => {
        const line = '[Node] \x1b[32m 2026-10-28 20:07:11 I\x1b[0m \x1b[36mPERF:\x1b[0m > initialize 115.4 ms';
        const { perf, lines } = parseTail(line);
        assert.equal(perf.initialize, 115.4);
        assert.equal(lines, 1);
    });
    test('a request line with cmd=', () => {
        const line =
            'I PERF: > request 7.5 ms mode=PUT type=mocks cmd=refresh status=200 context=1.0 param=0.4 handler=5.9 response=0.2 cold=0';
        const { request } = parseTail(line).perf;
        assert.equal(request.cmd, 'refresh');
        assert.equal(request.type, 'mocks');
        assert.equal(request.mode, 'PUT');
        assert.equal(request.handler, 5.9);
    });
    test('the last line of the same kind wins; unknown PERF lines are not counted', () => {
        const text = [
            'I PERF: > initialize 10.0 ms',
            'I PERF: > initialize 20.0 ms',
            'I PERF: > something-else 1.0 ms',
        ].join('\n');
        const { perf, lines } = parseTail(text);
        assert.equal(perf.initialize, 20);
        assert.equal(lines, 2);
    });
    test('empty or missing text: all null', () => {
        for (const t of ['', undefined, null]) {
            const { report, perf, lines } = parseTail(t);
            assert.equal(report.duration, null);
            assert.equal(perf.request, null);
            assert.equal(lines, 0);
        }
    });
});

describe('summarize', () => {
    test('stats: median, p95 (nearest rank), max', () => {
        assert.deepEqual(stats([5, 1, 3]), { n: 3, median: 3, p95: 5, max: 5 });
        assert.deepEqual(stats([4, 1, 3, 2]), { n: 4, median: 2.5, p95: 4, max: 4 });
        // 20 values 1..20: nearest rank ceil(0.95*20)=19 → 19.
        const xs = Array.from({ length: 20 }, (_, i) => i + 1);
        assert.deepEqual(stats(xs), { n: 20, median: 10.5, p95: 19, max: 20 });
        assert.deepEqual(stats([null, undefined]), { n: 0, median: null, p95: null, max: null });
    });
    test('cold / warm split and per-metric values (cut tail excluded from PERF metrics)', () => {
        const runs = [
            run(COLD, { took: 1100 }),
            run(WARM, { took: 40 }),
            run(warmTail(2.9, 1.4, 3.2), { took: 30 }),
            run(warmTail(5.0, 2.8, 6.75), { took: 50 }),
            run(CUT, { took: 1050 }),
        ];
        const s = summarize(runs);
        assert.equal(s.all.n, 5);
        assert.equal(s.cold.n, 2);
        assert.equal(s.warm.n, 3);
        assert.deepEqual(s.cold.took, { n: 2, median: 1075, p95: 1100, max: 1100 });
        assert.deepEqual(s.cold.init, { n: 2, median: 514.27, p95: 518.53, max: 518.53 });
        // the cut tail has no PERF lines: only the full cold run counts.
        assert.deepEqual(s.cold.initialize, { n: 1, median: 998.9, p95: 998.9, max: 998.9 });
        assert.deepEqual(s.cold.handle, { n: 1, median: 12.3, p95: 12.3, max: 12.3 });
        assert.deepEqual(s.warm.handle, { n: 3, median: 3.1, p95: 5, max: 5 });
        assert.deepEqual(s.warm.request, { n: 3, median: 1.6, p95: 2.8, max: 2.8 });
        assert.deepEqual(s.warm.duration, { n: 3, median: 4.42, p95: 6.75, max: 6.75 });
        assert.deepEqual(s.warm.init, { n: 0, median: null, p95: null, max: null });
        assert.deepEqual(s.warm.memUsed, { n: 3, median: 118, p95: 118, max: 118 });
        assert.deepEqual(Object.keys(s.cold).slice(1), METRICS);
    });
    test('cold falls back to the lemon-core cold flag when REPORT is missing', () => {
        const noReport = run('I PERF: > handle 9.0 ms type=web cold=1', { took: 900 });
        assert.equal(isCold(noReport), true);
        const warmNoReport = run('I PERF: > handle 1.0 ms type=web cold=0', { took: 9 });
        assert.equal(isCold(warmNoReport), false);
    });
});

describe('tables and exit code', () => {
    test('formatSummary prints n/a for metrics without values', () => {
        const text = formatSummary(summarize([run(WARM, { took: 40 }), run(CUT, { took: 1050 })]));
        const lines = text.split('\n');
        assert.equal(lines[0], 'runs=2 cold=1 warm=1');
        assert.match(lines[1], /^metric\s+cold\.n\s+median\s+p95\s+max\s+warm\.n\s+median\s+p95\s+max$/);
        // warm init has no value; cold initialize was cut from the tail.
        assert.match(text, /^init\s+1\s+510\s+510\s+510\s+0\s+n\/a\s+n\/a\s+n\/a$/m);
        assert.match(text, /^initialize\s+0\s+n\/a\s+n\/a\s+n\/a\s+0\s+n\/a\s+n\/a\s+n\/a$/m);
        assert.equal(lines.length, 2 + METRICS.length);
    });
    test('formatSummary of no runs is all n/a', () => {
        assert.match(formatSummary(summarize([])), /^took\s+0\s+n\/a\s+n\/a\s+n\/a\s+0\s+n\/a\s+n\/a\s+n\/a$/m);
    });
    test('formatRuns: one row per run with phase and http', () => {
        const text = formatRuns([run(COLD, { took: 1100 }), run(FAIL, { took: 20, http: 404 })]);
        const lines = text.split('\n');
        assert.equal(lines.length, 3);
        assert.match(
            lines[0],
            /^run\s+phase\s+http\s+error\s+took\s+duration\s+billed\s+init\s+loadedCore\s+loadedEngine\s+initialize\s/,
        );
        assert.match(
            lines[1],
            /^#1\s+cold\s+200\s+-\s+1100\s+1037\.05\s+1556\s+518\.53\s+420\.5\s+980\.2\s+998\.9\s+12\.3\s+4\.2\s+2\.6\s+117$/,
        );
        assert.match(
            lines[2],
            /^#2\s+warm\s+404\s+-\s+20\s+3\.8\s+4\s+n\/a\s+n\/a\s+n\/a\s+n\/a\s+2\.5\s+1\.9\s+1\.4\s+118$/,
        );
    });
    test('(c) exitCode: 0 for all 2xx, 1 for a 404, a FunctionError, a missing http, or no runs', () => {
        assert.equal(exitCode([run(COLD, { took: 1 }), run(WARM, { took: 1 })]), 0);
        assert.equal(exitCode([run(COLD, { took: 1 }), run(FAIL, { took: 1, http: 404 })]), 1);
        assert.equal(exitCode([run(WARM, { took: 1, functionError: 'Unhandled' })]), 1);
        assert.equal(exitCode([run(WARM, { took: 1, http: null })]), 1);
        assert.equal(exitCode([]), 1);
    });
});

// run the CLI with arguments (never reaches AWS for these cases).
//* v5 B19: `cwd` = the temp consumer root.
const cli = args =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env }, cwd: C.root });

describe('perf-lambda CLI (offline)', () => {
    test('--help exits 0', () => {
        const r = cli(['--help']);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /--runs <n>/);
    });
    test('--dry prints the target, event and runs without AWS', () => {
        const r = cli(['--dry', '--runs', '3']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(
            r.stdout.split('\n')[0],
            /^perf \S+-dev-lambda event=web GET \/hello\/0 runs=3 logs=false interval=0ms region=\S+ \(dry\)$/,
        );
        //* v5 B19: the service part comes from the temp root's `serverless.yml`.
        assert.ok(r.stdout.startsWith(`perf ${SERVICE}-dev-lambda `));
        const event = JSON.parse(r.stdout.slice(r.stdout.indexOf('\n') + 1));
        assert.equal(event.path, '/hello/0');
        assert.equal(event.httpMethod, 'GET');
        assert.equal(r.stderr, '');
    });
    test('--internal shows event=web(internal) and drops Host', () => {
        const r = cli(['--dry', '--internal', '--path', '/mocks/0']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /event=web\(internal\) GET \/mocks\/0 runs=5/);
        assert.equal('Host' in JSON.parse(r.stdout.slice(r.stdout.indexOf('\n') + 1)).headers, false);
    });
    test('bad --runs, bad --interval, unknown option, and the stage guard exit 2', () => {
        for (const args of [
            ['--runs', '0'],
            ['--runs', '101'],
            ['--runs', 'x'],
            ['--interval', '60001'],
            ['--bogus'],
            ['--stage', 'prod', '--dry'],
        ]) {
            const r = cli(args);
            assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
            assert.match(r.stderr, /^ERROR: /);
        }
    });
});
