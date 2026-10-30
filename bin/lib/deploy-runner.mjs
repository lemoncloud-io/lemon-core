import { setTimeout as delay } from 'node:timers/promises';
import {
    DeployError,
    isObject,
    deploymentPlan,
    QUEUE_ATTRIBUTES,
    TABLE_SHAPE,
    FUNCTION_SHAPES,
    LOG_RETENTION_DAYS,
    SCHEDULE,
} from './deploy-plan.mjs';
import { createReceipt } from './deploy-receipt.mjs';
import { sha256 } from './pack-zip.mjs';
import { ORG_DEFAULTS } from './org-defaults.mjs';

//* v5 B19: the deploy-service pins (tool namespace, policy profile, abort reason) come from `org-defaults.mjs`.
const DEPLOY = ORG_DEFAULTS.deploy;

const fail = (code, message, unknown = false) => {
    throw new DeployError(code, message, { unknown });
};
const identifier = (v, what, re = /^[A-Za-z0-9_.:/-]{1,256}$/) => {
    if (typeof v !== 'string' || !re.test(v))
        fail('RESPONSE_INVALID', `Invalid ${what} in tool response; inspect server deployment state.`, true);
    return v;
};
function envelope(response, tool, polling = false) {
    const r = response?.result;
    if (
        !isObject(r) ||
        r.tool !== tool.split('@')[0] ||
        String(r.version) !== '1' ||
        typeof r.verified !== 'boolean' ||
        ![200, 202].includes(response.http)
    )
        fail('RESPONSE_UNKNOWN', 'Tool returned an unrecognized response; mutation outcome is unknown.', true);
    if (r.status === 'failed' && response.http === 200 && r.verified === false)
        fail(
            polling ? 'POLL_UNKNOWN' : 'TOOL_FAILED',
            polling
                ? 'Status lookup failed; asynchronous operation may still be running.'
                : 'Tool failed or verification failed; see the server deployment record.',
            polling,
        );
    if (r.status === 'succeeded' && response.http === 200 && r.verified === true && isObject(r.output)) return r;
    if (r.status === 'accepted' && response.http === 202 && r.verified === false && isObject(r.output)) return r;
    fail('RESPONSE_UNKNOWN', 'Tool returned inconsistent status/verification; mutation outcome is unknown.', true);
}
function safeOutput(tool, out, c) {
    const rules = {
        functionArn: new RegExp(`^arn:aws:lambda:${c.region}:${c.account}:function:[A-Za-z0-9_-]{1,64}$`),
        functionName: /^[A-Za-z0-9_-]{1,64}$/,
        logGroupName: /^\/aws\/lambda\/[A-Za-z0-9_-]{1,64}$/,
        roleArn: new RegExp(`^arn:aws:iam::${c.account}:role/[A-Za-z0-9_+=,.@/-]+$`),
        streamArn: new RegExp(
            `^arn:aws:dynamodb:${c.region}:${c.account}:table/[A-Za-z0-9_.-]+/stream/[A-Za-z0-9_.:-]+$`,
        ),
        tableArn: new RegExp(`^arn:aws:dynamodb:${c.region}:${c.account}:table/[A-Za-z0-9_.-]+$`),
        queueArn: new RegExp(`^arn:aws:sqs:${c.region}:${c.account}:[A-Za-z0-9_-]+$`),
        queueUrl: new RegExp(`^https://sqs[.]${c.region}[.]amazonaws[.]com/${c.account}/[A-Za-z0-9_-]+$`),
        topicArn: new RegExp(`^arn:aws:sns:${c.region}:${c.account}:[A-Za-z0-9_-]+$`),
        restApiId: /^[a-z0-9]{1,32}$/,
        deployId: /^[A-Za-z0-9_-]{1,200}$/,
        uuid: /^[A-Za-z0-9_-]{1,100}$/,
        manifestVersionId: /^[A-Za-z0-9_.+=/-]{1,400}$/,
        tableName: /^[A-Za-z0-9_.-]{1,128}$/,
        short: /^[a-z0-9-]{1,128}$/,
        roleName: /^[A-Za-z0-9_-]{1,128}$/,
        queueName: /^[A-Za-z0-9_-]{1,128}$/,
        topicName: /^[A-Za-z0-9_-]{1,128}$/,
        ruleName: /^[A-Za-z0-9_-]{1,128}$/,
        restApiName: /^[A-Za-z0-9_-]{1,128}$/,
    };
    if (tool === 'aws.s3.presign-put@1') return {};
    const result = {};
    for (const [key, re] of Object.entries(rules))
        if (typeof out[key] === 'string' && re.test(out[key])) result[key] = out[key];
    if (Number.isSafeInteger(out.revision) && out.revision >= 0) result.revision = out.revision;
    return result;
}
function assertNames(value, c, standard = false) {
    if (value.project !== c.project || value.stage !== c.stage)
        fail('TARGET_MISMATCH', 'Resolved project/stage differs from config.');
    for (const k of standard
        ? ['short', 'functionName', 'roleName', 'tableName', 'queueName', 'topicName', 'ruleName', 'restApiName']
        : ['functionName'])
        identifier(value[k], k, /^[A-Za-z0-9_-]{1,128}$/);
    if (value.functionName.length > 64 || value.logGroupName !== `/aws/lambda/${value.functionName}`)
        fail('TARGET_MISMATCH', 'Invalid resolved Lambda name/log group.');
    return value;
}
export function assertPolicy(statements, c) {
    if (!Array.isArray(statements) || !statements.length)
        fail('TARGET_MISMATCH', 'Missing execution policy statements.');
    const scoped = new Set();
    for (const statement of statements) {
        if (!isObject(statement) || statement.Effect !== 'Allow')
            fail('TARGET_MISMATCH', 'Unsupported execution policy statement.');
        const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
        for (const r of resources) {
            if (r === '*') continue;
            if (typeof r !== 'string') fail('TARGET_MISMATCH', 'Malformed execution policy resource.');
            const m = /^arn:aws:([^:]+):([^:]*):([^:]*):(.+)$/.exec(r);
            if (!m || (m[2] && m[2] !== c.region) || (m[3] && m[3] !== c.account))
                fail('TARGET_MISMATCH', 'Policy account/region differs from config; no round opened.');
            if (m[2] === c.region && m[3] === c.account) scoped.add(m[1]);
        }
    }
    if (!scoped.has('logs') || !scoped.has('sns'))
        fail('TARGET_MISMATCH', 'Policy lacks account/region evidence from own logs and SNS resources.');
}
function assertFunction(found, name, deployment) {
    const c = deployment.config;
    if (!found) {
        if (c.mode === 'code') fail('FUNCTION_MISSING', 'Code mode requires both existing managed functions.');
        return;
    }
    if (
        found.functionArn !== `arn:aws:lambda:${c.region}:${c.account}:function:${name}` ||
        found.functionName !== name ||
        found.runtime !== 'nodejs24.x' ||
        found.architectures?.length !== 1 ||
        found.architectures[0] !== 'x86_64' ||
        found.handler !== deployment.artifact.handler ||
        found.tags?.['deploy-managed'] !== 'true' ||
        found.state !== 'Active' ||
        found.lastUpdateStatus !== 'Successful'
    )
        fail(
            'FUNCTION_MISMATCH',
            'Existing function must be managed, Active/Successful, Node 24, x86_64 with the packaged handler in the configured account/region.',
        );
    if (
        typeof found.role !== 'string' ||
        !new RegExp(`^arn:aws:iam::${c.account}:role/[A-Za-z0-9_+=,.@/-]+$`).test(found.role)
    )
        fail('FUNCTION_MISMATCH', 'Existing function has an invalid execution role.');
}
function uploadSpec(output, c, a) {
    const key = `${c.keyPrefix}/${a.sha256}.zip`;
    if (
        output.bucket !== c.artifactBucket ||
        output.key !== key ||
        output.sha256 !== a.sha256 ||
        output.method !== 'PUT' ||
        typeof output.stored !== 'boolean'
    )
        fail('UPLOAD_RESPONSE_INVALID', 'Upload identity does not match the validated ZIP.', true);
    if (output.stored) return;
    let url;
    try {
        url = new URL(output.uploadUrl);
    } catch {
        fail('UPLOAD_RESPONSE_INVALID', 'Invalid upload URL.', true);
    }
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        url.hostname !== `${c.artifactBucket}.s3.${c.region}.amazonaws.com` ||
        url.pathname !== `/${key.split('/').map(encodeURIComponent).join('/')}`
    )
        fail('UPLOAD_RESPONSE_INVALID', 'Upload URL is outside the exact artifact location.', true);
    const h = output.headers;
    if (
        !isObject(h) ||
        Object.entries(h).some(
            ([k, v]) =>
                !/^[A-Za-z0-9-]+$/.test(k) ||
                typeof v !== 'string' ||
                /[\r\n]/.test(v) ||
                ['authorization', 'proxy-authorization', 'host', 'cookie', 'connection', 'transfer-encoding'].includes(
                    k.toLowerCase(),
                ),
        )
    )
        fail('UPLOAD_RESPONSE_INVALID', 'Invalid required upload headers.', true);
    const normalized = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    if (
        Object.keys(normalized).length !== Object.keys(h).length ||
        normalized['content-type'] !== 'application/zip' ||
        normalized['content-length'] !== String(a.bytes.length) ||
        normalized['if-none-match'] !== '*' ||
        normalized['x-amz-checksum-sha256'] !== Buffer.from(a.sha256, 'hex').toString('base64')
    )
        fail('UPLOAD_RESPONSE_INVALID', 'Upload headers do not bind the exact ZIP/checksum.', true);
}

/** Clients are injected for tests; only the CLI's explicit --apply builds live clients. */
export async function runDeployment(
    deployment,
    {
        client,
        receiptDirectory = '.artifacts/deploy',
        signal,
        now = Date.now,
        sleep = ms => delay(ms),
        receiptFactory = createReceipt,
    } = {},
) {
    const c = deployment.config,
        a = deployment.artifact;
    const receipt = await receiptFactory(receiptDirectory, deploymentPlan(deployment));
    const state = receipt.state;
    const started = now();
    let deadline = started + 20 * 60 * 1000;
    let deployId;
    let closing = false;
    const check = () => {
        if (signal?.aborted) fail('INTERRUPTED', 'Deployment interrupted; inspect the receipt before recovery.', true);
        if (now() >= deadline)
            fail('DEADLINE_UNKNOWN', 'Deployment deadline reached; inspect the receipt before recovery.', true);
    };
    const bounded = async operation => {
        check();
        const controller = new AbortController();
        const ms = Math.min(c.requestTimeoutMs, deadline - now());
        let timer;
        const signalAbort = () => controller.abort();
        signal?.addEventListener('abort', signalAbort, { once: true });
        try {
            return await Promise.race([
                operation(controller.signal),
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        reject(
                            new DeployError('REQUEST_UNKNOWN', 'Request deadline reached; outcome is unknown.', {
                                unknown: true,
                            }),
                        );
                    }, ms);
                }),
                ...(signal
                    ? [
                          new Promise((_, reject) =>
                              controller.signal.addEventListener(
                                  'abort',
                                  () =>
                                      reject(
                                          new DeployError('INTERRUPTED', 'Request interrupted; outcome is unknown.', {
                                              unknown: true,
                                          }),
                                      ),
                                  { once: true },
                              ),
                          ),
                      ]
                    : []),
            ]);
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', signalAbort);
        }
    };
    const record = async (name, tool, method, operation) => {
        check();
        const step = {
            index: state.steps.length + 1,
            name,
            tool,
            method,
            status: 'in-flight',
            startedAt: new Date(now()).toISOString(),
        };
        if (deployId) step.deployId = deployId;
        state.status = 'running';
        state.steps.push(step);
        await receipt.save();
        const t0 = now();
        try {
            const result = await bounded(operation);
            step.durationMs = Math.max(0, now() - t0);
            step.status = 'received';
            return { result, step };
        } catch (error) {
            step.durationMs = Math.max(0, now() - t0);
            step.status = error instanceof DeployError && !error.unknown ? 'failed' : 'unknown';
            step.errorCode = error instanceof DeployError ? error.code : 'UNEXPECTED_UNKNOWN';
            await receipt.save();
            throw error;
        }
    };
    const call = async (name, tool, input, { method = 'POST', resource } = {}) => {
        let polled = 0;
        for (;;) {
            const got = await record(name, tool, method, s =>
                client.request({
                    tool,
                    method,
                    input: method === 'POST' ? input : undefined,
                    deployId,
                    resource,
                    signal: s,
                }),
            );
            let r;
            try {
                r = envelope(got.result, tool, method === 'GET');
            } catch (error) {
                got.step.status = error.unknown ? 'unknown' : 'failed';
                got.step.errorCode = error.code;
                await receipt.save();
                throw error;
            }
            got.step.status = r.status;
            got.step.verified = r.verified;
            got.step.output = safeOutput(tool, r.output, c);
            if (r.status === 'succeeded') {
                if (tool === `${DEPLOY.toolNamespace}.begin@1`) {
                    deployId = identifier(r.output.deployId, 'deployId', /^[A-Za-z0-9_-]{1,200}$/);
                    state.deployId = deployId;
                    got.step.deployId = deployId;
                }
                await receipt.save();
                return r.output;
            }
            resource = identifier(r.output.uuid ?? r.output.resource, 'poll resource');
            got.step.resource = resource;
            await receipt.save();
            if (++polled > c.maxPolls)
                fail('POLL_LIMIT_UNKNOWN', 'Asynchronous operation did not settle within the poll budget.', true);
            await sleep(c.pollIntervalMs);
            check();
            method = 'GET';
        }
    };
    const checkOwnArn = (arn, service, resourcePrefix = '') => {
        identifier(arn, `${service} ARN`);
        if (
            service === 'dynamodb'
                ? !arn.startsWith(`arn:aws:${service}:${c.region}:${c.account}:${resourcePrefix}`)
                : arn !== `arn:aws:${service}:${c.region}:${c.account}:${resourcePrefix}`
        )
            fail('TARGET_MISMATCH', 'Resource ARN differs from configured account/region.', true);
        return arn;
    };
    try {
        if (sha256(a.bytes) !== a.sha256) fail('ARTIFACT_CHANGED', 'In-memory ZIP no longer matches validated SHA.');
        const base = { project: c.project, stage: c.stage };
        const names = assertNames(await call('names', `${DEPLOY.toolNamespace}.resolve-names@1`, base), c, true);
        const fn = assertNames(
            await call('lambda-name', `${DEPLOY.toolNamespace}.resolve-names@1`, { ...base, convention: 'sls' }),
            c,
        );
        const backend = assertNames(
            await call('backend-name', `${DEPLOY.toolNamespace}.resolve-names@1`, {
                ...base,
                convention: 'sls',
                component: 'backend',
            }),
            c,
        );
        if (fn.functionName === backend.functionName)
            fail('TARGET_MISMATCH', 'Backend and API must resolve to different functions.');
        const policy = await call('policy', `${DEPLOY.toolNamespace}.resolve-policy@1`, {
            ...base,
            profile: DEPLOY.policyProfile,
            ...c.policy,
        });
        assertPolicy(policy.statements, c);
        const existing = [];
        for (const f of [fn, backend]) {
            const got = await record('function-preflight', 'lambda:GetFunctionConfiguration/ListTags', 'READ', s =>
                client.readFunction(f.functionName, { signal: s }),
            );
            assertFunction(got.result, f.functionName, deployment);
            existing.push(got.result);
            got.step.status = 'succeeded';
            got.step.exists = Boolean(got.result);
            await receipt.save();
        }
        const begun = await call('begin', `${DEPLOY.toolNamespace}.begin@1`, {
            ...base,
            artifact: { sha256: a.sha256, bytes: a.bytes.length },
            ttlSeconds: 1800,
        });
        deployId = identifier(begun.deployId, 'deployId', /^[A-Za-z0-9_-]{1,200}$/);
        state.deployId = deployId;
        if (!Number.isFinite(Date.parse(begun.expiresAt)) || Date.parse(begun.expiresAt) <= now() + 60000)
            fail('LEASE_UNKNOWN', 'Server returned an unusable lease deadline.', true);
        deadline = Math.min(deadline, Date.parse(begun.expiresAt) - 60000);
        state.leaseExpiresAt = new Date(Date.parse(begun.expiresAt)).toISOString();
        await receipt.save();
        if (begun.takeover !== false)
            fail('TAKEOVER_UNKNOWN', 'An unfinished previous round needs reconciliation before deployment.', true);
        const key = `${c.keyPrefix}/${a.sha256}.zip`;
        const presignInput = {
            bucket: c.artifactBucket,
            key,
            sha256: a.sha256,
            contentLength: a.bytes.length,
            contentType: 'application/zip',
        };
        let upload = await call('presign', 'aws.s3.presign-put@1', presignInput);
        uploadSpec(upload, c, a);
        if (!upload.stored) {
            const put = await record('upload', 's3:PutObject', 'PUT', s =>
                client.put({ url: upload.uploadUrl, headers: upload.headers, bytes: a.bytes, signal: s }),
            );
            put.step.httpStatus = put.result;
            if (put.result === 412) {
                put.step.status = 'conflict';
                await receipt.save();
                upload = await call('presign-recheck', 'aws.s3.presign-put@1', presignInput);
                uploadSpec(upload, c, a);
                if (!upload.stored)
                    fail(
                        'UPLOAD_UNKNOWN',
                        'Conditional upload conflict was not verified as the same stored ZIP.',
                        true,
                    );
            } else if (![200, 201, 204].includes(put.result)) {
                put.step.status = 'unknown';
                await receipt.save();
                fail('UPLOAD_UNKNOWN', 'Upload did not confirm storage; inspect the receipt.', true);
            } else {
                put.step.status = 'succeeded';
                await receipt.save();
            }
        }
        const code = { s3: { bucket: c.artifactBucket, key, sha256: a.sha256 } };
        const verifyPayload = {
            resource: '/',
            path: '/',
            httpMethod: 'GET',
            headers: {},
            pathParameters: null,
            queryStringParameters: null,
            requestContext: {
                stage: c.stage,
                domainName: 'localhost',
                requestId: 'deploy-verify',
                accountId: c.account,
                identity: { sourceIp: '127.0.0.1', userAgent: 'deploy-verify' },
            },
            body: null,
            isBase64Encoded: false,
        };
        const verify = { verifyPayload, ...(c.expect === undefined ? {} : { expect: c.expect }) };
        const functions = [];
        if (c.mode === 'code') {
            for (const [i, f] of [fn, backend].entries()) {
                const out = await call(i ? 'backend-code' : 'lambda-code', 'aws.lambda.ensure-function@1', {
                    project: c.project,
                    ...(i ? { component: 'backend' } : {}),
                    functionName: f.functionName,
                    code,
                    role: existing[i].role,
                    ...verify,
                });
                checkOwnArn(out.functionArn, 'lambda', `function:${f.functionName}`);
                functions.push(out);
            }
        } else {
            const role = await call('role', `${DEPLOY.toolNamespace}.ensure-role@1`, {
                ...base,
                statements: policy.statements,
            });
            if (role.roleArn !== `arn:aws:iam::${c.account}:role/${names.roleName}`)
                fail('TARGET_MISMATCH', 'Role ARN differs from resolved role/account.', true);
            const tags = { 'deploy-project': names.short };
            const table = await call('table', 'aws.dynamodb.ensure-table@1', {
                project: c.project,
                tableName: names.tableName,
                ...TABLE_SHAPE,
                deletionProtection: c.deletionProtection,
                tags,
            });
            if (table.tableName !== names.tableName)
                fail('TARGET_MISMATCH', 'Table name differs from resolved name.', true);
            checkOwnArn(table.streamArn, 'dynamodb', `table/${names.tableName}/stream/`);
            const queue = await call('queue', 'aws.sqs.ensure-queue@1', {
                project: c.project,
                queueName: names.queueName,
                attributes: QUEUE_ATTRIBUTES,
                tags,
            });
            checkOwnArn(queue.queueArn, 'sqs', names.queueName);
            if (queue.queueUrl !== `https://sqs.${c.region}.amazonaws.com/${c.account}/${names.queueName}`)
                fail('TARGET_MISMATCH', 'Queue URL differs from resolved target.', true);
            const topic = await call('topic', 'aws.sns.ensure-topic@1', { project: c.project, name: names.topicName });
            checkOwnArn(topic.topicArn, 'sns', names.topicName);
            for (const [i, f] of [fn, backend].entries())
                await call(i ? 'backend-log' : 'lambda-log', 'aws.logs.ensure-log-group@1', {
                    project: c.project,
                    ...(i ? { component: 'backend' } : {}),
                    logGroupName: f.logGroupName,
                    retentionInDays: LOG_RETENTION_DAYS,
                });
            const environment = {
                ...deployment.environment,
                STAGE: c.stage,
                DEFAULT_REGION: c.region,
                MY_DYNAMO_TABLE: table.tableName,
                MY_SQS_ENDPOINT: queue.queueUrl,
                MY_SNS_ENDPOINT: topic.topicArn,
            };
            for (const [i, f] of [fn, backend].entries()) {
                const out = await call(i ? 'backend-function' : 'lambda-function', 'aws.lambda.ensure-function@1', {
                    project: c.project,
                    ...(i ? { component: 'backend' } : {}),
                    functionName: f.functionName,
                    code,
                    role: role.roleArn,
                    handler: a.handler,
                    runtime: 'nodejs24.x',
                    ...FUNCTION_SHAPES[i],
                    environment,
                    environmentMode: 'merge',
                    ...verify,
                });
                checkOwnArn(out.functionArn, 'lambda', `function:${f.functionName}`);
                functions.push(out);
            }
            const [lambdaOut, backendOut] = functions;
            await call('sns-subscription', 'aws.sns.subscribe@1', {
                topicArn: topic.topicArn,
                functionArn: backendOut.functionArn,
            });
            await call('stream-mapping', 'aws.lambda.ensure-event-source-mapping@1', {
                functionArn: backendOut.functionArn,
                eventSourceArn: table.streamArn,
                batchSize: 1,
                startingPosition: 'LATEST',
                enabled: true,
                tags,
            });
            await call('queue-mapping', 'aws.lambda.ensure-event-source-mapping@1', {
                functionArn: backendOut.functionArn,
                eventSourceArn: queue.queueArn,
                batchSize: 1,
                enabled: true,
                tags,
            });
            await call('schedule', 'aws.events.ensure-schedule@1', {
                project: c.project,
                ruleName: names.ruleName,
                ...SCHEDULE,
                functionArn: lambdaOut.functionArn,
                input: JSON.stringify({ cron: { name: '1MIN', stage: c.stage } }),
                tags: { ...tags, 'deploy-managed': 'true', 'deploy-tool': 'aws.events.ensure-schedule@1' },
            });
            const api = await call('rest-api', 'aws.apigateway.ensure-rest-api@1', {
                project: c.project,
                name: names.restApiName,
                endpointType: 'REGIONAL',
                tags,
            });
            identifier(api.restApiId, 'REST API id', /^[a-z0-9]{1,32}$/);
            for (const [i, route] of c.routes.entries()) {
                if (i) {
                    await sleep(c.routeDelayMs);
                    check();
                }
                await call(`route-${i + 1}`, 'aws.apigateway.ensure-route@1', {
                    restApiId: api.restApiId,
                    ...route,
                    functionArn: lambdaOut.functionArn,
                });
            }
            const expectPaths = ['/'];
            if (
                c.routes.some(r => r.path === '/hello/{id}' && r.httpMethod === 'GET' && r.authorizationType === 'NONE')
            )
                expectPaths.push('/hello/0');
            await call('rest-stage', 'aws.apigateway.deploy-stage@1', {
                restApiId: api.restApiId,
                stageName: c.stage,
                probe: { method: 'GET', path: '/', expectStatus: 200 },
                expectPaths,
                tags,
            });
        }
        state.functions = functions.map(f => ({ functionArn: f.functionArn }));
        await receipt.save();
        closing = true;
        const ended = await call('end', `${DEPLOY.toolNamespace}.end@1`, { deployId });
        if (ended.deployId !== deployId || ended.status !== 'completed')
            fail('END_UNKNOWN', 'Round completion was not confirmed.', true);
        state.manifestVersionId = identifier(ended.manifestVersionId, 'manifest version', /^[A-Za-z0-9_.+=/-]{1,400}$/);
        state.status = 'completed';
        state.finishedAt = new Date(now()).toISOString();
        state.durationMs = Math.max(0, now() - started);
        await receipt.save();
        return { status: 'completed', deployId, receipt: receipt.file, durationMs: state.durationMs };
    } catch (caught) {
        let error =
            caught instanceof DeployError
                ? caught
                : new DeployError('UNEXPECTED_UNKNOWN', 'Unexpected failure; inspect the receipt before recovery.', {
                      unknown: true,
                  });
        if (closing) error.unknown = true; // A failed end may already have written the manifest/released the lease.
        state.status = error.unknown ? 'unknown' : 'failed';
        state.errorCode = error.code;
        if (deployId && !error.unknown && !closing && !signal?.aborted && now() < deadline) {
            try {
                const ended = await call('abort', `${DEPLOY.toolNamespace}.end@1`, {
                    deployId,
                    status: 'aborted',
                    reason: `${DEPLOY.abortReasonPrefix}:${error.code}`,
                });
                if (ended.deployId !== deployId || ended.status !== 'aborted')
                    fail('ABORT_UNKNOWN', 'Abort was not confirmed.', true);
                state.roundStatus = 'aborted';
                state.status = 'failed';
            } catch {
                state.roundStatus = 'unknown';
                state.status = 'unknown';
            }
        }
        state.finishedAt = new Date(now()).toISOString();
        state.durationMs = Math.max(0, now() - started);
        try {
            await receipt.save();
        } catch {
            /* Previous durable in-flight record remains the recovery point. */
        }
        error.unknown = state.status === 'unknown';
        error.receipt = receipt.file;
        error.deployId = deployId;
        error.exitCode = state.status === 'unknown' ? 3 : 1;
        throw error;
    } finally {
        client.close?.();
    }
}
