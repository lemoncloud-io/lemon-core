#!/usr/bin/env node
/**
 * `bin/lemon-lambda-logs.mjs` (lemon-core)
 * - print (and optionally follow) CloudWatch logs of the deployed Lambda by polling `FilterLogEvents`.
 * - usage: `lemon-lambda-logs --stage dev --profile <name> --follow --perf` (or `npm run lambda:logs -- …`)
 * - run in the service root (or pass `--cwd <dir>`): `serverless.yml` there gives `<service>`.
 */
//* v5 B19: moved from lemon-templates-api `bin/lambda-logs.mjs` (snapshot d57dc5b); root = cwd.
import {
    parseArgs,
    resolveAws,
    functionName,
    parseSince,
    printHelp,
    fail,
    checkStage,
    tryServiceName,
    serviceRoot,
    groupFunctionName,
    stripControl,
    parseMaxBytes,
    outputFilter,
    resolveIdentity,
    HarnessError,
    DEFAULT_REGION,
} from './lib/common.mjs';
import { createLogsClient, fetchAll } from './lib/logs.mjs';

// help text for `--help`.
const HELP = [
    'Print CloudWatch logs of the deployed Lambda (polling FilterLogEvents).',
    '',
    'usage: lemon-lambda-logs [options]',
    '       npm run lambda:logs -- [options]',
    '',
    'target:',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    '  --function, --fn <fn>   lambda | backend (default: lambda)',
    '  --name <name>           full function name (overrides <service>-<stage>-<fn>)',
    '  --group <log-group>     log group (default: /aws/lambda/<name>)',
    '  --cwd <dir>             service root with serverless.yml (default: the current directory)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain; AWS_PROFILE also works)',
    '',
    'filter:',
    '  --since <t>             30s | 5m | 2h | 1d | ISO date (default: 5m)',
    '  --filter <pattern>      CloudWatch filter pattern (server side)',
    '  --grep <regex>          case-insensitive regex on the message (client side)',
    "  --perf                  shortcut for --grep 'PERF:'",
    '',
    'output:',
    '  --follow, -f            keep polling until Ctrl-C',
    '  --interval <sec>        poll interval with --follow (default: 2)',
    '  --json                  one JSON object per line: { ts, stream, message }',
    '  --raw                   do not redact messages (control stripping and the size cap stay)',
    '  --max-bytes <n>         cap for one message (default: 65536; 0 = no cap)',
    '  --help                  show this help',
    '',
    'exit codes: 0 = ok, 1 = AWS error, 2 = bad arguments or log group not found.',
];

// flags that never take a value.
const BOOLEANS = ['follow', 'perf', 'json', 'raw', 'help'];

// every accepted option (aliases resolve to these).
const KNOWN = [
    'stage',
    'confirm-stage',
    'cwd',
    'function',
    'name',
    'group',
    'region',
    'profile',
    'since',
    'filter',
    'grep',
    'interval',
    'max-bytes',
    ...BOOLEANS,
];

// output filter for this run (redacting by default until the options are parsed).
let out = outputFilter();

// re-scan window in follow mode, so late-ingested events from other streams are not missed.
const LAG_MS = 10 * 1000;

// pad a number with leading zeros.
const pad = (n, w = 2) => `${n}`.padStart(w, '0');

// format epoch ms as local `YYYY-MM-DD HH:mm:ss.SSS`.
const fmtTime = ms => {
    const d = new Date(ms);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

// wait for the given milliseconds.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// entry point.
const main = async () => {
    const opts = parseArgs(process.argv.slice(2), {
        booleans: BOOLEANS,
        aliases: { f: 'follow', fn: 'function' },
        known: KNOWN,
        maxPositional: 0,
    });
    if (opts.help) return printHelp(HELP);
    //* v5 B19: the service root (`--cwd`, else the process cwd) instead of the tool's own repo.
    const root = serviceRoot(opts.cwd);
    out = outputFilter({ raw: !!opts.raw, maxBytes: parseMaxBytes(opts['max-bytes']) });
    // stage guard: --group and --name are checked by the function name they point at.
    const hasGroup = typeof opts.group === 'string' && opts.group;
    const hasName = typeof opts.name === 'string' && opts.name;
    const target = hasGroup ? groupFunctionName(opts.group) ?? opts.group : hasName ? opts.name : undefined;
    checkStage({
        stage: opts.stage,
        confirm: opts['confirm-stage'],
        name: target,
        service: target !== undefined ? tryServiceName(root) : null,
        label: hasGroup ? '--group' : '--name',
    });
    const aws = resolveAws(opts);
    const group = hasGroup ? opts.group : `/aws/lambda/${functionName(opts)}`;
    const since = parseSince(opts.since);
    const follow = !!opts.follow;
    const interval = Math.max(1, Number(opts.interval) || 2) * 1000;
    // client-side regex (--perf wins over --grep).
    const pattern = opts.perf ? 'PERF:' : typeof opts.grep === 'string' ? opts.grep : null;
    let grep = null;
    try {
        grep = pattern ? new RegExp(pattern, 'i') : null;
    } catch (e) {
        fail(`invalid --grep regex: ${e.message}`, 2);
    }
    const filterPattern = typeof opts.filter === 'string' && opts.filter ? opts.filter : undefined;

    // identity banner first; an STS failure stops before Logs is called.
    console.error(await resolveIdentity(aws, opts, groupFunctionName(group) ?? group));
    console.error(`logs ${group} since=${new Date(since).toISOString()} follow=${follow}`);
    process.on('SIGINT', () => process.exit(0));

    const client = createLogsClient(aws);
    const seen = new Map(); // eventId -> timestamp, for dedupe across polls.
    let startTime = since;
    let maxTs = since;

    // poll once (or forever with --follow).
    for (;;) {
        const events = await fetchAll(client, { logGroupName: group, startTime, filterPattern }).catch(e => {
            // a missing log group is a clear, named error (exit 2).
            if (e?.name === 'ResourceNotFoundException') {
                fail(`log group not found: ${group} (not deployed yet, or wrong --stage/--region/--profile?)`, 2);
            }
            throw e;
        });
        for (const ev of events) {
            // skip events already printed in an earlier poll.
            if (seen.has(ev.eventId)) continue;
            seen.set(ev.eventId, ev.timestamp);
            maxTs = Math.max(maxTs, ev.timestamp);
            const message = `${ev.message || ''}`.replace(/[\r\n]+$/, '');
            if (grep && !grep.test(message)) continue;
            const stream = `${ev.logStreamName || ''}`;
            // control-stripped, redacted (unless --raw) and capped message.
            if (opts.json) {
                const row = out.json({
                    ts: new Date(ev.timestamp).toISOString(),
                    stream,
                    message: stripControl(message),
                });
                console.log(JSON.stringify(row));
            } else console.log(`${fmtTime(ev.timestamp)}  ${stripControl(stream.slice(-8))}  ${out.log(message)}`);
        }
        if (!follow) break;
        // advance the window (keep a short re-scan lag) and drop dedupe ids older than it.
        startTime = Math.max(since, maxTs - LAG_MS);
        for (const [id, ts] of seen) if (ts < startTime) seen.delete(id);
        await sleep(interval);
    }
};

// run; harness errors keep their exit code, other SDK errors are redacted and exit 1 (no stack trace).
main().catch(e => {
    if (e instanceof HarnessError) return fail(e.message, e.code);
    fail(out.log(`${e.name || 'Error'}: ${e.message}`), 1);
});
