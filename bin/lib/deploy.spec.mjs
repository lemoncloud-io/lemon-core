/**
 * `bin/lib/deploy.spec.mjs` (lemon-core)
 * - offline tests of deploy-plan / deploy-runner / deploy-client / deploy-credentials / deploy-receipt (`lemon-lambda-deploy`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/deploy.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHmac, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import { writeZip, sha256 } from './pack-zip.mjs';
import { loadDeployment, validateConfig, deploymentPlan, DeployError } from './deploy-plan.mjs';
import { runDeployment } from './deploy-runner.mjs';
import { createDeployClient } from './deploy-client.mjs';
import { main, parseDeployArgs } from '../lemon-lambda-deploy.mjs';

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
async function fixture(t, mode = 'code') {
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
    const config = mode === 'bootstrap' ? { ...structuredClone(example), environmentFile: 'env.json' } : codeConfig();
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
