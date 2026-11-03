/**
 * `bin/lib/guard-writers.spec.mjs` (lemon-core)
 * - offline tests of the B31 writer wiring: `lemon-lambda-deploy`, `lemon-lambda-deploy-dev` and the six
 *   `lemon-lambda-migrate` phases under the migration guard (`runGuarded` / `planGuard` of `migrate-guard.mjs`).
 * - per writer: (a) outside the registry — output as before, no guard state I/O; (b) no installation — blocked
 *   `install-invalid`, write not called; (c) installed + registered — write called once, `guard.operationId`,
 *   journal `completed`; (d) an unresolved journal — blocked `journal-unresolved`; (e) dry-run — `guard` summary.
 * - r2: the failure line's `guard` / `recovery` fields, a pre-effect migrate failure (`SEQUENCE_INVALID`), unknown
 *   status of any `stateWriteFailed` error, thrown primitives, the migrate journal request ids and the sealed env.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`). Temp dirs under `os.tmpdir()`, free loopback ports, stubbed
 *   runners / clients / children; no AWS, no network.
 */
//* v5 B31: new spec of the guarded writers.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { writeZip, sha256 } from './pack-zip.mjs';
import { DeployError, loadDeployment, deploymentPlan } from './deploy-plan.mjs';
import { MigrationError, TARGETS, migrationPlan, validateMigrationConfig } from './migrate-core.mjs';
import os from 'node:os';
import {
    GUARD_BLOCKED_MESSAGE,
    GUARD_RECOVERY,
    INSTALL_ENV,
    operationState,
    runGuarded,
    guardStatus,
} from './migrate-guard.mjs';
import { fixture as migrationFixture } from './migrate-test-fixture.mjs';
import { guardFixture, missingGuardEnv, guardTemp } from './guard-test-fixture.mjs';
import { main as deployMain } from '../lemon-lambda-deploy.mjs';
import { main as devMain } from '../lemon-lambda-deploy-dev.mjs';
import { main as migrateMain } from '../lemon-lambda-migrate.mjs';

//* v5 B31: the cases listen on loopback ports and write temp state a few times.
vi.setConfig({ testTimeout: 60_000 });

// the deploy example config (code mode keys only).
const example = JSON.parse(
    await readFile(new URL('../fixtures/deploy/deploy.config.example.json', import.meta.url), 'utf8'),
);
// the expected installation values of the fixtures (synthetic; the migration fixture uses the same).
const ACCOUNT = '234567890123';
const REGION = 'ap-northeast-2';
// a uuid (the operation id form).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// the templates reviewed target.
const TEMPLATES = TARGETS.find(t => t.project === 'lemon-templates-api');

// a proxy that records every property read (a guard fs / net that must stay untouched).
const untouched = touched => new Proxy({}, { get: (_, k) => (touched.push(String(k)), undefined) });
// guard deps whose every access is recorded (N14: outside the registry nothing may be read).
const spyDeps = touched => ({
    fs: untouched(touched),
    net: untouched(touched),
    homedir: () => touched.push('homedir'),
});

// collect stdout / stderr lines of a CLI `main`.
function io() {
    const out = [],
        err = [];
    return { out, err, stdout: s => out.push(s), stderr: s => err.push(s) };
}

// the journal records of a guard root (name order).
async function journal(root) {
    const dir = path.join(root, 'journal');
    const names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort();
    return Promise.all(names.map(async n => JSON.parse(await readFile(path.join(dir, n), 'utf8'))));
}

// the expected blocked line of a reason.
const blockedLine = reason => ({ status: 'blocked', code: 'GUARD_BLOCKED', reason, message: GUARD_BLOCKED_MESSAGE });

//* ---- fixtures ----

/** a packed artifact and a code-mode deploy config of `project` (dev stage) in a temp dir. */
async function deployFixture(project = TEMPLATES.project) {
    const root = await guardTemp('lemon-guard-deploy-');
    const source = path.join(root, 'handler.cjs');
    await writeFile(source, 'throw new Error("handler must not execute during planning");');
    const zip = path.join(root, 'lambda.zip');
    const meta = await writeZip(zip, [{ path: 'handler.cjs', source }]);
    await writeFile(
        path.join(root, 'manifest.json'),
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
            validation: { handler: { file: 'handler.cjs', export: 'lambda' } },
        }),
    );
    // code mode: no environment file, routes, policy or deletion protection.
    const { environmentFile, policy, routes, deletionProtection, ...code } = structuredClone(example);
    const config = {
        ...code,
        mode: 'code',
        project,
        stage: 'dev',
        account: ACCOUNT,
        region: REGION,
        endpoint: `https://localfixture.execute-api.${REGION}.amazonaws.com/dev`,
        profile: 'local-fixture',
        artifactBucket: `${ACCOUNT}-deploy-artifacts`,
        keyPrefix: `${project}/dev`,
    };
    const configFile = path.join(root, 'deploy.json');
    await writeFile(configFile, JSON.stringify(config));
    const receiptDirectory = path.join(root, 'receipts');
    const args = ['--config', configFile, '--artifact', root, '--receipt-dir', receiptDirectory];
    return { root, config, configFile, receiptDirectory, args };
}

/** a fake deployment runner: counts its calls, returns a completed result (or runs `impl`). */
function fakeRun(impl) {
    const calls = [];
    const run = async (deployment, options) => {
        calls.push({ deployment, options });
        if (impl) return impl(deployment, options);
        return { status: 'completed', deployId: 'dpl_test', receipt: '/receipts/r.json', durationMs: 1 };
    };
    return Object.assign(run, { calls });
}

/** a client factory that counts its calls (credentials would be read here). */
function fakeClients() {
    const created = [];
    const factory = async config => {
        created.push(config.project);
        return { close() {} };
    };
    return Object.assign(factory, { created });
}

//* ---- lemon-lambda-deploy ----

// why: D-2 — a general deploy target keeps its exact plan / apply bytes and the guard reads nothing for it.
test('deploy (a): outside the registry the plan and apply output are the pre-B31 bytes, no guard state I/O', async () => {
    const d = await deployFixture('sample-x-api');
    const touched = [];
    const guardDeps = spyDeps(touched);
    // plan: the bytes of `deploymentPlan` as printed before B31.
    const plan = io();
    assert.equal(await deployMain(d.args, { ...plan, guardDeps, clientFactory: assert.fail }), 0);
    const deployment = await loadDeployment({ configFile: d.configFile, artifact: d.root });
    assert.deepEqual(plan.out, [JSON.stringify(deploymentPlan(deployment), null, 2)]);
    // apply: the runner's result printed as is (no guard field).
    const run = fakeRun();
    const clients = fakeClients();
    const apply = io();
    assert.equal(await deployMain([...d.args, '--apply'], { ...apply, guardDeps, run, clientFactory: clients }), 0);
    assert.deepEqual(apply.out, [
        JSON.stringify(
            { status: 'completed', deployId: 'dpl_test', receipt: '/receipts/r.json', durationMs: 1 },
            null,
            2,
        ),
    ]);
    assert.deepEqual([run.calls.length, clients.created], [1, ['sample-x-api']]);
    // a failure keeps its pre-B31 line (no operation id).
    const failed = io();
    const error = new DeployError('TRANSPORT_UNKNOWN', 'Known safe failure', { unknown: true });
    error.exitCode = 3;
    const throwing = fakeRun(() => {
        throw error;
    });
    assert.equal(
        await deployMain([...d.args, '--apply'], { ...failed, guardDeps, run: throwing, clientFactory: clients }),
        3,
    );
    assert.deepEqual(failed.err, [
        JSON.stringify({ status: 'unknown', code: 'TRANSPORT_UNKNOWN', message: 'Known safe failure' }),
    ]);
    assert.deepEqual(touched, []);
});

// why: D-4 — a reviewed target without an installation stops before credentials, receipt or network.
test('deploy (b): a reviewed target without an installation is blocked install-invalid, nothing else runs', async () => {
    const d = await deployFixture();
    const run = fakeRun();
    const clients = fakeClients();
    const r = io();
    const guardEnv = await missingGuardEnv();
    assert.equal(await deployMain([...d.args, '--apply'], { ...r, guardEnv, run, clientFactory: clients }), 1);
    assert.deepEqual(r.out, []);
    assert.deepEqual(
        r.err.map(s => JSON.parse(s)),
        [blockedLine('install-invalid')],
    );
    assert.equal(r.err[0].includes('\n'), false);
    assert.deepEqual([run.calls.length, clients.created.length], [0, 0]);
    assert.equal(await readdir(d.receiptDirectory).catch(() => null), null);
});

// why: D-3 / D-4 — a registered reviewed target writes once and reports its journal operation.
test('deploy (c): installed and registered — runner called once, guard.operationId, journal completed', async () => {
    const d = await deployFixture();
    const g = await guardFixture({ account: ACCOUNT, region: REGION });
    const run = fakeRun();
    const clients = fakeClients();
    const r = io();
    assert.equal(await deployMain([...d.args, '--apply'], { ...r, guardEnv: g.env, run, clientFactory: clients }), 0);
    assert.deepEqual([run.calls.length, clients.created.length], [1, 1]);
    const out = JSON.parse(r.out[0]);
    assert.match(out.guard.operationId, UUID_RE);
    assert.deepEqual(out, {
        status: 'completed',
        deployId: 'dpl_test',
        receipt: '/receipts/r.json',
        durationMs: 1,
        guard: { operationId: out.guard.operationId, journal: 'completed' },
    });
    const [rec] = await journal(g.root);
    assert.deepEqual(
        [rec.operationId, rec.state, rec.holder, rec.requestIds],
        [out.guard.operationId, 'completed', 'lemon-lambda-deploy', ['dpl_test']],
    );
});

// why: D-4 — an unknown write keeps exit 3 with its operation id; the next write is blocked until resolved.
test('deploy (d): an unknown write leaves journal-unresolved; the next apply is blocked before the runner', async () => {
    const d = await deployFixture();
    const g = await guardFixture({ account: ACCOUNT, region: REGION });
    const error = new DeployError('TRANSPORT_UNKNOWN', 'Known safe failure', { unknown: true });
    error.exitCode = 3;
    error.receipt = '/receipts/r.json';
    const run = fakeRun(() => {
        throw error;
    });
    const first = io();
    assert.equal(
        await deployMain([...d.args, '--apply'], { ...first, guardEnv: g.env, run, clientFactory: fakeClients() }),
        3,
    );
    const line = JSON.parse(first.err[0]);
    assert.match(line.operationId, UUID_RE);
    assert.deepEqual(line, {
        status: 'unknown',
        code: 'TRANSPORT_UNKNOWN',
        message: 'Known safe failure',
        receipt: '/receipts/r.json',
        operationId: line.operationId,
        guard: { operationId: line.operationId, journal: 'unknown' },
        recovery: GUARD_RECOVERY,
    });
    assert.equal((await journal(g.root))[0].state, 'unknown');
    const second = io();
    assert.equal(
        await deployMain([...d.args, '--apply'], { ...second, guardEnv: g.env, run, clientFactory: fakeClients() }),
        1,
    );
    assert.deepEqual(
        second.err.map(s => JSON.parse(s)),
        [blockedLine('journal-unresolved')],
    );
    assert.equal(run.calls.length, 1);
});

// why: D-5 — a reviewed target's plan carries the read-only guard summary (ready / blocked), no lock, no journal.
test('deploy (e): the dry-run plan of a reviewed target carries the guard summary', async () => {
    const d = await deployFixture();
    const missing = io();
    assert.equal(
        await deployMain(d.args, { ...missing, guardEnv: await missingGuardEnv(), clientFactory: assert.fail }),
        0,
    );
    assert.deepEqual(JSON.parse(missing.out[0]).guard, {
        applicability: 'applicable',
        status: 'blocked',
        reason: 'install-invalid',
    });
    const g = await guardFixture({ account: ACCOUNT, region: REGION });
    const ready = io();
    assert.equal(await deployMain(d.args, { ...ready, guardEnv: g.env, clientFactory: assert.fail }), 0);
    const plan = JSON.parse(ready.out[0]);
    assert.deepEqual(plan.guard, { applicability: 'applicable', status: 'ready' });
    // the rest is the plan of B30 (the guard field appended last).
    const { guard, ...rest } = plan;
    const deployment = await loadDeployment({ configFile: d.configFile, artifact: d.root });
    assert.deepEqual(rest, JSON.parse(JSON.stringify(deploymentPlan(deployment))));
    assert.deepEqual(await journal(g.root), []);
});

// why: D-4 — a journal that cannot be written after the write is WRITE_UNKNOWN (exit 3) with stateWriteFailed.
test('deploy: a journal write failing after the runner is WRITE_UNKNOWN with stateWriteFailed (success and throw)', async () => {
    const d = await deployFixture();
    // an fs whose n-th rename fails (rename 1 = the inflight record, 2 = the end record).
    const failingRename = n => {
        let count = 0;
        return {
            ...nodeFs,
            rename: async (a, b) => {
                if (++count === n) throw Object.assign(new Error('injected'), { code: 'EIO' });
                return nodeFs.rename(a, b);
            },
        };
    };
    // the runner completed, the completed record failed.
    const g1 = await guardFixture({ account: ACCOUNT, region: REGION });
    const ok = io();
    const code1 = await deployMain([...d.args, '--apply'], {
        ...ok,
        guardEnv: g1.env,
        guardDeps: { fs: failingRename(2) },
        run: fakeRun(),
        clientFactory: fakeClients(),
    });
    assert.equal(code1, 3);
    const line1 = JSON.parse(ok.err[0]);
    assert.deepEqual(
        [line1.status, line1.code, line1.stateWriteFailed, line1.receipt, line1.deployId],
        ['unknown', 'WRITE_UNKNOWN', true, '/receipts/r.json', 'dpl_test'],
    );
    assert.match(line1.operationId, UUID_RE);
    // r2: the journal state is uncertain (the end record may not be durable); same recovery sentence.
    assert.deepEqual(
        [line1.guard, line1.recovery],
        [{ operationId: line1.operationId, journal: 'uncertain' }, GUARD_RECOVERY],
    );
    assert.deepEqual(ok.out, []);
    // the runner failed (known failure), the unknown record failed too: unknown, exit 3.
    const g2 = await guardFixture({ account: ACCOUNT, region: REGION });
    const bad = io();
    const code2 = await deployMain([...d.args, '--apply'], {
        ...bad,
        guardEnv: g2.env,
        guardDeps: { fs: failingRename(2) },
        run: fakeRun(() => {
            throw new DeployError(
                'TOOL_FAILED',
                'Tool failed or verification failed; see the server deployment record.',
            );
        }),
        clientFactory: fakeClients(),
    });
    assert.equal(code2, 3);
    const line2 = JSON.parse(bad.err[0]);
    assert.deepEqual([line2.status, line2.code, line2.stateWriteFailed], ['unknown', 'TOOL_FAILED', true]);
    // the inflight record stays and keeps blocking.
    assert.equal(await operationState(g2.install), 'inflight');
});

//* ---- lemon-lambda-deploy-dev ----

/** a migration fixture plus a code-only dev deploy config of its target and a packed artifact. */
async function devFixture(t, project = TEMPLATES.project) {
    const f = await migrationFixture(t);
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
    const file = path.join(f.root, 'deploy.json');
    await writeFile(file, JSON.stringify(config));
    const receiptDirectory = path.join(f.root, 'receipts');
    return {
        f,
        config,
        args: ['--config', file, '--artifact', f.root, '--receipt-dir', receiptDirectory],
        receiptDirectory,
    };
}

// why: D-2 — deploy-dev accepts reviewed targets only; another project keeps its pre-B31 refusal, no guard I/O.
test('deploy-dev (a): a project outside the registry keeps its TARGET_MISMATCH line, no guard state I/O', async t => {
    const d = await devFixture(t, 'other-api');
    const touched = [];
    const r = io();
    assert.equal(
        await devMain([...d.args, '--apply'], { ...r, guardDeps: spyDeps(touched), clientFactory: assert.fail }),
        2,
    );
    assert.deepEqual(r.err, [
        JSON.stringify({
            status: 'failed',
            code: 'TARGET_MISMATCH',
            message: `Dev deployment requires a reviewed target config: ${TARGETS.map(
                x => `${x.project}/dev/code`,
            ).join(', ')}.`,
        }),
    ]);
    assert.deepEqual(touched, []);
});

// why: D-4 — no installation: blocked before the client, the runner and the deploy receipt.
test('deploy-dev (b): a reviewed target without an installation is blocked install-invalid', async t => {
    const d = await devFixture(t);
    const run = fakeRun();
    const clients = fakeClients();
    const r = io();
    assert.equal(
        await devMain([...d.args, '--apply'], { ...r, guardEnv: await missingGuardEnv(), run, clientFactory: clients }),
        1,
    );
    assert.deepEqual(
        r.err.map(s => JSON.parse(s)),
        [blockedLine('install-invalid')],
    );
    assert.deepEqual([run.calls.length, clients.created.length, r.out], [0, 0, []]);
    assert.equal(await readdir(d.receiptDirectory).catch(() => null), null);
});

// why: D-3 — a registered dev target writes once under the holder `lemon-lambda-deploy-dev`.
test('deploy-dev (c): installed and registered — runner called once, guard.operationId, journal completed', async t => {
    const d = await devFixture(t);
    const g = await guardFixture({ account: d.config.account, region: d.config.region });
    const run = fakeRun();
    const r = io();
    assert.equal(
        await devMain([...d.args, '--apply'], { ...r, guardEnv: g.env, run, clientFactory: fakeClients() }),
        0,
    );
    assert.equal(run.calls.length, 1);
    const out = JSON.parse(r.out[0]);
    assert.match(out.guard.operationId, UUID_RE);
    assert.equal(out.guard.journal, 'completed');
    const [rec] = await journal(g.root);
    assert.deepEqual(
        [rec.operationId, rec.state, rec.holder],
        [out.guard.operationId, 'completed', 'lemon-lambda-deploy-dev'],
    );
});

// why: D-4 — a known failure keeps its own exit code, but the journal records it unknown and blocks the next apply.
test('deploy-dev (d): a failed write records the journal unknown; the next apply is journal-unresolved', async t => {
    const d = await devFixture(t);
    const g = await guardFixture({ account: d.config.account, region: d.config.region });
    const error = new DeployError(
        'TOOL_FAILED',
        'Tool failed or verification failed; see the server deployment record.',
    );
    error.exitCode = 1;
    const run = fakeRun(() => {
        throw error;
    });
    const first = io();
    assert.equal(
        await devMain([...d.args, '--apply'], { ...first, guardEnv: g.env, run, clientFactory: fakeClients() }),
        1,
    );
    const line = JSON.parse(first.err[0]);
    assert.deepEqual([line.status, line.code], ['failed', 'TOOL_FAILED']);
    assert.match(line.operationId, UUID_RE);
    assert.deepEqual(
        [line.guard, line.recovery],
        [{ operationId: line.operationId, journal: 'unknown' }, GUARD_RECOVERY],
    );
    assert.equal(await operationState(g.install), 'unknown');
    const second = io();
    assert.equal(
        await devMain([...d.args, '--apply'], { ...second, guardEnv: g.env, run, clientFactory: fakeClients() }),
        1,
    );
    assert.deepEqual(
        second.err.map(s => JSON.parse(s)),
        [blockedLine('journal-unresolved')],
    );
    assert.equal(run.calls.length, 1);
});

// why: D-5 — the dev plan carries the guard summary; registered under another account it is identity-mismatch.
test('deploy-dev (e): the dry-run plan carries the guard summary (ready, identity-mismatch)', async t => {
    const d = await devFixture(t);
    const g = await guardFixture({ account: d.config.account, region: d.config.region });
    const ready = io();
    assert.equal(await devMain(d.args, { ...ready, guardEnv: g.env, clientFactory: assert.fail }), 0);
    assert.deepEqual(JSON.parse(ready.out[0]).guard, { applicability: 'applicable', status: 'ready' });
    const other = await guardFixture({ account: '345678901234', region: d.config.region });
    const mismatch = io();
    assert.equal(await devMain(d.args, { ...mismatch, guardEnv: other.env, clientFactory: assert.fail }), 0);
    assert.deepEqual(JSON.parse(mismatch.out[0]).guard, {
        applicability: 'applicable',
        status: 'blocked',
        reason: 'identity-mismatch',
    });
    assert.deepEqual(await journal(g.root), []);
});

//* ---- lemon-lambda-migrate ----

// the CLI argv of one phase with its confirmation flags.
const phaseArgs = (f, phase, execute = true) => [
    phase,
    '--config',
    f.configFile,
    ...(execute ? ['--execute'] : []),
    ...(execute && phase === 'plan' ? ['--allow-sensitive-backup'] : []),
    ...(execute && phase === 'remove' ? ['--confirm-stack', f.config.stack] : []),
];

// why: D-2 — migrate accepts reviewed targets only; another stack keeps its pre-B31 refusal, no guard I/O.
test('migrate (a): a config outside the registry keeps its TARGET_MISMATCH line, no guard state I/O', async t => {
    const f = await migrationFixture(t);
    await writeFile(f.configFile, JSON.stringify({ ...f.raw, project: 'other-api', stack: 'other-api-dev' }));
    const touched = [];
    const r = io();
    assert.equal(await migrateMain(phaseArgs(f, 'plan'), { ...f.deps, ...r, guardDeps: spyDeps(touched) }), 2);
    assert.deepEqual(r.err, [
        JSON.stringify({
            status: 'failed',
            code: 'TARGET_MISMATCH',
            message: `Only reviewed migration targets are supported: ${TARGETS.map(x => `${x.project} ${x.stage}`).join(
                ', ',
            )}.`,
        }),
    ]);
    assert.deepEqual([touched, f.calls], [[], []]);
});

// why: D-4 — no installation: blocked before the receipt, the LOCK file, STS and the child.
test('migrate (b): a reviewed target without an installation is blocked install-invalid; no run dir, no child', async t => {
    const f = await migrationFixture(t);
    const r = io();
    assert.equal(await migrateMain(phaseArgs(f, 'plan'), { ...f.deps, ...r, guardEnv: await missingGuardEnv() }), 1);
    assert.deepEqual(
        r.err.map(s => JSON.parse(s)),
        [blockedLine('install-invalid')],
    );
    assert.deepEqual([f.calls, r.out], [[], []]);
    assert.equal(await readdir(f.run).catch(() => null), null);
});

// why: D-3 — each phase writes once under `lemon-lambda-migrate:<phase>`; the migration LOCK stays as before.
test('migrate (c): installed and registered — plan and retain run once each, guard.operationId, journal completed', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: f.config.account, region: f.config.region });
    const ids = [];
    for (const phase of ['plan', 'retain']) {
        const r = io();
        assert.equal(await migrateMain(phaseArgs(f, phase), { ...f.deps, ...r, guardEnv: g.env }), 0, r.err.join());
        const out = JSON.parse(r.out[0]);
        assert.deepEqual([out.phase, out.guard.journal], [phase, 'completed']);
        assert.match(out.guard.operationId, UUID_RE);
        ids.push(out.guard.operationId);
    }
    const records = await journal(g.root);
    assert.deepEqual(
        records.map(x => [x.operationId, x.state, x.holder]),
        [
            [ids[0], 'completed', 'lemon-lambda-migrate:plan'],
            [ids[1], 'completed', 'lemon-lambda-migrate:retain'],
        ],
    );
    // the canonical child ran once per phase (STS + migration each).
    assert.deepEqual(
        f.calls.map(c => c.mode),
        ['sts', 'migration', 'sts', 'migration'],
    );
});

// why: D-4 — an unknown phase keeps exit 3 and its diagnostic; the journal blocks the next phase until resolved.
test('migrate (d): a failed canonical phase leaves journal-unresolved; the next execute is blocked', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: f.config.account, region: f.config.region });
    const failing = {
        ...f.deps,
        runChild: async request => {
            f.calls.push(request);
            return request.mode === 'sts'
                ? { code: 0, reason: 'exited', account: f.config.account }
                : { code: 1, reason: 'failed' };
        },
    };
    const first = io();
    assert.equal(await migrateMain(phaseArgs(f, 'plan'), { ...failing, ...first, guardEnv: g.env }), 3);
    const line = JSON.parse(first.err[0]);
    assert.deepEqual([line.status, line.code], ['unknown', 'PHASE_FAILED']);
    assert.match(line.operationId, UUID_RE);
    assert.deepEqual(
        [line.guard, line.recovery],
        [{ operationId: line.operationId, journal: 'unknown' }, GUARD_RECOVERY],
    );
    const calls = f.calls.length;
    const second = io();
    assert.equal(await migrateMain(phaseArgs(f, 'plan'), { ...f.deps, ...second, guardEnv: g.env }), 1);
    assert.deepEqual(
        second.err.map(s => JSON.parse(s)),
        [blockedLine('journal-unresolved')],
    );
    assert.equal(f.calls.length, calls);
});

// why: a flag error is an input refusal before the guard: no journal record, no blocked target.
test('migrate: a missing confirmation flag is refused before the guard (exit 2, journal stays idle)', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: f.config.account, region: f.config.region });
    const r = io();
    const argv = ['plan', '--config', f.configFile, '--execute'];
    assert.equal(await migrateMain(argv, { ...f.deps, ...r, guardEnv: g.env }), 2);
    assert.equal(JSON.parse(r.err[0]).code, 'BACKUP_CONSENT_REQUIRED');
    assert.equal(Object.hasOwn(JSON.parse(r.err[0]), 'operationId'), false);
    assert.deepEqual([await journal(g.root), await operationState(g.install)], [[], 'idle']);
});

// why: D-5 — every phase's dry-run plan carries the guard summary; not-registered when the entry is missing.
test('migrate (e): the dry-run plan carries the guard summary (ready, not-registered)', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: f.config.account, region: f.config.region });
    const ready = io();
    assert.equal(await migrateMain(phaseArgs(f, 'verify', false), { ...f.deps, ...ready, guardEnv: g.env }), 0);
    const plan = JSON.parse(ready.out[0]);
    assert.deepEqual(plan.guard, { applicability: 'applicable', status: 'ready' });
    const { guard, ...rest } = plan;
    const c = validateMigrationConfig(f.raw, f.configFile);
    c.migrationRepo = f.repo;
    assert.deepEqual(rest, JSON.parse(JSON.stringify(migrationPlan(c, 'verify'))));
    const empty = await guardFixture({ account: f.config.account, region: f.config.region, targets: [] });
    const missing = io();
    assert.equal(await migrateMain(phaseArgs(f, 'plan', false), { ...f.deps, ...missing, guardEnv: empty.env }), 0);
    assert.deepEqual(JSON.parse(missing.out[0]).guard, {
        applicability: 'applicable',
        status: 'blocked',
        reason: 'not-registered',
    });
    assert.deepEqual(f.calls, []);
});

//* ---- runGuarded ----

// why: errors of the guard itself (not the write) are thrown as they are; the passthrough result is returned as is.
test('runGuarded: outside the registry returns the run result; guard input errors are thrown, run not called', async () => {
    let calls = 0;
    const run = async () => (++calls, { status: 'completed' });
    assert.deepEqual(await runGuarded({ input: { project: 'sample-x-api', stage: 'dev' }, run }), {
        result: { status: 'completed' },
    });
    await assert.rejects(
        runGuarded({
            input: { project: TEMPLATES.project, stage: 'dev', stack: 'other-stack' },
            expected: { account: ACCOUNT, region: REGION },
            holder: 'h',
            run,
        }),
        e => e instanceof MigrationError && e.code === 'TARGET_MISMATCH',
    );
    await assert.rejects(
        runGuarded({
            input: { project: TEMPLATES.project, stage: 'dev' },
            expected: { account: 'acct', region: REGION },
            holder: 'h',
            run,
        }),
        { code: 'INVALID_INPUT' },
    );
    assert.equal(calls, 1);
});

//* ---- v5 B31 r2 ----

// why: S2 — a migrate failure before any AWS effect (phase out of order) still leaves the journal unknown and blocks.
test('migrate: SEQUENCE_INVALID before any effect reports guard.journal unknown and blocks the next write', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: f.config.account, region: f.config.region });
    const first = io();
    // retain before plan: the phase order check fails inside the write, before the run dir, STS or the child.
    assert.equal(await migrateMain(phaseArgs(f, 'retain'), { ...f.deps, ...first, guardEnv: g.env }), 1);
    const line = JSON.parse(first.err[0]);
    assert.deepEqual([line.status, line.code], ['failed', 'SEQUENCE_INVALID']);
    assert.match(line.operationId, UUID_RE);
    assert.deepEqual(line.guard, { operationId: line.operationId, journal: 'unknown' });
    assert.equal(line.recovery, GUARD_RECOVERY);
    assert.deepEqual(f.calls, []);
    const [rec] = await journal(g.root);
    assert.deepEqual([rec.operationId, rec.state, rec.error.code], [line.operationId, 'unknown', 'SEQUENCE_INVALID']);
    // the next guarded write of the installation (even the right phase) is journal-unresolved.
    const second = io();
    assert.equal(await migrateMain(phaseArgs(f, 'plan'), { ...f.deps, ...second, guardEnv: g.env }), 1);
    assert.deepEqual(
        second.err.map(s => JSON.parse(s)),
        [blockedLine('journal-unresolved')],
    );
    assert.deepEqual(f.calls, []);
});

// why: N7 (1) — a journal failure makes the line unknown / exit 3 even for an error that is not a known one.
test('deploy: an unexpected error with stateWriteFailed is status unknown, exit 3', async () => {
    const d = await deployFixture();
    const g = await guardFixture({ account: ACCOUNT, region: REGION });
    let renames = 0;
    const fs = {
        ...nodeFs,
        rename: async (a, b) => {
            if (++renames === 2) throw Object.assign(new Error('injected'), { code: 'EIO' });
            return nodeFs.rename(a, b);
        },
    };
    const r = io();
    const run = fakeRun(() => {
        throw new TypeError('raw failure text');
    });
    const code = await deployMain([...d.args, '--apply'], {
        ...r,
        guardEnv: g.env,
        guardDeps: { fs },
        run,
        clientFactory: fakeClients(),
    });
    assert.equal(code, 3);
    const line = JSON.parse(r.err[0]);
    assert.deepEqual(
        [line.status, line.code, line.stateWriteFailed, line.guard.journal],
        ['unknown', 'UNEXPECTED_ERROR', true, 'uncertain'],
    );
    assert.ok(!r.err[0].includes('raw failure text'));
});

// why: N7 (2) — a thrown primitive is wrapped in an Error that carries the operation id.
test('runGuarded: a thrown primitive becomes an Error with the operation id; the journal records it unknown', async () => {
    const g = await guardFixture({ account: ACCOUNT, region: REGION });
    const error = await runGuarded({
        input: { project: TEMPLATES.project, stage: 'dev' },
        expected: { account: ACCOUNT, region: REGION },
        holder: 'spec',
        env: g.env,
        run: async () => {
            throw 'plain text';
        },
    }).catch(e => e);
    assert.ok(error instanceof Error);
    assert.match(error.operationId, UUID_RE);
    const [rec] = await journal(g.root);
    assert.deepEqual([rec.operationId, rec.state], [error.operationId, 'unknown']);
    // through a writer: the generic line plus the guard fields.
    const d = await deployFixture();
    const g2 = await guardFixture({ account: ACCOUNT, region: REGION });
    const r = io();
    const run = fakeRun(() => {
        throw 42;
    });
    assert.equal(
        await deployMain([...d.args, '--apply'], { ...r, guardEnv: g2.env, run, clientFactory: fakeClients() }),
        1,
    );
    const line = JSON.parse(r.err[0]);
    assert.deepEqual([line.status, line.code, line.guard.journal], ['failed', 'UNEXPECTED_ERROR', 'unknown']);
    assert.match(line.operationId, UUID_RE);
});

// why: N6 — the migrate journal keeps the phase's deploy id and the run receipt digest.
test('migrate: the journal of a completed phase carries its deploy id and the run receipt digest', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: f.config.account, region: f.config.region });
    for (const phase of ['plan', 'retain', 'remove', 'tag', 'apply']) {
        const r = io();
        assert.equal(await migrateMain(phaseArgs(f, phase), { ...f.deps, ...r, guardEnv: g.env }), 0, r.err.join());
    }
    const records = await journal(g.root);
    const receipt = JSON.parse(await readFile(path.join(f.run, f.target.receiptFile), 'utf8'));
    assert.deepEqual(
        records.map(x => [x.holder.split(':')[1], x.state, x.requestIds]),
        [
            ['plan', 'completed', []],
            ['retain', 'completed', []],
            ['remove', 'completed', []],
            ['tag', 'completed', []],
            ['apply', 'completed', ['dpl_mabc1234_abcdef']],
        ],
    );
    // every record has a receipt digest; the last one is the digest of the receipt as it stands now.
    assert.ok(records.every(x => /^[0-9a-f]{64}$/.test(x.receiptDigest)));
    assert.equal(records.at(-1).receiptDigest, receipt.sha256);
});

// why: S3 — with no guardEnv the guard reads the sealed install path of the test setup, never the home dir.
test('sealed env: a reviewed target with process.env reads only the sealed install path, not ~/.lemon-core', async () => {
    const sealed = process.env[INSTALL_ENV];
    assert.ok(path.isAbsolute(sealed) && sealed.startsWith(os.tmpdir()));
    assert.equal(await nodeFs.stat(sealed).catch(() => null), null);
    const reads = [];
    const homes = [];
    const fs = { ...nodeFs, readFile: async (file, ...rest) => (reads.push(file), nodeFs.readFile(file, ...rest)) };
    const deps = { fs, homedir: () => (homes.push('homedir'), os.homedir()) };
    const status = await guardStatus(
        { project: TEMPLATES.project, stage: 'dev' },
        { account: ACCOUNT, region: REGION },
        { deps },
    );
    assert.deepEqual([status.status, status.reason], ['blocked', 'install-invalid']);
    assert.deepEqual([reads, homes], [[sealed], []]);
    // a writer without guardEnv takes the same sealed path (blocked before the runner).
    const d = await deployFixture();
    const run = fakeRun();
    const r = io();
    reads.length = 0;
    assert.equal(
        await deployMain([...d.args, '--apply'], { ...r, guardDeps: deps, run, clientFactory: fakeClients() }),
        1,
    );
    assert.deepEqual(
        r.err.map(x => JSON.parse(x)),
        [blockedLine('install-invalid')],
    );
    assert.deepEqual([reads, homes, run.calls.length], [[sealed], [], 0]);
});

// why: v5 B34 (D-2) — the tool's scrubbed error message / code of a failed step reach the deploy-dev stderr line too.
test('deploy-dev (B34): a TOOL_FAILED error with a tool message prints errorMessage / toolErrorCode', async t => {
    const d = await devFixture(t);
    const g = await guardFixture({ account: d.config.account, region: d.config.region });
    const error = new DeployError(
        'TOOL_FAILED',
        'Tool failed or verification failed; see the server deployment record.',
    );
    Object.assign(error, { exitCode: 1, errorMessage: 'Too Many Requests', toolErrorCode: 'TooManyRequestsException' });
    const run = fakeRun(() => {
        throw error;
    });
    const first = io();
    assert.equal(
        await devMain([...d.args, '--apply'], { ...first, guardEnv: g.env, run, clientFactory: fakeClients() }),
        1,
    );
    const line = JSON.parse(first.err[0]);
    assert.deepEqual(
        [line.status, line.code, line.message, line.errorMessage, line.toolErrorCode],
        [
            'failed',
            'TOOL_FAILED',
            'Tool failed or verification failed; see the server deployment record.',
            'Too Many Requests',
            'TooManyRequestsException',
        ],
    );
});
