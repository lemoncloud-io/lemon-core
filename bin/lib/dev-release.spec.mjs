/**
 * `bin/lib/dev-release.spec.mjs` (lemon-core)
 * - offline tests of dev-release.mjs (`lemon-lambda-deploy-dev`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/dev-release.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { writeFile, readFile, rename, symlink, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, allPhases } from './migrate-test-fixture.mjs';
import { writeZip, sha256 } from './pack-zip.mjs';
import { main } from '../lemon-lambda-deploy-dev.mjs';
import { DeployError, validateConfig, loadDeployment } from './deploy-plan.mjs';
import { verifyMigrationReceipt } from './migrate-core.mjs';
//* v5 B31: every dev release target is reviewed, so its apply case runs with a guard installation.
import { guardFixture } from './guard-test-fixture.mjs';

//* v5 B19: node:test had no per-test deadline; the process cases (fork/spawn) need more than 5 s on a busy host.
vi.setConfig({ testTimeout: 60_000 });
async function artifact(f) {
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
        project: f.config.project,
        stage: 'dev',
        region: f.config.region,
        account: f.config.account,
        profile: f.config.profile,
        endpoint: f.config.endpoint,
        artifactBucket: f.config.artifactBucket,
        keyPrefix: 'lemon-templates-api/dev',
    };
    const file = path.join(f.root, 'deploy.json');
    await writeFile(file, JSON.stringify(config));
    return { config, file };
}
test('dev wrapper defaults to offline verified plan without client construction', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        out = [];
    const code = await main(['--config', a.file, '--artifact', f.root], {
        stdout: s => out.push(s),
        stderr: assert.fail,
        clientFactory: () => assert.fail('credentials accessed'),
    });
    assert.equal(code, 0);
    assert.equal(JSON.parse(out[0]).target.stage, 'dev');
});
test('dev wrapper rejects prod/other project before client creation', async t => {
    for (const patch of [{ stage: 'prod' }, { project: 'other-api' }]) {
        const f = await fixture(t),
            a = await artifact(f);
        await writeFile(a.file, JSON.stringify({ ...a.config, ...patch }));
        const errors = [];
        assert.equal(
            await main(['--config', a.file, '--artifact', f.root, '--apply'], {
                stdout: assert.fail,
                stderr: s => errors.push(s),
                clientFactory: () => assert.fail('client'),
            }),
            2,
        );
        assert.ok(errors.length);
    }
});
test('verified migration receipt binds snapshots and target; checksum corruption blocks deployment', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        migration = await allPhases(f),
        out = [];
    const args = ['--config', a.file, '--artifact', f.root, '--migration-receipt', migration.receipt];
    assert.equal(await main(args, { stdout: s => out.push(s), stderr: assert.fail }), 0);
    assert.equal(JSON.parse(out[0]).migration.status, 'verified');
    await assert.rejects(verifyMigrationReceipt(migration.receipt, { ...a.config, account: '345678901234' }), {
        code: 'TARGET_MISMATCH',
    });
    const envelope = JSON.parse(await readFile(migration.receipt));
    envelope.payload.status = 'unknown';
    await writeFile(migration.receipt, JSON.stringify(envelope));
    assert.equal(await main(args, { stdout: assert.fail, stderr: () => {} }), 1);
});
test('verified receipt detects edited backup even when receipt itself is unchanged', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        migration = await allPhases(f);
    const env = JSON.parse(await readFile(path.join(f.run, 'env.json')));
    env['lemon-templates-api-dev-lambda'].SECRET = 'changed';
    await writeFile(path.join(f.run, 'env.json'), JSON.stringify(env));
    await assert.rejects(verifyMigrationReceipt(migration.receipt, a.config), { code: 'SNAPSHOT_CHANGED' });
});
test('dev wrapper propagates existing deployment failure exit and uncertainty', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        errors = [];
    const error = new DeployError('TRANSPORT_UNKNOWN', 'Known safe failure', { unknown: true });
    error.exitCode = 3;
    assert.equal(
        await main(['--config', a.file, '--artifact', f.root, '--apply'], {
            stdout: assert.fail,
            stderr: s => errors.push(s),
            clientFactory: async () => ({}),
            run: async () => {
                throw error;
            },
            // v5 B31: a registered guard installation of the reviewed target.
            guardEnv: (await guardFixture({ account: a.config.account, region: a.config.region })).env,
        }),
        3,
    );
    assert.equal(JSON.parse(errors[0]).status, 'unknown');
});

test('valid bootstrap config is rejected before reading its nonexistent environment file', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        raw = JSON.parse(await readFile(new URL('../fixtures/deploy/deploy.config.example.json', import.meta.url)));
    const c = { ...raw, ...a.config, mode: 'bootstrap', environmentFile: 'environment.json' };
    assert.equal(validateConfig(c).mode, 'bootstrap');
    await writeFile(a.file, JSON.stringify(c));
    const errors = [];
    assert.equal(
        await main(['--config', a.file, '--artifact', f.root, '--apply'], {
            stdout: assert.fail,
            stderr: s => errors.push(s),
            clientFactory: () => assert.fail('client created'),
        }),
        2,
    );
    assert.equal(JSON.parse(errors[0]).code, 'TARGET_MISMATCH');
});
test('valid-checksum unknown receipt is refused by the completion-state gate', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        migration = await allPhases(f),
        envelope = JSON.parse(await readFile(migration.receipt));
    envelope.payload.status = 'unknown';
    envelope.sha256 = createHash('sha256').update(JSON.stringify(envelope.payload)).digest('hex');
    await writeFile(migration.receipt, JSON.stringify(envelope));
    await assert.rejects(
        verifyMigrationReceipt(migration.receipt, a.config),
        error => error.code === 'RECEIPT_INVALID' && error.message.includes('complete successful verify'),
    );
});

test('verified receipt rejects symlinked parent directories before reading snapshots', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        migration = await allPhases(f);
    await rename(path.join(f.repo, 'scripts'), path.join(f.repo, 'scripts-saved'));
    await symlink(path.join(f.repo, 'scripts-saved'), path.join(f.repo, 'scripts'));
    await assert.rejects(verifyMigrationReceipt(migration.receipt, a.config), { code: 'PRIVATE_STATE_INVALID' });
});

test('dev loader uses a private immutable config copy despite original config changing', async t => {
    const f = await fixture(t),
        a = await artifact(f),
        out = [];
    let copied;
    const raw = JSON.parse(await readFile(new URL('../fixtures/deploy/deploy.config.example.json', import.meta.url)));
    const code = await main(['--config', a.file, '--artifact', f.root], {
        stdout: s => out.push(s),
        stderr: assert.fail,
        load: async options => {
            copied = options.configFile;
            assert.notEqual(copied, a.file);
            // v5 B24 compat: the templates temp-dir prefix is byte-identical (captured on v5 @ 06727a94).
            assert.match(path.basename(path.dirname(copied)), /^templates-dev-config-[A-Za-z0-9]{6}$/);
            assert.equal((await stat(path.dirname(copied))).mode & 0o777, 0o700);
            assert.equal((await stat(copied)).mode & 0o777, 0o600);
            await writeFile(a.file, JSON.stringify({ ...raw, stage: 'prod', environmentFile: 'missing-secret.json' }));
            return loadDeployment(options);
        },
    });
    assert.equal(code, 0);
    const result = JSON.parse(out[0]);
    assert.equal(result.target.stage, 'dev');
    assert.equal(result.mode, 'code');
    assert.equal(await lstat(copied).catch(() => null), null);
});
