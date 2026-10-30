#!/usr/bin/env node
/**
 * `bin/lemon-lambda-perf.mjs` (lemon-core)
 * - invoke the deployed Lambda `--runs` times with a web event and summarize cold / warm timings
 *   from the log tail (`REPORT` line + lemon-core `PERF: >` lines), or with `--logs` from the full CloudWatch log
 *   of each request (found by its request id; the tail stays as the fallback).
 * - usage: `lemon-lambda-perf --stage dev --profile <name> --path /hello/0 --runs 5` (or `npm run perf:lambda -- …`)
 * - run in the service root (or pass `--cwd <dir>`): `serverless.yml` there gives `<service>`.
 */
//* v5 B19: moved from lemon-templates-api `bin/perf-lambda.mjs` (snapshot d57dc5b); root = cwd.
import {
    parseArgs,
    resolveAws,
    functionName,
    printHelp,
    fail,
    checkStage,
    tryServiceName,
    serviceRoot,
    parseMaxBytes,
    outputFilter,
    maskHeaders,
    resolveIdentity,
    HarnessError,
    ArgError,
    DEFAULT_REGION,
} from './lib/common.mjs';
import { webEvent, eventLabel } from './lib/event.mjs';
import { createClient, invokeLambda } from './lib/invoke.mjs';
import { createLogsClient, fetchAll, fetchFullLog, DEFAULT_WAIT_MS } from './lib/logs.mjs';
import { parseTail, mergeParsed, summarize, formatRuns, formatSummary, formatLogs, exitCode } from './lib/perf.mjs';

// default path (the hello route answers without any backend).
const DEFAULT_PATH = '/hello/0';

// default and allowed range of `--runs`.
const DEFAULT_RUNS = 5;
const MAX_RUNS = 100;

// allowed range of `--interval` (ms).
const MAX_INTERVAL = 60000;

// allowed range of `--logs-wait` (ms).
const MIN_LOGS_WAIT = 1000;
const MAX_LOGS_WAIT = 120000;

// the log query starts this long before the invoke (clock skew and ingestion slack).
const LOGS_LOOKBACK_MS = 60 * 1000;

// help text for `--help`.
const HELP = [
    'Invoke the deployed Lambda several times and summarize cold / warm timings from the log tail (or the full log).',
    '',
    'usage: lemon-lambda-perf [options]',
    '       npm run perf:lambda -- [options]',
    '',
    'target:',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    '  --function, --fn <fn>   lambda | backend (default: lambda)',
    '  --name <name>           full function name (overrides <service>-<stage>-<fn>)',
    '  --cwd <dir>             service root with serverless.yml (default: the current directory)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain; AWS_PROFILE also works)',
    '',
    'event (web only):',
    `  --path <path>           HTTP path (default: ${DEFAULT_PATH}); \`?a=1\` is moved into the query`,
    '  --method <METHOD>       HTTP method (default: GET)',
    '  --query k=v             query parameter (repeatable)',
    '  --header k:v            header (repeatable)',
    '  --internal              no Host header, like a direct invoke (lemon-core treats it as internal)',
    '',
    'run:',
    `  --runs <n>              number of invokes, 1-${MAX_RUNS} (default: ${DEFAULT_RUNS})`,
    `  --interval <ms>         pause between invokes, 0-${MAX_INTERVAL} (default: 0)`,
    '  --logs                  parse the full CloudWatch log of each run (by request id) instead of the 4 KB tail;',
    '                          needs logs:FilterLogEvents, waits a few seconds per run for the log to arrive',
    `  --logs-wait <ms>        max wait per run for the REPORT line, ${MIN_LOGS_WAIT}-${MAX_LOGS_WAIT} (default: ${DEFAULT_WAIT_MS})`,
    '  --dry                   print the target, the event JSON and the runs, do not call AWS (no --logs fetch)',
    '  --json                  print { target, runs, summary } only',
    '  --raw                   do not redact the output (control stripping and the size cap stay)',
    '  --max-bytes <n>         cap for one printed text (default: 65536; 0 = no cap)',
    '  --help                  show this help',
    '',
    'exit codes: 0 = every run http 2xx and no FunctionError, 1 = otherwise, 2 = bad arguments.',
];

// flags that never take a value.
const BOOLEANS = ['internal', 'logs', 'dry', 'json', 'raw', 'help'];

// every accepted option (aliases resolve to these).
const KNOWN = [
    'stage',
    'confirm-stage',
    'cwd',
    'function',
    'name',
    'region',
    'profile',
    'path',
    'method',
    'query',
    'header',
    'runs',
    'interval',
    'logs-wait',
    'max-bytes',
    ...BOOLEANS,
];

// output filter for this run (redacting by default until the options are parsed).
let out = outputFilter();

// parse an integer option within `[min, max]` (throws `ArgError`).
const parseIntIn = (value, name, min, max, dflt) => {
    if (value === undefined) return dflt;
    const ok = typeof value === 'string' && /^\d+$/.test(value) && +value >= min && +value <= max;
    if (!ok) throw new ArgError(`--${name} needs an integer ${min}-${max} (got: ${value})`);
    return Number(value);
};

// parse a JSON text, or return undefined.
const tryJson = text => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

// web `statusCode` of the response payload as a number, or null.
const httpOf = text => {
    const payload = text ? tryJson(text) : undefined;
    const code = payload && typeof payload === 'object' ? Number(payload.statusCode) : NaN;
    return Number.isFinite(code) ? code : null;
};

// wait `ms` milliseconds.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// the full log of one run (`--logs`); a Logs error falls back to the tail → `{ text, complete, events, took, error }`.
const fetchRunLog = async (logs, requestId, startTime) => {
    const t0 = Date.now();
    try {
        const got = await fetchFullLog(logs.fetch, { group: logs.group, requestId, startTime, timeoutMs: logs.wait });
        return { text: got.text, complete: got.complete, events: got.events.length, took: got.took, error: null };
    } catch (e) {
        // only the error name is kept (the message can carry ARNs); the run itself goes on with the tail.
        return { text: '', complete: false, events: 0, took: Date.now() - t0, error: e?.name || 'Error' };
    }
};

// one invoke with the log tail (+ the full log with `--logs`) → one run record.
const runOnce = async (client, name, event, logs) => {
    const startTime = Date.now() - LOGS_LOOKBACK_MS;
    const resp = await invokeLambda(client, { name, event, tail: true });
    const tail = resp.logResult ? Buffer.from(resp.logResult, 'base64').toString('utf8') : '';
    const fromTail = parseTail(tail);
    const base = {
        status: resp.statusCode,
        http: httpOf(resp.text),
        functionError: resp.functionError || null,
        took: resp.took,
    };
    // without --logs: the tail only (same as before).
    if (!logs) return { ...base, ...fromTail };
    const got = await fetchRunLog(logs, resp.requestId, startTime);
    if (got.error) console.error(`WARN: logs fetch failed (${got.error}); using the log tail for this run`);
    // a complete log is used as is; an incomplete one is filled from the tail item by item.
    const fromLogs = parseTail(got.text);
    const parsed = got.complete ? fromLogs : mergeParsed(fromLogs, fromTail);
    const meta = {
        complete: got.complete,
        events: got.events,
        took: got.took,
        ...(got.error ? { error: got.error } : {}),
    };
    return { ...base, ...parsed, logs: meta };
};

// entry point.
const main = async () => {
    const opts = parseArgs(process.argv.slice(2), {
        booleans: BOOLEANS,
        aliases: { fn: 'function' },
        known: KNOWN,
        maxPositional: 0,
    });
    if (opts.help) return printHelp(HELP);
    //* v5 B19: the service root (`--cwd`, else the process cwd) instead of the tool's own repo.
    const root = serviceRoot(opts.cwd);
    out = outputFilter({ raw: !!opts.raw, maxBytes: parseMaxBytes(opts['max-bytes']) });
    const runs = parseIntIn(opts.runs, 'runs', 1, MAX_RUNS, DEFAULT_RUNS);
    const interval = parseIntIn(opts.interval, 'interval', 0, MAX_INTERVAL, 0);
    const logsWait = parseIntIn(opts['logs-wait'], 'logs-wait', MIN_LOGS_WAIT, MAX_LOGS_WAIT, DEFAULT_WAIT_MS);
    const useLogs = !!opts.logs;
    // stage guard before anything else touches the target.
    const hasName = typeof opts.name === 'string' && opts.name;
    checkStage({
        stage: opts.stage,
        confirm: opts['confirm-stage'],
        name: hasName ? opts.name : undefined,
        service: hasName ? tryServiceName(root) : null,
    });
    const stage = typeof opts.stage === 'string' && opts.stage ? opts.stage : 'dev';
    const aws = resolveAws(opts);
    const name = functionName(opts);
    // the web event of one run (a fresh requestId each time).
    const eventOpts = { ...opts, path: typeof opts.path === 'string' && opts.path ? opts.path : DEFAULT_PATH };
    const makeEvent = () => webEvent(eventOpts, stage);
    const first = makeEvent();
    const route = ` ${first.httpMethod} ${first.path}`;
    const label = eventLabel('web', opts);
    const head = `perf ${name} event=${label}${route} runs=${runs} logs=${useLogs}`;

    // --dry: show the target, the event (sensitive headers masked) and the runs, never call AWS (no --logs fetch).
    if (opts.dry) {
        console.log(`${head} interval=${interval}ms region=${aws.region} (dry)`);
        console.log(JSON.stringify(maskHeaders(first), null, 2));
        return;
    }

    // identity banner first; an STS failure stops before Lambda is called.
    console.error(await resolveIdentity(aws, opts, name));
    if (!opts.json) console.log(head);

    // the runs, one after another (an invoke error stops the whole run with exit 1; a Logs error falls back to the tail).
    const client = createClient(aws);
    // --logs: one Logs client and the function's log group, shared by every run.
    const logsClient = useLogs ? createLogsClient(aws) : null;
    const logs = useLogs
        ? { group: `/aws/lambda/${name}`, wait: logsWait, fetch: params => fetchAll(logsClient, params) }
        : null;
    const records = [];
    for (let i = 0; i < runs; i++) {
        if (i > 0 && interval > 0) await sleep(interval);
        records.push(await runOnce(client, name, i === 0 ? first : makeEvent(), logs));
    }
    const summary = summarize(records);

    // --json: one object; string leaves redacted and capped.
    if (opts.json) {
        const fn = hasName ? null : opts.function || 'lambda';
        const target = { name, stage, fn, path: first.path, method: first.httpMethod, runs, logs: useLogs };
        console.log(JSON.stringify(out.json({ target, runs: records, summary })));
    } else {
        console.log(out.text(formatRuns(records)));
        console.log('--- summary (ms; memUsed in MB) ---');
        console.log(out.text(formatSummary(summary)));
        // --logs: how many runs had their full log, and the median wait for it.
        if (useLogs) console.log(formatLogs(summary));
    }
    process.exitCode = exitCode(records);
};

// run; harness errors keep their exit code, SDK errors are redacted and exit 1 (no stack trace).
main().catch(e => {
    if (e instanceof HarnessError) return fail(e.message, e.code);
    fail(out.log(`${e.name || 'Error'}: ${e.message}`), 1);
});
