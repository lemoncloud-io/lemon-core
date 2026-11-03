/**
 * `bin/lib/loop-check.spec.mjs` (lemon-core)
 * - offline tests for `loop-check.mjs` (fake Lambda invoker, fake log fetch, fake clock, fake `fetch`; no AWS).
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/loop-check.test.mjs` (node:test -> vitest), plus root cases.
import { test, describe, vi, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { makeConsumer, SERVICE, PORT } from './fixtures/consumer.mjs';
import {
    run,
    parseOptions,
    findLines,
    waitForLines,
    logGroups,
    triggerEvent,
    resultLine,
    defaultPort,
    tidOf,
    tidIssues,
    KINDS,
    TRACE_KINDS,
} from './loop-check.mjs';
import { functionName, ArgError } from './common.mjs';

// the CLI entry, run with `--dry` / `--help` / bad arguments only (no AWS call).
const SCRIPT = fileURLToPath(new URL('../lemon-loop-check.mjs', import.meta.url));

//* v5 B19: the temp consumer root (`serverless.yml` gives the service, `package.json` the port).
const C = makeConsumer();
afterAll(() => C.done());

// every in-process run reads the root from `process.cwd()` = the temp consumer.
beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(C.root);
});
afterEach(() => vi.restoreAllMocks());

// the function names and log groups of dev.
const LAMBDA = functionName({ stage: 'dev', fn: 'lambda', cwd: C.root });
const BACKEND = functionName({ stage: 'dev', fn: 'backend', cwd: C.root });
const G_LAMBDA = `/aws/lambda/${LAMBDA}`;
const G_BACKEND = `/aws/lambda/${BACKEND}`;

// one loop id per kind (the fake trigger answers these).
const IDS = {
    sns: '11111111-1111-4111-8111-111111111111',
    sqs: '22222222-2222-4222-8222-222222222222',
    protocol: '33333333-3333-4333-8333-333333333333',
    notify: '44444444-4444-4444-8444-444444444444',
    enqueue: '55555555-5555-4555-8555-555555555555',
};

// kinds whose recv line carries the relay trace ` tid=<send tid> hop=1` (the protocol receiver `loop-recv`).
const RECV_HOP = ['protocol', 'notify', 'enqueue'];

// the trigger tid of each kind (a Lambda request id).
const TIDS = {
    sns: 'aaaaaaaa-0000-4000-8000-0000000000a1',
    sqs: 'aaaaaaaa-0000-4000-8000-0000000000a2',
    protocol: 'aaaaaaaa-0000-4000-8000-0000000000a3',
    notify: 'aaaaaaaa-0000-4000-8000-0000000000a4',
    enqueue: 'aaaaaaaa-0000-4000-8000-0000000000a5',
};

// a lemon-core `_inf` line as CloudWatch keeps it (ANSI colors, request id, level).
const line = body => `2026-10-30T00:00:00.000Z\tabc\tINFO\t\x1b[33mloop:\x1b[0m ${body}\n`;

// the send / recv log lines of a kind (`tid`: the recv tid, default the send tid; null = no tid).
const sendLine = kind =>
    line(
        `[LOOP] send kind=${kind} loop=${IDS[kind]} message=${kind === 'protocol' ? '-' : 'm-1'} tid=${
            TIDS[kind]
        } hop=0`,
    );
const recvLine = (kind, ms = 42, tid = TIDS[kind]) =>
    line(
        `[LOOP] recv kind=${kind} loop=${IDS[kind]} latency=${ms}ms` +
            (RECV_HOP.includes(kind) && tid ? ` tid=${tid} hop=1` : ''),
    );

// a fake invoker: answers the trigger of each kind with `http` and its body; records each event.
const fakeInvoke = ({ http = 200, functionError, body } = {}) => {
    const events = [];
    const fn = async event => {
        events.push(event);
        const kind = event.path.split('/')[2];
        const loopId = IDS[kind];
        const ok =
            kind === 'protocol'
                ? { kind, loopId, sentAt: 1, result: { loopId, recvAt: 2, hop: 1 } }
                : { kind, loopId, messageId: `mid-${kind}`, sentAt: 1 };
        const payload = { statusCode: http, body: http === 200 ? JSON.stringify(body ? body(kind) : ok) : 'nope' };
        return { statusCode: 200, functionError, text: JSON.stringify(payload), took: 1 };
    };
    return Object.assign(fn, { events });
};

// a fake log fetch: `logs[group]` is the list of messages it holds; filters by the quoted term; records each query.
const fakeFetch = (logs, { fail } = {}) => {
    const queries = [];
    const fn = async params => {
        queries.push(params);
        if (fail) throw fail;
        const term = params.filterPattern.replace(/^"|"$/g, '');
        return (logs[params.logGroupName] || []).filter(m => m.includes(term)).map(message => ({ message }));
    };
    return Object.assign(fn, { queries });
};

// every line of a good run, per group.
const GOOD_LOGS = {
    [G_LAMBDA]: [
        sendLine('sns'),
        sendLine('sqs'),
        sendLine('protocol'),
        recvLine('protocol', 7),
        sendLine('notify'),
        sendLine('enqueue'),
    ],
    [G_BACKEND]: [recvLine('sns', 120), recvLine('sqs', 300), recvLine('notify', 250), recvLine('enqueue', 3100)],
};

// a fake clock: `sleep` moves it forward.
const fakeClock = () => {
    let t = 1_000_000;
    const sleeps = [];
    return { now: () => t, sleep: async ms => (sleeps.push(ms), (t += ms)), sleeps };
};

// run with captured output, a fake STS banner and a fake clock; returns `{ code, out, err, lines }`.
const call = async (argv, deps = {}) => {
    const out = [];
    const err = [];
    const clock = fakeClock();
    const identity = async () => `account=****0000 region=x credentials=default-chain function=${LAMBDA}`;
    const code = await run(argv, {
        log: s => out.push(s),
        error: s => err.push(s),
        identity,
        now: clock.now,
        sleep: clock.sleep,
        intervalMs: 2000,
        ...deps,
    });
    return { code, out: out.join('\n'), err: err.join('\n'), lines: out.join('\n').split('\n'), clock };
};

// assert that `fn` throws an `ArgError` (code 2) whose message matches `re`.
const throwsArg = (fn, re) =>
    assert.throws(fn, e => e instanceof ArgError && e.code === 2 && re.test(e.message), `expected ArgError ${re}`);

describe('loop-check arguments', () => {
    test('unknown option, extra argument, bad --kind or --timeout exit 2', async () => {
        const unknown = await call(['--foo']);
        assert.equal(unknown.code, 2);
        assert.equal(unknown.err, 'ERROR: unknown option --foo (see --help)');
        const extra = await call(['sns']);
        assert.equal(extra.code, 2);
        assert.equal(extra.err, 'ERROR: unknown argument sns (see --help)');
        throwsArg(
            () => parseOptions(['--kind', 'kafka']),
            /^--kind must be sns, sqs, protocol, notify, enqueue or all \(got: kafka\)$/,
        );
        throwsArg(() => parseOptions(['--timeout', '999']), /^--timeout needs an integer 1000-600000/);
        throwsArg(() => parseOptions(['--timeout', '600001']), /^--timeout needs an integer/);
        throwsArg(() => parseOptions(['--timeout', 'x']), /^--timeout needs an integer/);
        throwsArg(() => parseOptions(['--name', 'x']), /^unknown option --name/);
    });
    test('defaults: all kinds, 60000 ms', () => {
        const o = parseOptions([]);
        assert.deepEqual(o.kinds, KINDS);
        assert.deepEqual(KINDS, ['sns', 'sqs', 'protocol', 'notify', 'enqueue']);
        assert.equal(o.timeoutMs, 60000);
        assert.deepEqual(parseOptions(['--kind', 'sqs', '--timeout', '5000']).kinds, ['sqs']);
        assert.equal(parseOptions(['--kind', 'all']).kinds.length, 5);
        assert.deepEqual(parseOptions(['--kind', 'notify']).kinds, ['notify']);
        assert.deepEqual(parseOptions(['--kind', 'enqueue']).kinds, ['enqueue']);
    });
    test('the stage guard exits 2 before any AWS call', async () => {
        const invoke = fakeInvoke();
        const r = await call(['--stage', 'prod'], { invoke });
        assert.equal(r.code, 2);
        assert.equal(r.err, 'ERROR: stage "prod" needs --confirm-stage prod');
        assert.equal(invoke.events.length, 0);
    });
    test('--help exits 0 with any other argument', async () => {
        const r = await call(['--help', '--foo']);
        assert.equal(r.code, 0);
        assert.match(r.lines[0], /loop test of the deployed service/);
    });
});

describe('loop-check run', () => {
    test('every kind received: exit 0, one line per kind', async () => {
        const invoke = fakeInvoke();
        const fetch = fakeFetch(GOOD_LOGS);
        const r = await call([], { invoke, fetch });
        assert.equal(r.code, 0, r.out);
        assert.deepEqual(r.lines, [
            `loop-check stage=dev lambda=${LAMBDA} backend=${BACKEND}`,
            `loop kind=sns loop=${IDS.sns} send=ok recv=ok latency=120 tid=${TIDS.sns}`,
            `loop kind=sqs loop=${IDS.sqs} send=ok recv=ok latency=300 tid=${TIDS.sqs}`,
            `loop kind=protocol loop=${IDS.protocol} send=ok recv=ok latency=7 tid=${TIDS.protocol} recv-tid=same`,
            `loop kind=notify loop=${IDS.notify} send=ok recv=ok latency=250 tid=${TIDS.notify} recv-tid=same`,
            `loop kind=enqueue loop=${IDS.enqueue} send=ok recv=ok latency=3100 tid=${TIDS.enqueue} recv-tid=same`,
        ]);
        assert.match(r.err, /^account=\*\*\*\*0000 /);
        assert.equal(r.clock.sleeps.length, 0);
    });
    test('the trigger: one internal admin POST /callback/<kind>/loop per kind (guard 6: no retry)', async () => {
        const invoke = fakeInvoke();
        await call([], { invoke, fetch: fakeFetch(GOOD_LOGS) });
        assert.deepEqual(
            invoke.events.map(e => `${e.httpMethod} ${e.path}`),
            [
                'POST /callback/sns/loop',
                'POST /callback/sqs/loop',
                'POST /callback/protocol/loop',
                'POST /callback/notify/loop',
                'POST /callback/enqueue/loop',
            ],
        );
        for (const e of invoke.events) {
            assert.ok(!Object.keys(e.headers).some(k => k.toLowerCase() === 'host'));
            assert.equal(e.headers['x-lemon-identity'], '{"sid":"loop-check","roles":["admin"]}');
            assert.deepEqual(e.pathParameters, { id: e.path.split('/')[2], cmd: 'loop' });
            assert.equal(e.resource, '/callback/{id}/{cmd}');
        }
    });
    test('log queries: filtered by the loop id; protocol recv in lambda, the others in backend', async () => {
        const fetch = fakeFetch(GOOD_LOGS);
        await call([], { invoke: fakeInvoke(), fetch });
        const seen = fetch.queries.map(q => `${q.logGroupName} ${q.filterPattern}`);
        assert.deepEqual(seen, [
            `${G_LAMBDA} "${IDS.sns}"`,
            `${G_BACKEND} "${IDS.sns}"`,
            `${G_LAMBDA} "${IDS.sqs}"`,
            `${G_BACKEND} "${IDS.sqs}"`,
            `${G_LAMBDA} "${IDS.protocol}"`,
            `${G_LAMBDA} "${IDS.notify}"`,
            `${G_BACKEND} "${IDS.notify}"`,
            `${G_LAMBDA} "${IDS.enqueue}"`,
            `${G_BACKEND} "${IDS.enqueue}"`,
        ]);
        assert.ok(fetch.queries.every(q => typeof q.startTime === 'number'));
        assert.deepEqual(logGroups('protocol', { lambda: 'a', backend: 'b' }), {
            send: '/aws/lambda/a',
            recv: '/aws/lambda/a',
        });
        for (const kind of ['sns', 'sqs', 'notify', 'enqueue']) {
            assert.deepEqual(logGroups(kind, { lambda: 'a', backend: 'b' }), {
                send: '/aws/lambda/a',
                recv: '/aws/lambda/b',
            });
        }
    });
    test('recv missing: polls until the timeout, then exit 1 (one invoke only)', async () => {
        const invoke = fakeInvoke();
        const fetch = fakeFetch({ [G_LAMBDA]: [sendLine('sns')] });
        const r = await call(['--kind', 'sns', '--timeout', '10000'], { invoke, fetch });
        assert.equal(r.code, 1);
        assert.equal(r.lines[1], `loop kind=sns loop=${IDS.sns} send=ok recv=missing latency=- tid=${TIDS.sns}`);
        assert.deepEqual(r.lines.slice(2), [`  - no [LOOP] recv line in ${G_BACKEND}`, '  - timeout after 10000ms']);
        assert.equal(invoke.events.length, 1);
        // polls at 0, 2, 4, 6, 8, 10 s (the last one at the timeout): 5 sleeps, 6 polls;
        // the send group is not queried again once found.
        assert.deepEqual(r.clock.sleeps, [2000, 2000, 2000, 2000, 2000]);
        assert.equal(fetch.queries.filter(q => q.logGroupName === G_LAMBDA).length, 1);
        assert.equal(fetch.queries.filter(q => q.logGroupName === G_BACKEND).length, 6);
    });
    test('a line that arrives late is found on a later poll', async () => {
        const logs = { [G_LAMBDA]: [sendLine('sqs')], [G_BACKEND]: [] };
        const fetch = fakeFetch(logs);
        const clock = fakeClock();
        const sleep = async ms => {
            await clock.sleep(ms);
            logs[G_BACKEND] = [recvLine('sqs', 900)];
        };
        const r = await call(['--kind', 'sqs'], { invoke: fakeInvoke(), fetch, now: clock.now, sleep });
        assert.equal(r.code, 0, r.out);
        assert.equal(r.lines[1], `loop kind=sqs loop=${IDS.sqs} send=ok recv=ok latency=900 tid=${TIDS.sqs}`);
        assert.deepEqual(clock.sleeps, [2000]);
    });
    test('non-200 http: exit 1, no log poll', async () => {
        const fetch = fakeFetch(GOOD_LOGS);
        const r = await call(['--kind', 'sns'], { invoke: fakeInvoke({ http: 403 }), fetch });
        assert.equal(r.code, 1);
        assert.deepEqual(r.lines.slice(1), [
            'loop kind=sns loop=- send=missing recv=missing latency=- tid=-',
            '  - expected http 200 got 403: nope',
        ]);
        assert.equal(fetch.queries.length, 0);
    });
    test('a FunctionError exits 1', async () => {
        const r = await call(['--kind', 'sqs'], { invoke: fakeInvoke({ functionError: 'Unhandled' }) });
        assert.equal(r.code, 1);
        assert.match(r.out, /lambda invoke failed: status=200 function-error=Unhandled/);
    });
    test('protocol: a result with another loop id exits 1', async () => {
        const body = kind => ({ kind, loopId: IDS[kind], sentAt: 1, result: { loopId: IDS.sns } });
        const r = await call(['--kind', 'protocol'], { invoke: fakeInvoke({ body }), fetch: fakeFetch(GOOD_LOGS) });
        assert.equal(r.code, 1);
        assert.ok(r.lines.includes('  - protocol result.loopId does not match'));
        assert.match(r.lines[1], / send=ok recv=ok latency=7 tid=\S+ recv-tid=same$/);
    });
    test('a Logs error exits 1 with the error redacted; a missing log group reads as empty', async () => {
        const fail = Object.assign(new Error('denied for arn:aws:iam::123456789012:user/x'), {
            name: 'AccessDeniedException',
        });
        const r = await call(['--kind', 'sns'], { invoke: fakeInvoke(), fetch: fakeFetch({}, { fail }) });
        assert.equal(r.code, 1);
        assert.equal(r.err.split('\n').at(-1), 'ERROR: AccessDeniedException: denied for <arn>');
        const missing = Object.assign(new Error('no group'), { name: 'ResourceNotFoundException' });
        const m = await call(['--kind', 'sns', '--timeout', '1000'], {
            invoke: fakeInvoke(),
            fetch: fakeFetch({}, { fail: missing }),
        });
        assert.equal(m.code, 1);
        assert.match(m.out, /send=missing recv=missing/);
    });
    test('--json prints { stage, functions, results } only', async () => {
        const r = await call(['--kind', 'sns', '--json'], { invoke: fakeInvoke(), fetch: fakeFetch(GOOD_LOGS) });
        assert.equal(r.code, 0);
        const json = JSON.parse(r.out);
        assert.deepEqual(Object.keys(json), ['stage', 'functions', 'results']);
        assert.deepEqual(json.functions, { lambda: LAMBDA, backend: BACKEND });
        assert.deepEqual(json.results, [
            {
                kind: 'sns',
                loopId: IDS.sns,
                messageId: 'mid-sns',
                http: 200,
                send: true,
                recv: true,
                latency: 120,
                tid: TIDS.sns,
                recvTid: null,
                issues: [],
            },
        ]);
    });
});

describe('loop-check trace (tid)', () => {
    test('a relay kind whose recv tid differs: exit 1 with the mismatch', async () => {
        const logs = { [G_LAMBDA]: [sendLine('notify')], [G_BACKEND]: [recvLine('notify', 9, 'other-tid')] };
        const r = await call(['--kind', 'notify'], { invoke: fakeInvoke(), fetch: fakeFetch(logs) });
        assert.equal(r.code, 1);
        assert.deepEqual(r.lines.slice(1), [
            `loop kind=notify loop=${IDS.notify} send=ok recv=ok latency=9 tid=${TIDS.notify} recv-tid=differs`,
            `  - tid mismatch: send=${TIDS.notify} recv=other-tid`,
        ]);
    });
    test('a relay kind whose recv line has no tid (old receiver): exit 1', async () => {
        const logs = { [G_LAMBDA]: [sendLine('enqueue')], [G_BACKEND]: [recvLine('enqueue', 9, null)] };
        const r = await call(['--kind', 'enqueue'], { invoke: fakeInvoke(), fetch: fakeFetch(logs) });
        assert.equal(r.code, 1);
        assert.deepEqual(r.lines.slice(2), ['  - no tid on the [LOOP] recv line']);
    });
    test('protocol: send and recv in the lambda group with the same tid: exit 0', async () => {
        const logs = { [G_LAMBDA]: [sendLine('protocol'), recvLine('protocol', 5)] };
        const r = await call(['--kind', 'protocol', '--json'], { invoke: fakeInvoke(), fetch: fakeFetch(logs) });
        assert.equal(r.code, 0);
        const [res] = JSON.parse(r.out).results;
        assert.deepEqual([res.tid, res.recvTid, res.issues], [TIDS.protocol, TIDS.protocol, []]);
    });
    test('sns / sqs: the tid is printed, never compared (a raw message has no relay)', async () => {
        const r = await call(['--kind', 'sqs'], { invoke: fakeInvoke(), fetch: fakeFetch(GOOD_LOGS) });
        assert.equal(r.code, 0);
        assert.match(r.lines[1], new RegExp(` tid=${TIDS.sqs}$`));
        assert.deepEqual(tidIssues('sqs', { send: true, recv: true, sendTid: 'a', recvTid: null }), []);
    });
    test('tidOf reads a safe id only; tidIssues skips a missing line', () => {
        assert.equal(tidOf('[LOOP] send kind=x loop=y message=- tid=abc-1.2:3_4 hop=0 mock=1'), 'abc-1.2:3_4');
        assert.equal(tidOf('[LOOP] recv kind=x loop=y latency=1ms tid=a-b hop=1\n'), 'a-b');
        assert.equal(tidOf('[LOOP] recv kind=x loop=y latency=1ms tid=<bad> hop=1'), null);
        assert.equal(tidOf('[LOOP] recv kind=x loop=y latency=1ms'), null);
        assert.deepEqual(tidIssues('protocol', { send: true, recv: false, sendTid: 'a' }), []);
        assert.deepEqual(tidIssues('protocol', { send: true, recv: true, sendTid: null, recvTid: 'a' }), [
            'no tid on the [LOOP] send line',
        ]);
        assert.deepEqual(TRACE_KINDS, ['protocol', 'notify', 'enqueue']);
    });
});

describe('loop-check helpers and --dry', () => {
    test('findLines strips ANSI codes and reads the latency', () => {
        const got = findLines([{ message: sendLine('sns') }, { message: recvLine('sns', 55) }], 'sns', IDS.sns);
        assert.deepEqual(got, { send: true, recv: true, latency: 55, sendTid: TIDS.sns, recvTid: null });
        // another kind or loop id does not match.
        assert.deepEqual(findLines([{ message: recvLine('sns') }], 'sqs', IDS.sns), {
            send: false,
            recv: false,
            latency: null,
            sendTid: null,
            recvTid: null,
        });
        assert.equal(findLines([{ message: recvLine('sqs') }], 'sqs', IDS.sns).recv, false);
    });
    test('waitForLines never polls past the timeout', async () => {
        const clock = fakeClock();
        const fetch = fakeFetch({});
        const groups = { send: 'a', recv: 'b' };
        const r = await waitForLines(fetch, {
            kind: 'sns',
            loopId: IDS.sns,
            groups,
            startTime: 0,
            timeoutMs: 5000,
            intervalMs: 2000,
            now: clock.now,
            sleep: clock.sleep,
        });
        // polls at 0, 2, 4 s; a poll at 6 s would pass the 5 s timeout.
        assert.deepEqual(r, {
            send: false,
            recv: false,
            latency: null,
            sendTid: null,
            recvTid: null,
            timedOut: true,
            polls: 3,
        });
        assert.deepEqual(clock.sleeps, [2000, 2000]);
    });
    test('resultLine format', () => {
        const r = { kind: 'sqs', loopId: IDS.sqs, send: true, recv: false, latency: null, issues: [] };
        assert.equal(resultLine(r), `loop kind=sqs loop=${IDS.sqs} send=ok recv=missing latency=-`);
        // lambda results carry `tid` (and `recvTid` for the relay kinds).
        assert.equal(resultLine({ ...r, tid: 't-1', recvTid: null }), `${resultLine(r)} tid=t-1`);
        const p = { ...r, kind: 'notify', loopId: IDS.notify, recv: true, latency: 3, tid: 't-1' };
        assert.match(resultLine({ ...p, recvTid: 't-1' }), / latency=3 tid=t-1 recv-tid=same$/);
        assert.match(resultLine({ ...p, recvTid: 't-2' }), / latency=3 tid=t-1 recv-tid=differs$/);
        assert.match(resultLine({ ...p, tid: null, recvTid: null }), / latency=3 tid=- recv-tid=missing$/);
        assert.equal(triggerEvent('sns', 'dev').body, '{"note":"loop:check"}');
    });
    test('--dry prints the targets and the events with the identity masked, no AWS call (no stderr)', () => {
        //* v5 B19: `cwd` = the temp consumer root.
        const r = spawnSync(process.execPath, [SCRIPT, '--dry'], { encoding: 'utf8', cwd: C.root });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stderr, '');
        const lines = r.stdout.split('\n');
        assert.equal(
            lines[0],
            `loop-check stage=dev lambda=${LAMBDA} backend=${BACKEND} kinds=sns,sqs,protocol,notify,enqueue timeout=60000ms region=${
                process.env.AWS_REGION || 'ap-northeast-2'
            } (dry)`,
        );
        assert.ok(lines.includes(`--- kind=sns: invoke ${LAMBDA}, send in ${G_LAMBDA}, recv in ${G_BACKEND} ---`));
        assert.ok(lines.includes(`--- kind=protocol: invoke ${LAMBDA}, send in ${G_LAMBDA}, recv in ${G_LAMBDA} ---`));
        assert.ok(lines.includes(`--- kind=notify: invoke ${LAMBDA}, send in ${G_LAMBDA}, recv in ${G_BACKEND} ---`));
        assert.ok(lines.includes(`--- kind=enqueue: invoke ${LAMBDA}, send in ${G_LAMBDA}, recv in ${G_BACKEND} ---`));
        assert.match(r.stdout, /"x-lemon-identity": "<redacted>"/);
        assert.match(r.stdout, /"path": "\/callback\/sqs\/loop"/);
        assert.doesNotMatch(r.stdout, /"host"/i);
    });
    test('the stage guard runs before --dry', () => {
        const r = spawnSync(process.execPath, [SCRIPT, '--stage', 'prod', '--dry'], { encoding: 'utf8', cwd: C.root });
        assert.equal(r.status, 2);
        assert.equal(r.stderr.trim(), 'ERROR: stage "prod" needs --confirm-stage prod');
    });
    //* v5 B19: the names come from the root `serverless.yml`: the process cwd, or `--cwd` from anywhere.
    test('--dry with `--cwd` from another directory; no serverless.yml exits 2', () => {
        assert.equal(LAMBDA, `${SERVICE}-dev-lambda`);
        const r = spawnSync(process.execPath, [SCRIPT, '--dry', '--kind', 'sns', '--cwd', C.root], {
            encoding: 'utf8',
            cwd: tmpdir(),
        });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, new RegExp(`^loop-check stage=dev lambda=${LAMBDA} backend=${BACKEND} kinds=sns `));
        const none = spawnSync(process.execPath, [SCRIPT, '--dry'], { encoding: 'utf8', cwd: tmpdir() });
        assert.equal(none.status, 2);
        assert.match(none.stderr, /^ERROR: cannot read serverless\.yml /);
    });
});

// a fake `fetch` of the local express server: answers each kind like `doPostLoop()` with the local transport.
// `answer(kind, body)` may change the body; `status` the http status; records each request.
const fakeServer = ({ status = 200, answer, fail } = {}) => {
    const requests = [];
    const fn = async (url, init) => {
        requests.push({ url, ...init });
        if (fail) throw fail;
        const kind = new URL(url).pathname.split('/')[2];
        const loopId = IDS[kind];
        const recv = [{ kind, loopId, recvAt: 1042, hop: 1 }];
        const base = { kind, loopId, sentAt: 1000, mock: true, recv };
        const ok =
            kind === 'protocol'
                ? { ...base, result: { loopId, recvAt: 1042, hop: 1 } }
                : { ...base, messageId: `mock-${kind}` };
        const body = answer ? answer(kind, ok) : ok;
        return { status, text: async () => (status === 200 ? JSON.stringify(body) : '403 NOT ALLOWED - x') };
    };
    return Object.assign(fn, { requests });
};

describe('loop-check --target express', () => {
    test('every kind received: exit 0, one POST per kind to 127.0.0.1:<port>, no AWS', async () => {
        const fetch = fakeServer();
        const invoke = fakeInvoke();
        const identity = async () => assert.fail('no STS banner for express');
        const r = await call(['--target', 'express', '--port', '8899'], { fetch, invoke, identity });
        assert.equal(r.code, 0, r.out);
        assert.deepEqual(r.lines, [
            'loop-check target=express url=http://127.0.0.1:8899',
            `loop kind=sns loop=${IDS.sns} send=ok recv=ok latency=42`,
            `loop kind=sqs loop=${IDS.sqs} send=ok recv=ok latency=42`,
            `loop kind=protocol loop=${IDS.protocol} send=ok recv=ok latency=42`,
            `loop kind=notify loop=${IDS.notify} send=ok recv=ok latency=42`,
            `loop kind=enqueue loop=${IDS.enqueue} send=ok recv=ok latency=42`,
        ]);
        assert.equal(r.err, '');
        assert.deepEqual(
            fetch.requests.map(q => `${q.method} ${q.url}`),
            KINDS.map(k => `POST http://127.0.0.1:8899/callback/${k}/loop`),
        );
        assert.equal(fetch.requests[0].body, '{"note":"loop:check"}');
        assert.equal(invoke.events.length, 0);
    });
    test('default port from package.json, --kind and --json', async () => {
        const fetch = fakeServer();
        const r = await call(['--target', 'express', '--kind', 'notify', '--json'], { fetch });
        assert.equal(r.code, 0, r.out);
        const port = defaultPort();
        //* v5 B19: the port of the temp consumer root.
        assert.equal(port, PORT);
        assert.equal(fetch.requests[0].url, `http://127.0.0.1:${port}/callback/notify/loop`);
        const json = JSON.parse(r.out);
        assert.equal(json.target, 'express');
        assert.equal(json.url, `http://127.0.0.1:${port}`);
        assert.deepEqual(json.results[0], {
            kind: 'notify',
            loopId: IDS.notify,
            messageId: 'mock-notify',
            http: 200,
            send: true,
            recv: true,
            latency: 42,
            issues: [],
        });
    });
    test('not mock, no recv, recv twice or another loop id: exit 1 with the issue', async () => {
        const noMock = await call(['--target', 'express', '--kind', 'sns'], {
            fetch: fakeServer({ answer: (k, b) => ({ ...b, mock: undefined, recv: undefined }) }),
        });
        assert.equal(noMock.code, 1);
        assert.deepEqual(noMock.lines.slice(1), [
            `loop kind=sns loop=${IDS.sns} send=ok recv=missing latency=-`,
            '  - no mock: true in the response (run the server with npm run express.lemon)',
            '  - expected 1 recv for the loopId got 0',
        ]);
        const twice = await call(['--target', 'express', '--kind', 'sqs'], {
            fetch: fakeServer({ answer: (k, b) => ({ ...b, recv: [...b.recv, ...b.recv] }) }),
        });
        assert.equal(twice.code, 1);
        assert.equal(twice.lines[2], '  - expected 1 recv for the loopId got 2');
        const other = await call(['--target', 'express', '--kind', 'enqueue'], {
            fetch: fakeServer({ answer: (k, b) => ({ ...b, recv: [{ ...b.recv[0], loopId: IDS.sns }] }) }),
        });
        assert.equal(other.code, 1);
        assert.equal(other.lines[2], '  - expected 1 recv for the loopId got 0');
    });
    test('non-200 answer: exit 1; server down: exit 1 with one ERROR line', async () => {
        const denied = await call(['--target', 'express', '--kind', 'protocol'], {
            fetch: fakeServer({ status: 403 }),
        });
        assert.equal(denied.code, 1);
        assert.deepEqual(denied.lines.slice(1), [
            `loop kind=protocol loop=- send=missing recv=missing latency=-`,
            '  - expected http 200 got 403: 403 NOT ALLOWED - x',
        ]);
        const fail = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        const down = await call(['--target', 'express', '--port', '1'], { fetch: fakeServer({ fail }) });
        assert.equal(down.code, 1);
        assert.equal(down.err, 'ERROR: cannot reach http://127.0.0.1:1/callback/sns/loop (ECONNREFUSED)');
    });
    test('lambda-target options with --target express (and --port without it) exit 2', async () => {
        for (const opt of [
            ['--stage', 'dev'],
            ['--confirm-stage', 'dev'],
            ['--region', 'x'],
            ['--profile', 'p'],
            ['--timeout', '5000'],
            ['--dry'],
        ]) {
            const fetch = fakeServer();
            const r = await call(['--target', 'express', ...opt], { fetch });
            assert.equal(r.code, 2, opt.join(' '));
            assert.equal(r.err, `ERROR: ${opt[0]} applies to --target lambda only`);
            assert.equal(fetch.requests.length, 0);
        }
        throwsArg(() => parseOptions(['--port', '8800']), /^--port applies to --target express only$/);
        throwsArg(() => parseOptions(['--target', 'ecs']), /^--target must be express or lambda \(got: ecs\)$/);
        throwsArg(() => parseOptions(['--target', 'express', '--port', '0']), /^--port needs an integer 1-65535/);
        throwsArg(() => parseOptions(['--target', 'express', '--port', 'x']), /^--port needs an integer 1-65535/);
        assert.equal(parseOptions([]).target, 'lambda');
    });
    //* v5 B19: `--cwd` applies to both targets; the express port is read under it.
    test("`--cwd` on --target express reads that root's port; a missing port exits 2", async () => {
        const other = makeConsumer({ port: 9922 });
        const bare = makeConsumer({ port: null });
        try {
            assert.equal(defaultPort(other.root), 9922);
            const fetch = fakeServer();
            const r = await call(['--target', 'express', '--kind', 'sns', '--cwd', other.root], { fetch });
            assert.equal(r.code, 0, r.out);
            assert.equal(fetch.requests[0].url, 'http://127.0.0.1:9922/callback/sns/loop');
            const miss = await call(['--target', 'express', '--cwd', bare.root], { fetch: fakeServer() });
            assert.equal(miss.code, 2);
            assert.equal(miss.err, 'ERROR: no "port" in package.json; pass --port <n>');
            throwsArg(() => parseOptions(['--cwd']), /^--cwd needs a directory$/);
            throwsArg(() => defaultPort(`${bare.root}/none`), /^cannot read package\.json .*pass --port <n>$/);
        } finally {
            other.done();
            bare.done();
        }
    });
});
