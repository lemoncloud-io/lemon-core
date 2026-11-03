/**
 * `bin/lib/deploy.spec.mjs` (lemon-core)
 * - offline tests of deploy-plan / deploy-runner / deploy-client / deploy-credentials / deploy-receipt (`lemon-lambda-deploy`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/deploy.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHmac, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import { writeZip, sha256 } from './pack-zip.mjs';
import { loadDeployment, validateConfig, deploymentPlan, DeployError } from './deploy-plan.mjs';
import {
    runDeployment,
    isThrottleError,
    isRetryableTool,
    toolErrorText,
    toolErrorFields,
    THROTTLE_RETRY_DELAYS_MS,
    RETRYABLE_TOOLS,
} from './deploy-runner.mjs';
import { createDeployClient } from './deploy-client.mjs';
import { main, parseDeployArgs } from '../lemon-lambda-deploy.mjs';
//* v5 B31: the templates config is a reviewed target, so its apply cases run with a guard installation.
import { guardFixture } from './guard-test-fixture.mjs';

//* v5 B19: node:test had no per-test deadline; the process cases (fork/spawn) need more than 5 s on a busy host.
vi.setConfig({ testTimeout: 60_000 });
const require = createRequire(import.meta.url);
const example = JSON.parse(
    await readFile(new URL('../fixtures/deploy/deploy.config.example.json', import.meta.url), 'utf8'),
);
const codeConfig = () => {
    const { environmentFile, policy, routes, deletionProtection, ...c } = structuredClone(example);
    return { ...c, mode: 'code' };
};
//* v5 B24: `patch` overrides config keys (e.g. another project) before the deployment is loaded.
async function fixture(t, mode = 'code', patch = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'templates-deploy-test-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'handler.cjs');
    await writeFile(source, 'throw new Error("handler must not execute during planning");');
    const zip = path.join(root, 'lambda.zip');
    const meta = await writeZip(zip, [{ path: 'handler.cjs', source }]);
    const bytes = await readFile(zip);
    const manifest = {
        schemaVersion: 1,
        runtime: 'nodejs24.x',
        architecture: 'x86_64',
        files: meta.files,
        archive: {
            file: 'lambda.zip',
            sha256: sha256(bytes),
            bytes: meta.bytes,
            uncompressedBytes: meta.uncompressedBytes,
            fileCount: meta.files.length,
        },
        validation: { handler: { file: 'handler.cjs', export: 'lambda' } },
        source: { gitSha: 'a'.repeat(40), dirty: false },
    };
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    const config = {
        ...(mode === 'bootstrap' ? { ...structuredClone(example), environmentFile: 'env.json' } : codeConfig()),
        ...patch,
    };
    await writeFile(path.join(root, 'env.json'), JSON.stringify({ NAME: 'templates', SECRET: 'secret-env-sentinel' }));
    const configFile = path.join(root, 'config.json');
    await writeFile(configFile, JSON.stringify(config));
    const deployment = await loadDeployment({ configFile, artifact: root });
    return { root, configFile, config, manifest, deployment, receiptDirectory: path.join(root, 'receipts') };
}
const good = (tool, output) => ({
    http: 200,
    result: { tool: tool.split('@')[0], version: '1', status: 'succeeded', verified: true, output },
});
function fakeClient(d, { hook, readHook, putStatus = 200, issueUpload = false, asyncMappings = false } = {}) {
    const c = d.config,
        a = d.artifact,
        calls = [],
        reads = [],
        puts = [];
    const arn = (service, name) => `arn:aws:${service}:${c.region}:${c.account}:${name}`;
    const names = {
        project: c.project,
        stage: c.stage,
        short: 'lemon-templates',
        functionName: 'lemon-templates-lambda-dev',
        logGroupName: '/aws/lambda/lemon-templates-lambda-dev',
        roleName: 'lemon-templates-lambda-role-dev',
        tableName: 'lemon-templates-table-dev',
        queueName: 'lemon-templates-sqs-dev',
        topicName: 'lemon-templates-sns-dev',
        ruleName: 'lemon-templates-dev-1min',
        restApiName: 'dev-lemon-templates-api',
    };
    let presigns = 0;
    const result = {
        calls,
        reads,
        puts,
        async request(r) {
            calls.push(r);
            const overridden = await hook?.(r, { calls, names, arn, good });
            if (overridden !== undefined) return overridden;
            const i = r.input ?? {};
            if (r.method === 'GET') return good(r.tool, { uuid: r.resource, state: 'Enabled' });
            switch (r.tool) {
                case 'lemon.deploy.resolve-names@1': {
                    const name =
                        i.convention === 'sls'
                            ? `${c.project}-${c.stage}-${i.component ?? 'lambda'}`
                            : names.functionName;
                    return good(r.tool, { ...names, functionName: name, logGroupName: `/aws/lambda/${name}` });
                }
                case 'lemon.deploy.resolve-policy@1':
                    return good(r.tool, {
                        statements: [
                            {
                                Sid: 'Logs',
                                Effect: 'Allow',
                                Action: ['logs:CreateLogStream'],
                                Resource: arn('logs', 'log-group:/aws/lambda/lemon-templates-*'),
                            },
                            {
                                Sid: 'SNS',
                                Effect: 'Allow',
                                Action: ['sns:Publish'],
                                Resource: arn('sns', 'lemon-templates-*'),
                            },
                        ],
                    });
                case 'lemon.deploy.begin@1':
                    return good(r.tool, {
                        deployId: 'dpl_test',
                        expiresAt: new Date(Date.now() + 1800000).toISOString(),
                        revision: 1,
                        takeover: false,
                    });
                case 'aws.s3.presign-put@1': {
                    const base = {
                        bucket: i.bucket,
                        key: i.key,
                        sha256: i.sha256,
                        method: 'PUT',
                        stored: !issueUpload || presigns++ > 0,
                    };
                    if (base.stored) return good(r.tool, base);
                    return good(r.tool, {
                        ...base,
                        uploadUrl: `https://${c.artifactBucket}.s3.${c.region}.amazonaws.com/${i.key}?X-Amz-Signature=secret-url-sentinel`,
                        headers: {
                            'content-type': 'application/zip',
                            'content-length': String(a.bytes.length),
                            'x-amz-checksum-sha256': Buffer.from(a.sha256, 'hex').toString('base64'),
                            'if-none-match': '*',
                            'x-amz-meta-upload': 'required',
                        },
                    });
                }
                case 'lemon.deploy.ensure-role@1':
                    return good(r.tool, { roleArn: `arn:aws:iam::${c.account}:role/${names.roleName}` });
                case 'aws.dynamodb.ensure-table@1':
                    return good(r.tool, {
                        tableName: names.tableName,
                        tableArn: arn('dynamodb', `table/${names.tableName}`),
                        streamArn: arn('dynamodb', `table/${names.tableName}/stream/2026-10-30T00:00:00.000`),
                    });
                case 'aws.sqs.ensure-queue@1':
                    return good(r.tool, {
                        queueArn: arn('sqs', names.queueName),
                        queueUrl: `https://sqs.${c.region}.amazonaws.com/${c.account}/${names.queueName}`,
                    });
                case 'aws.sns.ensure-topic@1':
                    return good(r.tool, { topicArn: arn('sns', names.topicName) });
                case 'aws.lambda.ensure-function@1':
                    return good(r.tool, {
                        functionArn: arn('lambda', `function:${i.functionName}`),
                        functionName: i.functionName,
                        state: 'Active',
                    });
                case 'aws.lambda.ensure-event-source-mapping@1':
                    return asyncMappings
                        ? {
                              http: 202,
                              result: {
                                  tool: r.tool.split('@')[0],
                                  version: '1',
                                  status: 'accepted',
                                  verified: false,
                                  output: { uuid: 'map_123', state: 'Creating' },
                              },
                          }
                        : good(r.tool, { uuid: 'map_123', state: 'Enabled' });
                case 'aws.apigateway.ensure-rest-api@1':
                    return good(r.tool, { restApiId: 'api123' });
                case 'lemon.deploy.end@1':
                    return good(r.tool, {
                        deployId: i.deployId,
                        status: i.status ?? 'completed',
                        manifestVersionId: 'version-1',
                        revision: 1,
                    });
                default:
                    return good(r.tool, {});
            }
        },
        async readFunction(name) {
            reads.push(name);
            const found = {
                functionName: name,
                functionArn: arn('lambda', `function:${name}`),
                runtime: 'nodejs24.x',
                architectures: ['x86_64'],
                handler: a.handler,
                role: `arn:aws:iam::${c.account}:role/lemon-templates-lambda-role-dev`,
                state: 'Active',
                lastUpdateStatus: 'Successful',
                tags: { 'deploy-managed': 'true' },
            };
            return readHook ? readHook(found, name) : found;
        },
        async put(p) {
            puts.push(p);
            return putStatus;
        },
        close() {},
    };
    return result;
}
async function execute(f, client, extra = {}) {
    return runDeployment(f.deployment, {
        client,
        receiptDirectory: f.receiptDirectory,
        sleep: async () => {},
        ...extra,
    });
}
async function failedRun(f, client, code, extra = {}) {
    let error;
    try {
        await execute(f, client, extra);
    } catch (e) {
        error = e;
    }
    assert.ok(error, 'expected failure');
    if (code) assert.equal(error.code, code);
    return { error, receipt: JSON.parse(await readFile(error.receipt, 'utf8')) };
}

test('offline plan verifies actual ZIP without loading handler, client, network or credentials', async t => {
    const f = await fixture(t);
    const out = [];
    let clients = 0;
    const exit = await main(['--config', f.configFile, '--artifact', f.root], {
        stdout: s => out.push(s),
        stderr: assert.fail,
        clientFactory: () => {
            clients++;
            throw Error('credentials queried');
        },
    });
    assert.equal(exit, 0);
    assert.equal(clients, 0);
    const plan = JSON.parse(out[0]);
    assert.equal(plan.execution, 'offline-plan');
    assert.equal(plan.artifact.sha256, f.manifest.archive.sha256);
    assert.equal(plan.artifact.source.gitSha, 'a'.repeat(40));
});
test('bootstrap plan exposes concrete route/auth/CORS and resource settings but no env values', async t => {
    const f = await fixture(t, 'bootstrap');
    const p = deploymentPlan(f.deployment);
    assert.equal(p.configuration.routes.length, 18);
    assert.equal(p.configuration.functions[1].timeout, 300);
    assert.equal(p.configuration.table.deletionProtection, true);
    assert.equal(p.configuration.queue.attributes.VisibilityTimeout, '300');
    assert.equal(p.configuration.schedule.state, 'DISABLED');
    assert.ok(p.environmentKeys.includes('SECRET'));
    assert.ok(!JSON.stringify(p).includes('secret-env-sentinel'));
});
test('example has exact serverless route/auth/CORS contract (18 paths/methods)', async () => {
    const yaml = require('js-yaml');
    const sls = yaml.load(await readFile(new URL('../fixtures/deploy/serverless.routes.yml', import.meta.url), 'utf8'));
    const routes = sls.functions.lambda.events
        .filter(x => x.http)
        .map(x => ({
            path: x.http.path,
            httpMethod: x.http.method.toUpperCase(),
            authorizationType: x.http.authorizer === 'aws_iam' ? 'AWS_IAM' : 'NONE',
            cors:
                x.http.cors === true
                    ? {
                          origin: '*',
                          headers: [
                              'Content-Type',
                              'X-Amz-Date',
                              'Authorization',
                              'X-Api-Key',
                              'X-Amz-Security-Token',
                              'X-Amz-User-Agent',
                              'X-Amzn-Trace-Id',
                          ],
                          credentials: false,
                      }
                    : {
                          origin: sls.custom.cors.origin,
                          headers: sls.custom.cors.headers,
                          credentials: sls.custom.cors.allowCredentials,
                          allowCredentialsWithWildcardOrigin: true,
                      },
        }));
    assert.equal(routes.length, 18);
    assert.deepEqual(example.routes, routes);
});
test('strict config/CLI validation refuses ambiguous, unsupported or wrong target input', () => {
    for (const patch of [
        { stage: 'production' },
        { account: '123' },
        { region: 'bad' },
        { endpoint: 'http://example123.execute-api.ap-northeast-2.amazonaws.com/dev' },
        { endpoint: 'https://user:secret@example123.execute-api.ap-northeast-2.amazonaws.com/dev' },
        { endpoint: 'https://example123.execute-api.us-east-1.amazonaws.com/dev' },
        { endpoint: 'https://example123.execute-api.ap-northeast-2.amazonaws.com/dev?secret=yes' },
        { keyPrefix: '../x' },
        { project: 'eureka-deploy-api' },
        { extra: true },
        { expect: '' },
        { expect: '   ' },
        { requestTimeoutMs: 0 },
        { environmentFile: 'secret.json' },
    ])
        assert.throws(() => validateConfig({ ...codeConfig(), ...patch }), DeployError);
    assert.throws(() => parseDeployArgs(['--config', 'a', '--config', 'b']), DeployError);
    assert.throws(() => parseDeployArgs(['--apply', 'false']), DeployError);
    assert.throws(
        () => validateConfig({ ...example, routes: [{ ...example.routes[0], httpMethod: 'OPTIONS' }] }),
        DeployError,
    );
    //* `policy.snsPushEndpoints` (knowledge#1172) is a boolean, passed through to resolve-policy as is.
    assert.equal(validateConfig({ ...example, policy: { snsPushEndpoints: true } }).policy.snsPushEndpoints, true);
    assert.throws(() => validateConfig({ ...example, policy: { snsPushEndpoints: 'true' } }), DeployError);
});
test('artifact tamper/runtime/architecture and encrypted env missing KMS refuse before client construction', async t => {
    const f = await fixture(t);
    const file = path.join(f.root, 'manifest.json');
    for (const patch of [{ architecture: 'arm64' }, { runtime: 'nodejs22.x' }]) {
        await writeFile(file, JSON.stringify({ ...f.manifest, ...patch }));
        await assert.rejects(loadDeployment({ configFile: f.configFile, artifact: f.root }), DeployError);
    }
    await writeFile(file, JSON.stringify(f.manifest));
    await writeFile(path.join(f.root, 'lambda.zip'), 'bad ZIP');
    await assert.rejects(loadDeployment({ configFile: f.configFile, artifact: f.root }), DeployError);
    const b = await fixture(t, 'bootstrap');
    await writeFile(path.join(b.root, 'env.json'), JSON.stringify({ SECRET: '*AQICtest' }));
    await assert.rejects(loadDeployment({ configFile: b.configFile, artifact: b.root }), /kmsDecryptKeyArn/);
});
test('code apply preflights both functions, preserves settings, scopes all writes and stores receipts', async t => {
    const f = await fixture(t);
    const client = fakeClient(f.deployment);
    const result = await execute(f, client);
    assert.equal(result.status, 'completed');
    assert.equal(client.reads.length, 2);
    const begin = client.calls.findIndex(c => c.tool === 'lemon.deploy.begin@1');
    assert.equal(begin, 4);
    for (const call of client.calls.slice(begin + 1)) assert.equal(call.deployId, 'dpl_test');
    const functions = client.calls.filter(c => c.tool === 'aws.lambda.ensure-function@1');
    assert.equal(functions.length, 2);
    assert.equal(functions[1].input.component, 'backend');
    for (const { input } of functions)
        for (const key of ['environment', 'handler', 'runtime', 'memorySize', 'timeout']) assert.ok(!(key in input));
    assert.equal(client.puts.length, 0);
    const receipt = JSON.parse(await readFile(result.receipt, 'utf8'));
    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.steps.find(s => s.name === 'begin').deployId, 'dpl_test');
    assert.equal(
        receipt.steps.find(s => s.name === 'lambda-code').output.functionArn,
        functions[0].input.functionName.replace(/^/, 'arn:aws:lambda:ap-northeast-2:123456789012:function:'),
    );
    assert.equal((await stat(result.receipt)).mode & 0o777, 0o600);
});
test('bootstrap applies authoritative names, retained logs, env merge and sequential routes before stage', async t => {
    const f = await fixture(t, 'bootstrap');
    const client = fakeClient(f.deployment, { readHook: () => null, asyncMappings: true });
    const result = await execute(f, client);
    const calls = client.calls;
    const find = tool => calls.filter(x => x.tool === tool);
    assert.equal(find('aws.apigateway.ensure-route@1').length, 18);
    assert.ok(
        calls.findIndex(x => x.tool === 'aws.logs.ensure-log-group@1') <
            calls.findIndex(x => x.tool === 'aws.lambda.ensure-function@1'),
    );
    const functions = find('aws.lambda.ensure-function@1');
    assert.equal(functions[1].input.timeout, 300);
    assert.equal(functions[1].input.component, 'backend');
    assert.equal(find('aws.logs.ensure-log-group@1')[1].input.component, 'backend');
    assert.equal(functions[0].input.environmentMode, 'merge');
    assert.equal(functions[0].input.environment.SECRET, 'secret-env-sentinel');
    assert.equal(functions[0].input.environment.MY_DYNAMO_TABLE, 'lemon-templates-table-dev');
    assert.deepEqual(
        find('lemon.deploy.ensure-role@1')[0].input.statements,
        (await client.request({ tool: 'lemon.deploy.resolve-policy@1', input: {} })).result.output.statements,
    );
    assert.equal(find('aws.events.ensure-schedule@1')[0].input.state, 'DISABLED');
    assert.equal(calls.filter(x => x.method === 'GET').length, 2);
    assert.deepEqual(find('aws.apigateway.deploy-stage@1')[0].input.expectPaths, ['/', '/hello/0']);
    const receipt = await readFile(result.receipt, 'utf8');
    assert.ok(!receipt.includes('secret-env-sentinel'));
    assert.ok(!receipt.includes('secret-url-sentinel'));
    assert.ok(!receipt.includes('statements'));
    assert.equal(
        JSON.parse(receipt).steps.find(s => s.name === 'queue').output.queueUrl,
        'https://sqs.ap-northeast-2.amazonaws.com/123456789012/lemon-templates-sqs-dev',
    );
});
test('both modes reject wrong account, unmanaged, arm64, handler or unstable functions before begin', async t => {
    for (const mode of ['code', 'bootstrap'])
        for (const patch of [
            { architectures: ['arm64'] },
            { runtime: 'nodejs22.x' },
            { tags: {} },
            { handler: 'index.handler' },
            { state: 'Pending' },
            { lastUpdateStatus: 'InProgress' },
            { functionArn: 'arn:aws:lambda:ap-northeast-2:999999999999:function:other' },
        ]) {
            const f = await fixture(t, mode),
                client = fakeClient(f.deployment, { readHook: found => ({ ...found, ...patch }) });
            await failedRun(f, client, 'FUNCTION_MISMATCH');
            assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.begin@1'));
        }
    const f = await fixture(t),
        client = fakeClient(f.deployment, { readHook: () => null });
    await failedRun(f, client, 'FUNCTION_MISSING');
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.begin@1'));
});
test('installation account mismatch in policy stops before begin/role', async t => {
    const f = await fixture(t, 'bootstrap'),
        client = fakeClient(f.deployment, {
            hook: r =>
                r.tool === 'lemon.deploy.resolve-policy@1'
                    ? good(r.tool, {
                          statements: [
                              { Effect: 'Allow', Resource: 'arn:aws:logs:ap-northeast-2:999999999999:log-group:*' },
                          ],
                      })
                    : undefined,
        });
    await failedRun(f, client, 'TARGET_MISMATCH');
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.begin@1'));
});
test('upload sends exact headers and validated immutable bytes; 412 rechecks stored SHA', async t => {
    for (const status of [200, 412]) {
        const f = await fixture(t),
            client = fakeClient(f.deployment, { issueUpload: true, putStatus: status });
        const result = await execute(f, client);
        assert.equal(client.puts.length, 1);
        assert.equal(client.puts[0].headers['x-amz-meta-upload'], 'required');
        assert.equal(sha256(client.puts[0].bytes), f.manifest.archive.sha256);
        assert.equal(client.calls.filter(x => x.tool === 'aws.s3.presign-put@1').length, status === 412 ? 2 : 1);
        assert.ok(!(await readFile(result.receipt, 'utf8')).includes('secret-url-sentinel'));
    }
});
test('malicious presigned URL or mismatched identity/headers never uploads', async t => {
    for (const patch of [
        { uploadUrl: 'https://attacker.example/upload' },
        { sha256: 'f'.repeat(64) },
        { method: 'POST' },
        { headers: { authorization: 'secret-token' } },
    ]) {
        const f = await fixture(t),
            client = fakeClient(f.deployment, {
                hook: r =>
                    r.tool === 'aws.s3.presign-put@1'
                        ? good(r.tool, {
                              ...r.input,
                              method: 'PUT',
                              stored: false,
                              uploadUrl: `https://${f.config.artifactBucket}.s3.${f.config.region}.amazonaws.com/${r.input.key}`,
                              headers: {
                                  'content-type': 'application/zip',
                                  'content-length': String(f.deployment.artifact.bytes.length),
                                  'if-none-match': '*',
                                  'x-amz-checksum-sha256': Buffer.from(f.deployment.artifact.sha256, 'hex').toString(
                                      'base64',
                                  ),
                              },
                              ...patch,
                          })
                        : undefined,
            });
        await failedRun(f, client, 'UPLOAD_RESPONSE_INVALID');
        assert.equal(client.puts.length, 0);
        assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.end@1'));
    }
});
test('HTTP 200 tool failure aborts known round and preserves partial function success without secrets', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r =>
                r.tool === 'aws.lambda.ensure-function@1' && r.input.component === 'backend'
                    ? {
                          http: 200,
                          result: {
                              tool: r.tool.split('@')[0],
                              version: '1',
                              status: 'failed',
                              verified: false,
                              error: { message: 'remote secret-env-sentinel' },
                          },
                      }
                    : undefined,
        });
    const { error, receipt } = await failedRun(f, client, 'TOOL_FAILED');
    assert.equal(error.exitCode, 1);
    assert.equal(receipt.roundStatus, 'aborted');
    assert.ok(receipt.steps.find(s => s.name === 'lambda-code').output.functionArn);
    assert.ok(!JSON.stringify(receipt).includes('secret-env-sentinel'));
    assert.equal(client.calls.at(-1).input.status, 'aborted');
    // v5 B24 compat: the templates abort reason is byte-identical (captured on v5 @ 06727a94).
    assert.equal(client.calls.at(-1).input.reason, 'templates-cli:TOOL_FAILED');
});
//* v5 B24: the abort reason prefix follows the project (data in org-defaults); only templates keeps `templates-cli`.
test('abort reason of a non-templates project uses the lemon-lambda-deploy prefix', async t => {
    const f = await fixture(t, 'code', { project: 'lemon-hello-api', keyPrefix: 'lemon-hello-api/dev' }),
        client = fakeClient(f.deployment, {
            hook: r =>
                r.tool === 'aws.s3.presign-put@1'
                    ? {
                          http: 200,
                          result: { tool: r.tool.split('@')[0], version: '1', status: 'failed', verified: false },
                      }
                    : undefined,
        });
    const { receipt } = await failedRun(f, client, 'TOOL_FAILED');
    assert.equal(receipt.roundStatus, 'aborted');
    assert.deepEqual(client.calls.at(-1).input, {
        deployId: 'dpl_test',
        status: 'aborted',
        reason: 'lemon-lambda-deploy:TOOL_FAILED',
    });
});
//* v5 B24: resolved function names must be the planned `<project>-<stage>-lambda|backend`, checked before begin.
test('resolved function names that differ from the planned targets stop before begin', async t => {
    for (const [component, name] of [
        ['lambda', 'lemon-other-api-dev-lambda'],
        ['backend', 'lemon-other-api-dev-backend'],
        ['backend', 'lemon-templates-api-dev-worker'],
    ]) {
        const f = await fixture(t),
            client = fakeClient(f.deployment, {
                hook: (r, { names }) =>
                    r.tool === 'lemon.deploy.resolve-names@1' &&
                    r.input.convention === 'sls' &&
                    (r.input.component ?? 'lambda') === component
                        ? good(r.tool, { ...names, functionName: name, logGroupName: `/aws/lambda/${name}` })
                        : undefined,
            });
        const { error } = await failedRun(f, client, 'TARGET_MISMATCH');
        assert.equal(error.message, 'Resolved function names differ from the planned targets.');
        assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.begin@1'));
        assert.equal(client.reads.length, 0);
    }
});
test('network or malformed mutation response stays unknown and never retries/end/unlocks', async t => {
    for (const kind of ['network', 'malformed', 'verifyfalse']) {
        const f = await fixture(t),
            client = fakeClient(f.deployment, {
                hook: r => {
                    if (r.tool !== 'aws.lambda.ensure-function@1') return;
                    if (kind === 'network') throw new Error('remote secret-token');
                    if (kind === 'malformed') return { http: 502, result: { error: 'secret-token' } };
                    return {
                        http: 200,
                        result: {
                            tool: r.tool.split('@')[0],
                            version: '1',
                            status: 'succeeded',
                            verified: false,
                            output: {},
                        },
                    };
                },
            });
        const { error, receipt } = await failedRun(f, client);
        assert.equal(error.exitCode, 3);
        assert.equal(receipt.status, 'unknown');
        assert.equal(client.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1').length, 1);
        assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.end@1'));
        assert.ok(!JSON.stringify(receipt).includes('secret-token'));
    }
});
test('pending asynchronous mappings timeout without another POST or closing lease', async t => {
    const f = await fixture(t, 'bootstrap');
    f.deployment.config.maxPolls = 1;
    const client = fakeClient(f.deployment, {
        hook: r =>
            r.tool === 'aws.lambda.ensure-event-source-mapping@1'
                ? {
                      http: 202,
                      result: {
                          tool: r.tool.split('@')[0],
                          version: '1',
                          status: 'accepted',
                          verified: false,
                          output: { uuid: 'pending-map' },
                      },
                  }
                : undefined,
    });
    const { receipt } = await failedRun(f, client, 'POLL_LIMIT_UNKNOWN');
    assert.equal(receipt.status, 'unknown');
    assert.equal(
        client.calls.filter(x => x.tool === 'aws.lambda.ensure-event-source-mapping@1' && x.method === 'POST').length,
        1,
    );
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.end@1'));
});
test('SIGINT-style abort and hanging adapter preserve unknown in-flight request', async t => {
    const f = await fixture(t);
    const controller = new AbortController();
    const client = fakeClient(f.deployment, {
        hook: r => {
            if (r.tool === 'lemon.deploy.begin@1') {
                setTimeout(() => controller.abort(), 20);
                return new Promise(() => {});
            }
        },
    });
    const { receipt, error } = await failedRun(f, client, 'INTERRUPTED', { signal: controller.signal });
    assert.equal(error.exitCode, 3);
    assert.equal(receipt.steps.at(-1).status, 'unknown');
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.end@1'));
});
test('function ARN prefix lookalike is rejected and receipt preserves uncertain state', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: (r, { arn }) =>
                r.tool === 'aws.lambda.ensure-function@1'
                    ? good(r.tool, { functionArn: arn('lambda', `function:${r.input.functionName}other`) })
                    : undefined,
        });
    await failedRun(f, client, 'TARGET_MISMATCH');
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.end@1'));
});

test('real SigV4 signs @ tool path/query and no redirects (independent HMAC verification)', async () => {
    let observed;
    const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'test-secret' };
    const config = validateConfig(codeConfig());
    const client = await createDeployClient(config, {
        credentials,
        fetchImpl: async (url, options) => {
            observed = { url, options };
            return { status: 200, json: async () => ({}) };
        },
        lambdaClient: { destroy() {} },
    });
    await client.request({ tool: 'aws.lambda.ensure-function@1', input: { answer: 42 }, deployId: 'dpl_test' });
    const { url, options: o } = observed;
    assert.equal(url.pathname, '/dev/tools/aws.lambda.ensure-function@1');
    assert.equal(url.searchParams.get('deployId'), 'dpl_test');
    assert.equal(o.redirect, 'manual');
    const h = o.headers;
    const auth = h.authorization;
    const signed = auth.match(/SignedHeaders=([^,]+)/)[1];
    const headers = signed
        .split(';')
        .map(k => `${k}:${h[k].trim()}\n`)
        .join('');
    const date = h['x-amz-date'].slice(0, 8);
    const scope = `${date}/${config.region}/execute-api/aws4_request`;
    const hash = s => createHash('sha256').update(s).digest('hex');
    const mac = (key, s) => createHmac('sha256', key).update(s).digest();
    const canonical = [
        'POST',
        '/dev/tools/aws.lambda.ensure-function%401',
        'deployId=dpl_test',
        headers,
        signed,
        hash(o.body),
    ].join('\n');
    const signing = mac(
        mac(mac(mac('AWS4' + credentials.secretAccessKey, date), config.region), 'execute-api'),
        'aws4_request',
    );
    const signature = createHmac('sha256', signing)
        .update(['AWS4-HMAC-SHA256', h['x-amz-date'], scope, hash(canonical)].join('\n'))
        .digest('hex');
    assert.ok(auth.endsWith(signature));
    client.close();
});
test('stalled credential provider and SDK read are bounded; late signing cannot send', async () => {
    const config = { ...validateConfig(codeConfig()), requestTimeoutMs: 30 };
    let release,
        fetches = 0;
    const client = await createDeployClient(config, {
        credentials: () =>
            new Promise(r => {
                release = r;
            }),
        fetchImpl: async () => {
            fetches++;
            throw Error('should not send');
        },
        lambdaClient: { send: () => new Promise(() => {}), destroy() {} },
    });
    const started = Date.now();
    await assert.rejects(client.request({ tool: 'lemon.deploy.begin@1', input: {} }), { code: 'TRANSPORT_UNKNOWN' });
    assert.ok(Date.now() - started < 1000);
    release({ accessKeyId: 'fake', secretAccessKey: 'fake' });
    await wait(10);
    assert.equal(fetches, 0);
    await assert.rejects(client.readFunction('test'), { code: 'READ_FAILED' });
    client.close();
});

test('failed abort escalates original failure to unknown in CLI and receipt', async t => {
    const f = await fixture(t);
    let stderr;
    const client = fakeClient(f.deployment, {
        hook: r => {
            if (r.tool === 'aws.lambda.ensure-function@1')
                return {
                    http: 200,
                    result: {
                        tool: r.tool.split('@')[0],
                        version: '1',
                        status: 'failed',
                        verified: false,
                        error: { message: 'secret-failure' },
                    },
                };
            if (r.tool === 'lemon.deploy.end@1')
                throw new DeployError('TRANSPORT_UNKNOWN', 'Outcome unknown', { unknown: true });
        },
    });
    const exit = await main(
        ['--config', f.configFile, '--artifact', f.root, '--receipt-dir', f.receiptDirectory, '--apply'],
        {
            stdout: assert.fail,
            stderr: s => {
                stderr = JSON.parse(s);
            },
            clientFactory: async () => client,
            // v5 B31: a registered guard installation of the reviewed target.
            guardEnv: (await guardFixture({ account: f.config.account, region: f.config.region })).env,
        },
    );
    assert.equal(exit, 3);
    assert.equal(stderr.status, 'unknown');
    const receipt = JSON.parse(await readFile(stderr.receipt, 'utf8'));
    assert.equal(receipt.status, 'unknown');
    assert.equal(receipt.roundStatus, 'unknown');
    assert.ok(!JSON.stringify(stderr).includes('secret-failure'));
});
test('begin success is durably associated with its deployId before the next request', async t => {
    const f = await fixture(t);
    const snapshots = [];
    const receiptFactory = async (_, plan) => {
        const state = { status: 'prepared', plan, steps: [] };
        return {
            state,
            file: path.join(f.root, 'mock-receipt.json'),
            save: async () => {
                snapshots.push(structuredClone(state));
            },
        };
    };
    await execute(f, fakeClient(f.deployment), { receiptFactory });
    for (const state of snapshots) {
        const begin = state.steps.find(s => s.name === 'begin' && s.status === 'succeeded');
        if (begin) {
            assert.equal(state.deployId, 'dpl_test');
            assert.equal(begin.deployId, 'dpl_test');
        }
    }
});
test('server success without exact expected function identity cannot complete', async t => {
    const f = await fixture(t);
    const client = fakeClient(f.deployment, {
        hook: r =>
            r.tool === 'aws.lambda.ensure-function@1'
                ? good(r.tool, {
                      functionArn: `arn:aws:lambda:${f.config.region}:${f.config.account}:function:${r.input.functionName}:alias`,
                  })
                : undefined,
    });
    const { receipt } = await failedRun(f, client, 'TARGET_MISMATCH');
    assert.equal(receipt.status, 'unknown');
    assert.ok(!client.calls.some(r => r.tool === 'lemon.deploy.end@1'));
});

test('invalid doubled-slash route and invalid/noncanonical CORS origin fail before apply', () => {
    for (const path of ['//hello', '/hello/'])
        assert.throws(
            () => validateConfig({ ...example, routes: [example.routes[0], { ...example.routes[0], path }] }),
            { code: 'INVALID_INPUT', message: /route\.path/ },
        );
    for (const origin of ['https://example.com:99999', 'https://EXAMPLE.COM']) {
        const route = { ...example.routes[0], path: '/unique', cors: { ...example.routes[0].cors, origin } };
        assert.throws(() => validateConfig({ ...example, routes: [example.routes[0], route] }), {
            code: 'INVALID_INPUT',
            message: /route\.cors\.origin/,
        });
    }
});
test('copied bootstrap quickstart resolves sibling environment file', async t => {
    const f = await fixture(t, 'bootstrap');
    await writeFile(f.configFile, JSON.stringify(example));
    await writeFile(path.join(f.root, 'deploy.env.json'), JSON.stringify({ NAME: 'templates' }));
    const d = await loadDeployment({ configFile: f.configFile, artifact: f.root });
    assert.equal(d.environment.NAME, 'templates');
});
test('end tool failure remains unknown without replaying end or abort', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r =>
                r.tool === 'lemon.deploy.end@1'
                    ? {
                          http: 200,
                          result: {
                              tool: r.tool.split('@')[0],
                              version: '1',
                              status: 'failed',
                              verified: false,
                              error: { message: 'close failed' },
                          },
                      }
                    : undefined,
        });
    const { error, receipt } = await failedRun(f, client, 'TOOL_FAILED');
    assert.equal(error.exitCode, 3);
    assert.equal(receipt.status, 'unknown');
    assert.equal(client.calls.filter(r => r.tool === 'lemon.deploy.end@1').length, 1);
});
test.skipIf(process.platform === 'win32')(
    'real stalled credential_process is killed with its helper and CLI exits on deadline',
    async t => {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const f = await fixture(t);
        const helper = path.join(f.root, 'credential-helper.mjs');
        const pidFile = path.join(f.root, 'credential-pids');
        await writeFile(
            helper,
            `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(
                pidFile,
            )},JSON.stringify([process.pid,process.ppid]));setInterval(()=>{},1000);`,
        );
        const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
        const config = path.join(f.root, 'aws-config');
        const credentials = path.join(f.root, 'aws-credentials');
        await writeFile(credentials, '');
        await writeFile(config, `[profile lemon]\ncredential_process = ${quote(process.execPath)} ${quote(helper)}\n`);
        await writeFile(f.configFile, JSON.stringify({ ...f.config, requestTimeoutMs: 1000 }));
        const environment = {
            PATH: process.env.PATH,
            HOME: f.root,
            AWS_CONFIG_FILE: config,
            AWS_SHARED_CREDENTIALS_FILE: credentials,
            AWS_EC2_METADATA_DISABLED: 'true',
            // v5 B31: a registered guard installation of the reviewed target.
            ...(await guardFixture({ account: f.config.account, region: f.config.region })).env,
        };
        const started = Date.now();
        let error;
        try {
            await promisify(execFile)(
                process.execPath,
                [
                    'bin/lemon-lambda-deploy.mjs',
                    '--config',
                    f.configFile,
                    '--artifact',
                    f.root,
                    '--receipt-dir',
                    f.receiptDirectory,
                    '--apply',
                ],
                { cwd: path.resolve(new URL('../../', import.meta.url).pathname), env: environment, timeout: 5000 },
            );
        } catch (e) {
            error = e;
        }
        assert.equal(error?.code, 3);
        assert.ok(Date.now() - started < 4000);
        const report = JSON.parse(error.stderr);
        assert.equal(report.status, 'unknown');
        assert.ok(!error.stderr.includes('SecretAccessKey'));
        const pids = JSON.parse(await readFile(pidFile, 'utf8'));
        for (let tries = 0; tries < 50; tries++) {
            const alive = pids.some(pid => {
                try {
                    process.kill(pid, 0);
                    return true;
                } catch {
                    return false;
                }
            });
            if (!alive) break;
            await wait(20);
        }
        for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    },
);
test.skipIf(process.platform === 'win32')(
    'bounded credential worker caches credentials and refreshes after its cache window',
    async t => {
        const { boundedCredentialProvider } = await import('./deploy-credentials.mjs');
        const f = await fixture(t);
        const helper = path.join(f.root, 'credential-success.mjs');
        const count = path.join(f.root, 'credential-count');
        await writeFile(
            helper,
            `import {readFileSync,writeFileSync} from 'node:fs';let n=0;try{n=Number(readFileSync(${JSON.stringify(
                count,
            )},'utf8'));}catch{}n++;writeFileSync(${JSON.stringify(
                count,
            )},String(n));console.log(JSON.stringify({Version:1,AccessKeyId:'FAKE'+n,SecretAccessKey:'fake-secret',Expiration:new Date(Date.now()+3600000).toISOString()}));`,
        );
        const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
        const config = path.join(f.root, 'aws-config');
        const credentials = path.join(f.root, 'aws-credentials');
        await writeFile(credentials, '');
        await writeFile(
            config,
            `[profile localtest]\ncredential_process = ${quote(process.execPath)} ${quote(helper)}\n`,
        );
        let clock = Date.now();
        const provider = boundedCredentialProvider({
            profile: 'localtest',
            timeoutMs: 2000,
            now: () => clock,
            environment: {
                PATH: process.env.PATH,
                HOME: f.root,
                AWS_CONFIG_FILE: config,
                AWS_SHARED_CREDENTIALS_FILE: credentials,
                AWS_EC2_METADATA_DISABLED: 'true',
            },
        });
        onTestFinished(() => provider.close());
        const one = await provider();
        assert.equal(one.accessKeyId, 'FAKE1');
        assert.equal((await provider()).accessKeyId, 'FAKE1');
        assert.equal(await readFile(count, 'utf8'), '1');
        clock += 6 * 60 * 1000;
        assert.equal((await provider()).accessKeyId, 'FAKE2');
        assert.equal(await readFile(count, 'utf8'), '2');
    },
);

test.skipIf(process.platform === 'win32')(
    'credential worker cleans its process group after abrupt parent death',
    async t => {
        const { spawn } = await import('node:child_process');
        const { once } = await import('node:events');
        const f = await fixture(t);
        const helper = path.join(f.root, 'credential-orphan.mjs');
        const pidFile = path.join(f.root, 'orphan-pids');
        await writeFile(
            helper,
            `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(
                pidFile,
            )},JSON.stringify([process.pid,process.ppid]));setInterval(()=>{},1000);`,
        );
        const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
        const awsConfig = path.join(f.root, 'aws-config');
        const credentials = path.join(f.root, 'aws-credentials');
        await writeFile(credentials, '');
        await writeFile(
            awsConfig,
            `[profile lemon]\ncredential_process = ${quote(process.execPath)} ${quote(helper)}\n`,
        );
        const child = spawn(
            process.execPath,
            [
                'bin/lemon-lambda-deploy.mjs',
                '--config',
                f.configFile,
                '--artifact',
                f.root,
                '--receipt-dir',
                f.receiptDirectory,
                '--apply',
            ],
            {
                cwd: path.resolve(new URL('../../', import.meta.url).pathname),
                stdio: 'ignore',
                env: {
                    PATH: process.env.PATH,
                    HOME: f.root,
                    AWS_CONFIG_FILE: awsConfig,
                    AWS_SHARED_CREDENTIALS_FILE: credentials,
                    AWS_EC2_METADATA_DISABLED: 'true',
                    // v5 B31: a registered guard installation of the reviewed target.
                    ...(await guardFixture({ account: f.config.account, region: f.config.region })).env,
                },
            },
        );
        onTestFinished(() => child.kill('SIGKILL'));
        let pids;
        for (let i = 0; i < 100; i++) {
            try {
                pids = JSON.parse(await readFile(pidFile, 'utf8'));
                break;
            } catch {
                await wait(20);
            }
        }
        assert.ok(pids, 'local credential helper started');
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
        for (let i = 0; i < 100; i++) {
            const alive = pids.some(pid => {
                try {
                    process.kill(pid, 0);
                    return true;
                } catch {
                    return false;
                }
            });
            if (!alive) break;
            await wait(20);
        }
        for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    },
);

//* ---- v5 B34: throttle retry of idempotent tools (D-1) and the tool's error text in receipt / stderr (D-2) ----

// a `status: failed` tool response with the given tool error object (HTTP 200, not verified).
const failedTool = (tool, error) => ({
    http: 200,
    result: { tool: tool.split('@')[0], version: '1', status: 'failed', verified: false, error },
});
// the API Gateway control-plane throttle answer observed on 2026-11-01 (`ensure-route`).
const TOO_MANY = { message: 'Too Many Requests' };

test('B34 isThrottleError reads message, code and a 429 status; other failures are not throttling', () => {
    for (const e of [
        TOO_MANY,
        { message: 'TooManyRequestsException: Too Many Requests' },
        { code: 'TooManyRequestsException' },
        { code: 'ThrottlingException', message: 'x' },
        { message: 'Rate exceeded' },
        { message: 'request throttled' },
        { statusCode: 429 },
        { status: '429' },
        { code: '429' },
        { message: 'failed with HTTP 429' },
        // r2 (N3): a numeric code, trimmed status strings, the `http` field.
        { code: 429 },
        { status: ' 429 ' },
        { statusCode: '429\n' },
        { http: 429 },
    ])
        assert.equal(isThrottleError(e), true, JSON.stringify(e));
    for (const e of [
        undefined,
        null,
        'Too Many Requests',
        {},
        { message: 'The role defined for the function cannot be assumed by Lambda.' },
        { message: 'Invalid handler' },
        { message: 'took 429 ms' },
        { code: 'InvalidParameterValueException' },
        { statusCode: 400 },
        // r2 (N3): `throttle` as a setting name is not throttling.
        { message: 'Invalid throttle burst limit' },
        { code: 428 },
    ])
        assert.equal(isThrottleError(e), false, JSON.stringify(e));
});
test('B34 isRetryableTool is true only for ensure- / resolve- tools', () => {
    for (const tool of [
        'lemon.deploy.resolve-names@1',
        'lemon.deploy.resolve-policy@1',
        'lemon.deploy.ensure-role@1',
        'aws.apigateway.ensure-route@1',
        'aws.lambda.ensure-function@1',
        'aws.lambda.ensure-event-source-mapping@1',
    ])
        assert.equal(isRetryableTool(tool), true, tool);
    for (const tool of [
        'lemon.deploy.begin@1',
        'lemon.deploy.end@1',
        'aws.s3.presign-put@1',
        'aws.sns.subscribe@1',
        'aws.apigateway.deploy-stage@1',
        's3:PutObject',
        undefined,
        // r2 (N4): an ensure- / resolve- name outside the reviewed list is not retried.
        'foo.ensure-x@1',
        'lemon.deploy.ensure-other@1',
        'aws.apigateway.resolve-anything@1',
    ])
        assert.equal(isRetryableTool(tool), false, String(tool));
    // r2 (N4): the list is frozen and holds exactly the read-before-write tools the runner calls.
    //* v5 B47: twelve + the WebSocket API / route tools = fourteen.
    assert.ok(Object.isFrozen(RETRYABLE_TOOLS));
    assert.equal(new Set(RETRYABLE_TOOLS).size, 14);
});
test('B34 a throttled ensure-route is retried with the same input after 2 s, 4 s and the round completes', async t => {
    const f = await fixture(t, 'bootstrap');
    let throttled = 0;
    const client = fakeClient(f.deployment, {
        readHook: () => null,
        hook: r =>
            r.tool === 'aws.apigateway.ensure-route@1' && r.input.path === '/hello' && throttled++ < 2
                ? failedTool(r.tool, TOO_MANY)
                : undefined,
    });
    const sleeps = [];
    const result = await execute(f, client, { sleep: async ms => sleeps.push(ms) });
    assert.equal(result.status, 'completed');
    // three identical requests for the throttled route, one for every other route.
    const hello = client.calls.filter(x => x.tool === 'aws.apigateway.ensure-route@1' && x.input.path === '/hello');
    assert.equal(hello.length, 3);
    assert.deepEqual(hello[1].input, hello[0].input);
    assert.deepEqual(hello[2].input, hello[0].input);
    assert.equal(client.calls.filter(x => x.tool === 'aws.apigateway.ensure-route@1').length, 20);
    // the backoff waits, between the route pacing waits (1500 ms).
    assert.deepEqual(
        sleeps.filter(ms => ms !== f.deployment.config.routeDelayMs),
        THROTTLE_RETRY_DELAYS_MS.slice(0, 2),
    );
    // one receipt step for the route: attempts 3, retried throttle, and no leftover failure fields.
    const receipt = JSON.parse(await readFile(result.receipt, 'utf8'));
    const steps = receipt.steps.filter(s => s.name === 'route-2');
    assert.equal(steps.length, 1);
    assert.equal(steps[0].status, 'succeeded');
    assert.equal(steps[0].attempts, 3);
    assert.equal(steps[0].retried, 'throttle');
    for (const k of ['errorCode', 'errorMessage', 'toolErrorCode', 'nextAttemptAt'])
        assert.equal(steps[0][k], undefined, k);
    // r2 (S2): the previous attempt's outcome stays readable.
    assert.deepEqual([steps[0].previousErrorCode, steps[0].previousErrorMessage], ['TOOL_FAILED', 'Too Many Requests']);
    // steps without a retry carry no new field (receipt shape unchanged).
    for (const s of receipt.steps.filter(s => s.name !== 'route-2')) {
        assert.equal(s.attempts, undefined, s.name);
        assert.equal(s.retried, undefined, s.name);
    }
    assert.deepEqual(
        receipt.steps.map(s => s.index),
        receipt.steps.map((_, i) => i + 1),
    );
});
test('B34 a throttle that outlasts four retries fails TOOL_FAILED with attempts 5 and the tool message', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r =>
                r.tool === 'aws.lambda.ensure-function@1' && r.input.component === 'backend'
                    ? failedTool(r.tool, { ...TOO_MANY, code: 'TooManyRequestsException' })
                    : undefined,
        });
    const sleeps = [];
    const { error, receipt } = await failedRun(f, client, 'TOOL_FAILED', { sleep: async ms => sleeps.push(ms) });
    assert.equal(error.exitCode, 1);
    assert.deepEqual(sleeps, [...THROTTLE_RETRY_DELAYS_MS]);
    const backend = client.calls.filter(
        x => x.tool === 'aws.lambda.ensure-function@1' && x.input.component === 'backend',
    );
    assert.equal(backend.length, 5);
    const step = receipt.steps.find(s => s.name === 'backend-code');
    assert.deepEqual(
        [step.status, step.errorCode, step.attempts, step.retried, step.errorMessage, step.toolErrorCode],
        ['failed', 'TOOL_FAILED', 5, 'throttle', 'Too Many Requests', 'TooManyRequestsException'],
    );
    assert.equal(receipt.steps.filter(s => s.name === 'backend-code').length, 1);
    // the round is still aborted with the same reason.
    assert.equal(receipt.roundStatus, 'aborted');
    assert.equal(client.calls.at(-1).input.reason, 'templates-cli:TOOL_FAILED');
});
test('B34 a throttled non-idempotent tool and a non-throttle failure are not retried', async t => {
    // presign is not an ensure / resolve tool: one call, as before.
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r => (r.tool === 'aws.s3.presign-put@1' ? failedTool(r.tool, TOO_MANY) : undefined),
        });
    const sleeps = [];
    const { receipt } = await failedRun(f, client, 'TOOL_FAILED', { sleep: async ms => sleeps.push(ms) });
    assert.equal(client.calls.filter(x => x.tool === 'aws.s3.presign-put@1').length, 1);
    assert.deepEqual(sleeps, []);
    const presign = receipt.steps.find(s => s.name === 'presign');
    assert.equal(presign.attempts, undefined);
    assert.equal(presign.errorMessage, 'Too Many Requests');
    // an ensure tool with another failure: one call, failure fields kept, no retry fields.
    const g = await fixture(t),
        other = fakeClient(g.deployment, {
            hook: r =>
                r.tool === 'aws.lambda.ensure-function@1'
                    ? failedTool(r.tool, { message: 'Invalid handler', code: 'InvalidParameterValueException' })
                    : undefined,
        });
    const second = await failedRun(g, other, 'TOOL_FAILED', { sleep: async ms => sleeps.push(ms) });
    assert.equal(other.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1').length, 1);
    assert.deepEqual(sleeps, []);
    const step = second.receipt.steps.find(s => s.name === 'lambda-code');
    assert.deepEqual(
        [step.errorMessage, step.toolErrorCode, step.attempts, step.retried],
        ['Invalid handler', 'InvalidParameterValueException', undefined, undefined],
    );
});
test('B34 no retry when the backoff and one request do not fit before the lease deadline', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r => {
                // a 90 s lease: deadline = lease - 60 s = 30 s, less than 2 s + requestTimeoutMs (35 s).
                if (r.tool === 'lemon.deploy.begin@1')
                    return good(r.tool, {
                        deployId: 'dpl_test',
                        expiresAt: new Date(Date.now() + 90_000).toISOString(),
                        revision: 1,
                        takeover: false,
                    });
                if (r.tool === 'aws.lambda.ensure-function@1') return failedTool(r.tool, TOO_MANY);
            },
        });
    const sleeps = [];
    const { receipt } = await failedRun(f, client, 'TOOL_FAILED', { sleep: async ms => sleeps.push(ms) });
    assert.equal(client.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1').length, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(receipt.steps.find(s => s.name === 'lambda-code').attempts, undefined);
    assert.equal(receipt.roundStatus, 'aborted');
});
test('B34 an abort during the backoff stops before the next request (INTERRUPTED)', async t => {
    const f = await fixture(t),
        controller = new AbortController(),
        client = fakeClient(f.deployment, {
            hook: r => (r.tool === 'aws.lambda.ensure-function@1' ? failedTool(r.tool, TOO_MANY) : undefined),
        });
    // the injected wait never ends by itself; the abort ends it.
    const sleep = () => {
        setTimeout(() => controller.abort(), 5);
        return new Promise(() => {});
    };
    const { error, receipt } = await failedRun(f, client, 'INTERRUPTED', { sleep, signal: controller.signal });
    assert.equal(error.exitCode, 3);
    assert.equal(client.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1').length, 1);
    assert.equal(receipt.steps.find(s => s.name === 'lambda-code').errorCode, 'TOOL_FAILED');
});
test('B34 a throttled status lookup (GET) is not retried and keeps POLL_UNKNOWN with the tool message', async t => {
    const f = await fixture(t, 'bootstrap'),
        client = fakeClient(f.deployment, {
            readHook: () => null,
            asyncMappings: true,
            hook: r => (r.method === 'GET' ? failedTool(r.tool, TOO_MANY) : undefined),
        });
    const { receipt } = await failedRun(f, client, 'POLL_UNKNOWN');
    assert.equal(client.calls.filter(x => x.method === 'GET').length, 1);
    const step = receipt.steps.find(s => s.errorCode === 'POLL_UNKNOWN');
    assert.deepEqual([step.status, step.errorMessage, step.attempts], ['unknown', 'Too Many Requests', undefined]);
});
test('B34 toolErrorText hides accounts, ARNs, encoded ARNs, paths and secret words, one line, 300 characters', () => {
    const canary = '987654321098';
    const text = toolErrorText(
        `KMS Exception: InvalidArnException\nARN does not refer to a valid principal: arn:aws:sts::${canary}:assumed-role/r/f ` +
            `acct ${canary} enc arn%3Aaws%3Aiam%3A%3A${canary} at /Users/someone/work/x.js and /var/task/index.js ` +
            `file:///tmp/a ~/b/c C:\\Users\\x token-abc secret-env-sentinel`,
    );
    assert.ok(!text.includes(canary), text);
    assert.ok(!/\d{12}/.test(text), text);
    assert.ok(!text.includes('arn:aws'), text);
    assert.ok(!/arn%3A/i.test(text), text);
    for (const p of ['/Users/', '/var/task', 'file://', '~/b', 'C:\\', 'secret-env-sentinel', 'token-abc'])
        assert.ok(!text.includes(p), `${p} in ${text}`);
    assert.ok(!text.includes('\n'));
    assert.match(text, /^KMS Exception: InvalidArnException ARN does not refer to a valid principal: <arn>/);
    assert.equal(toolErrorText('x'.repeat(1000)).length, 300);
    // API routes are not local paths and stay readable.
    assert.equal(toolErrorText('Too Many Requests on /hello/{id}'), 'Too Many Requests on /hello/{id}');
    // a code that is no longer a short identifier after scrubbing is dropped; an empty message is absent.
    assert.deepEqual(toolErrorFields({ code: canary, message: '  ' }), {});
    assert.deepEqual(toolErrorFields({ code: 'Bad Code!', message: 'm' }), { errorMessage: 'm' });
    assert.deepEqual(toolErrorFields(undefined), {});
});
test('B34 the tool error reaches the receipt step and the CLI stderr line, scrubbed and cut to 300', async t => {
    const f = await fixture(t);
    const canary = '987654321098';
    const message =
        `Lambda was unable to configure access to your environment variables because the KMS key is invalid for CreateGrant. ` +
        `KMS Message: ARN does not refer to a valid principal: arn:aws:sts::${canary}:assumed-role/role/fn ` +
        `(${canary}, arn%3Aaws%3Asts%3A%3A${canary}, /Users/someone/x) secret-env-sentinel ` +
        'y'.repeat(400);
    let stderr;
    const client = fakeClient(f.deployment, {
        hook: r =>
            r.tool === 'aws.lambda.ensure-function@1'
                ? failedTool(r.tool, { message, code: 'InvalidParameterValueException' })
                : undefined,
    });
    const exit = await main(
        ['--config', f.configFile, '--artifact', f.root, '--receipt-dir', f.receiptDirectory, '--apply'],
        {
            stdout: assert.fail,
            stderr: s => {
                stderr = JSON.parse(s);
            },
            clientFactory: async () => client,
            guardEnv: (await guardFixture({ account: f.config.account, region: f.config.region })).env,
        },
    );
    assert.equal(exit, 1);
    assert.deepEqual(
        [stderr.status, stderr.code, stderr.toolErrorCode],
        ['failed', 'TOOL_FAILED', 'InvalidParameterValueException'],
    );
    // the fixed message is unchanged; the tool's text is a separate field.
    assert.equal(stderr.message, 'Tool failed or verification failed; see the server deployment record.');
    assert.match(stderr.errorMessage, /^Lambda was unable to configure access .* KMS key is invalid for CreateGrant/);
    assert.equal(stderr.errorMessage.length, 300);
    const raw = await readFile(stderr.receipt, 'utf8');
    const step = JSON.parse(raw).steps.find(s => s.name === 'lambda-code');
    assert.equal(step.errorMessage, stderr.errorMessage);
    assert.equal(step.toolErrorCode, 'InvalidParameterValueException');
    for (const out of [raw, JSON.stringify(stderr)]) {
        assert.ok(!out.includes(canary));
        assert.ok(!/arn%3A/i.test(out));
        assert.ok(!out.includes('/Users/someone'));
        assert.ok(!out.includes('secret-env-sentinel'));
    }
    // the abort reason sent to the server is unchanged.
    assert.equal(client.calls.at(-1).input.reason, 'templates-cli:TOOL_FAILED');
});

//* ---- v5 B34 r2: review should-fixes (S1–S3) and notes (N1–N5) ----

// the receipt file of the only run under a receipt directory.
const onlyReceipt = async dir => {
    const [run] = (await readdir(dir)).filter(n => n.startsWith('run-'));
    return JSON.parse(await readFile(path.join(dir, run, 'receipt.json'), 'utf8'));
};
// a clock that the injected sleep can move forward (`jump(ms)`).
const movableClock = () => {
    let offset = 0;
    return { now: () => Date.now() + offset, jump: ms => (offset += ms) };
};

test('B34 r2 (S1) a wait that ends past the deadline keeps TOOL_FAILED known (not DEADLINE_UNKNOWN)', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r => (r.tool === 'aws.lambda.ensure-function@1' ? failedTool(r.tool, TOO_MANY) : undefined),
        });
    const clock = movableClock();
    // the clock jumps 40 minutes during the backoff: the 20-minute round deadline is gone.
    const { error, receipt } = await failedRun(f, client, 'TOOL_FAILED', {
        now: clock.now,
        sleep: async () => clock.jump(40 * 60_000),
    });
    assert.equal(error.exitCode, 1);
    assert.equal(error.unknown, false);
    assert.equal(receipt.status, 'failed');
    assert.equal(client.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1').length, 1);
    // past the deadline the abort is skipped, as for any known failure there (unchanged rule).
    assert.equal(receipt.roundStatus, undefined);
    const step = receipt.steps.find(s => s.name === 'lambda-code');
    assert.deepEqual(
        [step.errorCode, step.retried, step.nextAttemptAt, step.attempts],
        ['TOOL_FAILED', undefined, undefined, undefined],
    );
});
test('B34 r2 (S1) a wait that leaves no room for one request keeps TOOL_FAILED and aborts the round', async t => {
    const f = await fixture(t),
        client = fakeClient(f.deployment, {
            hook: r => (r.tool === 'aws.lambda.ensure-function@1' ? failedTool(r.tool, TOO_MANY) : undefined),
        });
    const clock = movableClock();
    // 19 min 50 s: still before the deadline, but less than requestTimeoutMs (35 s) is left.
    const { error, receipt } = await failedRun(f, client, 'TOOL_FAILED', {
        now: clock.now,
        sleep: async () => clock.jump(20 * 60_000 - 10_000),
    });
    assert.equal(error.exitCode, 1);
    assert.equal(receipt.roundStatus, 'aborted');
    assert.equal(client.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1').length, 1);
    assert.equal(client.calls.at(-1).input.reason, 'templates-cli:TOOL_FAILED');
});
test('B34 r2 (S2) a retry whose attempt ends unknown keeps the previous outcome on the step', async t => {
    const f = await fixture(t);
    let n = 0;
    const client = fakeClient(f.deployment, {
        hook: r => {
            if (r.tool !== 'aws.lambda.ensure-function@1') return undefined;
            // first a tool 429, then an API Gateway 504 of the deploy service (no tool result).
            return n++ === 0 ? failedTool(r.tool, TOO_MANY) : { http: 504, result: { message: 'Endpoint timed out' } };
        },
    });
    const { error, receipt } = await failedRun(f, client, 'RESPONSE_UNKNOWN');
    assert.equal(error.exitCode, 3);
    assert.equal(receipt.status, 'unknown');
    // unknown: no abort is sent (the lease is held until it expires).
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.end@1'));
    const step = receipt.steps.find(s => s.name === 'lambda-code');
    assert.deepEqual(
        [step.status, step.errorCode, step.attempts, step.retried, step.previousErrorCode, step.previousErrorMessage],
        ['unknown', 'RESPONSE_UNKNOWN', 2, 'throttle', 'TOOL_FAILED', 'Too Many Requests'],
    );
});
test('B34 r2 (N2) the receipt shows the planned retry during the wait and clears it when the attempt starts', async t => {
    const f = await fixture(t);
    let n = 0;
    const client = fakeClient(f.deployment, {
        hook: r => (r.tool === 'aws.lambda.ensure-function@1' && n++ === 0 ? failedTool(r.tool, TOO_MANY) : undefined),
    });
    let during;
    const result = await execute(f, client, {
        sleep: async ms => {
            if (ms === THROTTLE_RETRY_DELAYS_MS[0]) during = await onlyReceipt(f.receiptDirectory);
        },
    });
    const mid = during.steps.find(s => s.name === 'lambda-code');
    assert.deepEqual(
        [mid.status, mid.errorCode, mid.retried, mid.attempts],
        ['failed', 'TOOL_FAILED', 'throttle', undefined],
    );
    assert.ok(Number.isFinite(Date.parse(mid.nextAttemptAt)));
    assert.ok(Date.parse(mid.nextAttemptAt) >= Date.parse(mid.startedAt) + THROTTLE_RETRY_DELAYS_MS[0]);
    const done = JSON.parse(await readFile(result.receipt, 'utf8')).steps.find(s => s.name === 'lambda-code');
    assert.deepEqual(
        [done.status, done.attempts, done.retried, done.nextAttemptAt, done.previousErrorCode],
        ['succeeded', 2, 'throttle', undefined, 'TOOL_FAILED'],
    );
});
test('B34 r2 (N5) the default wait ends on abort and leaves no timer behind', async t => {
    const f = await fixture(t),
        controller = new AbortController(),
        client = fakeClient(f.deployment, {
            hook: r => (r.tool === 'aws.lambda.ensure-function@1' ? failedTool(r.tool, TOO_MANY) : undefined),
        });
    const timers = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;
    const before = timers();
    const started = Date.now();
    setTimeout(() => controller.abort(), 30);
    // `sleep: undefined` selects the default wait (2 s backoff) of `runDeployment`.
    const { error } = await failedRun(f, client, 'INTERRUPTED', { sleep: undefined, signal: controller.signal });
    assert.equal(error.exitCode, 3);
    assert.ok(Date.now() - started < 1500);
    await wait(0);
    assert.ok(timers() <= before, `timers ${timers()} > ${before}`);
});
test('B34 r2 (S3/N1) toolErrorText hides every reviewer path and 12-digit form', () => {
    for (const input of [
        '/Us\0ers/alice/proj/x.js',
        '/\x1b[0mUsers/alice/proj',
        'ENOENT:/Users/alice/x',
        'C:/Users/x',
        'C:\\Users\\alice\\x',
        '~alice/.aws/credentials',
        '~/.aws/credentials',
        '%2FUsers%2Falice',
        '%2fhome%2falice%2fx',
        'path_/Users/x',
        'user_123456789012',
        'x123456789012y',
        'arn%253Aaws%253Aiam%253A%253A123456789012',
        'arn%3Aaws%3Aiam%3A%3A123456789012%3Arole',
    ]) {
        const out = toolErrorText(input);
        assert.ok(!/\d{12}/.test(out), `${JSON.stringify(input)} -> ${out}`);
        assert.ok(!/alice|Users|\.aws|home/i.test(out), `${JSON.stringify(input)} -> ${out}`);
    }
    assert.equal(toolErrorText('ENOENT:/Users/alice/x'), 'ENOENT:<path>');
    assert.equal(toolErrorText('path_/Users/x'), 'path_<path>');
    assert.equal(toolErrorText('x123456789012y'), 'x<acct>y');
    // a code holding 12 consecutive digits is dropped whole.
    assert.deepEqual(toolErrorFields({ code: 'user_123456789012' }), {});
    assert.deepEqual(toolErrorFields({ code: 'Throttling' }), { toolErrorCode: 'Throttling' });
});

//* v5 B47: a deterministic deployment (fixed ZIP bytes, no temp paths) of a config, for byte-level snapshots.
function syntheticDeployment(raw) {
    const bytes = Buffer.from('b47 synthetic zip bytes');
    return {
        config: validateConfig(raw),
        environment: raw.mode === 'bootstrap' ? { NAME: 'templates', SECRET: 'secret-env-sentinel' } : {},
        artifact: {
            bytes,
            sha256: sha256(bytes),
            manifestSha256: 'b'.repeat(64),
            fileCount: 1,
            handler: 'handler.lambda',
            source: { gitSha: 'a'.repeat(40), dirty: false },
        },
    };
}
//* v5 B47: the stable parts of a run — every client call (no signal) and the receipt without times / paths.
async function runSnapshot(d, root) {
    const client = fakeClient(d, d.config.mode === 'bootstrap' ? { readHook: () => null } : {});
    const result = await runDeployment(d, { client, receiptDirectory: root, sleep: async () => {} });
    const state = JSON.parse(await readFile(result.receipt, 'utf8'));
    // the volatile fields: run times, lease time, step times (and the abort signal of a request).
    const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    state.steps = state.steps.map(step => omit(step, ['startedAt', 'durationMs']));
    return {
        calls: JSON.stringify(client.calls.map(r => omit(r, ['signal']))),
        receipt: JSON.stringify(omit(state, ['startedAt', 'finishedAt', 'durationMs', 'leaseExpiresAt'])),
    };
}
//* v5 B47: sha256 of a string (snapshot digests).
const digest = s => createHash('sha256').update(s).digest('hex');
//* v5 B47: the snapshot digests of the example configs captured before B47 (also locked by T47-12).
const PRE_B47_DIGESTS = {
    bootstrap: {
        plan: '5bd7a584f5ad7dc7007a909b2526a3a83e273fb31fab99d1ff5e98ab77048cd4',
        calls: '105fb4f473049a4ab6797d0e8398e1e64779b5014a79b4b51344f61a61e75bb0',
        receipt: 'bb1b3737d5df74e8486aa85e564368825550a83aaf788aa11eed7a734ca3fa04',
    },
    code: {
        plan: 'ff0506043b0ab784735b61748970e79189a44af67b920369460b6bcc7198da4c',
        calls: '4cd36644b7863955df8edb5cd5f322b36cf4ab023f04914bc788f1802d3d69b7',
        receipt: '2444e34eab5c0a06ef9cf4ca1d342168311aebc6e65a4390ecccf11f21e158a1',
    },
};
test('B47 a config without websocket keeps plan, tool calls and receipt byte-identical (pre-B47 snapshot)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'templates-deploy-b47-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const out = {};
    for (const [mode, raw] of [
        ['bootstrap', { ...structuredClone(example), environmentFile: 'env.json' }],
        ['code', codeConfig()],
    ]) {
        const d = syntheticDeployment(raw);
        const snap = await runSnapshot(d, path.join(root, mode));
        out[mode] = {
            plan: digest(JSON.stringify(deploymentPlan(d), null, 2)),
            calls: digest(snap.calls),
            receipt: digest(snap.receipt),
        };
    }
    // digests captured from `origin/develop` 770f33f0 (before B47) with this same harness.
    assert.deepEqual(out, PRE_B47_DIGESTS);
    // the same, readable: no websocket key anywhere, the pre-B47 step list and two functions.
    const p = deploymentPlan(syntheticDeployment({ ...structuredClone(example), environmentFile: 'env.json' }));
    assert.ok(!JSON.stringify(p).includes('websocket'));
    assert.deepEqual(p.steps, [
        'resolve-names (lemon / sls / backend)',
        'resolve-policy + account/region cross-check',
        'read Lambda configuration/tags (absence allowed)',
        'deploy.begin',
        'presign-put → conditional ZIP PUT',
        'ensure-role',
        'table / queue / topic',
        'log groups ×2',
        'functions ×2 + verification',
        'SNS / DynamoDB stream / SQS mappings',
        'disabled schedule',
        'REST API / 18 sequential routes / stage probe',
        'deploy.end',
    ]);
    assert.deepEqual(
        p.configuration.functions.map(f => [f.component, f.memorySize, f.timeout]),
        [
            ['lambda', 512, 30],
            ['backend', 512, 300],
        ],
    );
});

//* ---- v5 B47: WebSocket API (`websocket` block, third function `socket`) — sample chatic-sockets-api dev ----

//* v5 B47: the four sls WebSocket routes of the sockets services (no authorizer = NONE).
const SOCKETS_WEBSOCKET = Object.freeze({
    routes: ['$connect', '$disconnect', '$default', 'echo'].map(routeKey => ({ routeKey, authorizationType: 'NONE' })),
});
//* v5 B47: the config patch of the sample service.
const SOCKETS = () => ({
    project: 'chatic-sockets-api',
    keyPrefix: 'chatic-sockets-api/dev',
    websocket: structuredClone(SOCKETS_WEBSOCKET),
});
//* v5 B47: the API id the fake WebSocket tools return (the PoC 2 id shape, 10 lower-case characters).
const WS_API_ID = 'ii8068qk89';
//* v5 B47: the fake client plus the three WebSocket tools, `websocketApiName` and the `websocketApiId` policy.
function websocketClient(d, { hook, names: namesPatch = {}, ...options } = {}) {
    const c = d.config;
    const endpoint = `wss://${WS_API_ID}.execute-api.${c.region}.amazonaws.com`;
    return fakeClient(d, {
        ...options,
        hook: async (r, ctx) => {
            const overridden = await hook?.(r, ctx);
            if (overridden !== undefined) return overridden;
            const i = r.input ?? {};
            if (r.method === 'GET') return undefined;
            switch (r.tool) {
                case 'lemon.deploy.resolve-names@1': {
                    const name =
                        i.convention === 'sls'
                            ? `${c.project}-${c.stage}-${i.component ?? 'lambda'}`
                            : ctx.names.functionName;
                    return good(r.tool, {
                        ...ctx.names,
                        websocketApiName: `${c.stage}-${c.project}-websockets`,
                        ...namesPatch,
                        functionName: name,
                        logGroupName: `/aws/lambda/${name}`,
                    });
                }
                case 'lemon.deploy.resolve-policy@1':
                    if (!i.websocketApiId) return undefined;
                    return good(r.tool, {
                        statements: [
                            {
                                Sid: 'Logs',
                                Effect: 'Allow',
                                Action: ['logs:CreateLogStream'],
                                Resource: ctx.arn('logs', 'log-group:/aws/lambda/lemon-templates-*'),
                            },
                            {
                                Sid: 'SNS',
                                Effect: 'Allow',
                                Action: ['sns:Publish'],
                                Resource: ctx.arn('sns', 'lemon-templates-*'),
                            },
                            {
                                Sid: 'OwnWebsocketConnections',
                                Effect: 'Allow',
                                Action: ['execute-api:ManageConnections'],
                                Resource: ctx.arn('execute-api', `${i.websocketApiId}/${c.stage}/*/@connections/*`),
                            },
                        ],
                    });
                case 'aws.apigatewayv2.ensure-websocket-api@1':
                    return good(r.tool, {
                        apiId: WS_API_ID,
                        apiEndpoint: endpoint,
                        routeSelectionExpression: i.routeSelectionExpression,
                        created: true,
                    });
                case 'aws.apigatewayv2.ensure-websocket-route@1':
                    return good(r.tool, {
                        routeId: `r${ctx.calls.length}`,
                        routeKey: i.routeKey,
                        integrationId: 'xvp1bqu',
                        integrationCreated: i.routeKey === '$connect',
                        deploymentRequired: true,
                    });
                case 'aws.apigatewayv2.deploy-websocket-stage@1':
                    return good(r.tool, {
                        deploymentId: 'o4vlne',
                        deploymentStatus: 'DEPLOYED',
                        stageName: i.stageName,
                        wssUrl: `${endpoint}/${i.stageName}`,
                        handshake: 'open',
                        expectRoutes: { present: i.expectRoutes, missing: [] },
                        created: true,
                    });
                default:
                    return undefined;
            }
        },
    });
}
test('B47 websocket config: defaults resolve, code mode takes true, and every malformed block is refused', () => {
    const boot = { ...structuredClone(example), ...SOCKETS() };
    const c = validateConfig(boot);
    assert.deepEqual(c.websocket, {
        routeSelectionExpression: '$request.body.action',
        routes: SOCKETS_WEBSOCKET.routes,
        probeTimeoutMs: 10000,
    });
    // every optional field of a route and the block.
    const full = validateConfig({
        ...boot,
        websocket: {
            routeSelectionExpression: '${request.body.type}',
            probeTimeoutMs: 15000,
            routes: [
                { routeKey: '$connect', authorizationType: 'CUSTOM', authorizerId: 'abc123', timeoutInMillis: 50 },
                { routeKey: 'chat:send.v1', authorizationType: 'AWS_IAM', timeoutInMillis: 29000 },
            ],
        },
    });
    assert.equal(full.websocket.routes[0].authorizerId, 'abc123');
    // code mode: `true` or the same block.
    assert.equal(validateConfig({ ...codeConfig(), websocket: true }).websocket, true);
    assert.equal(validateConfig({ ...codeConfig(), websocket: SOCKETS_WEBSOCKET }).websocket.probeTimeoutMs, 10000);
    const route = patch => ({ routes: [{ routeKey: '$connect', authorizationType: 'NONE', ...patch }] });
    for (const websocket of [
        true,
        null,
        [],
        { ...SOCKETS_WEBSOCKET, extra: 1 },
        { routes: [] },
        { routes: Array.from({ length: 51 }, (_, i) => ({ routeKey: `r${i}`, authorizationType: 'NONE' })) },
        route({ routeKey: '$foo' }),
        route({ routeKey: 'bad key' }),
        route({ routeKey: 'x'.repeat(129) }),
        route({ authorizationType: 'JWT' }),
        route({ authorizationType: 'CUSTOM' }),
        route({ authorizerId: 'abc123' }),
        route({ authorizationType: 'CUSTOM', authorizerId: 'a/b' }),
        route({ timeoutInMillis: 49 }),
        route({ timeoutInMillis: 29001 }),
        route({ extra: true }),
        {
            routes: [
                { routeKey: 'echo', authorizationType: 'NONE' },
                { routeKey: 'echo', authorizationType: 'AWS_IAM' },
            ],
        },
        { ...SOCKETS_WEBSOCKET, probeTimeoutMs: 999 },
        { ...SOCKETS_WEBSOCKET, probeTimeoutMs: 15001 },
        { ...SOCKETS_WEBSOCKET, probeTimeoutMs: 1500.5 },
        { ...SOCKETS_WEBSOCKET, routeSelectionExpression: '$request.header.action' },
        { ...SOCKETS_WEBSOCKET, routeSelectionExpression: 'action' },
    ])
        assert.throws(() => validateConfig({ ...boot, websocket }), DeployError, JSON.stringify(websocket));
    for (const websocket of [false, null, 'yes', { routes: [] }])
        assert.throws(() => validateConfig({ ...codeConfig(), websocket }), DeployError, JSON.stringify(websocket));
});
test('B47 websocket bootstrap plan: three functions, the WebSocket steps and the handshake probe', async t => {
    const f = await fixture(t, 'bootstrap', SOCKETS());
    const p = deploymentPlan(f.deployment);
    assert.deepEqual(p.configuration.functions, [
        ...['lambda', 'backend', 'socket'].map((component, i) => ({
            component,
            runtime: 'nodejs24.x',
            architecture: 'x86_64',
            handler: 'handler.lambda',
            memorySize: 512,
            timeout: i ? 300 : 30,
            environmentMode: 'merge',
        })),
    ]);
    assert.deepEqual(p.configuration.websocket, {
        routeSelectionExpression: '$request.body.action',
        routes: SOCKETS_WEBSOCKET.routes,
        probeTimeoutMs: 10000,
    });
    assert.deepEqual(p.verification.websocketProbe, { handshake: 'open', expectRoutes: 4 });
    assert.deepEqual(p.steps, [
        'resolve-names (lemon / sls / backend / socket)',
        'resolve-policy + account/region cross-check',
        'read Lambda configuration/tags (absence allowed)',
        'deploy.begin',
        'presign-put → conditional ZIP PUT',
        'WebSocket API → resolve-policy(websocketApiId) → ensure-role',
        'table / queue / topic',
        'log groups ×3',
        'functions ×3 + verification',
        'SNS / DynamoDB stream / SQS mappings',
        'disabled schedule',
        'REST API / 18 sequential routes / stage probe',
        'WebSocket 4 sequential routes / stage probe',
        'deploy.end',
    ]);
    assert.ok(p.limitations.at(-1).startsWith('WebSocket stage probe'));
    // code mode: the third function only.
    const code = await fixture(t, 'code', { project: 'chatic-sockets-api', websocket: true });
    const cp = deploymentPlan(code.deployment);
    assert.deepEqual(cp.steps.slice(-2), ['existing functions ×3 code + verification', 'deploy.end']);
    assert.equal(cp.steps[0], 'resolve-names (lemon / sls / backend / socket)');
    assert.ok(!('websocketProbe' in cp.verification));
});
test('B47 websocket bootstrap: API before the role, policy with websocketApiId, routes ×4 to socket, stage probe', async t => {
    const f = await fixture(t, 'bootstrap', SOCKETS());
    const client = websocketClient(f.deployment, { readHook: () => null });
    const result = await execute(f, client);
    assert.equal(result.status, 'completed');
    const calls = client.calls.filter(x => x.method === 'POST');
    const at = tool => calls.findIndex(x => x.tool === tool);
    const find = tool => calls.filter(x => x.tool === tool);
    // names: the socket function is resolved like the other two, before begin.
    const names = find('lemon.deploy.resolve-names@1');
    assert.deepEqual(
        names.map(x => x.input.component ?? null),
        [null, null, 'backend', 'socket'],
    );
    assert.deepEqual(
        client.reads,
        ['lambda', 'backend', 'socket'].map(k => `chatic-sockets-api-dev-${k}`),
    );
    // order: presign → websocket-api → resolve-policy(websocketApiId) → ensure-role.
    const policies = find('lemon.deploy.resolve-policy@1');
    assert.equal(policies.length, 2);
    assert.ok(!('websocketApiId' in policies[0].input));
    assert.deepEqual(policies[1].input, { ...policies[0].input, websocketApiId: WS_API_ID });
    assert.ok(at('aws.s3.presign-put@1') < at('aws.apigatewayv2.ensure-websocket-api@1'));
    assert.ok(at('lemon.deploy.begin@1') < at('aws.apigatewayv2.ensure-websocket-api@1'));
    assert.ok(at('aws.apigatewayv2.ensure-websocket-api@1') < calls.indexOf(policies[1]));
    assert.ok(calls.indexOf(policies[1]) < at('lemon.deploy.ensure-role@1'));
    assert.deepEqual(find('aws.apigatewayv2.ensure-websocket-api@1')[0].input, {
        project: 'chatic-sockets-api',
        apiName: 'dev-chatic-sockets-api-websockets',
        routeSelectionExpression: '$request.body.action',
        tags: { 'deploy-project': 'lemon-templates' },
    });
    // one role, carrying the connection statement.
    const roles = find('lemon.deploy.ensure-role@1');
    assert.equal(roles.length, 1);
    const own = roles[0].input.statements.find(s => s.Sid === 'OwnWebsocketConnections');
    assert.deepEqual(own.Action, ['execute-api:ManageConnections']);
    assert.equal(own.Resource, `arn:aws:execute-api:ap-northeast-2:123456789012:${WS_API_ID}/dev/*/@connections/*`);
    // three log groups and functions; socket = 512 MB / 300 s, same handler and environment.
    assert.deepEqual(
        find('aws.logs.ensure-log-group@1').map(x => [x.input.component ?? null, x.input.logGroupName]),
        [null, 'backend', 'socket'].map(k => [k, `/aws/lambda/chatic-sockets-api-dev-${k ?? 'lambda'}`]),
    );
    const functions = find('aws.lambda.ensure-function@1');
    assert.equal(functions.length, 3);
    assert.equal(functions[2].input.component, 'socket');
    assert.equal(functions[2].input.functionName, 'chatic-sockets-api-dev-socket');
    assert.equal(functions[2].input.memorySize, 512);
    assert.equal(functions[2].input.timeout, 300);
    assert.equal(functions[2].input.handler, functions[0].input.handler);
    assert.equal(functions[2].input.environmentMode, 'merge');
    assert.deepEqual(functions[2].input.environment, functions[0].input.environment);
    // after the REST stage: four sequential routes to the socket function, then the stage with expectRoutes.
    const routes = find('aws.apigatewayv2.ensure-websocket-route@1');
    assert.deepEqual(
        routes.map(x => x.input),
        SOCKETS_WEBSOCKET.routes.map(r => ({
            apiId: WS_API_ID,
            ...r,
            functionArn: 'arn:aws:lambda:ap-northeast-2:123456789012:function:chatic-sockets-api-dev-socket',
        })),
    );
    assert.ok(at('aws.apigateway.deploy-stage@1') < calls.indexOf(routes[0]));
    assert.deepEqual(find('aws.apigatewayv2.deploy-websocket-stage@1')[0].input, {
        apiId: WS_API_ID,
        stageName: 'dev',
        probe: { timeoutMs: 10000 },
        expectRoutes: ['$connect', '$disconnect', '$default', 'echo'],
        tags: { 'deploy-project': 'lemon-templates' },
    });
    assert.equal(at('aws.apigatewayv2.deploy-websocket-stage@1'), at('lemon.deploy.end@1') - 1);
    // receipt: the WebSocket state and three functions.
    const receipt = JSON.parse(await readFile(result.receipt, 'utf8'));
    assert.deepEqual(receipt.websocket, {
        apiId: WS_API_ID,
        wssUrl: `wss://${WS_API_ID}.execute-api.ap-northeast-2.amazonaws.com/dev`,
        stageName: 'dev',
    });
    assert.equal(receipt.functions.length, 3);
    assert.deepEqual(
        receipt.steps.filter(s => s.name.startsWith('websocket')).map(s => s.name),
        [
            'websocket-api',
            'websocket-policy',
            'websocket-route-1',
            'websocket-route-2',
            'websocket-route-3',
            'websocket-route-4',
            'websocket-stage',
        ],
    );
    assert.equal(receipt.steps.find(s => s.name === 'websocket-stage').output.handshake, 'open');
    assert.ok(!JSON.stringify(receipt).includes('statements'));
    assert.ok(!JSON.stringify(receipt).includes('secret-env-sentinel'));
});
test('B47 websocket routes are paced like REST routes (routeDelayMs between routes)', async t => {
    const f = await fixture(t, 'bootstrap', { ...SOCKETS(), routeDelayMs: 2500 });
    const client = websocketClient(f.deployment, { readHook: () => null });
    const waits = [];
    await execute(f, client, { sleep: async ms => waits.push([ms, client.calls.at(-1).tool]) });
    const after = waits.filter(([, tool]) => tool === 'aws.apigatewayv2.ensure-websocket-route@1');
    assert.deepEqual(after, Array(3).fill([2500, 'aws.apigatewayv2.ensure-websocket-route@1']));
});
test('B47 websocket code mode updates all three functions and requires the socket function', async t => {
    const f = await fixture(t, 'code', { project: 'chatic-sockets-api', websocket: true });
    const client = websocketClient(f.deployment);
    const result = await execute(f, client);
    assert.equal(result.status, 'completed');
    const functions = client.calls.filter(x => x.tool === 'aws.lambda.ensure-function@1');
    assert.deepEqual(
        functions.map(x => [x.input.component ?? null, x.input.functionName]),
        [null, 'backend', 'socket'].map(k => [k, `chatic-sockets-api-dev-${k ?? 'lambda'}`]),
    );
    const receipt = JSON.parse(await readFile(result.receipt, 'utf8'));
    assert.deepEqual(
        receipt.steps.filter(s => s.name.endsWith('-code')).map(s => s.name),
        ['lambda-code', 'backend-code', 'socket-code'],
    );
    assert.equal(receipt.functions.length, 3);
    assert.ok(!client.calls.some(x => x.tool.startsWith('aws.apigatewayv2.')));
    // no socket function: FUNCTION_MISSING before begin.
    const g = await fixture(t, 'code', { project: 'chatic-sockets-api', websocket: true });
    const missing = websocketClient(g.deployment, {
        readHook: (found, name) => (name.endsWith('-socket') ? null : found),
    });
    const { error } = await failedRun(g, missing, 'FUNCTION_MISSING');
    assert.match(error.message, /three/);
    assert.ok(!missing.calls.some(x => x.tool === 'lemon.deploy.begin@1'));
});
test('B47 a websocket bootstrap stops before begin when resolve-names has no websocketApiName', async t => {
    const f = await fixture(t, 'bootstrap', SOCKETS());
    const client = websocketClient(f.deployment, { readHook: () => null, names: { websocketApiName: undefined } });
    const { receipt } = await failedRun(f, client, 'NAMES_MISSING');
    assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.begin@1'));
    assert.equal(receipt.status, 'failed');
    // code mode does not touch the API, so it does not need the name.
    const g = await fixture(t, 'code', { project: 'chatic-sockets-api', websocket: true });
    const code = websocketClient(g.deployment, { names: { websocketApiName: undefined } });
    assert.equal((await execute(g, code)).status, 'completed');
});
test('B47 a websocket policy whose connection statement or other statements differ stops before the role', async t => {
    for (const change of [
        s =>
            s.map(x =>
                x.Sid === 'OwnWebsocketConnections' ? { ...x, Resource: x.Resource.replace('/dev/', '/*/') } : x,
            ),
        s => s.map(x => (x.Sid === 'OwnWebsocketConnections' ? { ...x, Action: ['execute-api:*'] } : x)),
        s => s.filter(x => x.Sid !== 'OwnWebsocketConnections'),
        s => [{ ...s[0], Action: ['logs:*'] }, ...s.slice(1)],
    ]) {
        const f = await fixture(t, 'bootstrap', SOCKETS());
        let inner;
        const client = websocketClient(f.deployment, {
            readHook: () => null,
            hook: async r => {
                if (r.tool !== 'lemon.deploy.resolve-policy@1' || !r.input.websocketApiId || inner) return undefined;
                inner = true;
                const got = await client.request(r);
                inner = false;
                client.calls.pop();
                return good(r.tool, { statements: change(got.result.output.statements) });
            },
        });
        const { error } = await failedRun(f, client, 'TARGET_MISMATCH');
        assert.ok(error);
        assert.ok(!client.calls.some(x => x.tool === 'lemon.deploy.ensure-role@1'));
    }
});

//* ---- v5 T47-12: REST API endpoint type (`restApi.endpointType`) — adopted sls APIs are EDGE ----
//* v5 T47-12: the example configs of the B47 snapshot, optionally with a `restApi` block.
const restApiConfigs = restApi => [
    ['bootstrap', { ...structuredClone(example), environmentFile: 'env.json', ...(restApi ? { restApi } : {}) }],
    ['code', { ...codeConfig(), ...(restApi ? { restApi } : {}) }],
];
//* v5 T47-12: the plan / calls / receipt digests (and the raw snapshot) of each mode for one `restApi` value.
async function restApiSnapshots(root, restApi) {
    const out = {};
    for (const [mode, raw] of restApiConfigs(restApi)) {
        const d = syntheticDeployment(raw);
        const snap = await runSnapshot(d, path.join(root, `${mode}-${restApi?.endpointType ?? 'none'}`));
        out[mode] = {
            plan: digest(JSON.stringify(deploymentPlan(d), null, 2)),
            calls: digest(snap.calls),
            receipt: digest(snap.receipt),
            snap,
        };
    }
    return out;
}
//* v5 T47-12: the `ensure-rest-api@1` inputs of a snapshot's calls.
const restApiInputs = snap =>
    JSON.parse(snap.calls)
        .filter(r => r.tool === 'aws.apigateway.ensure-rest-api@1')
        .map(r => r.input);
test('T47-12 no restApi keeps plan, tool calls and receipt byte-identical; explicit REGIONAL keeps calls and receipt', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'templates-deploy-t4712-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const none = await restApiSnapshots(root);
    // the three digests of each mode (the raw snapshot left out).
    const strip = o =>
        Object.fromEntries(
            Object.entries(o).map(([m, d]) => [m, { plan: d.plan, calls: d.calls, receipt: d.receipt }]),
        );
    // (a) the pre-B47 digests (`origin/develop` 770f33f0), so also the 5.0.26 bytes: no key, nothing changes.
    assert.deepEqual(strip(none), PRE_B47_DIGESTS);
    const noneInputs = restApiInputs(none.bootstrap.snap);
    assert.equal(noneInputs.length, 1);
    assert.equal(noneInputs[0].endpointType, 'REGIONAL');
    assert.ok(!JSON.stringify(deploymentPlan(syntheticDeployment(restApiConfigs()[0][1]))).includes('restApi'));
    // `REGIONAL` written out: the same calls; the receipt differs only by the plan it embeds (which names the block).
    const regional = await restApiSnapshots(root, { endpointType: 'REGIONAL' });
    const withoutPlan = snap => {
        const receipt = JSON.parse(snap.receipt);
        delete receipt.plan;
        return receipt;
    };
    for (const mode of ['bootstrap', 'code']) {
        assert.equal(regional[mode].calls, none[mode].calls, mode);
        assert.deepEqual(withoutPlan(regional[mode].snap), withoutPlan(none[mode].snap), mode);
    }
    assert.deepEqual(JSON.parse(regional.bootstrap.snap.receipt).plan.configuration.restApi, {
        endpointType: 'REGIONAL',
    });
    // code mode never calls the REST API tool, so its plan and receipt are unchanged too.
    assert.equal(regional.code.plan, none.code.plan);
    assert.equal(regional.code.receipt, none.code.receipt);
    assert.notEqual(regional.bootstrap.plan, none.bootstrap.plan);
});
test('T47-12 restApi.endpointType EDGE reaches the plan and the ensure-rest-api input; code mode ignores it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'templates-deploy-t4712-'));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const none = await restApiSnapshots(root);
    const edge = await restApiSnapshots(root, { endpointType: 'EDGE' });
    // (b) the one REST API call carries `EDGE`; every other call is the same as without the block.
    const [input] = restApiInputs(edge.bootstrap.snap);
    assert.equal(input.endpointType, 'EDGE');
    assert.deepEqual({ ...input, endpointType: 'REGIONAL' }, restApiInputs(none.bootstrap.snap)[0]);
    const others = snap => JSON.parse(snap.calls).filter(r => r.tool !== 'aws.apigateway.ensure-rest-api@1');
    assert.deepEqual(others(edge.bootstrap.snap), others(none.bootstrap.snap));
    // the plan: `configuration.restApi` and the REST step name the type.
    const p = deploymentPlan(syntheticDeployment(restApiConfigs({ endpointType: 'EDGE' })[0][1]));
    assert.deepEqual(p.configuration.restApi, { endpointType: 'EDGE' });
    assert.ok(p.steps.includes('REST API (EDGE) / 18 sequential routes / stage probe'));
    // code mode: plan, calls and receipt as without the block (no REST API tool).
    for (const k of ['plan', 'calls', 'receipt']) assert.equal(edge.code[k], none.code[k], k);
    assert.deepEqual(restApiInputs(edge.code.snap), []);
    // PRIVATE is passed the same way.
    const priv = validateConfig({ ...restApiConfigs()[0][1], restApi: { endpointType: 'PRIVATE' } });
    assert.deepEqual(priv.restApi, { endpointType: 'PRIVATE' });
});
test('T47-12 a malformed restApi block is INVALID_INPUT in both modes', () => {
    for (const restApi of [
        null,
        'EDGE',
        [],
        {},
        { endpointType: 'edge' },
        { endpointType: '' },
        { endpointType: 'GLOBAL' },
        { endpointType: ['EDGE'] },
        { endpointType: 'EDGE', policy: '*' },
    ])
        for (const [mode, raw] of restApiConfigs())
            assert.throws(
                () => validateConfig({ ...raw, restApi }),
                { code: 'INVALID_INPUT', message: /restApi/ },
                `${mode} ${JSON.stringify(restApi)}`,
            );
});
