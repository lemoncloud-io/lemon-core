/**
 * `bin/lib/logs.spec.mjs` (lemon-core)
 * - offline tests for `lib/logs.mjs` (paged fetch, request-log polling, INIT lines of a cold start), the parse of a full
 *   request log and its merge with the tail (`lib/perf.mjs`), the request id of `lib/invoke.mjs`, and the
 *   `lemon-lambda-perf --logs` options with `--dry` / bad arguments only (no AWS).
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/logs.test.mjs` (node:test -> vitest), plus SDK-client stub cases.
import { test, describe, vi, beforeAll, afterAll, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { makeConsumer } from './fixtures/consumer.mjs';
import {
    createLogsClient,
    fetchAll,
    fetchRequestLog,
    fetchInitLog,
    fetchFullLog,
    initWindow,
    joinMessages,
    INIT_FILTER,
} from './logs.mjs';
import { parseTail, mergeParsed, summarize, formatRuns, formatSummary, formatLogs, METRICS } from './perf.mjs';
import { invokeLambda, requestIdOf, createClient } from './invoke.mjs';

// the CLI entry, run with `--dry` / bad arguments only.
const SCRIPT = fileURLToPath(new URL('../lemon-lambda-perf.mjs', import.meta.url));

// the temp consumer root the CLI runs in.
let C;
beforeAll(() => {
    C = makeConsumer();
});
afterAll(() => C.done());

// request id and log stream of the fixture request.
const RID = '11111111-2222-3333-4444-555555555555';
const STREAM = '2026/10/28/[$LATEST]0123456789abcdef';

// base epoch of the fixture (ms).
const T = Date.parse('2026-10-28T11:16:33.000Z');

// one CloudWatch event: `message` at `T + dt` in the fixture stream.
const ev = (dt, message, id = `e${dt}`) => ({ eventId: id, timestamp: T + dt, logStreamName: STREAM, message });

// an app line as the Node runtime prints it: `<iso>\t<request id>\tINFO\t<body>`.
const app = (dt, rid, body) => ev(dt, `${new Date(T + dt).toISOString()}\t${rid}\tINFO\t${body}\n`);

// INIT phase of a cold start (no request id on these lines).
const INIT_EVENTS = [
    ev(0, 'INIT_START Runtime Version: nodejs:20.v99\tRuntime Version ARN: arn:aws:lambda:region::runtime:x\n'),
    app(700, 'undefined', 'I PERF: > loaded lemon-core 420.5 ms'),
    app(1100, 'undefined', 'I PERF: > loaded engine 980.2 ms'),
];

// the request lines of a cold run (START … REPORT with Init Duration).
const COLD_REQUEST = [
    ev(1200, `START RequestId: ${RID} Version: $LATEST\n`),
    app(1261, RID, 'I PERF: > initialize 998.9 ms'),
    app(1262, RID, '- LMDA: main(web)...'),
    app(1263, RID, 'I PERF: > handle 12.3 ms type=web cold=1'),
    app(
        1264,
        RID,
        'I PERF: > request 4.2 ms mode=GET type=hello status=200 context=0.8 param=0.3 handler=2.6 response=0.1 cold=1',
    ),
    ev(1270, `END RequestId: ${RID}\n`),
    ev(
        1271,
        `REPORT RequestId: ${RID}\tDuration: 1037.05 ms\tBilled Duration: 1556 ms\tMemory Size: 512 MB\tMax Memory Used: 117 MB\tInit Duration: 518.53 ms\t\n`,
    ),
];

// the request lines of a warm run (no Init Duration).
const WARM_REQUEST = [
    ev(5000, `START RequestId: ${RID} Version: $LATEST\n`),
    app(5001, RID, 'I PERF: > handle 3.1 ms type=web cold=0'),
    app(
        5002,
        RID,
        'I PERF: > request 1.6 ms mode=GET type=hello status=200 context=0.2 param=0.1 handler=1.1 response=0.1 cold=0',
    ),
    ev(5003, `END RequestId: ${RID}\n`),
    ev(
        5004,
        `REPORT RequestId: ${RID}\tDuration: 4.42 ms\tBilled Duration: 5 ms\tMemory Size: 512 MB\tMax Memory Used: 118 MB\t\n`,
    ),
];

// a fake clock and sleep: `sleep(ms)` only moves the clock.
const fakeClock = () => {
    const c = { t: 0, slept: [] };
    c.now = () => c.t;
    c.sleep = async ms => {
        c.slept.push(ms);
        c.t += ms;
    };
    return c;
};

// a fake `fetch(params)`: request polls answer `answers[i]` (the last one repeats); INIT queries answer `init`.
const fakeFetch = (answers, init = INIT_EVENTS) => {
    const calls = [];
    const fn = async params => {
        calls.push(params);
        // INIT query: events of that stream up to endTime that match the server filter.
        if (params.logStreamNames) {
            return init.filter(e => e.timestamp <= params.endTime && e.message.includes('PERF: > loaded'));
        }
        const n = calls.filter(p => !p.logStreamNames).length;
        return answers[Math.min(n, answers.length) - 1];
    };
    fn.calls = calls;
    return fn;
};

describe('fetchAll', () => {
    test('follows nextToken and sorts events by timestamp', async () => {
        const sent = [];
        const pages = [
            { events: [ev(30, 'c'), ev(10, 'a')], nextToken: 'p2' },
            { events: [ev(20, 'b')], nextToken: undefined },
        ];
        const client = { send: async cmd => (sent.push(cmd.input), pages[sent.length - 1]) };
        const events = await fetchAll(client, { logGroupName: '/aws/lambda/fn', startTime: 1 });
        assert.deepEqual(
            events.map(e => e.message),
            ['a', 'b', 'c'],
        );
        assert.equal(sent.length, 2);
        assert.equal(sent[0].nextToken, undefined);
        assert.equal(sent[1].nextToken, 'p2');
        assert.equal(sent[1].logGroupName, '/aws/lambda/fn');
    });
    //* v5 B19: the real SDK client, stubbed at `send` (no network, no credentials).
    test('createLogsClient: a CloudWatchLogsClient; fetchAll sends FilterLogEventsCommand', async () => {
        const send = vi
            .spyOn(CloudWatchLogsClient.prototype, 'send')
            .mockResolvedValueOnce({ events: [ev(2, 'y')], nextToken: 'n' })
            .mockResolvedValueOnce({ events: [ev(1, 'x')] });
        const client = createLogsClient({ region: 'ap-northeast-2' });
        assert.ok(client instanceof CloudWatchLogsClient);
        const events = await fetchAll(client, { logGroupName: '/aws/lambda/fn', startTime: 1 });
        assert.deepEqual(
            events.map(e => e.message),
            ['x', 'y'],
        );
        assert.ok(send.mock.calls[0][0] instanceof FilterLogEventsCommand);
        assert.equal(send.mock.calls[1][0].input.nextToken, 'n');
        vi.restoreAllMocks();
    });
});

describe('fetchRequestLog', () => {
    test('(a) polls until the REPORT line arrives: 3 fetches, 2 sleeps, complete', async () => {
        const c = fakeClock();
        const partial = COLD_REQUEST.slice(0, 3);
        const fetch = fakeFetch([partial, COLD_REQUEST.slice(0, 6), COLD_REQUEST]);
        const r = await fetchRequestLog(fetch, {
            group: '/aws/lambda/fn',
            requestId: RID,
            startTime: 123,
            sleep: c.sleep,
            now: c.now,
        });
        assert.equal(r.complete, true);
        assert.equal(fetch.calls.length, 3);
        assert.deepEqual(c.slept, [1000, 1000]);
        assert.equal(r.took, 2000);
        assert.equal(r.events.length, COLD_REQUEST.length);
        // the server filter is the quoted request id, from the given start time.
        assert.deepEqual(fetch.calls[0], { logGroupName: '/aws/lambda/fn', filterPattern: `"${RID}"`, startTime: 123 });
        assert.equal(r.text, joinMessages(COLD_REQUEST));
        assert.match(r.text, /^START RequestId: .+\nREPORT RequestId: [^\n]+$/s);
    });
    test('(b) timeout: complete=false with the events received so far', async () => {
        const c = fakeClock();
        const fetch = fakeFetch([COLD_REQUEST.slice(0, 4)]);
        const r = await fetchRequestLog(fetch, {
            group: 'g',
            requestId: RID,
            startTime: 0,
            timeoutMs: 3000,
            intervalMs: 1000,
            sleep: c.sleep,
            now: c.now,
        });
        assert.equal(r.complete, false);
        assert.equal(r.events.length, 4);
        assert.equal(fetch.calls.length, 4);
        assert.equal(c.slept.length, 3);
        assert.equal(r.took, 3000);
    });
    test('no request id: no fetch, complete=false', async () => {
        const fetch = fakeFetch([COLD_REQUEST]);
        const r = await fetchRequestLog(fetch, { group: 'g', requestId: null, startTime: 0 });
        assert.deepEqual(r, { text: '', events: [], complete: false, took: 0 });
        assert.equal(fetch.calls.length, 0);
    });
    test('a REPORT line of another request does not complete the poll', async () => {
        const c = fakeClock();
        const other = ev(1, 'REPORT RequestId: 11111111-2222-3333-4444-555555555556\tDuration: 1 ms\t');
        const fetch = fakeFetch([[other]]);
        const r = await fetchRequestLog(fetch, {
            group: 'g',
            requestId: RID,
            startTime: 0,
            timeoutMs: 1500,
            sleep: c.sleep,
            now: c.now,
        });
        assert.equal(r.complete, false);
    });
});

describe('INIT lines of a cold start', () => {
    test('initWindow: the START timestamp and stream of a cold request; null when warm or incomplete', () => {
        assert.deepEqual(initWindow(COLD_REQUEST, RID), { logStreamName: STREAM, endTime: T + 1200 });
        assert.equal(initWindow(WARM_REQUEST, RID), null);
        assert.equal(initWindow(COLD_REQUEST.slice(0, 6), RID), null);
    });
    test('fetchInitLog: one query on the stream, up to START, with the loaded filter', async () => {
        const fetch = fakeFetch([]);
        const r = await fetchInitLog(fetch, { group: 'g', logStreamName: STREAM, startTime: 5, endTime: T + 1200 });
        assert.deepEqual(fetch.calls[0], {
            logGroupName: 'g',
            logStreamNames: [STREAM],
            filterPattern: INIT_FILTER,
            startTime: 5,
            endTime: T + 1200,
        });
        assert.equal(INIT_FILTER, '"PERF:" "loaded"');
        assert.equal(r.events.length, 2);
        assert.match(r.text, /loaded lemon-core 420\.5 ms\n.*loaded engine 980\.2 ms$/);
    });
    test('fetchFullLog (cold): INIT lines in front of the request log', async () => {
        const c = fakeClock();
        const fetch = fakeFetch([COLD_REQUEST.slice(0, 2), COLD_REQUEST]);
        const r = await fetchFullLog(fetch, {
            group: 'g',
            requestId: RID,
            startTime: 7,
            sleep: c.sleep,
            now: c.now,
        });
        assert.equal(r.complete, true);
        assert.equal(r.events.length, 2 + COLD_REQUEST.length);
        assert.equal(fetch.calls.length, 3);
        assert.equal(fetch.calls[2].startTime, 7);
        assert.ok(r.text.indexOf('loaded engine') < r.text.indexOf('START RequestId:'));
        assert.equal(r.took, 1000);
    });
    test('fetchFullLog (warm or incomplete): no INIT query', async () => {
        const c = fakeClock();
        const warm = fakeFetch([WARM_REQUEST]);
        const w = await fetchFullLog(warm, { group: 'g', requestId: RID, startTime: 0, sleep: c.sleep, now: c.now });
        assert.equal(w.complete, true);
        assert.equal(warm.calls.length, 1);
        const cut = fakeFetch([COLD_REQUEST.slice(0, 3)]);
        const x = await fetchFullLog(cut, {
            group: 'g',
            requestId: RID,
            startTime: 0,
            timeoutMs: 2000,
            sleep: c.sleep,
            now: c.now,
        });
        assert.equal(x.complete, false);
        assert.equal(
            cut.calls.some(p => p.logStreamNames),
            false,
        );
    });
});

describe('full log parse and merge', () => {
    // the full text of a cold request, with the INIT lines in front (as `fetchFullLog` builds it).
    const FULL =
        joinMessages([...INIT_EVENTS, ...COLD_REQUEST]) + '\nINIT_REPORT Init Duration: 518.53 ms\tPhase: init';

    test('(c) parseTail of a full cold log: loaded lines, initialize, handle, request, REPORT', () => {
        const { report, perf, lines } = parseTail(FULL);
        assert.equal(perf.loadedLemonCore, 420.5);
        assert.equal(perf.loadedEngine, 980.2);
        assert.equal(perf.initialize, 998.9);
        assert.equal(perf.handle.ms, 12.3);
        assert.equal(perf.request.handler, 2.6);
        assert.deepEqual(report, { duration: 1037.05, billed: 1556, memSize: 512, memUsed: 117, init: 518.53 });
        // START / END / INIT_START / INIT_REPORT and app lines are skipped.
        assert.equal(lines, 5);
    });
    test('(d) merge: full-log values win, empty items come from the tail', () => {
        // an incomplete log: INIT lines and initialize only (no handle / request / REPORT yet).
        const fromLogs = parseTail(joinMessages([...INIT_EVENTS, ...COLD_REQUEST.slice(0, 2)]));
        // a 4 KB tail: handle, request and REPORT, a different initialize value, no loaded lines.
        const fromTail = parseTail(
            [
                'I PERF: > initialize 1.0 ms',
                'I PERF: > handle 12.3 ms type=web cold=1',
                'I PERF: > request 4.2 ms mode=GET type=hello status=200 context=0.8 param=0.3 handler=2.6 response=0.1 cold=1',
                `REPORT RequestId: ${RID}\tDuration: 1037.05 ms\tBilled Duration: 1556 ms\tMemory Size: 512 MB\tMax Memory Used: 117 MB\tInit Duration: 518.53 ms\t`,
            ].join('\n'),
        );
        const m = mergeParsed(fromLogs, fromTail);
        assert.equal(m.perf.loadedLemonCore, 420.5);
        assert.equal(m.perf.loadedEngine, 980.2);
        assert.equal(m.perf.initialize, 998.9);
        assert.equal(m.perf.handle.ms, 12.3);
        assert.equal(m.perf.request.status, 200);
        assert.equal(m.report.duration, 1037.05);
        assert.equal(m.report.init, 518.53);
        assert.equal(m.lines, 3);
        // nothing on either side stays null.
        assert.equal(mergeParsed(parseTail(''), parseTail('')).report.duration, null);
    });
    test('summary and run table carry loadedLemonCore / loadedEngine; formatLogs line', () => {
        const runs = [
            { took: 1100, http: 200, ...parseTail(FULL), logs: { complete: true, events: 9, took: 3200 } },
            {
                took: 40,
                http: 200,
                ...parseTail(joinMessages(WARM_REQUEST)),
                logs: { complete: false, events: 3, took: 2000 },
            },
        ];
        const s = summarize(runs);
        assert.deepEqual(s.cold.loadedLemonCore, { n: 1, median: 420.5, p95: 420.5, max: 420.5 });
        assert.deepEqual(s.cold.loadedEngine, { n: 1, median: 980.2, p95: 980.2, max: 980.2 });
        assert.deepEqual(s.logs, { n: 2, complete: 1, wait: { n: 2, median: 2600, p95: 3200, max: 3200 } });
        assert.ok(METRICS.indexOf('loadedLemonCore') < METRICS.indexOf('initialize'));
        assert.match(formatSummary(s), /^loadedLemonCore\s+1\s+420\.5\s+420\.5\s+420\.5\s+0\s+n\/a/m);
        assert.equal(formatLogs(s), 'logs: complete=1/2 wait=2600ms');
        const table = formatRuns(runs).split('\n');
        assert.match(table[1], /^#1\s+cold\s+200\s+-\s+1100\s+1037\.05\s+1556\s+518\.53\s+420\.5\s+980\.2\s+998\.9\s/);
        assert.match(table[2], /^#2\s+warm\s+200\s+-\s+40\s+4\.42\s+5\s+n\/a\s+n\/a\s+n\/a\s+n\/a\s+3\.1\s/);
        // without --logs: no logs key, empty line.
        const plain = summarize([{ took: 1, ...parseTail(joinMessages(WARM_REQUEST)) }]);
        assert.equal('logs' in plain, false);
        assert.equal(formatLogs(plain), '');
    });
});

describe('request id', () => {
    test('(e) requestIdOf: END line, else REPORT line, else null', () => {
        assert.equal(requestIdOf(`x\nEND RequestId: ${RID}\nREPORT RequestId: other\tDuration: 1 ms`), RID);
        assert.equal(requestIdOf(`REPORT RequestId: ${RID}\tDuration: 1 ms`), RID);
        assert.equal(requestIdOf('no id here'), null);
        assert.equal(requestIdOf(undefined), null);
    });
    test('invokeLambda: $metadata.requestId first, then the tail, then null', async () => {
        const tail = Buffer.from(`END RequestId: ${RID}\n`).toString('base64');
        // a fake client answering one response.
        const client = resp => ({ send: async () => resp });
        const meta = await invokeLambda(client({ StatusCode: 200, $metadata: { requestId: 'm-1' }, LogResult: tail }), {
            name: 'fn',
            event: {},
            tail: true,
        });
        assert.equal(meta.requestId, 'm-1');
        const fromTail = await invokeLambda(client({ StatusCode: 200, $metadata: {}, LogResult: tail }), {
            name: 'fn',
            event: {},
            tail: true,
        });
        assert.equal(fromTail.requestId, RID);
        const none = await invokeLambda(client({ StatusCode: 202 }), { name: 'fn', event: {}, async: true });
        assert.equal(none.requestId, null);
    });
    //* v5 B19: the real Lambda client, stubbed at `send` (no network, no credentials).
    test('createClient: a LambdaClient; invokeLambda sends one InvokeCommand', async () => {
        const payload = new TextEncoder().encode('{"statusCode":200}');
        const send = vi
            .spyOn(LambdaClient.prototype, 'send')
            .mockResolvedValue({ StatusCode: 200, Payload: payload, $metadata: { requestId: 'r-1' } });
        const client = createClient({ region: 'ap-northeast-2' });
        assert.ok(client instanceof LambdaClient);
        const r = await invokeLambda(client, { name: 'fn', event: { a: 1 } });
        assert.ok(send.mock.calls[0][0] instanceof InvokeCommand);
        assert.equal(send.mock.calls[0][0].input.LogType, 'None');
        assert.deepEqual([r.statusCode, r.text, r.requestId], [200, '{"statusCode":200}', 'r-1']);
        vi.restoreAllMocks();
    });
});

// run the CLI with arguments (never reaches AWS for these cases).
//* v5 B19: `cwd` = the temp consumer root.
const cli = args =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env }, cwd: C.root });

describe('perf-lambda --logs (offline)', () => {
    test('(f) --logs --dry exits 0 without AWS and shows logs=true', () => {
        const r = cli(['--dry', '--runs', '2', '--logs']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout.split('\n')[0], /^perf \S+ event=web GET \/hello\/0 runs=2 logs=true interval=0ms /);
        assert.equal(r.stderr, '');
        const w = cli(['--dry', '--logs', '--logs-wait', '5000']);
        assert.equal(w.status, 0, w.stderr);
    });
    test('(f) bad --logs-wait exits 2', () => {
        for (const args of [
            ['--logs-wait', '0'],
            ['--logs-wait', 'abc'],
            ['--logs-wait', '999'],
            ['--logs-wait', '120001'],
            ['--dry', '--logs', '--logs-wait'],
        ]) {
            const r = cli(args);
            assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
            assert.match(r.stderr, /^ERROR: --logs-wait needs an integer 1000-120000/);
        }
    });
    test('--help lists --logs and --logs-wait', () => {
        const r = cli(['--help']);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /--logs-wait <ms>/);
        assert.match(r.stdout, /--logs {2,}/);
    });
});
