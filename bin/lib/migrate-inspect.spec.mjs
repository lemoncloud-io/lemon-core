/**
 * `bin/lib/migrate-inspect.spec.mjs` (lemon-core)
 * - offline tests of the B27 follow-up commands of `lemon-lambda-migrate` (`inspect`, `reconcile`, `resolve`).
 * - the compat section holds values captured on `v5` @ 68b05490 (5.0.17, before B27): the existing phases stay
 *   byte-identical.
 * - v5 B28: the locks keep their templates / hello values; the eureka-hello entry is compared to hello by name.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`). Temp dirs under `os.tmpdir()`; fake `aws` CLI; no AWS, no network.
 */
//* v5 B27: compat lock first (only APIs that existed before B27), command cases after.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, symlink, chmod, stat, lstat, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './migrate-test-fixture.mjs';
import { TARGETS, PHASES, executeMigration, verifyMigrationReceipt, validateMigrationConfig } from './migrate-core.mjs';
import { READS, STALE_AFTER_MS, KINDS, verifyDiff, awsFailure, envCategories } from './migrate-inspect.mjs';
import { main as migrateMain } from '../lemon-lambda-migrate.mjs';

//* v5 B27: the full-phase cases run six phases per target.
vi.setConfig({ testTimeout: 60_000 });

// sha256 hex of a string.
const sha = text => createHash('sha256').update(text).digest('hex');
// the pinned revision of both reviewed targets (captured value, not read from the code under test).
const PINNED = '66d1e91a60a240765d44dedfdab73a92af6abd51';
// a migration config with every optional key (synthetic installation values only).
const fullConfig = target => ({
    schemaVersion: 1,
    project: target.project,
    stage: target.stage,
    stack: target.stack,
    migrationRepo: 'canonical',
    migrationRevision: PINNED,
    region: 'ap-northeast-2',
    account: '234567890123',
    profile: 'local-fixture',
    endpoint: 'https://localfixture.execute-api.ap-northeast-2.amazonaws.com/dev/',
    artifactBucket: '234567890123-deploy-artifacts',
    runtime: 'nodejs24.x',
    kmsDecryptKeyArn: 'arn:aws:kms:ap-northeast-2:234567890123:key/decrypt-fixture',
    kmsEncryptKeyArn: 'arn:aws:kms:ap-northeast-2:234567890123:key/encrypt-fixture',
    timeoutMs: 5000,
});
// run the CLI `main` and collect stdout / stderr lines and the exit code.
async function cli(argv, deps = {}) {
    const out = [],
        err = [];
    const code = await migrateMain(argv, { ...deps, stdout: s => out.push(s), stderr: s => err.push(s) });
    return { code, out, err };
}
// mask the volatile parts (node path, temp root) of a CLI output line.
const mask = (text, root) => text.replaceAll(process.execPath, '<node>').replaceAll(root, '<root>');

//* ---- compat lock: values captured on v5 @ 68b05490 before B27 ----

// sha256 of the general `--help` stdout.
const GOLDEN_HELP = 'c7fb0872a11102cf3383048ee5afd902a3ed9e0c1e517fcab243469984da0126';
// sha256 of the six CLI offline plan stdouts per reviewed target (checkout root stubbed, node path masked).
const GOLDEN_CLI_PLANS = {
    'lemon-templates-api': '0af6a1264a7ef0b5f7a4bfd726167024f3161981ed4140017ff0248d89417cd1',
    'lemon-hello-api': 'b5ca05cfe7de9e53d5e166fc9949af9bcac1cc71a41de01a515a8bbf309e6a7a',
};
// sha256 of the stderr lines and exit codes of the existing argument errors.
const GOLDEN_ARG_ERRORS = '18464baa36685d23db859faf3d93c5b3a353a9a613e7d867de8a5d41291544c0';
// sha256 of the CLI `--execute` stdouts of the six phases and of the masked final receipt, per reviewed target.
const GOLDEN_EXECUTE = {
    'lemon-templates-api': '5847a7b45edd8473ee2cae145dcf2ec98a5de182a3d2397f72da69acf411e109',
    'lemon-hello-api': '1351c3b889e35573259be6d564e4650678d10b560efe3384da577719a3d90409',
};
//* v5 B28: the locks cover the targets captured before B27 (templates, hello); eureka-hello is compared to hello.
const lockedTargets = golden => TARGETS.filter(t => Object.hasOwn(golden, t.project));
// v5 B28: the one intended change of the general help: the reviewed target list ends with the eureka-hello stack.
const B28_HELP_TARGET = ', eureka-hello-api-dev.';

// the masked stdout of the six CLI offline plans of `target` (checkout root stubbed), one text.
async function cliPlanText(t, target) {
    const f = await fixture(t, { target });
    await writeFile(f.configFile, JSON.stringify(fullConfig(target)));
    const lines = [];
    for (const phase of PHASES) {
        const { code, out, err } = await cli([phase, '--config', f.configFile], {
            validateRepository: async () => '/fixture/canonical',
        });
        assert.deepEqual([code, err], [0, []]);
        lines.push(...out.map(s => mask(s, f.root)));
    }
    return lines.join('\n');
}
// the masked stdout of the six CLI `--execute` phases of `target`, its masked final receipt and run dir, one text.
async function cliExecuteText(t, target) {
    const f = await fixture(t, { target });
    const lines = [];
    for (const phase of PHASES) {
        const extra =
            phase === 'plan'
                ? ['--allow-sensitive-backup']
                : phase === 'remove'
                ? ['--confirm-stack', target.stack]
                : [];
        const { code, out, err } = await cli([phase, '--config', f.configFile, '--execute', ...extra], f.deps);
        assert.deepEqual([code, err], [0, []]);
        // the elapsed time is the only volatile value of the result.
        lines.push(...out.map(s => mask(s, f.root).replace(/"elapsedMs": [0-9.e+-]+/, '"elapsedMs": 0')));
    }
    const envelope = JSON.parse(await readFile(path.join(f.run, target.receiptFile), 'utf8'));
    const p = envelope.payload;
    // mask the run id, the temp-path fingerprint and the step times; everything else must be equal.
    const masked = {
        ...p,
        ownerId: '<id>',
        fingerprint: '<fingerprint>',
        config: { ...p.config, migrationRepo: '<repo>' },
        steps: p.steps.map(s => ({ ...s, startedAt: '<t>', finishedAt: '<t>', elapsedMs: 0 })),
    };
    lines.push(JSON.stringify(masked), JSON.stringify(Object.keys(envelope)));
    lines.push(JSON.stringify((await readdir(f.run)).sort()));
    return lines.join('\n');
}

test('B27 compat: the general --help output is byte-identical (B28: plus the eureka-hello target)', async () => {
    const { code, out, err } = await cli(['--help']);
    assert.deepEqual([code, err], [0, []]);
    const text = out.join('\n');
    // the B28 entry appears once, at the end of the target list; without it the help is the captured one.
    assert.equal(text.split(B28_HELP_TARGET).length, 2, text);
    assert.equal(sha(text.replace(B28_HELP_TARGET, '.')), GOLDEN_HELP, sha(text));
});
test('B27 compat: the offline plan output of every phase is byte-identical for both targets', async t => {
    const got = {};
    for (const target of lockedTargets(GOLDEN_CLI_PLANS)) got[target.project] = sha(await cliPlanText(t, target));
    assert.deepEqual(got, GOLDEN_CLI_PLANS, JSON.stringify(got));
});
test('B27 compat: the existing argument errors keep their output and exit codes', async t => {
    const f = await fixture(t);
    const lines = [];
    for (const argv of [
        [],
        ['plan'],
        ['--config', f.configFile],
        ['plan', '--config', f.configFile, '--bogus'],
        ['plan', '--config', f.configFile, '--config', f.configFile],
        ['verify', '--config', f.configFile, '--allow-sensitive-backup'],
        ['plan', '--config', f.configFile, '--confirm-stack', f.config.stack],
        ['plan', '--config'],
        ['--config', f.configFile, 'inspection'],
        ['plan', 'inspect', '--config', f.configFile],
    ]) {
        const { code, out, err } = await cli(argv, f.deps);
        assert.deepEqual(out, []);
        lines.push(`${code} ${err.join('|')}`);
    }
    assert.equal(sha(lines.join('\n')), GOLDEN_ARG_ERRORS, sha(lines.join('\n')));
});
test('B27 compat: the six --execute outputs and the final receipt are byte-identical for both targets', async t => {
    const got = {};
    for (const target of lockedTargets(GOLDEN_EXECUTE)) got[target.project] = sha(await cliExecuteText(t, target));
    assert.deepEqual(got, GOLDEN_EXECUTE, JSON.stringify(got));
});
//* v5 B28: eureka-hello has the generic state names of hello, so its outputs are hello's with the project renamed.
test('B28 compat: the eureka-hello plan and --execute outputs are the hello ones with the project renamed', async t => {
    const eureka = TARGETS.find(x => x.project === 'eureka-hello-api');
    const hello = TARGETS.find(x => x.project === 'lemon-hello-api');
    // rename eureka-hello to hello; the rename is one-to-one (the eureka-hello text never names hello itself).
    const renamed = text => {
        assert.ok(text.includes('eureka-hello-api-dev') && !text.includes('lemon-hello-api'));
        return text.replaceAll('eureka-hello-api', 'lemon-hello-api');
    };
    // the offline plans equal the captured hello plans.
    assert.equal(sha(renamed(await cliPlanText(t, eureka))), GOLDEN_CLI_PLANS['lemon-hello-api']);
    // the receipt's snapshot digests hash files that hold the project name, so only they are masked.
    const digests = text => text.replace(/"((?:after|before|env|plan)\.json)":"[0-9a-f]{64}"/g, '"$1":"<sha>"');
    const helloText = await cliExecuteText(t, hello);
    assert.equal(sha(helloText), GOLDEN_EXECUTE['lemon-hello-api']);
    const eurekaText = renamed(await cliExecuteText(t, eureka));
    assert.notEqual(digests(helloText), helloText);
    assert.equal(digests(eurekaText), digests(helloText));
});

//* ---- B27 fixtures: a migrated run, a fake read-only `aws` CLI, and the guards every command case checks ----

// the hello entry (generic state names) and the synthetic installation values of the fixture.
const HELLO = TARGETS.find(t => t.project === 'lemon-hello-api');
const ACCOUNT = '234567890123';
const REGION = 'ap-northeast-2';
// env value markers: a plain secret and a KMS ciphertext; neither may reach a record or an output.
const SECRET = 'never-print-this-secret-value';
const CIPHER = '*AQICAHfixtureciphertextmarker';
// a credential marker in the parent environment; the scrubbed child environment must not carry it.
const KEY_MARKER = 'AKIAFIXTUREKEYMARKER';
// retained resources of the enriched snapshot (synthetic names).
const TABLE = 'fixture-table';
const QUEUE = 'fixture-queue';
const TOPIC = `arn:aws:sns:${REGION}:${ACCOUNT}:fixture-topic`;
const BUCKET = 'fixture-web-bucket';
const STREAM = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}/stream/2026-01-01T00:00:00.000`;
const QUEUE_URL = `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/${QUEUE}`;
// the deterministic tool revision recorded in the control records of the cases.
const TOOL = Object.freeze({ name: 'lemon-core', version: '0.0.0-fixture', gitSha: null });
// the two functions of a stack.
const fnNames = t => [`${t.stack}-lambda`, `${t.stack}-backend`];
// the two function log groups of a stack.
const logGroups = t => fnNames(t).map(n => `/aws/lambda/${n}`);
// the base64 Lambda CodeSha256 of a hex sha256.
const b64 = hex => Buffer.from(hex, 'hex').toString('base64');

// read a JSON file of the run.
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
// write a JSON file of the run (keeps the existing 0600 mode).
const writeJson = (file, value) => writeFile(file, JSON.stringify(value), { mode: 0o600 });

// enrich the fixture plan snapshot with retained resources and a KMS env key (inside the canonical `plan` child).
async function enrichSnapshot(f) {
    const plan = await readJson(path.join(f.run, 'plan.json'));
    const env = await readJson(path.join(f.run, 'env.json'));
    const before = await readJson(path.join(f.run, 'before.json'));
    for (const fn of Object.keys(env)) {
        env[fn].KMS_VALUE = CIPHER;
        before.functions[fn].envKeys = Object.keys(env[fn]).sort();
    }
    plan.keep = {
        logical: ['Table', 'Queue', 'Topic', 'Bucket', 'LambdaLog', 'BackendLog', 'Api'],
        tables: [TABLE],
        queues: [QUEUE],
        topics: [TOPIC],
        buckets: [BUCKET],
        logGroups: logGroups(f.target),
    };
    plan.tableProps = { [TABLE]: { KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] } };
    before.tables = { [TABLE]: { created: '2026-01-01T09:00:00.000000+09:00', items: 3, stream: STREAM } };
    before.queues = { [QUEUE]: { url: QUEUE_URL, created: '1767225600', messages: '0' } };
    before.topics = { [TOPIC]: { subscriptions: 1 } };
    before.buckets = {
        [BUCKET]: { created: '2026-01-01T00:00:00+00:00', objects: 2, website: true, policySids: ['PublicRead'] },
    };
    before.logGroups = Object.fromEntries(logGroups(f.target).map(g => [g, { created: 1767225600000, retention: 7 }]));
    await writeJson(path.join(f.run, 'plan.json'), plan);
    await writeJson(path.join(f.run, 'env.json'), env);
    await writeJson(path.join(f.run, 'before.json'), before);
}

/**
 * a migrated run of `target`: the six phases with the enriched snapshot. `verify` is all same (receipt
 * `completed`), or with `unknownVerify` the log retention DIFF 7 -> 14 (receipt `unknown`, lock kept: the hello case).
 */
async function migratedRun(t, { target = HELLO, unknownVerify = false, phases = PHASES, runtime } = {}) {
    const f = await fixture(t, { target });
    // an explicit runtime override is part of the config (and of the receipt fingerprint).
    if (runtime) {
        f.raw.runtime = runtime;
        await writeFile(f.configFile, JSON.stringify(f.raw));
        f.config = validateMigrationConfig(f.raw, f.configFile);
    }
    const child = f.deps.runChild;
    f.deps.runChild = async r => {
        const out = await child(r);
        if (r.mode === 'migration' && r.args[0] === 'plan') await enrichSnapshot(f);
        if (r.mode === 'migration' && r.args[0] === 'verify' && unknownVerify) {
            const after = await readJson(path.join(f.run, 'after.json'));
            for (const g of logGroups(target)) after.logGroups[g].retention = 14;
            await writeJson(path.join(f.run, 'after.json'), after);
            return { code: 2, reason: 'failed', diagnostic: { kind: 'process' } };
        }
        return out;
    };
    for (const phase of phases) {
        const run = executeMigration(
            f.config,
            phase,
            { allowSensitiveBackup: true, confirmStack: target.stack },
            f.deps,
        );
        if (phase === 'verify' && unknownVerify) await assert.rejects(run, e => e.exitCode === 3);
        else await run;
    }
    return f;
}

// a live world equal to the run baseline (after.json, else before.json) and the env backup: every axis the same.
async function worldOf(f) {
    const file = (await lstat(path.join(f.run, 'after.json')).catch(() => null)) ? 'after.json' : 'before.json';
    const base = await readJson(path.join(f.run, file));
    const env = await readJson(path.join(f.run, 'env.json'));
    const functions = {};
    for (const fn of fnNames(f.target)) {
        const b = base.functions[fn];
        functions[fn] = {
            config: {
                FunctionArn: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${fn}`,
                Runtime: b.runtime,
                Architectures: ['x86_64'],
                Handler: b.handler,
                MemorySize: b.memory,
                Timeout: b.timeout,
                CodeSha256: b.codeSha,
                LastModified: '2026-10-31T00:00:00.000+0000',
                Role: `arn:aws:iam::${ACCOUNT}:role/fixture-role`,
                State: 'Active',
                LastUpdateStatus: 'Successful',
                Environment: { Variables: { ...env[fn] } },
            },
            tags: {
                'deploy-managed': 'true',
                'deploy-tool': 'aws.lambda.ensure-function@1',
                'deploy-project': 'hello',
                owner: 'not-recorded',
            },
            esm: fn.endsWith('-backend')
                ? [
                      {
                          UUID: 'esm-2',
                          EventSourceArn: STREAM,
                          State: 'Enabled',
                          BatchSize: 1,
                          StartingPosition: 'LATEST',
                          FunctionArn: 'x',
                      },
                      {
                          UUID: 'esm-1',
                          EventSourceArn: `arn:aws:sqs:${REGION}:${ACCOUNT}:${QUEUE}`,
                          State: 'Enabled',
                          BatchSize: 1,
                      },
                  ]
                : [],
        };
    }
    return {
        stack: { absent: true },
        functions,
        tables: base.tables,
        queues: base.queues,
        topics: base.topics,
        buckets: base.buckets,
        logGroups: base.logGroups,
        api: base.api,
        owners: {},
        fail: {},
    };
}

// an AWS CLI failure as `execFile` rejects it (the stderr holds an ARN and the account: it must never leak).
const awsError = (code, op, message = `User: arn:aws:iam::${ACCOUNT}:user/fixture is not authorized`) =>
    Object.assign(new Error('Command failed: aws'), {
        code: 254,
        stderr: `\nAn error occurred (${code}) when calling the ${op} operation: ${message}\n`,
    });
// a killed child (execFile `timeout`).
const killed = () => Object.assign(new Error('Command failed: aws'), { killed: true, signal: 'SIGTERM', code: null });
// a successful CLI JSON stdout.
const ok = value => ({ stdout: JSON.stringify(value) + '\n', stderr: '' });
// the value of a CLI flag in an argv.
const flag = (args, name) => args[args.indexOf(name) + 1];
// the CLI tail every read must carry (explicit profile/region, JSON, no pager).
const TAIL = ['--profile', 'local-fixture', '--region', REGION, '--output', 'json', '--no-cli-pager'];

/** a fake `aws` CLI over a world; records every call (spy 1: target-resource calls). `world.fail[op]` injects. */
function fakeAws(world, calls) {
    return async (file, args, options) => {
        calls.push({ file, args, env: options?.env, timeout: options?.timeout });
        assert.equal(file, 'aws');
        assert.deepEqual(args.slice(-TAIL.length), TAIL);
        const op = `${args[0]} ${args[1]}`;
        const injected = world.fail[op];
        if (typeof injected === 'function') {
            const r = injected(args);
            if (r) throw r;
        } else if (injected) throw injected;
        // the function name of a function ARN.
        const fnOf = arn => arnName(arn);
        switch (op) {
            case 'cloudformation describe-stacks': {
                const name = flag(args, '--stack-name');
                if (name.startsWith('arn:'))
                    return ok({ Stacks: [{ StackStatus: world.stackStatuses?.[name] ?? 'DELETE_COMPLETE' }] });
                if (world.stack.absent)
                    throw awsError('ValidationError', 'DescribeStacks', `Stack with id ${name} does not exist`);
                return ok({ Stacks: [{ StackName: name, StackStatus: world.stack.status }] });
            }
            case 'cloudformation describe-stack-resources': {
                const id = flag(args, '--physical-resource-id');
                const o = world.owners[id];
                if (!o) throw awsError('ValidationError', 'DescribeStackResources', `Stack for ${id} does not exist`);
                return ok({
                    StackResources: [{ StackId: o, PhysicalResourceId: id, ResourceStatus: 'DELETE_SKIPPED' }],
                });
            }
            case 'lambda get-function-configuration': {
                const fn = world.functions[flag(args, '--function-name')];
                if (!fn) throw awsError('ResourceNotFoundException', 'GetFunctionConfiguration', 'Function not found');
                return ok(fn.config);
            }
            case 'lambda list-tags':
                return ok({ Tags: world.functions[fnOf(flag(args, '--resource'))].tags });
            case 'lambda list-event-source-mappings':
                return ok({ EventSourceMappings: world.functions[flag(args, '--function-name')].esm });
            case 'dynamodb describe-table': {
                const name = flag(args, '--table-name'),
                    t = world.tables[name];
                if (!t) throw awsError('ResourceNotFoundException', 'DescribeTable', 'Requested resource not found');
                return ok({
                    Table: {
                        TableName: name,
                        TableArn: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${name}`,
                        TableId: 'fixture-table-id',
                        CreationDateTime: world.tableCreated ?? '2026-01-01T00:00:00+00:00',
                        KeySchema: world.keySchema ?? [{ AttributeName: 'id', KeyType: 'HASH' }],
                        LatestStreamArn: t.stream,
                        ItemCount: t.items + 40,
                    },
                });
            }
            case 'sqs get-queue-url':
                return ok({ QueueUrl: world.queues[flag(args, '--queue-name')].url });
            case 'sqs get-queue-attributes': {
                const q = Object.values(world.queues).find(x => x.url === flag(args, '--queue-url'));
                return ok({ Attributes: { CreatedTimestamp: q.created, ApproximateNumberOfMessages: '9' } });
            }
            case 'sns get-topic-attributes':
                return ok({
                    Attributes: {
                        SubscriptionsConfirmed: String(world.topics[flag(args, '--topic-arn')].subscriptions),
                        SubscriptionsPending: '0',
                    },
                });
            case 'sns list-subscriptions-by-topic':
                return ok({
                    Subscriptions: [
                        {
                            Protocol: 'lambda',
                            Endpoint: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${fnNames(HELLO)[1]}`,
                            SubscriptionArn: 'x',
                        },
                    ],
                });
            case 's3api head-bucket':
                if (!world.buckets[flag(args, '--bucket')]) throw awsError('404', 'HeadBucket', 'Not Found');
                return ok({ BucketRegion: REGION });
            case 's3api list-buckets': {
                // the CLI applies `--query Buckets[?Name=='<b>']`: only that bucket reaches the tool.
                const name = /Name=='([^']+)'/.exec(flag(args, '--query'))[1];
                return ok([{ Name: name, CreationDate: world.buckets[name].created }]);
            }
            case 's3api list-objects-v2':
                assert.equal(flag(args, '--query'), 'KeyCount');
                return ok(world.buckets[flag(args, '--bucket')].objects);
            case 's3api get-bucket-website':
                if (!world.buckets[flag(args, '--bucket')].website)
                    throw awsError('NoSuchWebsiteConfiguration', 'GetBucketWebsite', 'none');
                return ok({ IndexDocument: { Suffix: 'index.html' } });
            case 's3api get-bucket-policy':
                return ok({
                    Policy: JSON.stringify({
                        Statement: world.buckets[flag(args, '--bucket')].policySids.map(Sid => ({ Sid })),
                    }),
                });
            case 'logs describe-log-groups': {
                const prefix = flag(args, '--log-group-name-prefix');
                return ok({
                    logGroups: Object.entries(world.logGroups)
                        .filter(([g]) => g.startsWith(prefix))
                        .map(([g, v]) => ({ logGroupName: g, creationTime: v.created, retentionInDays: v.retention })),
                });
            }
            case 'apigateway get-resources':
                if (!world.api) throw awsError('NotFoundException', 'GetResources', 'Invalid API identifier');
                return ok({
                    items: world.api.routes.map(r => {
                        const [m, p, auth] = r.split(' ');
                        return { id: p, path: p, resourceMethods: { [m]: { authorizationType: auth } } };
                    }),
                });
            case 'apigateway get-stages':
                return ok({ item: world.api.stages.map(stageName => ({ stageName })) });
            case 'sns list-subscriptions': {
                // the CLI applies `--query Subscriptions[?Endpoint=='<arn>' || ...]`: only those entries reach the tool.
                const endpoints = [...flag(args, '--query').matchAll(/Endpoint=='([^']+)'/g)].map(m => m[1]);
                return ok((world.subscriptions ?? []).filter(x => endpoints.includes(x.Endpoint)));
            }
            case 'resourcegroupstaggingapi get-resources':
                assert.deepEqual(args.slice(2, 5), [
                    '--tag-filters',
                    'Key=deploy-managed,Values=true',
                    `Key=deploy-project,Values=${world.projectTag}`,
                ]);
                assert.equal(flag(args, '--resource-type-filters'), 'dynamodb:table');
                return ok({
                    ResourceTagMappingList: (world.tagged ?? []).map(x => ({
                        ResourceARN: x.arn,
                        Tags: [
                            { Key: 'deploy-managed', Value: 'true' },
                            { Key: 'deploy-project', Value: x.project ?? world.projectTag },
                        ],
                    })),
                });
            case 'apigateway get-rest-api':
                return ok({ id: flag(args, '--rest-api-id'), name: world.apis[flag(args, '--rest-api-id')].name });
            case 'lambda get-event-source-mapping':
                return ok({ UUID: flag(args, '--uuid'), FunctionArn: world.esmFunctions[flag(args, '--uuid')] });
            default:
                throw new Error(`unexpected aws call: ${op}`);
        }
    };
}
// the last `:`/`/` segment of an ARN.
const arnName = arn => `${arn}`.split(/[:/]/).pop();

// the reviewed read-only operations (from `READS`) and the mutating verbs no call may use.
const ALLOWED = new Set(Object.values(READS).map(([s, o]) => `${s} ${o}`));
const WRITE_VERB =
    /^(create|update|delete|put|tag|untag|remove|add|set|invoke|publish|subscribe|send|start|stop|attach|detach|enable|disable|associate|import|execute|deploy|upload)/;

// sha256 of every protected file of the run (missing -> null): receipt, owner, lock and the snapshots.
async function protectedHashes(f) {
    const out = {};
    for (const name of [
        f.target.receiptFile,
        f.target.ownerFile,
        f.target.lockFile,
        'plan.json',
        'env.json',
        'before.json',
        'after.json',
    ]) {
        const bytes = await readFile(path.join(f.run, name)).catch(() => null);
        out[name] = bytes ? sha(bytes) : null;
    }
    return out;
}

/**
 * run one follow-up command through the CLI `main` with the fake `aws`, a fetch spy, a control-write spy (spy 2)
 * and the guards: protected files byte-identical, read-only calls only, writes under the record dirs only, no
 * value / ARN / account / credential on stdout or stderr.
 */
async function cmd(f, argv, { world, now, http } = {}) {
    const before = await protectedHashes(f);
    const out = [],
        err = [],
        writes = [],
        files = [],
        aws = [],
        probes = [];
    const stsBefore = f.calls.length;
    const code = await migrateMain(argv, {
        ...f.deps,
        exec: world ? fakeAws(world, aws) : async () => assert.fail('no AWS call expected'),
        fetch: async (url, options) => {
            probes.push({ url, method: options.method, redirect: options.redirect });
            return { status: http?.[new URL(url).pathname.replace(/^\/dev/, '')] ?? 200, body: null };
        },
        now: now ? () => new Date(now) : undefined,
        onControlWrite: (rel, file) => {
            writes.push(rel);
            files.push(file);
        },
        toolRevision: async () => TOOL,
        environment: { ...process.env, AWS_ACCESS_KEY_ID: KEY_MARKER, AWS_SECRET_ACCESS_KEY: KEY_MARKER },
        stdout: s => out.push(s),
        stderr: s => err.push(s),
    });
    // amendment 12: receipt, owner, lock and every snapshot file are byte-identical after the command.
    assert.deepEqual(await protectedHashes(f), before);
    // spy 1: only reviewed Describe/Get/List calls; no write verb, no code download, no invoke.
    for (const c of aws) {
        const op = `${c.args[0]} ${c.args[1]}`;
        assert.ok(ALLOWED.has(op), op);
        assert.ok(!WRITE_VERB.test(c.args[1]), op);
        assert.ok(!['lambda get-function', 'lambda invoke'].includes(op), op);
        assert.equal(c.env.AWS_ACCESS_KEY_ID, undefined);
        assert.equal(c.env.AWS_PROFILE, 'local-fixture');
    }
    // the STS check is the only private child; no canonical migration child runs.
    assert.ok(f.calls.slice(stsBefore).every(c => c.mode === 'sts'));
    // spy 2: control records only, under the record dirs of the run or of its `.observed` sibling.
    for (const w of writes)
        assert.match(w, /^((inspections|resolutions)\/\d{8}T\d{9}Z(\.reconcile-\d{8}T\d{9}Z)?\.json|baseline\.json)$/);
    for (const file of files)
        assert.ok(file.startsWith(f.run + path.sep) || file.startsWith(`${f.run}.observed${path.sep}`), file);
    for (const s of [...out, ...err])
        for (const marker of [SECRET, CIPHER, KEY_MARKER, ACCOUNT, 'arn:', '<arn>', '<account>', 'https://sqs'])
            assert.ok(!s.includes(marker), `output holds ${marker}`);
    return {
        code,
        out,
        err,
        json: out.length ? JSON.parse(out.join('\n')) : undefined,
        error: err.length ? JSON.parse(err[0]) : undefined,
        writes,
        aws,
        probes,
    };
}
// the private record files must never hold an env value or the credential marker.
async function assertNoValues(file) {
    const text = await readFile(file, 'utf8');
    for (const marker of [SECRET, CIPHER, KEY_MARKER]) assert.ok(!text.includes(marker), `${file} holds ${marker}`);
    const st = await stat(file);
    assert.equal(st.mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    return JSON.parse(text).payload;
}
// `inspect --execute` on a world; returns the run result and the inventory payload.
async function inspected(f, world, extra = [], options = {}) {
    const r = await cmd(f, ['inspect', '--config', f.configFile, '--execute', ...extra], { world, ...options });
    return { ...r, inventory: r.json?.inventory ? await assertNoValues(r.json.inventory) : undefined };
}
// a completed deploy receipt of `project` for `hex` in a private `.artifacts/deploy/run-*` of the fixture root.
async function deployReceipt(f, { hex, project = f.config.project, patch = r => r } = {}) {
    const dir = path.join(f.root, 'service', '.artifacts', 'deploy', `run-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    // the function ARN of a name.
    const arn = n => `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${n}`;
    const [lambda, backend] = [`${project}-dev-lambda`, `${project}-dev-backend`];
    const receipt = {
        schemaVersion: 1,
        startedAt: '2026-10-31T00:00:00.000Z',
        status: 'completed',
        plan: {
            schemaVersion: 1,
            mode: 'code',
            execution: 'offline-plan',
            target: { project, stage: 'dev', account: ACCOUNT, region: REGION, endpoint: f.config.endpoint },
            artifact: { sha256: hex, bytes: 10, bucket: f.config.artifactBucket, key: `${project}/dev/${hex}.zip` },
        },
        steps: [
            { name: 'lambda-code', status: 'succeeded', verified: true, output: { functionArn: arn(lambda) } },
            { name: 'backend-code', status: 'succeeded', verified: true, output: { functionArn: arn(backend) } },
            { name: 'end', status: 'succeeded', verified: true, output: {} },
        ],
        verification: 'server aggregate only',
        deployId: 'dpl_fixture_000001',
        functions: [{ functionArn: arn(lambda) }, { functionArn: arn(backend) }],
        manifestVersionId: 'fixture-version',
        finishedAt: '2026-10-31T00:01:00.000Z',
    };
    const file = path.join(dir, 'receipt.json');
    await writeFile(file, JSON.stringify(patch(receipt)), { mode: 0o600 });
    return file;
}

//* ---- B27 inspect ----

test('B27 inspect: the offline plan lists the read APIs from the baseline and calls nothing', async t => {
    const f = await migratedRun(t);
    const r = await cmd(f, ['inspect', '--config', f.configFile]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.writes, []);
    assert.equal(r.probes.length, 0);
    assert.equal(f.calls.filter(c => c.mode === 'sts').length, 6);
    assert.deepEqual(
        [r.json.execution, r.json.runState, r.json.runReceipt, r.json.baseline],
        ['offline-plan', 'owned', 'completed', 'after.json'],
    );
    const calls = Object.fromEntries(r.json.reads.map(x => [x.api, x.calls]));
    assert.equal(calls['lambda:GetFunctionConfiguration'], 2);
    assert.equal(calls['dynamodb:DescribeTable'], 1);
    assert.equal(calls['logs:DescribeLogGroups'], 2);
    assert.equal(calls['cloudformation:DescribeStackResources (owner of each retained resource)'], 7);
    assert.deepEqual(r.json.httpProbes, { mode: 'off' });
    assert.equal(calls['https:GET (public probe, app call)'], undefined);
    const probe = await cmd(f, ['inspect', '--config', f.configFile, '--http-probe']);
    assert.deepEqual(probe.json.httpProbes, { mode: 'on', appCall: true, paths: 1 });
    // no run state: the plan says so; `--execute` stops before STS.
    const g = await fixture(t, { target: HELLO });
    const none = await cmd(g, ['inspect', '--config', g.configFile]);
    assert.deepEqual([none.code, none.json.runState, none.json.baseline], [0, 'absent', 'none']);
    const refused = await cmd(g, ['inspect', '--config', g.configFile, '--execute'], { world: { fail: {} } });
    assert.deepEqual(
        [refused.code, refused.error.code, refused.aws.length, g.calls.length],
        [1, 'RUN_STATE_MISSING', 0, 0],
    );
    // the run dir was not created (a later `plan` phase still starts fresh).
    assert.equal(await lstat(g.run).catch(() => null), null);
});

//* v5 B28: the eureka-hello entry is accepted by the offline `inspect` plans (with run state, and `--discover`).
test('B28 inspect: the offline plan accepts the eureka-hello target, with run state and with --discover', async t => {
    const eureka = TARGETS.find(x => x.project === 'eureka-hello-api');
    const f = await migratedRun(t, { target: eureka });
    const r = await cmd(f, ['inspect', '--config', f.configFile]);
    assert.deepEqual([r.code, r.err, r.writes, r.probes.length], [0, [], [], 0]);
    assert.deepEqual(
        [r.json.execution, r.json.runState, r.json.runReceipt, r.json.baseline],
        ['offline-plan', 'owned', 'completed', 'after.json'],
    );
    // the same read plan as hello (both stacks have the same shape).
    const h = await migratedRun(t, { target: HELLO });
    assert.deepEqual(r.json.reads, (await cmd(h, ['inspect', '--config', h.configFile])).json.reads);
    // no run state: the discover plan names the eureka-hello `.observed` dir and calls nothing.
    const g = await fixture(t, { target: eureka });
    const plan = await cmd(g, ['inspect', '--config', g.configFile, '--discover']);
    assert.deepEqual(
        [plan.code, plan.json.mode, plan.json.execution, plan.json.runState],
        [0, 'discover', 'offline-plan', 'absent'],
    );
    assert.deepEqual(plan.json.writes, [
        'scripts/migrate/runs/eureka-hello-api-dev.observed/inspections/<UTC-stamp>.json (0600)',
    ]);
    assert.deepEqual([plan.aws.length, g.calls.length], [0, 0]);
    assert.equal(await lstat(g.run).catch(() => null), null);
});

test('B27 inspect: --execute writes a private inventory of read-only observations, values never stored', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const r = await inspected(f, world);
    assert.equal(r.code, 0, JSON.stringify(r.err));
    assert.equal(r.json.status, 'observed');
    assert.deepEqual(r.writes, [path.relative(f.run, r.json.inventory)]);
    assert.equal(r.probes.length, 0);
    // STS once, before every read.
    assert.equal(f.calls.at(-1).mode, 'sts');
    assert.deepEqual(f.calls.at(-1).args.slice(0, 2), ['sts', 'get-caller-identity']);
    const inv = r.inventory;
    assert.equal(inv.kind, KINDS.inventory);
    assert.deepEqual(inv.stack.state, 'absent');
    assert.equal(inv.httpProbes, 'off');
    assert.deepEqual(inv.http, {});
    const [lambda, backend] = fnNames(HELLO);
    const fields = inv.functions[lambda].fields;
    for (const k of [
        'runtime',
        'architecture',
        'handler',
        'memory',
        'timeout',
        'codeSha',
        'lastModified',
        'roleArn',
        'state',
        'lastUpdateStatus',
        'envKeys',
        'tags',
        'eventSourceMappings',
    ])
        assert.ok(fields[k].sourceApi && fields[k].observedAt, k);
    assert.equal(fields.state.value, 'Active');
    assert.equal(fields.lastUpdateStatus.value, 'Successful');
    assert.deepEqual(fields.envKeys.value, ['KMS_VALUE', 'NAME', 'SECRET']);
    // env: categories by name; the KMS ciphertext is not comparable; no value, no hash of a value.
    assert.deepEqual(fields.env.value, {
        same: ['NAME', 'SECRET'],
        changed: [],
        backupOnly: [],
        liveOnly: [],
        notComparable: ['KMS_VALUE'],
    });
    assert.deepEqual(fields.env.counts, { same: 2, changed: 0, backupOnly: 0, liveOnly: 0, notComparable: 1 });
    // tags: the deploy-* keys only.
    assert.deepEqual(fields.tags.value, {
        'deploy-managed': 'true',
        'deploy-project': 'hello',
        'deploy-tool': 'aws.lambda.ensure-function@1',
    });
    // mappings: uuid, source, state, batch size, starting position; sorted by uuid.
    assert.deepEqual(inv.functions[backend].fields.eventSourceMappings.value, [
        { uuid: 'esm-1', sourceArn: `arn:aws:sqs:${REGION}:${ACCOUNT}:${QUEUE}`, state: 'Enabled', batchSize: 1 },
        { uuid: 'esm-2', sourceArn: STREAM, state: 'Enabled', batchSize: 1, startingPosition: 'LATEST' },
    ]);
    // subscriptions: the canonical count and the protocol/endpoint list.
    assert.equal(inv.topics[TOPIC].fields.subscriptions.value, 1);
    assert.deepEqual(inv.topics[TOPIC].fields.endpoints.count, 1);
    assert.equal(inv.topics[TOPIC].fields.endpoints.value[0].protocol, 'lambda');
    // tables: identity axes; ItemCount is an approximate reference.
    const table = inv.tables[TABLE].fields;
    assert.deepEqual(Object.keys(table), ['arn', 'id', 'created', 'keySchema', 'stream', 'items', 'cfOwner']);
    assert.equal(table.items.approximate, true);
    assert.deepEqual(table.keySchema.value, [{ attributeName: 'id', keyType: 'HASH' }]);
    assert.equal(table.cfOwner.value, 'none');
    assert.equal(inv.queues[QUEUE].fields.messages.approximate, true);
    assert.deepEqual(inv.buckets[BUCKET].fields.policySids.value, ['PublicRead']);
    assert.equal(inv.logGroups[logGroups(HELLO)[0]].fields.retention.value, 7);
    assert.deepEqual(inv.api.fields.routes.value, ['GET / NONE']);
    // the account-wide bucket list is filtered by the CLI to the target bucket.
    const list = r.aws.find(c => c.args[1] === 'list-buckets');
    assert.equal(flag(list.args, '--query'), `Buckets[?Name=='${BUCKET}']`);
    // every retained resource had its CloudFormation owner read.
    assert.equal(r.aws.filter(c => c.args[1] === 'describe-stack-resources').length, 7);
    assert.deepEqual(r.json.observations, { present: 9, absent: 1, error: 0 });
});

test('B27 inspect: the stack is absent only for the exact not-found error; other errors stay errors (exit 3)', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const cases = [
        [awsError('AccessDenied', 'DescribeStacks'), 'access-denied'],
        [awsError('Throttling', 'DescribeStacks', 'Rate exceeded'), 'throttling'],
        [killed(), 'timeout'],
        [awsError('ValidationError', 'DescribeStacks', 'Stack with id other-stack does not exist'), 'other'],
        [awsError('ValidationError', 'DescribeStacks', 'Template format error'), 'other'],
    ];
    let i = 0;
    for (const [error, kind] of cases) {
        world.fail['cloudformation describe-stacks'] = args =>
            args.includes('--stack-name') && !flag(args, '--stack-name').startsWith('arn:') ? error : null;
        const r = await inspected(f, world, [], { now: Date.UTC(2026, 10, 1, 0, 0, i++) });
        assert.equal(r.code, 3, kind);
        assert.equal(r.inventory.stack.state, 'error');
        assert.equal(r.inventory.stack.errorKind, kind);
        assert.equal(r.json.errors.stack, kind);
        assert.equal(r.json.status, 'observed-with-errors');
    }
    // a present stack is observed with its status.
    world.fail = {};
    world.stack = { status: 'UPDATE_COMPLETE' };
    const present = await inspected(f, world, [], { now: Date.UTC(2026, 10, 1, 0, 1) });
    assert.deepEqual([present.code, present.json.stack], [0, { state: 'present', status: 'UPDATE_COMPLETE' }]);
    // a resource-level AccessDenied is an error of that resource, never absence.
    world.stack = { absent: true };
    world.fail['dynamodb describe-table'] = awsError('AccessDeniedException', 'DescribeTable');
    const table = await inspected(f, world, [], { now: Date.UTC(2026, 10, 1, 0, 2) });
    assert.equal(table.code, 3);
    assert.deepEqual(
        [table.inventory.tables[TABLE].state, table.inventory.tables[TABLE].errorKind],
        ['error', 'access-denied'],
    );
    // the classifier keeps the code, never the message.
    assert.deepEqual(Object.keys(awsFailure(awsError('Throttling', 'X'))).sort(), ['code', 'kind', 'stderr']);
    assert.equal(table.inventory.tables[TABLE].errorCode, 'AccessDeniedException');
});

test('B27 inspect: function and resource states — absent function, in-progress update, CloudFormation owner', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const [lambda, backend] = fnNames(HELLO);
    delete world.functions[backend];
    world.functions[lambda].config.State = 'Pending';
    world.functions[lambda].config.LastUpdateStatus = 'InProgress';
    // a retained table still listed by a live stack, and a log group of a deleted stack (trace only).
    const stackId = n => `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${n}/0000-fixture`;
    world.owners[TABLE] = stackId('other-stack');
    world.stackStatuses = { [stackId('other-stack')]: 'UPDATE_COMPLETE', [stackId('old-stack')]: 'DELETE_COMPLETE' };
    world.owners[logGroups(HELLO)[0]] = stackId('old-stack');
    const r = await inspected(f, world);
    assert.equal(r.code, 0);
    assert.equal(r.inventory.functions[backend].state, 'absent');
    assert.equal(r.inventory.functions[lambda].fields.state.value, 'Pending');
    assert.deepEqual(
        [r.inventory.tables[TABLE].fields.cfOwner.value, r.inventory.tables[TABLE].fields.cfOwner.stackStatus],
        ['stack', 'UPDATE_COMPLETE'],
    );
    assert.deepEqual(
        [
            r.inventory.logGroups[logGroups(HELLO)[0]].fields.cfOwner.value,
            r.inventory.logGroups[logGroups(HELLO)[0]].fields.cfOwner.trace,
        ],
        ['none', 'DELETE_COMPLETE'],
    );
    // a describe-stack-resources error other than the exact not-found is a read error.
    world.fail['cloudformation describe-stack-resources'] = awsError(
        'ValidationError',
        'DescribeStackResources',
        'Something else',
    );
    const e = await inspected(f, world, [], { now: Date.now() + 5 });
    assert.equal(e.code, 3);
    assert.equal(e.inventory.queues[QUEUE].fields.cfOwner.state, 'error');
});

test('B27 inspect: baseline after.json vs before.json vs none drives what is observed', async t => {
    // after.json (completed run).
    const f = await migratedRun(t);
    const a = await inspected(f, await worldOf(f));
    assert.equal(a.inventory.baseline.file, 'after.json');
    // before.json only (stopped before verify).
    const g = await migratedRun(t, { phases: PHASES.slice(0, 5) });
    const b = await inspected(g, await worldOf(g));
    assert.equal(b.inventory.baseline.file, 'before.json');
    assert.equal(Object.keys(b.inventory.tables).length, 1);
    // none: a run whose plan never wrote a snapshot observes the stack and the functions only.
    const h = await fixture(t, { target: HELLO });
    h.deps.runChild = async r =>
        r.mode === 'sts'
            ? h.calls.push(r) && { code: 0, reason: 'exited', account: ACCOUNT }
            : { code: 1, reason: 'failed', diagnostic: { kind: 'process' } };
    await assert.rejects(executeMigration(h.config, 'plan', { allowSensitiveBackup: true }, h.deps));
    const world = await worldOf(f);
    const n = await inspected(h, world);
    assert.equal(n.inventory.baseline, null);
    assert.deepEqual(new Set(n.aws.map(c => c.args[0])), new Set(['cloudformation', 'lambda']));
    assert.equal(n.inventory.functions[fnNames(HELLO)[0]].fields.env.state, 'no-backup');
});

test('B27 inspect: HTTP probes are app calls, off by default, only the baseline public GET paths', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const off = await inspected(f, world);
    assert.equal(off.probes.length, 0);
    const on = await inspected(f, world, ['--http-probe'], { now: Date.now() + 5 });
    assert.deepEqual(on.probes, [
        { url: `https://api123.execute-api.${REGION}.amazonaws.com/dev/`, method: 'GET', redirect: 'manual' },
    ]);
    assert.deepEqual(on.json.httpProbes, { mode: 'on', appCall: true, count: 1 });
    assert.equal(on.inventory.http['/'].appCall, true);
    assert.equal(on.inventory.http['/'].value, 200);
});

test('B27 inspect: private record dir rules — symlink, wrong mode and unowned state are refused before AWS', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    // a symlinked `inspections` dir is refused (the run tree check of every phase also refuses it).
    const elsewhere = path.join(f.root, 'elsewhere');
    await mkdir(elsewhere, { mode: 0o700 });
    await symlink(elsewhere, path.join(f.run, 'inspections'));
    const link = await cmd(f, ['inspect', '--config', f.configFile, '--execute'], { world });
    assert.deepEqual([link.code, link.error.code, link.aws.length], [1, 'PRIVATE_STATE_INVALID', 0]);
    assert.deepEqual(await readdir(elsewhere), []);
    await rm(path.join(f.run, 'inspections'));
    // a 0755 record dir is refused.
    await mkdir(path.join(f.run, 'inspections'), { mode: 0o700 });
    await chmod(path.join(f.run, 'inspections'), 0o755);
    const mode = await cmd(f, ['inspect', '--config', f.configFile, '--execute'], { world });
    assert.deepEqual([mode.code, mode.error.code, mode.aws.length], [1, 'PRIVATE_STATE_INVALID', 0]);
    await chmod(path.join(f.run, 'inspections'), 0o700);
    // a wrong STS account stops before any read and writes nothing.
    const child = f.deps.runChild;
    f.deps.runChild = async r => (r.mode === 'sts' ? { code: 0, reason: 'exited', account: '345678901234' } : child(r));
    const sts = await cmd(f, ['inspect', '--config', f.configFile, '--execute'], { world });
    assert.deepEqual([sts.code, sts.error.code, sts.aws.length, sts.writes], [1, 'ACCOUNT_MISMATCH', 0, []]);
    f.deps.runChild = child;
    // records are append-only: the same stamp twice is refused, the first file is kept.
    const now = Date.UTC(2026, 10, 1, 1, 0, 0);
    const first = await inspected(f, world, [], { now });
    const bytes = await readFile(first.json.inventory);
    const again = await cmd(f, ['inspect', '--config', f.configFile, '--execute'], { world, now });
    assert.deepEqual([again.code, again.error.code], [1, 'RECORD_EXISTS']);
    assert.deepEqual(await readFile(first.json.inventory), bytes);
});

//* ---- B27 reconcile ----

test('B27 reconcile: a completed run equal to live is verified-no-op with scope and notCompared', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const i = await inspected(f, world);
    const r = await cmd(f, ['reconcile', '--config', f.configFile, '--inventory', i.json.inventory]);
    assert.equal(r.code, 0, JSON.stringify(r.json));
    assert.deepEqual([r.json.class, r.json.reasons, r.json.differing], ['verified-no-op', [], []]);
    assert.deepEqual(r.json.runReceipt, {
        status: 'completed',
        runState: 'completed',
        resumable: false,
        lock: 'absent',
    });
    assert.deepEqual(r.json.baseline, { file: 'after.json', binding: 'bound-at-verify' });
    assert.deepEqual(r.json.code, { [fnNames(HELLO)[0]]: 'baseline', [fnNames(HELLO)[1]]: 'baseline' });
    // the table time is the same instant in another zone; ItemCount / messages are approximate references only.
    assert.deepEqual(r.json.approximate, {
        [`tables/${TABLE}/items`]: 'different',
        [`queues/${QUEUE}/messages`]: 'different',
    });
    for (const axis of [
        'cloudformation-owner-of-retained-resources',
        'function-code-sha',
        'function-state(Active,Successful)',
        'table-identity(arn,created,keySchema,stream)',
    ])
        assert.ok(r.json.scope.includes(axis), axis);
    for (const axis of [
        'deploy-service-history-and-active-lease (deployId recorded only)',
        'event-delivery',
        'data-equality',
        'runtime-performance',
        'http-status (probes off)',
        'kms-encrypted-env-values (key names in the result file)',
    ])
        assert.ok(r.json.notCompared.includes(axis), axis);
    assert.deepEqual(r.writes, [path.relative(f.run, r.json.result)]);
    const record = await assertNoValues(r.json.result);
    assert.equal(record.kind, KINDS.reconcile);
    assert.deepEqual(record.envNotComparable[fnNames(HELLO)[0]], ['KMS_VALUE']);
    // b) the completed run still passes the dev-release gate with the new record dirs inside its run dir.
    assert.equal((await verifyMigrationReceipt(path.join(f.run, HELLO.receiptFile), f.config)).status, 'verified');
});

test('B27 reconcile: differing settings, tags, states and env keys are reconcile-required by path only', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const [lambda, backend] = fnNames(HELLO);
    world.functions[lambda].config.MemorySize = 1024;
    world.functions[backend].tags = { 'deploy-project': 'hello' };
    world.functions[backend].config.LastUpdateStatus = 'InProgress';
    world.functions[lambda].config.Environment.Variables.NAME = 'changed-value';
    world.functions[lambda].config.Environment.Variables.ADDED = 'x';
    world.keySchema = [{ AttributeName: 'pk', KeyType: 'HASH' }];
    const i = await inspected(f, world);
    const r = await cmd(f, ['reconcile', '--config', f.configFile, '--inventory', i.json.inventory]);
    assert.equal(r.code, 3);
    assert.deepEqual([r.json.class, r.json.reasons], ['reconcile-required', []]);
    assert.deepEqual(r.json.differing.sort(), [
        `functions/${backend}/lastUpdateStatus`,
        `functions/${backend}/tags/deploy-managed`,
        `functions/${lambda}/env/ADDED`,
        `functions/${lambda}/env/NAME`,
        `functions/${lambda}/envKeys`,
        `functions/${lambda}/memory`,
        `tables/${TABLE}/keySchema`,
    ]);
    assert.deepEqual(r.json.env[lambda], { same: 1, changed: 1, backupOnly: 0, liveOnly: 1, notComparable: 1 });
    // the private result names the env category; it never holds a value.
    const record = await assertNoValues(r.json.result);
    assert.deepEqual(
        record.differing.find(d => d.path === `functions/${lambda}/env/NAME`),
        { path: `functions/${lambda}/env/NAME`, axis: 'function-env-values', category: 'changed' },
    );
    assert.deepEqual(record.differing.find(d => d.path === `functions/${lambda}/memory`).observed, { value: 1024 });
});

test('B27 reconcile: blocked reasons — stack present, read error, CF-owned, stale, no baseline, changed baseline', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    // reconcile one inventory of this run.
    const reconcile = async (inv, extra = {}) =>
        cmd(f, ['reconcile', '--config', f.configFile, '--inventory', inv], extra);
    world.stack = { status: 'UPDATE_COMPLETE' };
    const present = await reconcile((await inspected(f, world)).json.inventory);
    assert.deepEqual([present.code, present.json.class, present.json.reasons], [3, 'blocked', ['stack-present']]);
    world.stack = { absent: true };
    world.fail['sqs get-queue-attributes'] = awsError('ThrottlingException', 'GetQueueAttributes', 'Rate exceeded');
    const error = await reconcile((await inspected(f, world, [], { now: Date.now() + 5 })).json.inventory);
    assert.deepEqual(
        [error.json.class, error.json.reasons, error.json.readErrors],
        ['blocked', ['read-error'], [`queues/${QUEUE}/created`, `queues/${QUEUE}/messages`]],
    );
    world.fail = {};
    world.owners[BUCKET] = `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/other-stack/0000-fixture`;
    world.stackStatuses = { [world.owners[BUCKET]]: 'UPDATE_COMPLETE' };
    const owned = await reconcile((await inspected(f, world, [], { now: Date.now() + 10 })).json.inventory);
    assert.deepEqual(
        [owned.json.class, owned.json.reasons, owned.json.cfOwned],
        ['blocked', ['cf-owned-resource'], [`buckets/${BUCKET}`]],
    );
    world.owners = {};
    const fresh = await inspected(f, world, [], { now: Date.now() + 15 });
    const stale = await reconcile(fresh.json.inventory, { now: Date.now() + STALE_AFTER_MS + 60_000 });
    assert.deepEqual([stale.json.class, stale.json.reasons], ['blocked', ['inventory-stale']]);
    // an after.json changed after verify: the baseline binding breaks (and the inventory no longer matches it).
    const g = await migratedRun(t);
    const gi = await inspected(g, await worldOf(g));
    const after = path.join(g.run, 'after.json');
    await writeFile(after, (await readFile(after, 'utf8')).replace('"dev"', '"dev" '));
    const changed = await cmd(g, ['reconcile', '--config', g.configFile, '--inventory', gi.json.inventory]);
    assert.deepEqual(
        [changed.json.class, changed.json.reasons, changed.json.baseline.binding],
        ['blocked', ['inventory-stale', 'baseline-changed'], 'changed-after-verify'],
    );
    // no baseline at all.
    const h = await fixture(t, { target: HELLO });
    h.deps.runChild = async r =>
        r.mode === 'sts'
            ? { code: 0, reason: 'exited', account: ACCOUNT }
            : { code: 1, reason: 'failed', diagnostic: { kind: 'process' } };
    await assert.rejects(executeMigration(h.config, 'plan', { allowSensitiveBackup: true }, h.deps));
    const hi = await inspected(h, world);
    const none = await cmd(h, ['reconcile', '--config', h.configFile, '--inventory', hi.json.inventory]);
    assert.deepEqual([none.json.class, none.json.reasons], ['blocked', ['no-baseline', 'receipt-unknown-unresolved']]);
    // an inventory outside this run's inspections/ dir, or a tampered one, is refused.
    const copy = path.join(f.root, 'copy.json');
    await copyFile(fresh.json.inventory, copy);
    const outside = await reconcile(copy);
    assert.deepEqual([outside.code, outside.error.code], [2, 'INVALID_ARGS']);
    const tampered = JSON.parse(await readFile(fresh.json.inventory, 'utf8'));
    tampered.payload.stack.state = 'absent';
    tampered.payload.lock = 'absent ';
    const tamperedFile = path.join(f.run, 'inspections', '20990101T000000000Z.json');
    await writeFile(tamperedFile, JSON.stringify(tampered), { mode: 0o600 });
    const bad = await reconcile(tamperedFile);
    assert.deepEqual([bad.code, bad.error.code], [1, 'INVENTORY_INVALID']);
});

test('B27 reconcile: code sha via a completed deploy receipt — valid, tampered, other project; runtime override', async t => {
    const f = await migratedRun(t);
    const world = await worldOf(f);
    const hex = sha('new code fixture');
    for (const fn of fnNames(HELLO)) world.functions[fn].config.CodeSha256 = b64(hex);
    const i = await inspected(f, world);
    // reconcile the inventory with extra flags.
    const reconcile = async extra =>
        cmd(f, ['reconcile', '--config', f.configFile, '--inventory', i.json.inventory, ...extra]);
    const without = await reconcile([]);
    assert.deepEqual(
        [without.json.class, without.json.differing.sort()],
        [
            'reconcile-required',
            fnNames(HELLO)
                .map(n => `functions/${n}/codeSha`)
                .sort(),
        ],
    );
    const valid = await reconcile(['--deploy-receipt', await deployReceipt(f, { hex })]);
    assert.deepEqual([valid.code, valid.json.class, valid.json.deployReceipt], [0, 'verified-no-op', 'valid']);
    assert.deepEqual(Object.values(valid.json.code), ['deploy-receipt', 'deploy-receipt']);
    assert.equal((await assertNoValues(valid.json.result)).deployReceipt.deployId, 'dpl_fixture_000001');
    // tampered: the artifact sha no longer matches its key; an incomplete receipt; a loose file mode.
    for (const patch of [
        r => ({ ...r, plan: { ...r.plan, artifact: { ...r.plan.artifact, sha256: sha('other') } } }),
        r => ({ ...r, steps: r.steps.filter(s => s.name !== 'end') }),
        r => ({ ...r, status: 'unknown' }),
    ]) {
        const bad = await reconcile(['--deploy-receipt', await deployReceipt(f, { hex, patch })]);
        assert.deepEqual([bad.code, bad.error.code], [2, 'DEPLOY_RECEIPT_INVALID']);
    }
    const loose = await deployReceipt(f, { hex });
    await chmod(loose, 0o644);
    assert.equal((await reconcile(['--deploy-receipt', loose])).error.code, 'DEPLOY_RECEIPT_INVALID');
    // another project: a valid receipt, never used; the result is blocked.
    const other = await reconcile([
        '--deploy-receipt',
        await deployReceipt(f, { hex, project: 'lemon-templates-api' }),
    ]);
    assert.deepEqual(
        [other.json.class, other.json.reasons, other.json.deployReceipt],
        ['blocked', ['target-mismatch'], 'other-target'],
    );
    // runtime: not compared without an override; with `runtime` in the config the live runtime must equal it.
    world.functions[fnNames(HELLO)[0]].config.Runtime = 'nodejs22.x';
    const j = await inspected(f, world, [], { now: Date.now() + 5 });
    const noOverride = await cmd(f, [
        'reconcile',
        '--config',
        f.configFile,
        '--inventory',
        j.json.inventory,
        '--deploy-receipt',
        await deployReceipt(f, { hex }),
    ]);
    assert.equal(noOverride.json.class, 'verified-no-op');
    assert.ok(
        noOverride.json.notCompared.includes(
            'function-runtime (no runtime override; the canonical verify excludes it)',
        ),
    );
    const g = await migratedRun(t, { runtime: 'nodejs24.x' });
    const gw = await worldOf(g);
    gw.functions[fnNames(HELLO)[0]].config.Runtime = 'nodejs22.x';
    const gi = await inspected(g, gw);
    const override = await cmd(g, ['reconcile', '--config', g.configFile, '--inventory', gi.json.inventory]);
    assert.deepEqual(
        [override.json.class, override.json.differing],
        ['reconcile-required', [`functions/${fnNames(HELLO)[0]}/runtime`]],
    );
    assert.ok(override.json.scope.includes('function-runtime-override'));
});

//* ---- B27 resolve (the hello case: verify unknown on the log retention DIFF 7 -> 14) ----

// the `--accept` arguments of the hello verify DIFF.
const retentionAccepts = t => logGroups(t).flatMap(g => ['--accept', `logGroups/${g}/retention=7->14`]);

test('B27 resolve: an unknown verify stays blocked until its exact DIFF is attested; the receipt and lock stay', async t => {
    const f = await migratedRun(t, { unknownVerify: true });
    const receipt = await readJson(path.join(f.run, HELLO.receiptFile));
    assert.equal(receipt.payload.status, 'unknown');
    assert.ok(await lstat(path.join(f.run, HELLO.lockFile)));
    assert.equal(Object.hasOwn(receipt.payload.snapshots, 'after.json'), false);
    // the canonical verify DIFF (ItemCount excluded) is the two retention paths.
    const diff = verifyDiff(
        await readJson(path.join(f.run, 'before.json')),
        await readJson(path.join(f.run, 'after.json')),
    );
    assert.deepEqual(
        diff.map(d => [d.path, d.from, d.to]),
        logGroups(HELLO).map(g => [`logGroups/${g}/retention`, 7, 14]),
    );
    // the live code is the new code of a completed deploy round.
    const world = await worldOf(f);
    const hex = sha('new code fixture');
    for (const fn of fnNames(HELLO)) world.functions[fn].config.CodeSha256 = b64(hex);
    const deploy = await deployReceipt(f, { hex });
    const i = await inspected(f, world);
    assert.deepEqual([i.inventory.runReceipt.status, i.inventory.lock], ['unknown', 'present']);
    const before = await cmd(f, [
        'reconcile',
        '--config',
        f.configFile,
        '--inventory',
        i.json.inventory,
        '--deploy-receipt',
        deploy,
    ]);
    assert.deepEqual(
        [before.code, before.json.class, before.json.reasons],
        [3, 'blocked', ['receipt-unknown-unresolved']],
    );
    assert.deepEqual(before.json.runReceipt, {
        status: 'unknown',
        runState: 'unresolved',
        resumable: false,
        lock: 'present',
    });
    assert.deepEqual(before.json.baseline, { file: 'after.json', binding: 'unbound-at-verify' });
    assert.deepEqual(before.json.differing, []);
    // resolve: the exact DIFF set, from/to as before -> after, the reason; a local attestation only.
    const r = await cmd(f, [
        'resolve',
        '--config',
        f.configFile,
        '--inventory',
        i.json.inventory,
        ...retentionAccepts(HELLO),
        '--reason',
        'Owner keeps the 14-day retention (decided 2026-11-01).',
    ]);
    assert.equal(r.code, 0, JSON.stringify(r.err));
    assert.deepEqual(
        [r.json.status, r.json.kind, r.json.authorizesMutation, r.json.count],
        ['recorded', 'local-attestation', false, 2],
    );
    assert.deepEqual(r.writes, [path.relative(f.run, r.json.resolution)]);
    assert.match(r.writes[0], /^resolutions\//);
    const res = await assertNoValues(r.json.resolution);
    assert.equal(res.kind, 'local-attestation');
    assert.equal(res.authorizesMutation, false);
    assert.equal(res.ownerId, receipt.payload.ownerId);
    assert.equal(res.receipt.sha256, sha(await readFile(path.join(f.run, HELLO.receiptFile))));
    assert.deepEqual(res.receipt.snapshots, receipt.payload.snapshots);
    assert.deepEqual([res.before.binding, res.after.binding], ['bound-at-plan', 'unbound-at-verify']);
    assert.equal(res.after.sha256, sha(await readFile(path.join(f.run, 'after.json'))));
    assert.equal(res.inventory.sha256, sha(await readFile(i.json.inventory)));
    assert.deepEqual(
        res.accepted,
        logGroups(HELLO).map(g => ({ path: `logGroups/${g}/retention`, from: { value: 7 }, to: { value: 14 } })),
    );
    assert.deepEqual(res.tool, TOOL);
    assert.ok(res.note.includes('not the server-side approval receipt'));
    // reconcile with the resolution: resolved-observed-diff, verified-no-op; the receipt stays unknown, the lock stays.
    const after = await cmd(f, [
        'reconcile',
        '--config',
        f.configFile,
        '--inventory',
        i.json.inventory,
        '--deploy-receipt',
        deploy,
        '--resolution',
        r.json.resolution,
    ]);
    assert.deepEqual([after.code, after.json.class, after.json.reasons], [0, 'verified-no-op', []]);
    assert.deepEqual(after.json.runReceipt, {
        status: 'unknown',
        runState: 'resolved-observed-diff',
        resumable: false,
        lock: 'present',
    });
    assert.deepEqual(
        after.json.accepted,
        logGroups(HELLO).map(g => `logGroups/${g}/retention`),
    );
    assert.deepEqual(after.json.resolutions, { given: 1, applied: 1 });
    assert.equal((await readJson(path.join(f.run, HELLO.receiptFile))).payload.status, 'unknown');
    // a) the dev-release gate still refuses this run, and no phase resumes it (terminal).
    await assert.rejects(verifyMigrationReceipt(path.join(f.run, HELLO.receiptFile), f.config), {
        code: 'RECEIPT_INVALID',
    });
    const locked = await protectedHashes(f);
    await assert.rejects(executeMigration(f.config, 'verify', {}, f.deps), { code: 'SEQUENCE_INVALID' });
    assert.deepEqual(await protectedHashes(f), locked);
    // a live value that moved away from the after-value is a difference again.
    world.logGroups[logGroups(HELLO)[0]].retention = 7;
    const j = await inspected(f, world, [], { now: Date.now() + 5 });
    const moved = await cmd(f, [
        'reconcile',
        '--config',
        f.configFile,
        '--inventory',
        j.json.inventory,
        '--deploy-receipt',
        deploy,
        '--resolution',
        r.json.resolution,
    ]);
    assert.deepEqual(
        [moved.json.class, moved.json.differing],
        ['reconcile-required', [`logGroups/${logGroups(HELLO)[0]}/retention`]],
    );
    // b) a completed run keeps verifying with a resolution record inside its run dir.
    const g = await migratedRun(t);
    await mkdir(path.join(g.run, 'resolutions'), { mode: 0o700 });
    await copyFile(r.json.resolution, path.join(g.run, 'resolutions', path.basename(r.json.resolution)));
    await chmod(path.join(g.run, 'resolutions', path.basename(r.json.resolution)), 0o600);
    await inspected(g, await worldOf(g));
    assert.equal((await verifyMigrationReceipt(path.join(g.run, HELLO.receiptFile), g.config)).status, 'verified');
    // a resolution of another run never applies.
    const gi = await inspected(g, await worldOf(g), [], { now: Date.now() + 5 });
    const foreign = await cmd(g, [
        'reconcile',
        '--config',
        g.configFile,
        '--inventory',
        gi.json.inventory,
        '--resolution',
        path.join(g.run, 'resolutions', path.basename(r.json.resolution)),
    ]);
    assert.deepEqual([foreign.json.class, foreign.json.resolutions], ['verified-no-op', { given: 1, applied: 0 }]);
});

test('B27 resolve: refuses env keys, code, ARNs, partial or extra paths, wrong from/to, completed runs, stale input', async t => {
    const f = await migratedRun(t, { unknownVerify: true });
    const world = await worldOf(f);
    const i = await inspected(f, world);
    // resolve with the given accepts and reason.
    const resolve = async (accepts, extra = {}, reason = 'owner decision') =>
        cmd(
            f,
            ['resolve', '--config', f.configFile, '--inventory', i.json.inventory, ...accepts, '--reason', reason],
            extra,
        );
    const [lambda] = fnNames(HELLO);
    const [g1, g2] = logGroups(HELLO);
    for (const [accept, text] of [
        [`functions/${lambda}/envKeys=1->2`, 'Environment keys'],
        [`functions/${lambda}/env/SECRET=1->2`, 'Environment keys'],
        [`functions/${lambda}/codeSha=1->2`, 'Code is never'],
        [`queues/${QUEUE}/url=1->2`, 'ARNs, URLs'],
        [`tables/${TABLE}/items=3->43`, 'Only non-secret scalar settings'],
    ]) {
        const r = await resolve(['--accept', accept]);
        assert.deepEqual([r.code, r.error.code], [2, 'RESOLUTION_REFUSED'], accept);
        assert.ok(r.error.message.includes(text), r.error.message);
    }
    // the accepted set must equal the verify DIFF: one of two, or an extra scalar, is refused.
    assert.equal((await resolve(['--accept', `logGroups/${g1}/retention=7->14`])).error.code, 'RESOLUTION_REFUSED');
    const extra = await resolve([...retentionAccepts(HELLO), '--accept', `functions/${lambda}/memory=512->512`]);
    assert.equal(extra.error.code, 'RESOLUTION_REFUSED');
    // from/to must be the verify before -> after values.
    const wrong = await resolve([
        '--accept',
        `logGroups/${g1}/retention=7->30`,
        '--accept',
        `logGroups/${g2}/retention=7->14`,
    ]);
    assert.ok(wrong.error.message.includes('do not match the original verify'));
    // syntax, duplicates and the reason text.
    assert.equal((await resolve(['--accept', `logGroups/${g1}/retention=seven->14`])).error.code, 'INVALID_ARGS');
    assert.equal(
        (await resolve([...retentionAccepts(HELLO), '--accept', `logGroups/${g1}/retention=7->14`])).error.code,
        'INVALID_ARGS',
    );
    assert.equal((await resolve(retentionAccepts(HELLO), {}, 'bad\u0007reason')).error.code, 'INVALID_ARGS');
    // a stale inventory is refused.
    const stale = await resolve(retentionAccepts(HELLO), { now: Date.now() + STALE_AFTER_MS + 60_000 });
    assert.deepEqual([stale.code, stale.error.code], [2, 'INVENTORY_STALE']);
    // the live value must still be the after-value.
    world.logGroups[g2].retention = 7;
    const j = await inspected(f, world, [], { now: Date.now() + 5 });
    const live = await cmd(f, [
        'resolve',
        '--config',
        f.configFile,
        '--inventory',
        j.json.inventory,
        ...retentionAccepts(HELLO),
        '--reason',
        'x',
    ]);
    assert.ok(live.error.message.includes('not the verify after-value'));
    // nothing was written by a refused resolve.
    assert.equal(await lstat(path.join(f.run, 'resolutions')).catch(() => null), null);
    // a completed run has no verify DIFF to attest.
    const g = await migratedRun(t);
    const gi = await inspected(g, await worldOf(g));
    const done = await cmd(g, [
        'resolve',
        '--config',
        g.configFile,
        '--inventory',
        gi.json.inventory,
        ...retentionAccepts(HELLO),
        '--reason',
        'x',
    ]);
    assert.deepEqual([done.code, done.error.code], [2, 'RESOLUTION_REFUSED']);
    // append-only: a second resolve is a new file; the same stamp is refused and the first file is kept.
    const now = Date.now() + 10;
    const k = await inspected(f, await worldOf(f), [], { now });
    const first = await cmd(
        f,
        [
            'resolve',
            '--config',
            f.configFile,
            '--inventory',
            k.json.inventory,
            ...retentionAccepts(HELLO),
            '--reason',
            'x',
        ],
        { now },
    );
    assert.equal(first.code, 0);
    const bytes = await readFile(first.json.resolution);
    const again = await cmd(
        f,
        [
            'resolve',
            '--config',
            f.configFile,
            '--inventory',
            k.json.inventory,
            ...retentionAccepts(HELLO),
            '--reason',
            'y',
        ],
        { now },
    );
    assert.deepEqual([again.code, again.error.code], [1, 'RECORD_EXISTS']);
    assert.deepEqual(await readFile(first.json.resolution), bytes);
});

//* ---- B27 CLI ----

test('B27 CLI: <command> --help, argument errors, and the general help keeps the B24 text', async t => {
    for (const command of ['inspect', 'reconcile', 'resolve', 'adopt-baseline']) {
        const r = await cli([command, '--help']);
        assert.deepEqual([r.code, r.err], [0, []]);
        assert.match(
            r.out[0],
            /^Usage: npm run lambda:migrate -- inspect --config <file> \[--execute\] \[--http-probe \| --discover\]/,
        );
    }
    const general = await cli(['--help']);
    assert.ok(!general.out[0].includes('inspect'));
    const f = await fixture(t, { target: HELLO });
    for (const argv of [
        ['inspect'],
        ['inspect', '--config', f.configFile, '--inventory', 'x'],
        ['reconcile', '--config', f.configFile],
        ['reconcile', '--config', f.configFile, '--inventory', 'x', '--execute'],
        ['resolve', '--config', f.configFile, '--inventory', 'x', '--reason', 'r'],
        ['resolve', '--config', f.configFile, '--inventory', 'x', '--accept', 'a=1->2'],
        ['inspect', '--config', f.configFile, '--config', f.configFile],
        ['inspect', '--config', '--execute'],
        ['inspect', '--config', f.configFile, '--execute', '--discover', '--http-probe'],
        ['adopt-baseline', '--config', f.configFile, '--inventory', 'x'],
        ['adopt-baseline', '--config', f.configFile, '--reason', 'r'],
        ['adopt-baseline', '--config', f.configFile, '--inventory', 'x', '--reason', 'r', '--discover'],
    ]) {
        const r = await cli(argv, f.deps);
        assert.deepEqual([r.code, JSON.parse(r.err[0]).code], [2, 'INVALID_ARGS'], argv.join(' '));
    }
    // env categories: names only, KMS ciphertext not comparable on either side.
    assert.deepEqual(
        envCategories({ A: '1', B: '2', K: '*AQICx', O: 'o' }, { A: '1', B: '3', K: '*AQICy', N: 'n' }).categories,
        {
            same: ['A'],
            changed: ['B'],
            backupOnly: ['O'],
            liveOnly: ['N'],
            notComparable: ['K'],
        },
    );
});

//* ---- B27-b: first-observation baseline (a migrated target without run state in this checkout) ----

// the templates entry: the owner case (migrated, no run state in this checkout).
const TEMPLATES = TARGETS.find(t => t.project === 'lemon-templates-api');
// synthetic names of the templates discover world (stage words as separate segments).
const T_DEV = 'lemon-templates-api-dev';
const T_LEGACY = 'LegacyTemplatesTable';
const T_PROD = 'lemon-templates-api-prod';
const Q_DEV = 'lemon-templates-api-dev-queue';
const TOPIC_DEV = `arn:aws:sns:${REGION}:${ACCOUNT}:lemon-templates-api-dev-topic`;
const B_DEV = 'lemon-templates-api-dev-web';
const API_DEV = 'tplapidev1';
const API_PROD = 'tplapiprd1';
// the stream ARN of a table.
const streamOf = t => `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${t}/stream/2026-01-01T00:00:00.000`;
// the function ARN of a name.
const fnArn = n => `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${n}`;

/**
 * the live world of templates dev without run state: the two functions (no env backup), mappings to two tables
 * (one without a stage word, attributed by its wiring) and a queue, a subscription, two log groups, and the tagged
 * resources of the project tag in two stages (dev observed, prod excluded).
 */
function discoverWorld(f) {
    const [lambda, backend] = fnNames(f.target);
    const functions = {};
    for (const fn of [lambda, backend])
        functions[fn] = {
            config: {
                FunctionArn: fnArn(fn),
                Runtime: 'nodejs24.x',
                Architectures: ['x86_64'],
                Handler: 'handler.lambda',
                MemorySize: 512,
                Timeout: fn === backend ? 300 : 30,
                CodeSha256: b64(sha('templates code fixture')),
                LastModified: '2026-10-31T00:00:00.000+0000',
                Role: `arn:aws:iam::${ACCOUNT}:role/fixture-role`,
                State: 'Active',
                LastUpdateStatus: 'Successful',
                Environment: { Variables: { NAME: 'templates', SECRET } },
            },
            tags: { 'deploy-managed': 'true', 'deploy-project': 'lemon-templates', owner: 'not-recorded' },
            esm:
                fn === backend
                    ? [
                          {
                              UUID: 'esm-a',
                              EventSourceArn: streamOf(T_DEV),
                              State: 'Enabled',
                              BatchSize: 1,
                              StartingPosition: 'LATEST',
                          },
                          {
                              UUID: 'esm-b',
                              EventSourceArn: streamOf(T_LEGACY),
                              State: 'Enabled',
                              BatchSize: 1,
                              StartingPosition: 'LATEST',
                          },
                          {
                              UUID: 'esm-c',
                              EventSourceArn: `arn:aws:sqs:${REGION}:${ACCOUNT}:${Q_DEV}`,
                              State: 'Enabled',
                              BatchSize: 1,
                          },
                      ]
                    : [],
        };
    const lg = logGroups(f.target);
    return {
        stack: { absent: true },
        functions,
        projectTag: 'lemon-templates',
        subscriptions: [
            { Protocol: 'lambda', Endpoint: fnArn(backend), TopicArn: TOPIC_DEV, SubscriptionArn: 'x' },
            {
                Protocol: 'lambda',
                Endpoint: fnArn('lemon-templates-api-prod-backend'),
                TopicArn: `${TOPIC_DEV}-prod`,
                SubscriptionArn: 'y',
            },
        ],
        tagged: [
            { arn: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_DEV}` },
            { arn: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_LEGACY}` },
            { arn: `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_PROD}` },
            { arn: `arn:aws:sqs:${REGION}:${ACCOUNT}:${Q_DEV}` },
            { arn: TOPIC_DEV },
            { arn: `arn:aws:s3:::${B_DEV}` },
            { arn: `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:${lg[0]}` },
            { arn: `arn:aws:logs:${REGION}:${ACCOUNT}:log-group:${lg[1]}:*` },
            { arn: `arn:aws:apigateway:${REGION}::/restapis/${API_DEV}` },
            { arn: `arn:aws:apigateway:${REGION}::/restapis/${API_DEV}/stages/dev` },
            { arn: `arn:aws:apigateway:${REGION}::/restapis/${API_PROD}` },
            { arn: `arn:aws:apigateway:${REGION}::/restapis/${API_PROD}/stages/prod` },
            { arn: fnArn(lambda) },
            { arn: fnArn(backend) },
            { arn: fnArn('lemon-templates-api-prod-lambda') },
            // another project's tag value (the CLI filter would drop it; the tool drops it again).
            { arn: `arn:aws:s3:::other-project-dev-bucket`, project: 'other-project' },
        ],
        apis: { [API_DEV]: { name: 'dev-lemon-templates-api' }, [API_PROD]: { name: 'prod-lemon-templates-api' } },
        esmFunctions: {},
        tables: {
            [T_DEV]: { created: '2026-01-01T00:00:00+00:00', items: 1, stream: streamOf(T_DEV) },
            [T_LEGACY]: { created: '2026-01-01T00:00:00+00:00', items: 2, stream: streamOf(T_LEGACY) },
        },
        queues: { [Q_DEV]: { url: `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/${Q_DEV}`, created: '1767225600' } },
        topics: { [TOPIC_DEV]: { subscriptions: 1 } },
        buckets: {
            [B_DEV]: { created: '2026-01-01T00:00:00+00:00', objects: 3, website: true, policySids: ['PublicRead'] },
        },
        logGroups: Object.fromEntries(lg.map(g => [g, { created: 1767225600000, retention: 14 }])),
        api: { id: API_DEV, routes: ['GET / NONE'], stages: ['dev'] },
        owners: {},
        fail: {},
    };
}
// `inspect --execute --discover` on a world at `now`; returns the result and the inventory payload.
const discovered = (f, world, now = Date.now()) => inspected(f, world, ['--discover'], { now });
// the `.observed` dir of a fixture target.
const observedDir = f => `${f.run}.observed`;

test('B27-b discover: five sources, stage attribution, a private inventory next to (never in) the run dir', async t => {
    const f = await fixture(t, { target: TEMPLATES });
    const plan = await cmd(f, ['inspect', '--config', f.configFile, '--discover']);
    assert.deepEqual(
        [plan.code, plan.json.mode, plan.json.execution, plan.json.runState],
        [0, 'discover', 'offline-plan', 'absent'],
    );
    assert.deepEqual(plan.json.writes, [
        'scripts/migrate/runs/lemon-templates-api-dev.observed/inspections/<UTC-stamp>.json (0600)',
    ]);
    const r = await discovered(f, discoverWorld(f));
    assert.equal(r.code, 0, JSON.stringify(r.json));
    assert.deepEqual([r.json.mode, r.json.status, r.json.runReceipt], ['discover', 'observed', 'none']);
    assert.ok(r.json.inventory.startsWith(`${observedDir(f)}/inspections/`));
    assert.equal((await stat(observedDir(f))).mode & 0o777, 0o700);
    // the run dir is never created.
    assert.equal(await lstat(f.run).catch(() => null), null);
    const inv = r.inventory;
    const [lambda, backend] = fnNames(TEMPLATES);
    assert.deepEqual(inv.tables[T_DEV].discoveredBy, ['event-source-mapping', 'tag']);
    assert.deepEqual(inv.tables[T_LEGACY].discoveredBy, ['event-source-mapping', 'tag']);
    assert.deepEqual(inv.queues[Q_DEV].discoveredBy, ['event-source-mapping', 'tag']);
    assert.deepEqual(inv.topics[TOPIC_DEV].discoveredBy, ['sns-subscription', 'tag']);
    assert.deepEqual(inv.buckets[B_DEV].discoveredBy, ['tag']);
    for (const g of logGroups(TEMPLATES)) assert.deepEqual(inv.logGroups[g].discoveredBy, ['log-group-prefix', 'tag']);
    assert.deepEqual([inv.api.fields.id.value, inv.api.discoveredBy], [API_DEV, ['tag']]);
    assert.equal(inv.tables[T_PROD], undefined);
    // the prod resources of the same project tag are excluded by their stage word, not ambiguous.
    assert.deepEqual(inv.discovery.excluded.map(x => `${x.type} ${x.name} ${x.stage}`).sort(), [
        'api prod-lemon-templates-api prod',
        'apiStage prod prod',
        'function lemon-templates-api-prod-lambda prod',
        `table ${T_PROD} prod`,
    ]);
    assert.deepEqual([inv.discovery.ambiguous, inv.discovery.reasons], [[], []]);
    assert.deepEqual(r.json.discovery, {
        projectTag: 'lemon-templates',
        reasons: [],
        excluded: { prod: 4 },
        ambiguous: [],
        otherTagged: 0,
        external: 0,
    });
    // the same per-resource reads and shapes as inspect; no env backup: key names only.
    assert.deepEqual(Object.keys(inv.tables[T_DEV].fields), [
        'arn',
        'id',
        'created',
        'keySchema',
        'stream',
        'items',
        'cfOwner',
    ]);
    assert.equal(inv.functions[lambda].fields.env.state, 'no-backup');
    assert.deepEqual(inv.functions[lambda].fields.envKeys.value, ['NAME', 'SECRET']);
    assert.equal(inv.functions[backend].fields.state.value, 'Active');
    // the account-wide subscription list is filtered by the CLI to the two functions.
    const subs = r.aws.find(c => c.args[1] === 'list-subscriptions');
    assert.equal(
        flag(subs.args, '--query'),
        `Subscriptions[?Endpoint=='${fnArn(lambda)}' || Endpoint=='${fnArn(backend)}']`,
    );
    assert.equal(r.aws.filter(c => c.args[1] === 'get-rest-api').length, 2);
});

test('B27-b discover: ambiguous or conflicting tagged resources block; --discover is refused with run state', async t => {
    const f = await fixture(t, { target: TEMPLATES });
    // a tagged bucket without a stage word.
    const world = discoverWorld(f);
    world.tagged.push({ arn: 'arn:aws:s3:::lemon-templates-shared-assets' });
    const a = await discovered(f, world);
    assert.deepEqual([a.code, a.json.status, a.json.discovery.reasons], [3, 'blocked', ['ambiguous-discovery']]);
    assert.deepEqual(a.json.discovery.ambiguous, ['bucket lemon-templates-shared-assets (no-stage)']);
    // a function mapping to a table whose tag says prod: a conflict; an extra dev function of the same tag.
    const w2 = discoverWorld(f);
    w2.functions[fnNames(TEMPLATES)[1]].esm.push({
        UUID: 'esm-d',
        EventSourceArn: streamOf(T_PROD),
        State: 'Enabled',
        BatchSize: 1,
    });
    w2.tables[T_PROD] = { created: '2026-01-01T00:00:00+00:00', items: 9, stream: streamOf(T_PROD) };
    w2.tagged.push({ arn: fnArn('lemon-templates-api-dev-worker') });
    const b = await discovered(f, w2, Date.now() + 5);
    assert.deepEqual(b.json.discovery.ambiguous.sort(), [
        'function lemon-templates-api-dev-worker (unexpected-function)',
        `table ${T_PROD} (conflicts-with-function-wiring)`,
    ]);
    // two stage words in one name, and a stage of the dev API attributed elsewhere, are ambiguous too.
    const w3 = discoverWorld(f);
    w3.tagged.push({ arn: `arn:aws:sqs:${REGION}:${ACCOUNT}:lemon-templates-dev-to-prod` });
    const c3 = await discovered(f, w3, Date.now() + 10);
    assert.deepEqual(c3.json.discovery.ambiguous, ['queue lemon-templates-dev-to-prod (several-stages)']);
    // two REST APIs of the dev stage: both, and the tagged dev stage, are ambiguous (one API per stage).
    const w4 = discoverWorld(f);
    w4.tagged.push({ arn: `arn:aws:apigateway:${REGION}::/restapis/tplapidev2` });
    w4.apis.tplapidev2 = { name: 'dev-lemon-templates-api-v2' };
    const d4 = await discovered(f, w4, Date.now() + 15);
    assert.deepEqual(d4.json.discovery.ambiguous.sort(), [
        `api ${API_DEV} (several-apis)`,
        'api tplapidev2 (several-apis)',
        `apiStage ${API_DEV} (stage-of-another-api)`,
    ]);
    assert.equal(d4.inventory.api, null);
    // with run state, --discover is refused before any AWS call (plan and execute).
    const g = await migratedRun(t);
    for (const extra of [[], ['--execute']]) {
        const r = await cmd(g, ['inspect', '--config', g.configFile, '--discover', ...extra], {
            world: discoverWorld(g),
        });
        assert.deepEqual([r.code, r.error.code, r.aws.length], [2, 'RUN_STATE_PRESENT', 0]);
    }
    assert.equal(await lstat(observedDir(g)).catch(() => null), null);
    assert.equal(await lstat(f.run).catch(() => null), null);
});

test('B27-b adopt-baseline: refusals, then the append-only first-observation baseline', async t => {
    const f = await fixture(t, { target: TEMPLATES });
    // adopt one inventory of this target.
    const adopt = async (inv, extra = {}) =>
        cmd(
            f,
            [
                'adopt-baseline',
                '--config',
                f.configFile,
                '--inventory',
                inv,
                '--reason',
                'Owner adopts the first observation.',
            ],
            extra,
        );
    // read errors, a present stack, an ambiguous discovery, a function without the management tag or not Active.
    let n = 0;
    for (const [patch, text] of [
        [
            w =>
                (w.fail['resourcegroupstaggingapi get-resources'] = awsError(
                    'ThrottlingException',
                    'GetResources',
                    'Rate exceeded',
                )),
            'read errors',
        ],
        [w => (w.stack = { status: 'UPDATE_COMPLETE' }), 'stack is not absent'],
        [w => w.tagged.push({ arn: 'arn:aws:s3:::lemon-templates-shared-assets' }), 'ambiguous'],
        [
            w => (w.functions[fnNames(TEMPLATES)[0]].tags = { 'deploy-project': 'lemon-templates' }),
            'deploy-managed=true',
        ],
        [w => (w.functions[fnNames(TEMPLATES)[1]].config.State = 'Pending'), 'Active/Successful'],
    ]) {
        const w = discoverWorld(f);
        patch(w);
        const i = await discovered(f, w, Date.now() + n++);
        const r = await adopt(i.json.inventory);
        assert.deepEqual([r.code, r.error.code], [2, 'ADOPTION_REFUSED'], text);
        assert.ok(r.error.message.includes(text), r.error.message);
    }
    // a stale inventory.
    const good = await discovered(f, discoverWorld(f), Date.now() + n++);
    const stale = await adopt(good.json.inventory, { now: Date.now() + STALE_AFTER_MS + 60_000 });
    assert.ok(stale.error.message.includes('older than 1 h'));
    assert.equal(await lstat(path.join(observedDir(f), 'baseline.json')).catch(() => null), null);
    // adopted: a local attestation bound to the inventory sha256.
    const r = await adopt(good.json.inventory);
    assert.equal(r.code, 0, JSON.stringify(r.err));
    assert.deepEqual(
        [r.json.status, r.json.kind, r.json.provenance, r.json.authorizesMutation],
        ['adopted', 'local-attestation', 'first-observation', false],
    );
    assert.deepEqual(r.writes, ['baseline.json']);
    const b = await assertNoValues(r.json.baseline);
    assert.deepEqual(b.notProven, [
        'equality-with-migration-time-state',
        'data-equality',
        'event-delivery',
        'deploy-service-history',
    ]);
    assert.equal(b.inventory.sha256, sha(await readFile(good.json.inventory)));
    assert.deepEqual([b.kind, b.provenance, b.tool], ['local-attestation', 'first-observation', TOOL]);
    // never replaced.
    const bytes = await readFile(r.json.baseline);
    const again = await adopt(good.json.inventory);
    assert.deepEqual([again.code, again.error.code], [2, 'BASELINE_EXISTS']);
    assert.deepEqual(await readFile(r.json.baseline), bytes);
    assert.equal(await lstat(f.run).catch(() => null), null);
    // a target with run state cannot adopt.
    const g = await migratedRun(t);
    const run = await cmd(g, [
        'adopt-baseline',
        '--config',
        g.configFile,
        '--inventory',
        good.json.inventory,
        '--reason',
        'x',
    ]);
    assert.deepEqual([run.code, run.error.code], [2, 'RUN_STATE_PRESENT']);
});

test('B27-b reconcile against the first observation; a later plan phase still starts', async t => {
    const f = await fixture(t, { target: TEMPLATES });
    const t0 = Date.now();
    const first = await discovered(f, discoverWorld(f), t0);
    const adopt = await cmd(
        f,
        ['adopt-baseline', '--config', f.configFile, '--inventory', first.json.inventory, '--reason', 'owner'],
        { now: t0 + 1 },
    );
    assert.equal(adopt.code, 0);
    // reconcile at a later, distinct time (each result is a new record).
    let tick = 1000;
    const reconcile = async (inv, extra = [], options = {}) =>
        cmd(f, ['reconcile', '--config', f.configFile, '--inventory', inv, ...extra], { now: t0 + tick++, ...options });
    // the adopted inventory itself is not a new observation.
    const self = await reconcile(first.json.inventory);
    assert.deepEqual([self.code, self.error.code], [2, 'INVENTORY_NOT_NEWER']);
    // the same live state later: verified-no-op against the first observation.
    const same = await discovered(f, discoverWorld(f), t0 + 10);
    const ok = await reconcile(same.json.inventory);
    assert.equal(ok.code, 0, JSON.stringify(ok.json));
    assert.deepEqual(
        [ok.json.mode, ok.json.class, ok.json.baseline, ok.json.runReceipt],
        ['first-observation', 'verified-no-op', 'first-observation', 'none'],
    );
    assert.deepEqual(ok.json.notProven, [
        'equality-with-migration-time-state',
        'data-equality',
        'event-delivery',
        'deploy-service-history',
    ]);
    for (const axis of [
        'discovered-resource-set',
        'table-identity(arn,id,created,keySchema,stream)',
        'function-env-keys',
        'cloudformation-owner-of-retained-resources',
    ])
        assert.ok(ok.json.scope.includes(axis), axis);
    assert.ok(ok.json.notCompared.includes('function-env-values (no backup or no function)'));
    assert.ok(ok.json.result.startsWith(`${observedDir(f)}/inspections/`));
    assert.equal((await assertNoValues(ok.json.result)).runReceipt, 'none');
    // a new code sha: reconcile-required without a receipt, explained by a valid completed deploy receipt.
    const world = discoverWorld(f);
    const hex = sha('templates new code');
    for (const fn of fnNames(TEMPLATES)) world.functions[fn].config.CodeSha256 = b64(hex);
    const code = await discovered(f, world, t0 + 20);
    const without = await reconcile(code.json.inventory);
    assert.deepEqual(
        [without.code, without.json.class, without.json.differing.sort()],
        [
            3,
            'reconcile-required',
            fnNames(TEMPLATES)
                .map(n => `functions/${n}/codeSha`)
                .sort(),
        ],
    );
    const withReceipt = await reconcile(code.json.inventory, ['--deploy-receipt', await deployReceipt(f, { hex })]);
    assert.deepEqual(
        [withReceipt.code, withReceipt.json.class, Object.values(withReceipt.json.code)],
        [0, 'verified-no-op', ['deploy-receipt', 'deploy-receipt']],
    );
    // a resource discovered later, and env key names that changed, are differences.
    const w2 = discoverWorld(f);
    w2.tagged.push({ arn: `arn:aws:sqs:${REGION}:${ACCOUNT}:lemon-templates-api-dev-extra` });
    w2.queues['lemon-templates-api-dev-extra'] = {
        url: `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/lemon-templates-api-dev-extra`,
        created: '1767225601',
    };
    w2.functions[fnNames(TEMPLATES)[0]].config.Environment.Variables.ADDED = 'x';
    const more = await discovered(f, w2, t0 + 30);
    const diff = await reconcile(more.json.inventory);
    assert.deepEqual(diff.json.differing.sort(), [
        `functions/${fnNames(TEMPLATES)[0]}/envKeys`,
        'queues/lemon-templates-api-dev-extra',
    ]);
    // a stale or ambiguous new inventory blocks; --resolution has no place without run state.
    assert.deepEqual((await reconcile(same.json.inventory, [], { now: t0 + STALE_AFTER_MS + 60_000 })).json.reasons, [
        'inventory-stale',
    ]);
    const w3 = discoverWorld(f);
    w3.tagged.push({ arn: 'arn:aws:s3:::lemon-templates-shared-assets' });
    const amb = await discovered(f, w3, t0 + 40);
    assert.deepEqual((await reconcile(amb.json.inventory)).json.reasons, ['ambiguous-discovery']);
    const res = await reconcile(same.json.inventory, ['--resolution', same.json.inventory]);
    assert.deepEqual([res.code, res.error.code], [2, 'INVALID_ARGS']);
    // no run dir was created by any command; the first `plan` phase of this target still starts.
    assert.equal(await lstat(f.run).catch(() => null), null);
    const before = (await readdir(observedDir(f), { recursive: true })).sort();
    const planned = await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps);
    assert.deepEqual([planned.status, planned.completed], ['ready', ['plan']]);
    assert.deepEqual((await readdir(observedDir(f), { recursive: true })).sort(), before);
    // with run state now, --discover is refused.
    const refused = await cmd(f, ['inspect', '--config', f.configFile, '--execute', '--discover'], {
        world: discoverWorld(f),
    });
    assert.deepEqual([refused.code, refused.error.code], [2, 'RUN_STATE_PRESENT']);
});
