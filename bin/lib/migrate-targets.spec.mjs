/**
 * `bin/lib/migrate-targets.spec.mjs` (lemon-core)
 * - offline tests of the reviewed migration target registry (B24): the templates behaviour captured on `v5`
 *   @ 06727a94 (before B24) stays byte-identical.
 * - v5 B28: the eureka-hello-api dev entry (generic state names, like hello); its cases follow the hello ones.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`). Temp dirs under `os.tmpdir()`; no AWS, no network.
 */
//* v5 B24: compat lock first (only APIs that existed before B24), registry cases after.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, allPhases, writeSnapshot } from './migrate-test-fixture.mjs';
import {
    validateMigrationConfig,
    migrationPlan,
    executeMigration,
    verifyMigrationReceipt,
    readReceipt,
    snapshotIdentity,
    findTarget,
    migrationTarget,
    TARGETS,
    PHASES,
} from './migrate-core.mjs';
import { ORG_DEFAULTS } from './org-defaults.mjs';
import { abortReasonPrefix } from './deploy-runner.mjs';
import { plannedFunctionNames, loadDeployment } from './deploy-plan.mjs';
import { writeZip, sha256 } from './pack-zip.mjs';
import { main as migrateMain } from '../lemon-lambda-migrate.mjs';
import { main as devMain } from '../lemon-lambda-deploy-dev.mjs';

//* v5 B24: the full-phase fixture runs six phases per case.
vi.setConfig({ testTimeout: 60_000 });

// sha256 hex of a string.
const sha = text => createHash('sha256').update(text).digest('hex');
// the pinned revision of the templates target (captured value, not read from the code under test).
const PINNED = '66d1e91a60a240765d44dedfdab73a92af6abd51';
// a fixed templates migration config (no temp path, so its fingerprint is stable).
const TEMPLATES_RAW = Object.freeze({
    schemaVersion: 1,
    project: 'lemon-templates-api',
    stage: 'dev',
    stack: 'lemon-templates-api-dev',
    migrationRepo: 'canonical',
    migrationRevision: PINNED,
    region: 'ap-northeast-2',
    account: '234567890123',
    profile: 'local-fixture',
    endpoint: 'https://localfixture.execute-api.ap-northeast-2.amazonaws.com/dev/',
    artifactBucket: '234567890123-deploy-artifacts',
    timeoutMs: 5000,
});
// the same config with every optional key set.
const TEMPLATES_FULL = Object.freeze({
    ...TEMPLATES_RAW,
    runtime: 'nodejs24.x',
    kmsDecryptKeyArn: 'arn:aws:kms:ap-northeast-2:234567890123:key/decrypt-fixture',
    kmsEncryptKeyArn: 'arn:aws:kms:ap-northeast-2:234567890123:key/encrypt-fixture',
});
// a fixed config file location (the repo path resolves against it).
const FIXED_FILE = '/fixture/migration.json';

//* ---- compat lock: values captured on v5 @ 06727a94 before B24 ----

// the config fingerprint is sha256 of the canonical validated config (`fingerprint()` in migrate-core).
const GOLDEN_FINGERPRINT = {
    raw: '9347e31cfb77d29c0ea327e26c8a4da050b891c8b317fb86ae856ec7e1fd5e02',
    full: '6b8b5a59ab286c77972ce8b5e3ff71df3bb2430e3169cd1b9a3e2c99951ad01a',
};
// sha256 of the six offline plans (`migrationPlan`), node path masked, joined by a newline.
const GOLDEN_PLAN = '0af6a1264a7ef0b5f7a4bfd726167024f3161981ed4140017ff0248d89417cd1';
// sha256 of the CLI offline plan stdout for every phase (stubbed checkout root), node path masked.
const GOLDEN_CLI_PLAN = '0af6a1264a7ef0b5f7a4bfd726167024f3161981ed4140017ff0248d89417cd1';

test('B24 compat: templates config fingerprint is byte-identical', () => {
    const raw = validateMigrationConfig({ ...TEMPLATES_RAW }, FIXED_FILE);
    const full = validateMigrationConfig({ ...TEMPLATES_FULL }, FIXED_FILE);
    assert.deepEqual(
        { raw: sha(JSON.stringify(raw)), full: sha(JSON.stringify(full)) },
        GOLDEN_FINGERPRINT,
        JSON.stringify({ raw: sha(JSON.stringify(raw)), full: sha(JSON.stringify(full)) }),
    );
});
test('B24 compat: templates offline plan output is byte-identical', async t => {
    const c = validateMigrationConfig({ ...TEMPLATES_FULL }, FIXED_FILE);
    const plans = PHASES.map(phase =>
        JSON.stringify(migrationPlan(c, phase), null, 2).replaceAll(process.execPath, '<node>'),
    );
    assert.equal(sha(plans.join('\n')), GOLDEN_PLAN, sha(plans.join('\n')));
    // the CLI path: config file in a temp dir, checkout root stubbed to a fixed path.
    const f = await fixture(t);
    const out = [];
    await writeFile(f.configFile, JSON.stringify({ ...TEMPLATES_FULL }));
    for (const phase of PHASES)
        assert.equal(
            await migrateMain([phase, '--config', f.configFile], {
                validateRepository: async () => '/fixture/canonical',
                stdout: s => out.push(s.replaceAll(process.execPath, '<node>')),
                stderr: assert.fail,
            }),
            0,
        );
    assert.equal(sha(out.join('\n')), GOLDEN_CLI_PLAN, sha(out.join('\n')));
});
test('B24 compat: templates private run-state paths and owner tag are byte-identical', async t => {
    const f = await fixture(t),
        during = [],
        child = f.deps.runChild;
    // list the run dir while the canonical child of each phase runs (the lock file exists then).
    f.deps.runChild = async r => {
        if (r.mode === 'migration') during.push((await readdir(f.run)).filter(n => !n.includes('.tmp-')).sort());
        return child(r);
    };
    const result = await allPhases(f);
    assert.equal(
        path.relative(f.repo, result.receipt),
        'scripts/migrate/runs/lemon-templates-api-dev/templates-receipt.json',
    );
    for (const names of during) assert.ok(names.includes('templates.lock') && names.includes('templates-owner.json'));
    assert.deepEqual((await readdir(f.run)).sort(), [
        'after.json',
        'before.json',
        'code',
        'env.json',
        'plan.json',
        'templates-owner.json',
        'templates-receipt.json',
    ]);
    const owner = JSON.parse(await readFile(path.join(f.run, 'templates-owner.json'), 'utf8'));
    assert.deepEqual(Object.keys(owner), ['schemaVersion', 'tool', 'id', 'fingerprint']);
    assert.equal(owner.tool, 'templates-migrate');
});
test('B24 compat: a mismatching config keeps its error codes and exit 2 (migrate and deploy-dev)', async t => {
    const f = await fixture(t);
    for (const [patch, code] of [
        [{ project: 'other-api' }, 'TARGET_MISMATCH'],
        [{ stage: 'prod' }, 'TARGET_MISMATCH'],
        [{ stack: 'other-dev' }, 'TARGET_MISMATCH'],
        [{ migrationRevision: 'a'.repeat(40) }, 'REVISION_MISMATCH'],
    ]) {
        await writeFile(f.configFile, JSON.stringify({ ...f.raw, ...patch }));
        const errors = [];
        assert.equal(
            await migrateMain(['plan', '--config', f.configFile], {
                ...f.deps,
                stdout: assert.fail,
                stderr: s => errors.push(s),
            }),
            2,
        );
        const out = JSON.parse(errors[0]);
        assert.deepEqual([out.status, out.code], ['failed', code]);
    }
    // deploy-dev rejects another project before reading an artifact or building a client.
    const deployConfig = {
        schemaVersion: 1,
        mode: 'code',
        project: 'other-api',
        stage: 'dev',
        region: f.config.region,
        account: f.config.account,
        profile: f.config.profile,
        endpoint: f.config.endpoint,
        artifactBucket: f.config.artifactBucket,
        keyPrefix: 'other-api/dev',
    };
    const file = path.join(f.root, 'deploy.json');
    await writeFile(file, JSON.stringify(deployConfig));
    const errors = [];
    assert.equal(
        await devMain(['--config', file, '--artifact', f.root, '--apply'], {
            stdout: assert.fail,
            stderr: s => errors.push(s),
            clientFactory: () => assert.fail('client'),
        }),
        2,
    );
    assert.equal(JSON.parse(errors[0]).code, 'TARGET_MISMATCH');
});

//* ---- B24 registry cases ----

// the reviewed entries, by project.
const TEMPLATES = TARGETS.find(t => t.project === 'lemon-templates-api');
const HELLO = TARGETS.find(t => t.project === 'lemon-hello-api');
//* v5 B28: the eureka-hello entry.
const EUREKA = TARGETS.find(t => t.project === 'eureka-hello-api');
// a hello migration config (same installation values as the templates one).
const HELLO_RAW = Object.freeze({ ...TEMPLATES_RAW, project: 'lemon-hello-api', stack: 'lemon-hello-api-dev' });
// v5 B28: an eureka-hello migration config (same installation values).
const EUREKA_RAW = Object.freeze({ ...TEMPLATES_RAW, project: 'eureka-hello-api', stack: 'eureka-hello-api-dev' });
// v5 B28: the TARGET_MISMATCH message of `lemon-lambda-migrate` (lists every reviewed target, registry order).
const REVIEWED_MESSAGE =
    'Only reviewed migration targets are supported: lemon-templates-api dev, lemon-hello-api dev, eureka-hello-api dev.';

// a code-only dev deploy config and a packed artifact in `f.root`, for the dev-release cases.
async function devArtifact(f, project = f.config.project) {
    const handler = path.join(f.root, 'handler.js');
    await writeFile(handler, 'throw Error("planning must not execute handler")');
    const zip = path.join(f.root, 'lambda.zip');
    const meta = await writeZip(zip, [{ path: 'handler.js', source: handler }]);
    await writeFile(
        path.join(f.root, 'manifest.json'),
        JSON.stringify({
            schemaVersion: 1,
            runtime: 'nodejs24.x',
            architecture: 'x86_64',
            files: meta.files,
            archive: {
                file: 'lambda.zip',
                sha256: sha256(await readFile(zip)),
                bytes: meta.bytes,
                uncompressedBytes: meta.uncompressedBytes,
                fileCount: meta.files.length,
            },
            validation: { handler: { file: 'handler.js', export: 'lambda' } },
        }),
    );
    const config = {
        schemaVersion: 1,
        mode: 'code',
        project,
        stage: 'dev',
        region: f.config.region,
        account: f.config.account,
        profile: f.config.profile,
        endpoint: f.config.endpoint,
        artifactBucket: f.config.artifactBucket,
        keyPrefix: `${project}/dev`,
    };
    const file = path.join(f.root, `deploy-${project}.json`);
    await writeFile(file, JSON.stringify(config));
    return { config, file };
}

test('B24 registry: the frozen reviewed entries have exact keys, unique stacks and the pinned revision', () => {
    // v5 B28: eureka-hello is the third entry (appended; the B24 order is kept).
    assert.deepEqual(
        TARGETS.map(t => t.project),
        ['lemon-templates-api', 'lemon-hello-api', 'eureka-hello-api'],
    );
    assert.equal(ORG_DEFAULTS.migration.targets, TARGETS);
    for (const t of TARGETS) {
        assert.deepEqual(Object.keys(t), [
            'project',
            'stage',
            'stack',
            'revision',
            'receiptFile',
            'ownerFile',
            'lockFile',
            'ownerTool',
            'devConfigPrefix',
        ]);
        assert.equal(t.stage, 'dev');
        assert.equal(t.stack, `${t.project}-${t.stage}`);
        assert.equal(t.revision, PINNED);
    }
    assert.equal(new Set(TARGETS.map(t => t.stack)).size, TARGETS.length);
    // the B19 keys are gone from the migration level (no second source of truth).
    assert.deepEqual(Object.keys(ORG_DEFAULTS.migration), ['targets', 'origin', 'entry', 'imports', 'runsDir']);
});
test('B24 registry: entries, the list and the defaults cannot be mutated', () => {
    assert.ok(Object.isFrozen(TARGETS) && TARGETS.every(Object.isFrozen));
    assert.throws(() => TARGETS.push({ project: 'other-api', stage: 'dev', stack: 'other-api-dev' }), TypeError);
    assert.throws(() => {
        TARGETS[1] = TARGETS[0];
    }, TypeError);
    assert.throws(() => {
        TARGETS[0].stack = 'other-api-dev';
    }, TypeError);
    assert.throws(() => {
        HELLO.revision = 'a'.repeat(40);
    }, TypeError);
    // v5 B28: the eureka-hello entry is frozen too.
    assert.throws(() => {
        EUREKA.stack = 'lemon-hello-api-dev';
    }, TypeError);
    assert.throws(() => {
        ORG_DEFAULTS.migration.targets = [];
    }, TypeError);
    assert.throws(() => {
        ORG_DEFAULTS.deploy.abortReasonPrefixes['lemon-hello-api'] = 'templates-cli';
    }, TypeError);
    assert.equal(TARGETS.length, 3);
    assert.equal(TEMPLATES.stack, 'lemon-templates-api-dev');
    assert.equal(EUREKA.stack, 'eureka-hello-api-dev');
});
test('B24 registry: templates keeps its B19 state names; hello gets the generic names', () => {
    assert.deepEqual(
        [
            TEMPLATES.receiptFile,
            TEMPLATES.ownerFile,
            TEMPLATES.lockFile,
            TEMPLATES.ownerTool,
            TEMPLATES.devConfigPrefix,
        ],
        [
            'templates-receipt.json',
            'templates-owner.json',
            'templates.lock',
            'templates-migrate',
            'templates-dev-config-',
        ],
    );
    assert.deepEqual(
        [HELLO.receiptFile, HELLO.ownerFile, HELLO.lockFile, HELLO.ownerTool, HELLO.devConfigPrefix],
        ['migrate-receipt.json', 'migrate-owner.json', 'migrate.lock', 'lemon-lambda-migrate', 'lemon-dev-config-'],
    );
});
test('B24 registry: a hello config matches the hello entry and plans its own stack', () => {
    const c = validateMigrationConfig({ ...HELLO_RAW }, FIXED_FILE);
    assert.equal(migrationTarget(c), HELLO);
    assert.equal(findTarget(c), HELLO);
    // the config object keeps its B19 keys (no registry key is added).
    assert.deepEqual(Object.keys(c), Object.keys(validateMigrationConfig({ ...TEMPLATES_RAW }, FIXED_FILE)));
    const plan = migrationPlan(c, 'remove');
    assert.deepEqual(Object.entries(plan.target).slice(0, 3), [
        ['project', 'lemon-hello-api'],
        ['stage', 'dev'],
        ['stack', 'lemon-hello-api-dev'],
    ]);
    assert.equal(plan.migrationRevision, PINNED);
    assert.deepEqual(plan.requiredFlags, ['--execute', '--confirm-stack lemon-hello-api-dev']);
    assert.deepEqual(plan.command.args.slice(1), ['remove', 'lemon-hello-api-dev', '--go']);
});
test('B24 registry: unknown project and mixed fields are TARGET_MISMATCH listing the reviewed targets', async t => {
    for (const patch of [
        { project: 'other-api', stack: 'other-api-dev' },
        { stack: 'lemon-hello-api-dev' },
        { project: 'lemon-hello-api' },
        { project: 'lemon-hello-api', stack: 'lemon-hello-api-dev', stage: 'prod' },
        { project: 'lemon-hello-api', stack: 'lemon-templates-api-dev' },
    ])
        assert.throws(
            () => validateMigrationConfig({ ...TEMPLATES_RAW, ...patch }, FIXED_FILE),
            e => e.code === 'TARGET_MISMATCH' && e.message === REVIEWED_MESSAGE,
        );
    assert.equal(findTarget(null), undefined);
    assert.equal(findTarget({ project: 'lemon-hello-api', stage: 'dev' }), undefined);
    // the CLI keeps exit 2 for the mixed config.
    const f = await fixture(t);
    await writeFile(f.configFile, JSON.stringify({ ...f.raw, stack: 'lemon-hello-api-dev' }));
    const errors = [];
    assert.equal(
        await migrateMain(['plan', '--config', f.configFile], {
            ...f.deps,
            stdout: assert.fail,
            stderr: s => errors.push(s),
        }),
        2,
    );
    assert.equal(JSON.parse(errors[0]).code, 'TARGET_MISMATCH');
});
test('B24 registry: hello runs all phases in its own run dir with the generic state names', async t => {
    const f = await fixture(t, { target: HELLO }),
        during = [],
        child = f.deps.runChild;
    // list the run dir while the canonical child runs (the lock exists then).
    f.deps.runChild = async r => {
        if (r.mode === 'migration') during.push((await readdir(f.run)).filter(n => !n.includes('.tmp-')).sort());
        return child(r);
    };
    const result = await allPhases(f);
    assert.equal(result.status, 'completed');
    assert.equal(
        path.relative(f.repo, result.receipt),
        'scripts/migrate/runs/lemon-hello-api-dev/migrate-receipt.json',
    );
    assert.equal(during.length, PHASES.length);
    for (const names of during) assert.ok(names.includes('migrate.lock') && names.includes('migrate-owner.json'));
    assert.deepEqual((await readdir(f.run)).sort(), [
        'after.json',
        'before.json',
        'code',
        'env.json',
        'migrate-owner.json',
        'migrate-receipt.json',
        'plan.json',
    ]);
    assert.equal(
        JSON.parse(await readFile(path.join(f.run, 'migrate-owner.json'), 'utf8')).tool,
        'lemon-lambda-migrate',
    );
    const plan = JSON.parse(await readFile(path.join(f.run, 'plan.json'), 'utf8'));
    assert.deepEqual(plan.functions.map(x => x.name).sort(), [
        'lemon-hello-api-dev-backend',
        'lemon-hello-api-dev-lambda',
    ]);
    for (const c of f.calls.filter(x => x.mode === 'migration')) assert.equal(c.args[1], 'lemon-hello-api-dev');
    assert.equal((await readReceipt(result.receipt)).config.project, 'lemon-hello-api');
    assert.equal((await verifyMigrationReceipt(result.receipt, { ...f.config, mode: 'code' })).status, 'verified');
    // a hello receipt never gates a templates release.
    await assert.rejects(verifyMigrationReceipt(result.receipt, { ...f.config, project: 'lemon-templates-api' }), {
        code: 'TARGET_MISMATCH',
    });
});
test('B24 registry: the hello snapshot must hold the two dev functions of its own stack', async t => {
    const f = await fixture(t, { target: HELLO }),
        child = f.deps.runChild;
    // the canonical plan reports the templates functions under the hello stack.
    f.deps.runChild = async r => {
        const out = await child(r);
        if (r.mode === 'migration' && r.args[0] === 'plan') {
            const file = path.join(f.run, 'plan.json'),
                plan = JSON.parse(await readFile(file, 'utf8'));
            plan.functions = plan.functions.map(x => ({
                ...x,
                name: x.name.replace('lemon-hello-api', 'lemon-templates-api'),
            }));
            await writeFile(file, JSON.stringify(plan));
        }
        return out;
    };
    await assert.rejects(executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps), {
        code: 'SNAPSHOT_INVALID',
    });
    // the check itself names the hello stack: a snapshot of the templates functions under the hello config.
    const g = await fixture(t, { target: HELLO });
    await mkdir(g.run, { recursive: true, mode: 0o700 });
    await writeSnapshot(g.run, { ...g.config, project: 'lemon-templates-api' });
    const file = path.join(g.run, 'plan.json');
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), project: 'lemon-hello-api' }));
    await assert.rejects(
        snapshotIdentity(g.run, g.config),
        e =>
            e.code === 'SNAPSHOT_INVALID' &&
            e.message === 'Snapshot must contain exactly the two dev functions of lemon-hello-api-dev.',
    );
});
test('B24 registry: dev release plans a hello config with its verified receipt and the generic temp prefix', async t => {
    const f = await fixture(t, { target: HELLO }),
        a = await devArtifact(f),
        migration = await allPhases(f),
        out = [];
    let prefix;
    const code = await devMain(['--config', a.file, '--artifact', f.root, '--migration-receipt', migration.receipt], {
        stdout: s => out.push(s),
        stderr: assert.fail,
        load: async options => {
            prefix = path.basename(path.dirname(options.configFile));
            return loadDeployment(options);
        },
    });
    assert.equal(code, 0);
    assert.match(prefix, /^lemon-dev-config-[A-Za-z0-9]{6}$/);
    const result = JSON.parse(out[0]);
    assert.equal(result.target.project, 'lemon-hello-api');
    assert.equal(result.migration.status, 'verified');
    // a templates deploy config cannot use the hello receipt.
    const other = path.join(f.root, 'deploy-templates.json'),
        errors = [];
    await writeFile(
        other,
        JSON.stringify({ ...a.config, project: 'lemon-templates-api', keyPrefix: 'lemon-templates-api/dev' }),
    );
    assert.equal(
        await devMain(['--config', other, '--artifact', f.root, '--migration-receipt', migration.receipt], {
            stdout: assert.fail,
            stderr: s => errors.push(s),
        }),
        2,
    );
    assert.equal(JSON.parse(errors[0]).code, 'TARGET_MISMATCH');
});
test('B24 registry: the deploy-dev mismatch message lists the reviewed dev targets', async t => {
    const f = await fixture(t),
        a = await devArtifact(f, 'other-api'),
        errors = [];
    assert.equal(
        await devMain(['--config', a.file, '--artifact', f.root], { stdout: assert.fail, stderr: s => errors.push(s) }),
        2,
    );
    assert.equal(
        JSON.parse(errors[0]).message,
        'Dev deployment requires a reviewed target config: lemon-templates-api/dev/code, lemon-hello-api/dev/code, eureka-hello-api/dev/code.',
    );
});
test('B24 registry: abort reason prefix is data — templates keeps templates-cli, every other project the default', () => {
    assert.equal(abortReasonPrefix('lemon-templates-api'), 'templates-cli');
    assert.equal(abortReasonPrefix('lemon-hello-api'), 'lemon-lambda-deploy');
    assert.equal(abortReasonPrefix('other-api'), 'lemon-lambda-deploy');
    // inherited object keys are not entries of the map.
    for (const name of ['constructor', 'toString', '__proto__'])
        assert.equal(abortReasonPrefix(name), 'lemon-lambda-deploy');
});
test('B24 registry: each target stack names the same two functions the deploy runner plans', () => {
    for (const t of TARGETS) {
        const planned = plannedFunctionNames(t);
        assert.deepEqual([planned.lambda, planned.backend], [`${t.stack}-lambda`, `${t.stack}-backend`]);
    }
});

//* ---- v5 B28: the eureka-hello-api dev entry ----

test('B28 registry: eureka-hello gets the generic state names (as hello) at the pinned revision', () => {
    assert.deepEqual(
        [EUREKA.project, EUREKA.stage, EUREKA.stack, EUREKA.revision],
        ['eureka-hello-api', 'dev', 'eureka-hello-api-dev', PINNED],
    );
    assert.deepEqual(
        [EUREKA.receiptFile, EUREKA.ownerFile, EUREKA.lockFile, EUREKA.ownerTool, EUREKA.devConfigPrefix],
        ['migrate-receipt.json', 'migrate-owner.json', 'migrate.lock', 'lemon-lambda-migrate', 'lemon-dev-config-'],
    );
    // only the identity differs from hello; the run dir (`<runsDir>/<stack>`) keeps the shared names apart.
    const state = t => ({ ...t, project: '', stack: '' });
    assert.deepEqual(state(EUREKA), state(HELLO));
    assert.notEqual(EUREKA.stack, HELLO.stack);
});
test('B28 registry: an eureka-hello config matches its entry and plans its own stack', () => {
    const c = validateMigrationConfig({ ...EUREKA_RAW }, FIXED_FILE);
    assert.equal(migrationTarget(c), EUREKA);
    assert.equal(findTarget(c), EUREKA);
    // the config object keeps its B19 keys (no registry key is added).
    assert.deepEqual(Object.keys(c), Object.keys(validateMigrationConfig({ ...TEMPLATES_RAW }, FIXED_FILE)));
    const plan = migrationPlan(c, 'remove');
    assert.deepEqual(Object.entries(plan.target).slice(0, 3), [
        ['project', 'eureka-hello-api'],
        ['stage', 'dev'],
        ['stack', 'eureka-hello-api-dev'],
    ]);
    assert.equal(plan.migrationRevision, PINNED);
    assert.deepEqual(plan.requiredFlags, ['--execute', '--confirm-stack eureka-hello-api-dev']);
    assert.deepEqual(plan.command.args.slice(1), ['remove', 'eureka-hello-api-dev', '--go']);
    // no phase plan names another reviewed target.
    for (const phase of PHASES) {
        const text = JSON.stringify(migrationPlan(c, phase));
        assert.ok(text.includes('eureka-hello-api-dev'), phase);
        assert.ok(!text.includes('lemon-hello-api') && !text.includes('lemon-templates-api'), phase);
    }
});
test('B28 registry: mixed fields across the three targets are TARGET_MISMATCH; a wrong revision is REVISION_MISMATCH', async t => {
    // each patch mixes identity fields of two entries, or changes the stage or the name of the eureka-hello one.
    for (const [base, patch] of [
        [EUREKA_RAW, { project: 'lemon-hello-api' }],
        [EUREKA_RAW, { project: 'lemon-templates-api' }],
        [EUREKA_RAW, { stack: 'lemon-hello-api-dev' }],
        [EUREKA_RAW, { stack: 'lemon-templates-api-dev' }],
        [EUREKA_RAW, { stage: 'prod' }],
        [EUREKA_RAW, { stage: 'prod', stack: 'eureka-hello-api-prod' }],
        [EUREKA_RAW, { project: 'eureka-hello', stack: 'eureka-hello-dev' }],
        [HELLO_RAW, { stack: 'eureka-hello-api-dev' }],
        [HELLO_RAW, { project: 'eureka-hello-api' }],
        [TEMPLATES_RAW, { stack: 'eureka-hello-api-dev' }],
        [TEMPLATES_RAW, { project: 'eureka-hello-api' }],
    ])
        assert.throws(
            () => validateMigrationConfig({ ...base, ...patch }, FIXED_FILE),
            e => e.code === 'TARGET_MISMATCH' && e.message === REVIEWED_MESSAGE,
            JSON.stringify(patch),
        );
    assert.equal(findTarget({ project: 'eureka-hello-api', stage: 'dev' }), undefined);
    // the CLI keeps exit 2 for a mixed config and for another revision of the eureka-hello entry.
    const f = await fixture(t, { target: EUREKA });
    for (const [patch, code] of [
        [{ project: 'lemon-hello-api' }, 'TARGET_MISMATCH'],
        [{ stack: 'lemon-hello-api-dev' }, 'TARGET_MISMATCH'],
        [{ migrationRevision: 'a'.repeat(40) }, 'REVISION_MISMATCH'],
    ]) {
        await writeFile(f.configFile, JSON.stringify({ ...f.raw, ...patch }));
        const errors = [];
        assert.equal(
            await migrateMain(['plan', '--config', f.configFile], {
                ...f.deps,
                stdout: assert.fail,
                stderr: s => errors.push(s),
            }),
            2,
        );
        assert.deepEqual([JSON.parse(errors[0]).status, JSON.parse(errors[0]).code], ['failed', code]);
    }
});
test('B28 registry: eureka-hello runs all phases in its own run dir; its receipt gates no other target', async t => {
    const f = await fixture(t, { target: EUREKA }),
        during = [],
        child = f.deps.runChild;
    // list the run dir while the canonical child runs (the lock exists then).
    f.deps.runChild = async r => {
        if (r.mode === 'migration') during.push((await readdir(f.run)).filter(n => !n.includes('.tmp-')).sort());
        return child(r);
    };
    const result = await allPhases(f);
    assert.equal(result.status, 'completed');
    assert.equal(
        path.relative(f.repo, result.receipt),
        'scripts/migrate/runs/eureka-hello-api-dev/migrate-receipt.json',
    );
    assert.equal(during.length, PHASES.length);
    for (const names of during) assert.ok(names.includes('migrate.lock') && names.includes('migrate-owner.json'));
    assert.equal(
        JSON.parse(await readFile(path.join(f.run, 'migrate-owner.json'), 'utf8')).tool,
        'lemon-lambda-migrate',
    );
    const plan = JSON.parse(await readFile(path.join(f.run, 'plan.json'), 'utf8'));
    assert.deepEqual(plan.functions.map(x => x.name).sort(), [
        'eureka-hello-api-dev-backend',
        'eureka-hello-api-dev-lambda',
    ]);
    for (const c of f.calls.filter(x => x.mode === 'migration')) assert.equal(c.args[1], 'eureka-hello-api-dev');
    assert.equal((await readReceipt(result.receipt)).config.project, 'eureka-hello-api');
    assert.equal((await verifyMigrationReceipt(result.receipt, { ...f.config, mode: 'code' })).status, 'verified');
    // the same state names as hello, but an eureka-hello receipt never gates a hello or templates release.
    for (const project of ['lemon-hello-api', 'lemon-templates-api'])
        await assert.rejects(verifyMigrationReceipt(result.receipt, { ...f.config, project }), {
            code: 'TARGET_MISMATCH',
        });
});
test('B28 registry: dev release plans an eureka-hello config with its own receipt; a hello config cannot use it', async t => {
    const f = await fixture(t, { target: EUREKA }),
        a = await devArtifact(f),
        migration = await allPhases(f),
        out = [];
    let prefix;
    const code = await devMain(['--config', a.file, '--artifact', f.root, '--migration-receipt', migration.receipt], {
        stdout: s => out.push(s),
        stderr: assert.fail,
        load: async options => {
            prefix = path.basename(path.dirname(options.configFile));
            return loadDeployment(options);
        },
    });
    assert.equal(code, 0);
    assert.match(prefix, /^lemon-dev-config-[A-Za-z0-9]{6}$/);
    const result = JSON.parse(out[0]);
    assert.equal(result.target.project, 'eureka-hello-api');
    assert.equal(result.migration.status, 'verified');
    // a hello deploy config (same generic state names) cannot use the eureka-hello receipt.
    const other = path.join(f.root, 'deploy-hello.json'),
        errors = [];
    await writeFile(
        other,
        JSON.stringify({ ...a.config, project: 'lemon-hello-api', keyPrefix: 'lemon-hello-api/dev' }),
    );
    assert.equal(
        await devMain(['--config', other, '--artifact', f.root, '--migration-receipt', migration.receipt], {
            stdout: assert.fail,
            stderr: s => errors.push(s),
        }),
        2,
    );
    assert.equal(JSON.parse(errors[0]).code, 'TARGET_MISMATCH');
});
test('B28 registry: the runner plans eureka-hello-api-dev-lambda / -backend; the abort prefix is the default', () => {
    const planned = plannedFunctionNames(EUREKA);
    assert.deepEqual(
        [planned.lambda, planned.backend],
        ['eureka-hello-api-dev-lambda', 'eureka-hello-api-dev-backend'],
    );
    assert.equal(abortReasonPrefix('eureka-hello-api'), 'lemon-lambda-deploy');
    // the per-project map still holds templates only (no B28 entry).
    assert.deepEqual(Object.keys(ORG_DEFAULTS.deploy.abortReasonPrefixes), ['lemon-templates-api']);
});
