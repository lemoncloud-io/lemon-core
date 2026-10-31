/**
 * `bin/lib/invoke.mjs` (lemon-core)
 * - one synchronous (or async) `lambda:Invoke` call, shared by `lemon-lambda-invoke`, `lemon-lambda-perf`,
 *   `lemon-fields-admin` and `lemon-loop-check`.
 * - no printing and no `process.exit`; SDK errors are thrown as they are.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/invoke.mjs` (snapshot d57dc5b); the SDK peer is guarded.
import { tryPeer, needPeer } from './common.mjs';

// the optional peer package of this module.
const PEER = '@aws-sdk/client-lambda';

// `@aws-sdk/client-lambda`, or null when the consumer has not installed it.
//* v5 B19: was a static import; a missing peer fails only when a call is made (with the install hint).
const SDK = await tryPeer(PEER);

// Lambda client for the resolved SDK config (`resolveAws()`).
export const createClient = aws => new (needPeer(SDK, PEER).LambdaClient)(aws);

// the request id from a decoded log tail (`END RequestId: <id>`, else `REPORT RequestId: <id>`), or null.
export const requestIdOf = logText => {
    const text = `${logText ?? ''}`;
    const m = text.match(/\bEND RequestId:\s*([\w-]+)/) || text.match(/\bREPORT RequestId:\s*([\w-]+)/);
    return m ? m[1] : null;
};

// invoke `name` with `event`; returns `{ statusCode, functionError, text, logResult, requestId, took }`.
export const invokeLambda = async (client, { name, event, async = false, tail = false }) => {
    const { InvokeCommand } = needPeer(SDK, PEER);
    const cmd = new InvokeCommand({
        FunctionName: name,
        InvocationType: async ? 'Event' : 'RequestResponse',
        LogType: tail && !async ? 'Tail' : 'None',
        Payload: Buffer.from(JSON.stringify(event)),
    });
    const t0 = Date.now();
    const resp = await client.send(cmd);
    const took = Date.now() - t0;
    // payload bytes as text ('' when none, e.g. async).
    const text = resp.Payload ? new TextDecoder().decode(resp.Payload) : '';
    // request id: the `x-amzn-RequestId` of the call (= the function's awsRequestId), else from the log tail.
    const tailText = resp.LogResult ? Buffer.from(resp.LogResult, 'base64').toString('utf8') : '';
    const requestId = resp.$metadata?.requestId || requestIdOf(tailText) || null;
    return {
        statusCode: resp.StatusCode,
        functionError: resp.FunctionError,
        text,
        logResult: resp.LogResult,
        requestId,
        took,
    };
};
