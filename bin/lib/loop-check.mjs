/**
 * `bin/lib/loop-check.mjs` (lemon-core)
 * - check the loop test of the deployed service end to end: one admin invoke of `lambda` per kind
 *   (`POST /callback/<kind>/loop`), then the `[LOOP] send` / `[LOOP] recv` lines in CloudWatch.
 *   - `sns`, `sqs`: send in the `lambda` log group, recv in the `backend` log group.
 *   - `protocol`: send and recv both in the `lambda` log group (`//self` is the `lambda` function).
 *   - `notify`, `enqueue`: protocol service over SNS / SQS; send in `lambda`, recv (`loop-recv`) in `backend`.
 * - exactly one invoke per kind, no retry; the log poll stops at `--timeout`.
 * - lemon-core B14 trace: each `[LOOP]` line ends with ` tid=<tid> hop=<hop>`. per kind it prints the send `tid`;
 *   for `protocol`, `notify`, `enqueue` (relay hops) the recv line must carry the same `tid` (else exit 1).
 * - `--target express`: the same trigger on a local express server run with lemon-core's local transport
 *   (`npm run express.lemon`, `LOCAL_TRANSPORT=mock`): `POST /callback/<kind>/loop`, and the answer must hold
 *   `mock: true` and `recv` with the same loop id (no AWS, no log poll).
 * - all logic of `lemon-loop-check`: no `process.exit`; the Lambda invoker, the log fetch, the STS banner,
 *   `fetch`, the clock, and the printers are injectable, so the tests run offline.
 * - the service root (`serverless.yml`, `package.json`) is `--cwd <dir>`, else `process.cwd()`.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/loop-check.mjs` (snapshot d57dc5b); root = cwd.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    parseArgs,
    resolveAws,
    functionName,
    checkStage,
    outputFilter,
    maskHeaders,
    resolveIdentity,
    stripControl,
    HarnessError,
    ArgError,
    DEFAULT_REGION,
    serviceRoot,
} from './common.mjs';
import { webEvent } from './event.mjs';

// every loop kind, in the order of `--kind all`.
export const KINDS = ['sns', 'sqs', 'protocol', 'notify', 'enqueue'];

// kinds that cross a protocol hop (lemon-core relay): the recv line carries the send `tid`.
export const TRACE_KINDS = ['protocol', 'notify', 'enqueue'];

// identity of the admin trigger (lemon-core reads it on internal calls only).
// lemon-core accepts a JSON identity only with a non-empty `sid` (else the identity is dropped → 403).
export const ADMIN_IDENTITY = '{"sid":"loop-check","roles":["admin"]}';

// note sent in the trigger body (echoed in the loop payload).
export const NOTE = 'loop:check';

// default and allowed range of `--timeout` (ms).
export const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

// poll interval of the log query (ms).
export const DEFAULT_INTERVAL_MS = 2000;

// the log query starts this long before the invoke (clock skew and ingestion slack).
export const LOOKBACK_MS = 60 * 1000;

// help text for `--help`.
export const HELP = [
    'Check the SNS / SQS / protocol / notify / enqueue loop test of the deployed service from its CloudWatch log lines.',
    '',
    'usage: lemon-loop-check [options]',
    '       npm run loop:check -- [options]',
    '',
    'per kind: one internal admin invoke of `lambda` (POST /callback/<kind>/loop), then a poll of the log lines',
    '  sns, sqs, notify, enqueue:  [LOOP] send in the lambda log group, [LOOP] recv in the backend log group',
    '  protocol:                   [LOOP] send and [LOOP] recv both in the lambda log group',
    '  tid:                        the send line tid is printed; protocol, notify, enqueue: the recv line',
    '                              must carry the same tid (lemon-core relay trace)',
    '',
    'options:',
    '  --target <t>            lambda | express (default: lambda)',
    '  --kind <k>              sns | sqs | protocol | notify | enqueue | all (default: all)',
    '  --cwd <dir>             service root (serverless.yml, package.json; default: the current directory)',
    '  --json                  print { stage, functions, results } (express: { target, url, results }) only',
    '  --help                  show this help',
    '',
    'lambda (the deployed service; IAM credentials):',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain)',
    `  --timeout <ms>          max wait for the log lines per kind, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (default: ${DEFAULT_TIMEOUT_MS})`,
    '  --dry                   print the targets and the events, do not call AWS',
    '',
    'express (a local server run by `npm run express.lemon`: LOCAL_MODE=1 and LOCAL_TRANSPORT=mock):',
    '  --port <n>              server port on 127.0.0.1 (default: "port" of package.json)',
    '  per kind: one POST /callback/<kind>/loop; the answer must be http 200 with mock: true and',
    '  recv holding the same loopId exactly once (no AWS call, no log poll)',
    '',
    'exit codes: 0 = every kind received; 1 = any missing, timeout, non-200, tid mismatch, or AWS error;',
    '            2 = bad arguments.',
];

// flags that never take a value.
const BOOLEANS = ['json', 'dry', 'help'];

// options for `--target lambda` only.
const LAMBDA_ONLY = ['stage', 'confirm-stage', 'region', 'profile', 'timeout', 'dry'];

// options for `--target express` only.
const EXPRESS_ONLY = ['port'];

// every accepted option.
//* v5 B19: `cwd` (the service root) applies to both targets.
const KNOWN = ['target', 'kind', 'cwd', ...LAMBDA_ONLY, ...EXPRESS_ONLY, 'json', 'help'];

// UUID shape of a loop id.
const LOOP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// a safe message id to print (AWS ids are short word/dash strings).
const MESSAGE_ID_RE = /^[\w-]{1,128}$/;

// parse argv strictly and check the values (throws `ArgError`).
export const parseOptions = argv => {
    const opts = parseArgs(argv, { booleans: BOOLEANS, known: KNOWN, maxPositional: 0 });
    if (opts.help) return opts;
    // `--target`: lambda (default) or express; it decides which options apply.
    const target = opts.target === undefined ? 'lambda' : opts.target;
    if (!['express', 'lambda'].includes(target)) {
        throw new ArgError(`--target must be express or lambda (got: ${target})`);
    }
    const [others, owner] = target === 'express' ? [LAMBDA_ONLY, 'lambda'] : [EXPRESS_ONLY, 'express'];
    const wrong = others.find(k => opts[k] !== undefined);
    if (wrong) throw new ArgError(`--${wrong} applies to --target ${owner} only`);
    // `--port`: an integer 1-65535.
    const p = opts.port;
    if (p !== undefined && !(typeof p === 'string' && /^\d+$/.test(p) && +p >= 1 && +p <= 65535)) {
        throw new ArgError(`--port needs an integer 1-65535 (got: ${p})`);
    }
    // `--kind`: one kind or all.
    const kind = opts.kind === undefined ? 'all' : opts.kind;
    if (!(kind === 'all' || KINDS.includes(kind))) {
        throw new ArgError(`--kind must be sns, sqs, protocol, notify, enqueue or all (got: ${kind})`);
    }
    // `--timeout`: an integer within the range.
    const t = opts.timeout;
    const okT =
        t === undefined || (typeof t === 'string' && /^\d+$/.test(t) && +t >= MIN_TIMEOUT_MS && +t <= MAX_TIMEOUT_MS);
    if (!okT) throw new ArgError(`--timeout needs an integer ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (got: ${t})`);
    //* v5 B19: a bad `--cwd` is an argument error up front.
    serviceRoot(opts.cwd);
    return {
        ...opts,
        target,
        kinds: kind === 'all' ? [...KINDS] : [kind],
        timeoutMs: t === undefined ? DEFAULT_TIMEOUT_MS : Number(t),
    };
};

// default express port from `"port"` in `<root>/package.json` (throws `ArgError`).
//* v5 B19: `root` (default: the service root) instead of the tool's own repo.
export const defaultPort = (root = serviceRoot()) => {
    let port;
    try {
        port = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).port;
    } catch (e) {
        throw new ArgError(`cannot read package.json (${e.message}); pass --port <n>`);
    }
    if (!port) throw new ArgError('no "port" in package.json; pass --port <n>');
    return Number(port);
};

// the trigger event of one kind: internal web event (no Host) with the admin identity.
export const triggerEvent = (kind, stage) =>
    webEvent(
        {
            method: 'POST',
            path: `/callback/${kind}/loop`,
            internal: true,
            identity: ADMIN_IDENTITY,
            body: JSON.stringify({ note: NOTE }),
        },
        stage,
    );

// log groups of one kind: where the send line and the recv line appear.
export const logGroups = (kind, names) => ({
    send: `/aws/lambda/${names.lambda}`,
    recv: `/aws/lambda/${kind === 'protocol' ? names.lambda : names.backend}`,
});

// parse a JSON text, or return undefined.
const tryJson = text => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

// the web response of one invoke → `{ http, body, issue }` (`issue` when the invoke itself failed).
export const readResponse = r => {
    if (r.functionError || !(r.statusCode >= 200 && r.statusCode < 300)) {
        const issue = `lambda invoke failed: status=${r.statusCode} function-error=${r.functionError || 'none'}`;
        return { http: null, body: null, issue: `${issue}: ${`${r.text ?? ''}`.trim()}` };
    }
    const payload = r.text ? tryJson(r.text) : undefined;
    if (!payload || typeof payload !== 'object' || !('statusCode' in payload)) {
        return { http: null, body: null, issue: `not a web response: ${`${r.text ?? ''}`.trim()}` };
    }
    const http = Number(payload.statusCode);
    const raw = payload.body;
    // the handler answers a JSON text (or an object when already parsed).
    const body = typeof raw === 'string' ? tryJson(raw) ?? raw : raw;
    if (http !== 200) return { http, body: null, issue: `expected http 200 got ${http}: ${`${raw ?? ''}`.trim()}` };
    return { http, body, issue: null };
};

// check the trigger answer of one kind → `{ loopId, messageId, issues }`.
export const checkAnswer = (kind, body) => {
    const issues = [];
    const B = body && typeof body === 'object' ? body : {};
    const loopId = LOOP_ID_RE.test(`${B.loopId ?? ''}`) ? B.loopId : null;
    if (!loopId) issues.push('no valid loopId in the response');
    if (B.kind !== kind) issues.push(`expected kind=${kind} got ${B.kind ?? '-'}`);
    const messageId = MESSAGE_ID_RE.test(`${B.messageId ?? ''}`) ? B.messageId : null;
    // sns/sqs/notify/enqueue: a message id from AWS; protocol: the receiver's result with the same loop id.
    if (kind !== 'protocol' && !messageId) issues.push('no messageId in the response');
    if (kind === 'protocol' && (!loopId || B.result?.loopId !== loopId)) {
        issues.push('protocol result.loopId does not match');
    }
    return { loopId, messageId, issues };
};

// escape a literal for use inside a RegExp.
const escapeRe = s => `${s}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the ` tid=<tid>` of a loop line (a safe id only: word, dot, colon, dash; max 128), or null.
const TID_RE = / tid=([\w.:-]{1,128})(?=\s|$)/;

// the tid of a loop line, or null (none, or not a safe id).
export const tidOf = text => {
    const m = `${text ?? ''}`.match(TID_RE);
    return m ? m[1] : null;
};

// find the send / recv lines of one loop in log events → `{ send, recv, latency, sendTid, recvTid }`.
export const findLines = (events, kind, loopId) => {
    const id = escapeRe(loopId);
    const sendRe = new RegExp(`\\[LOOP\\] send kind=${kind} loop=${id} message=`);
    const recvRe = new RegExp(`\\[LOOP\\] recv kind=${kind} loop=${id} latency=(\\d+)ms`);
    const found = { send: false, recv: false, latency: null, sendTid: null, recvTid: null };
    // ANSI color codes of the lemon-core logger are stripped first.
    for (const ev of events || []) {
        const text = stripControl(ev?.message ?? '');
        if (sendRe.test(text)) {
            found.send = true;
            found.sendTid = tidOf(text);
        }
        const m = text.match(recvRe);
        if (m) {
            found.recv = true;
            found.latency = Number(m[1]);
            found.recvTid = tidOf(text);
        }
    }
    return found;
};

// wait for the given milliseconds.
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// a log group not created yet (no invoke so far) reads as no events.
const isMissingGroup = e => e?.name === 'ResourceNotFoundException';

// poll the log groups for one loop until both lines are seen or `timeoutMs` passes (no other retry).
// → `{ send, recv, latency, timedOut, polls }`.
export const waitForLines = async (
    fetch,
    {
        kind,
        loopId,
        groups,
        startTime,
        timeoutMs,
        intervalMs = DEFAULT_INTERVAL_MS,
        sleep = defaultSleep,
        now = Date.now,
    },
) => {
    const t0 = now();
    const state = { send: false, recv: false, latency: null, sendTid: null, recvTid: null };
    const filterPattern = `"${loopId}"`;
    // one query of a group (a missing group is empty).
    const query = group =>
        fetch({ logGroupName: group, filterPattern, startTime }).catch(e => {
            if (isMissingGroup(e)) return [];
            throw e;
        });
    let polls = 0;
    for (;;) {
        polls++;
        // query only the groups still needed (one query when send and recv share a group).
        const need = [...new Set([!state.send && groups.send, !state.recv && groups.recv].filter(Boolean))];
        for (const group of need) {
            const got = findLines(await query(group), kind, loopId);
            if (group === groups.send && got.send) Object.assign(state, { send: true, sendTid: got.sendTid });
            if (group === groups.recv && got.recv) {
                Object.assign(state, { recv: true, latency: got.latency, recvTid: got.recvTid });
            }
        }
        if (state.send && state.recv) return { ...state, timedOut: false, polls };
        // the hard timeout: stop when the next poll would pass it.
        if (now() - t0 + intervalMs > timeoutMs) return { ...state, timedOut: true, polls };
        await sleep(intervalMs);
    }
};

// the tid issues of one kind (relay kinds only, both lines seen): a tid on each line, and the same tid.
export const tidIssues = (kind, seen) => {
    if (!TRACE_KINDS.includes(kind) || !seen.send || !seen.recv) return [];
    if (!seen.sendTid) return ['no tid on the [LOOP] send line'];
    if (!seen.recvTid) return ['no tid on the [LOOP] recv line'];
    return seen.sendTid === seen.recvTid ? [] : [`tid mismatch: send=${seen.sendTid} recv=${seen.recvTid}`];
};

// check one kind: one invoke, then the log poll → result record.
export const checkKind = async (kind, { stage, names, timeoutMs, invoke, fetch, sleep, now, intervalMs }) => {
    const clock = now || Date.now;
    const startTime = clock() - LOOKBACK_MS;
    const base = {
        kind,
        loopId: null,
        messageId: null,
        http: null,
        send: false,
        recv: false,
        latency: null,
        tid: null,
        recvTid: null,
    };
    // exactly one invoke per kind (never retried).
    const res = readResponse(await invoke(triggerEvent(kind, stage)));
    if (res.issue) return { ...base, http: res.http, issues: [res.issue] };
    const answer = checkAnswer(kind, res.body);
    const record = { ...base, http: res.http, loopId: answer.loopId, messageId: answer.messageId };
    if (!answer.loopId) return { ...record, issues: answer.issues };
    const groups = logGroups(kind, names);
    const opts = { kind, loopId: answer.loopId, groups, startTime, timeoutMs, intervalMs, sleep, now: clock };
    const seen = await waitForLines(fetch, opts);
    const issues = [...answer.issues];
    if (!seen.send) issues.push(`no [LOOP] send line in ${groups.send}`);
    if (!seen.recv) issues.push(`no [LOOP] recv line in ${groups.recv}`);
    if (seen.timedOut) issues.push(`timeout after ${timeoutMs}ms`);
    issues.push(...tidIssues(kind, seen));
    const tids = { tid: seen.sendTid, recvTid: seen.recvTid };
    return { ...record, send: seen.send, recv: seen.recv, latency: seen.latency, ...tids, issues };
};

// check one kind on the local express server: one POST, then the answer (`mock: true`, `recv` with the loop id).
// transport errors throw `HarnessError` code 1 (the server is not running).
export const checkExpressKind = async (kind, { base, fetchFn }) => {
    const url = `${base}/callback/${kind}/loop`;
    const record = { kind, loopId: null, messageId: null, http: null, send: false, recv: false, latency: null };
    let resp;
    try {
        // exactly one POST per kind (never retried); local mode makes the request admin.
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        resp = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify({ note: NOTE }) });
    } catch (e) {
        // `fetch failed` hides the reason in `cause` (ex: ECONNREFUSED).
        throw new HarnessError(`cannot reach ${url} (${e?.cause?.code || e?.cause?.message || e?.message || e})`, 1);
    }
    const text = await resp.text();
    const http = resp.status;
    if (http !== 200) return { ...record, http, issues: [`expected http 200 got ${http}: ${`${text ?? ''}`.trim()}`] };
    const body = tryJson(text);
    const answer = checkAnswer(kind, body);
    const issues = [...answer.issues];
    const B = body && typeof body === 'object' ? body : {};
    if (B.mock !== true) issues.push('no mock: true in the response (run the server with npm run express.lemon)');
    // the receiver results of this loop id: exactly one.
    const recv = Array.isArray(B.recv) ? B.recv.filter(r => answer.loopId && r?.loopId === answer.loopId) : [];
    if (recv.length !== 1) issues.push(`expected 1 recv for the loopId got ${recv.length}`);
    const ms = recv.length ? Number(recv[0].recvAt) - Number(B.sentAt) : NaN;
    const latency = Number.isFinite(ms) ? ms : null;
    const send = !!answer.loopId;
    return {
        ...record,
        http,
        loopId: answer.loopId,
        messageId: answer.messageId,
        send,
        recv: recv.length === 1,
        latency,
        issues,
    };
};

// the trace tail of a lambda result: ` tid=<send tid|->`, and for the relay kinds ` recv-tid=<same|differs|missing>`.
// an express result has no `tid` key → ''.
const traceTail = r => {
    if (!('tid' in r)) return '';
    const head = ` tid=${r.tid || '-'}`;
    if (!TRACE_KINDS.includes(r.kind)) return head;
    const same = !r.recvTid ? 'missing' : r.recvTid === r.tid ? 'same' : 'differs';
    return `${head} recv-tid=${same}`;
};

// one result line: `loop kind=<k> loop=<id> send=<ok|missing> recv=<ok|missing> latency=<ms|->` (+ the trace tail).
export const resultLine = r =>
    `loop kind=${r.kind} loop=${r.loopId || '-'} send=${r.send ? 'ok' : 'missing'} recv=${r.recv ? 'ok' : 'missing'}` +
    ` latency=${r.latency === null || r.latency === undefined ? '-' : r.latency}${traceTail(r)}`;

// a kind passes with no issue and both lines seen.
export const passed = r => r.send && r.recv && r.issues.length === 0;

// exit code of all results: 0 only when every kind passed.
export const exitCode = results => (results.length > 0 && results.every(passed) ? 0 : 1);

// default Lambda invoker for the resolved SDK config (SDK loaded only when needed).
const defaultInvoker = (aws, name) => {
    let client = null;
    return async event => {
        const { createClient, invokeLambda } = await import('./invoke.mjs');
        client = client || createClient(aws);
        return invokeLambda(client, { name, event });
    };
};

// default log fetch (paged `FilterLogEvents`, SDK loaded only when needed).
const defaultFetch = aws => {
    let client = null;
    return async params => {
        const { createLogsClient, fetchAll } = await import('./logs.mjs');
        client = client || createLogsClient(aws);
        return fetchAll(client, params);
    };
};

// run the check; returns the exit code. deps: `{ invoke, fetch, identity, log, error, sleep, now, intervalMs }`.
export const run = async (argv, deps = {}) => {
    const log = deps.log || (s => console.log(s));
    const error = deps.error || (s => console.error(s));
    const out = outputFilter();
    try {
        const opts = parseOptions(argv);
        if (opts.help) {
            log(HELP.join('\n'));
            return 0;
        }
        // express: the local server (no AWS, no STS banner, no log poll).
        if (opts.target === 'express') {
            //* v5 B19: the default port is read under the service root (`--cwd`, else the process cwd).
            const root = serviceRoot(opts.cwd);
            const base = `http://127.0.0.1:${opts.port === undefined ? defaultPort(root) : Number(opts.port)}`;
            if (!opts.json) log(`loop-check target=express url=${base}`);
            const fetchFn = deps.fetch || globalThis.fetch;
            const results = [];
            for (const kind of opts.kinds) {
                const r = await checkExpressKind(kind, { base, fetchFn });
                results.push(r);
                if (!opts.json) {
                    log(resultLine(r));
                    r.issues.forEach(s => log(`  - ${out.text(s)}`));
                }
            }
            if (opts.json) {
                const safe = results.map(r => ({ ...r, issues: r.issues.map(s => out.text(s)) }));
                log(JSON.stringify({ target: 'express', url: base, results: safe }));
            }
            return exitCode(results);
        }

        // stage guard before anything else touches the target.
        const stage = checkStage({ stage: opts.stage, confirm: opts['confirm-stage'] });
        const aws = resolveAws(opts);
        const names = {
            //* v5 B19: `cwd` carries the service root to `serverless.yml`.
            lambda: functionName({ stage, fn: 'lambda', cwd: opts.cwd }),
            backend: functionName({ stage, fn: 'backend', cwd: opts.cwd }),
        };
        const head = `loop-check stage=${stage} lambda=${names.lambda} backend=${names.backend}`;

        // --dry: the targets and each event (identity header masked), never call AWS.
        if (opts.dry) {
            log(`${head} kinds=${opts.kinds.join(',')} timeout=${opts.timeoutMs}ms region=${aws.region} (dry)`);
            for (const kind of opts.kinds) {
                const g = logGroups(kind, names);
                log(`--- kind=${kind}: invoke ${names.lambda}, send in ${g.send}, recv in ${g.recv} ---`);
                log(JSON.stringify(maskHeaders(triggerEvent(kind, stage)), null, 2));
            }
            return 0;
        }

        // identity banner first; an STS failure stops before Lambda or Logs is called.
        error(await (deps.identity || resolveIdentity)(aws, opts, names.lambda));
        if (!opts.json) log(head);
        const ctx = {
            stage,
            names,
            timeoutMs: opts.timeoutMs,
            invoke: deps.invoke || defaultInvoker(aws, names.lambda),
            fetch: deps.fetch || defaultFetch(aws),
            sleep: deps.sleep,
            now: deps.now,
            intervalMs: deps.intervalMs ?? DEFAULT_INTERVAL_MS,
        };
        // the kinds one after another (one invoke each).
        const results = [];
        for (const kind of opts.kinds) {
            const r = await checkKind(kind, ctx);
            results.push(r);
            if (!opts.json) {
                log(resultLine(r));
                r.issues.forEach(s => log(`  - ${out.text(s)}`));
            }
        }
        // --json: one object; the issue texts are redacted (other values are validated above).
        if (opts.json) {
            const safe = results.map(r => ({ ...r, issues: r.issues.map(s => out.text(s)) }));
            log(JSON.stringify({ stage, functions: names, results: safe }));
        }
        return exitCode(results);
    } catch (e) {
        // harness errors keep their exit code; anything else (SDK) is redacted and exits 1.
        if (e instanceof HarnessError) {
            error(`ERROR: ${e.message}`);
            return e.code;
        }
        error(`ERROR: ${out.log(`${e?.name || 'Error'}: ${e?.message ?? e}`)}`);
        return 1;
    }
};
