/**
 * `bin/lib/logs.mjs` (lemon-core)
 * - CloudWatch Logs helpers: paged `FilterLogEvents` (shared by `lemon-lambda-logs` and `lemon-loop-check`) and the
 *   full log of one Lambda request by its request id (used by `lemon-lambda-perf --logs`).
 * - the request-log functions take an injected `fetch(params) → events[]`, so they test without AWS.
 * - no printing and no `process.exit`; SDK errors are thrown as they are.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/logs.mjs` (snapshot d57dc5b); the SDK peer is guarded.
import { tryPeer, needPeer } from './common.mjs';

// the optional peer package of this module.
const PEER = '@aws-sdk/client-cloudwatch-logs';

// `@aws-sdk/client-cloudwatch-logs`, or null when the consumer has not installed it.
//* v5 B19: was a static import; a missing peer fails only when a call is made (with the install hint).
const SDK = await tryPeer(PEER);

// default wait for the `REPORT` line of one request (ms) and the poll interval.
export const DEFAULT_WAIT_MS = 20000;
export const DEFAULT_INTERVAL_MS = 1000;

// server-side filter for the INIT-phase lines of a cold start (they carry no request id).
//* two terms, not one phrase: in the INIT phase the lines carry ANSI color codes between `PERF:` and `>` (dev measured).
export const INIT_FILTER = '"PERF:" "loaded"';

// CloudWatch Logs client for the resolved SDK config (`resolveAws()`).
export const createLogsClient = aws => new (needPeer(SDK, PEER).CloudWatchLogsClient)(aws);

// wait for the given milliseconds.
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// fetch all pages from startTime; returns events sorted by timestamp.
export const fetchAll = async (client, params) => {
    const { FilterLogEventsCommand } = needPeer(SDK, PEER);
    const events = [];
    let nextToken;
    // follow nextToken until the last page.
    do {
        const resp = await client.send(new FilterLogEventsCommand({ ...params, nextToken }));
        events.push(...(resp.events || []));
        nextToken = resp.nextToken;
    } while (nextToken);
    return events.sort((a, b) => a.timestamp - b.timestamp);
};

// escape a literal for use inside a RegExp.
const escapeRe = s => `${s}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// true when `message` is the `<kind> RequestId: <id>` line of this request.
const isLineOf = (kind, message, requestId) =>
    new RegExp(`(^|\\s)${kind} RequestId:\\s*${escapeRe(requestId)}(\\s|$)`).test(`${message ?? ''}`);

// events sorted by timestamp (stable), without mutating the input.
const byTime = events => [...(events || [])].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

// event messages joined by `\n` (trailing newlines of each message dropped).
export const joinMessages = events => events.map(ev => `${ev.message ?? ''}`.replace(/[\r\n]+$/, '')).join('\n');

// poll the log group for one request until its `REPORT` line arrives (or `timeoutMs` passes).
// → `{ text, events, complete, took }`; `complete` is true when the `REPORT` line was seen.
export const fetchRequestLog = async (
    fetch,
    {
        group,
        requestId,
        startTime,
        timeoutMs = DEFAULT_WAIT_MS,
        intervalMs = DEFAULT_INTERVAL_MS,
        sleep = defaultSleep,
        now = Date.now,
    } = {},
) => {
    const t0 = now();
    // no request id: nothing to filter on.
    if (!requestId) return { text: '', events: [], complete: false, took: 0 };
    const params = { logGroupName: group, filterPattern: `"${requestId}"`, startTime };
    let events = [];
    // each poll re-reads the whole window, so the last answer is the full set so far.
    for (;;) {
        events = byTime(await fetch(params));
        const complete = events.some(ev => isLineOf('REPORT', ev.message, requestId));
        if (complete || now() - t0 + intervalMs > timeoutMs) {
            return { text: joinMessages(events), events, complete, took: now() - t0 };
        }
        await sleep(intervalMs);
    }
};

// the INIT window of a cold request: its log stream and the `START` timestamp, or null when not cold / not found.
export const initWindow = (events, requestId) => {
    const report = events.find(ev => isLineOf('REPORT', ev.message, requestId));
    // only a cold start has an INIT phase (`Init Duration` in REPORT).
    if (!report || !/Init Duration:/.test(`${report.message}`)) return null;
    const start = events.find(ev => isLineOf('START', ev.message, requestId));
    const stream = start?.logStreamName || report.logStreamName;
    if (!start || !stream) return null;
    return { logStreamName: stream, endTime: start.timestamp };
};

// the INIT-phase `PERF: > loaded …` lines of one log stream, up to the `START` line → `{ text, events }`.
export const fetchInitLog = async (fetch, { group, logStreamName, startTime, endTime } = {}) => {
    const params = {
        logGroupName: group,
        logStreamNames: [logStreamName],
        filterPattern: INIT_FILTER,
        startTime,
        endTime,
    };
    const events = byTime(await fetch(params));
    return { text: joinMessages(events), events };
};

// the full log of one request: request lines, plus the INIT lines in front when it was a cold start.
// → `{ text, events, complete, took }` (`events` includes the INIT events).
export const fetchFullLog = async (fetch, opts = {}) => {
    const now = opts.now || Date.now;
    const t0 = now();
    const req = await fetchRequestLog(fetch, opts);
    const win = req.complete ? initWindow(req.events, opts.requestId) : null;
    // warm (or incomplete) request: the request log is all there is.
    if (!win) return { ...req, took: now() - t0 };
    const init = await fetchInitLog(fetch, { group: opts.group, startTime: opts.startTime, ...win });
    const text = init.text ? `${init.text}\n${req.text}` : req.text;
    return { text, events: [...init.events, ...req.events], complete: true, took: now() - t0 };
};
