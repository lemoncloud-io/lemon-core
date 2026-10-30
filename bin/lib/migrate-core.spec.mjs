/**
 * `bin/lib/migrate-core.spec.mjs` (lemon-core)
 * - offline tests of migrate-core.mjs / migrate-process.mjs (`lemon-lambda-migrate`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/migrate-core.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, chmod, symlink, stat, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture, writeSnapshot, allPhases } from './migrate-test-fixture.mjs';
import {
    validateMigrationConfig,
    targetEnvironment,
    executeMigration,
    readReceipt,
    verifyMigrationReceipt,
    PHASES,
    TARGET,
    validateRepository,
} from './migrate-core.mjs';
import { runPrivateChild } from './migrate-process.mjs';
import { main, parseMigrationArgs } from '../lemon-lambda-migrate.mjs';

//* v5 B19: node:test had no per-test deadline; the process cases (fork/spawn) need more than 5 s on a busy host.
vi.setConfig({ testTimeout: 60_000 });
const receiptFile = f => path.join(f.run, 'templates-receipt.json');

test('migration defaults to offline plan and never invokes STS or canonical child', async t => {
    const f = await fixture(t),
        out = [];
    assert.equal(
        await main(['plan', '--config', f.configFile], { ...f.deps, stdout: s => out.push(s), stderr: assert.fail }),
        0,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(JSON.parse(out[0]).execution, 'offline-plan');
    assert.ok(!(await lstat(f.run).catch(() => null)));
    for (const phase of ['apply', 'verify'])
        assert.equal(
            await main([phase, '--config', f.configFile], { ...f.deps, stdout: () => {}, stderr: assert.fail }),
            0,
        );
    assert.equal(f.calls.length, 0);
});
test('config/args pin templates dev and normalize endpoint', async t => {
    const f = await fixture(t);
    assert.equal(
        validateMigrationConfig({ ...f.raw, endpoint: f.raw.endpoint + '/' }, f.configFile).endpoint,
        f.raw.endpoint,
    );
    for (const patch of [
        { stage: 'prod' },
        { project: 'other-api' },
        { stack: 'other-dev' },
        { migrationRevision: 'a'.repeat(40) },
        { runtime: 'nodejs20.x' },
        { unknown: true },
    ])
        assert.throws(() => validateMigrationConfig({ ...f.raw, ...patch }, f.configFile));
    for (const args of [
        ['all', '--config', 'x'],
        ['plan', '--config', 'a', '--config', 'b'],
        ['apply', '--allow-sensitive-backup', '--config', 'x'],
    ])
        assert.throws(() => parseMigrationArgs(args));
});
test('execution consent and phase gates stop before STS', async t => {
    const f = await fixture(t);
    await assert.rejects(executeMigration(f.config, 'plan', {}, f.deps), { code: 'BACKUP_CONSENT_REQUIRED' });
    await assert.rejects(executeMigration(f.config, 'remove', {}, f.deps), { code: 'STACK_CONFIRMATION_REQUIRED' });
    await assert.rejects(executeMigration(f.config, 'retain', {}, f.deps), { code: 'SEQUENCE_INVALID' });
    await assert.rejects(
        executeMigration({ ...f.config, account: '123456789012' }, 'plan', { allowSensitiveBackup: true }, f.deps),
        { code: 'PLACEHOLDER_INPUT' },
    );
    assert.equal(f.calls.length, 0);
});
test('all phases preserve backups, explicit go boundaries, account gate and private receipt', async t => {
    const f = await fixture(t),
        result = await allPhases(f);
    assert.equal(result.status, 'completed');
    const state = await readReceipt(result.receipt);
    assert.deepEqual(state.completed, PHASES);
    assert.equal(state.deployId, 'dpl_mabc1234_abcdef');
    assert.ok(!JSON.stringify(state).includes('never-print-this-secret-value'));
    assert.equal((await stat(f.run)).mode & 0o777, 0o700);
    assert.equal((await stat(result.receipt)).mode & 0o777, 0o600);
    const executions = f.calls.filter(c => c.mode === 'migration');
    assert.equal(executions.length, 6);
    for (const c of executions) assert.equal(c.args.includes('--go'), ['retain', 'remove', 'tag'].includes(c.args[0]));
    for (let i = 0; i < f.calls.length; i += 2) {
        assert.equal(f.calls[i].mode, 'sts');
        assert.equal(f.calls[i + 1].mode, 'migration');
    }
    assert.equal((await verifyMigrationReceipt(result.receipt, { ...f.config, mode: 'code' })).status, 'verified');
    assert.ok(!(await lstat(path.join(f.run, 'templates.lock')).catch(() => null)));
});
test('wrong STS account prevents snapshot collection and any canonical command', async t => {
    const f = await fixture(t),
        run = f.deps.runChild;
    f.deps.runChild = async r => (r.mode === 'sts' ? { code: 0, reason: 'exited', account: '999999999999' } : run(r));
    await assert.rejects(executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps), {
        code: 'ACCOUNT_MISMATCH',
    });
    assert.equal(f.calls.length, 0);
    assert.equal((await readReceipt(receiptFile(f))).status, 'blocked');
    assert.ok(!(await lstat(path.join(f.run, 'env.json')).catch(() => null)));
});
test('exit zero with plan warnings cannot advance', async t => {
    const f = await fixture(t);
    f.deps.runChild = async r => {
        if (r.mode === 'sts') return { code: 0, reason: 'exited', account: f.config.account };
        await writeSnapshot(f.run, f.config, { warnings: ['unresolved item'] });
        return { code: 0, reason: 'exited' };
    };
    await assert.rejects(executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps), {
        code: 'SNAPSHOT_INVALID',
    });
    await assert.rejects(executeMigration(f.config, 'retain', {}, f.deps), { code: 'SEQUENCE_INVALID' });
});
test('snapshot tampering and target/config drift block removal', async t => {
    for (const file of ['env.json', 'before.json', 'plan.json']) {
        const f = await fixture(t);
        await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps);
        await executeMigration(f.config, 'retain', {}, f.deps);
        const data = JSON.parse(await readFile(path.join(f.run, file)));
        if (file === 'env.json') data['lemon-templates-api-dev-lambda'].SECRET = 'tampered';
        else data.extra = 'tampered';
        await writeFile(path.join(f.run, file), JSON.stringify(data));
        const count = f.calls.length;
        await assert.rejects(executeMigration(f.config, 'remove', { confirmStack: TARGET.stack }, f.deps), {
            code: 'SNAPSHOT_CHANGED',
        });
        assert.equal(f.calls.length, count);
    }
    const f = await fixture(t);
    await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps);
    await assert.rejects(executeMigration({ ...f.config, timeoutMs: 10000 }, 'retain', {}, f.deps), {
        code: 'STATE_MISMATCH',
    });
    const p = JSON.parse(await readFile(path.join(f.run, 'plan.json'))),
        zip = Object.values(p.codeFiles)[0];
    await writeFile(path.join(f.run, zip), 'changed');
    await assert.rejects(executeMigration(f.config, 'retain', {}, f.deps), { code: 'SNAPSHOT_INVALID' });
});
test('unsafe private directories, symlinks and unowned state are refused', async t => {
    for (const kind of ['unowned', 'symlink', 'permissions']) {
        const f = await fixture(t);
        await mkdir(path.dirname(f.run), { recursive: true });
        if (kind === 'symlink') {
            const other = path.join(f.root, 'other');
            await mkdir(other);
            await symlink(other, f.run);
        } else {
            await mkdir(f.run, { mode: kind === 'permissions' ? 0o755 : 0o700 });
        }
        await assert.rejects(executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps));
        assert.equal(f.calls.length, 0);
    }
});
test('failure/timeout leaves unknown state and blocks all subsequent phases', async t => {
    const f = await fixture(t);
    await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps);
    const child = f.deps.runChild;
    f.deps.runChild = r => (r.mode === 'migration' ? Promise.resolve({ code: null, reason: 'timeout' }) : child(r));
    await assert.rejects(executeMigration(f.config, 'retain', {}, f.deps), e => e.unknown && e.exitCode === 3);
    assert.equal((await readReceipt(receiptFile(f))).status, 'unknown');
    assert.ok(await stat(path.join(f.run, 'templates.lock')));
    await assert.rejects(executeMigration(f.config, 'retain', {}, f.deps), { code: 'SEQUENCE_INVALID' });
});
test('concurrent stale reader reloads receipt under lock and cannot replay a phase', async t => {
    const f = await fixture(t);
    await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps);
    let notify;
    const reached = new Promise(r => (notify = r));
    let release;
    const held = new Promise(r => (release = r));
    const stale = executeMigration(
        f.config,
        'retain',
        {},
        {
            ...f.deps,
            beforeLock: async () => {
                notify();
                await held;
            },
        },
    );
    await reached;
    await executeMigration(f.config, 'retain', {}, f.deps);
    release();
    await assert.rejects(stale, { code: 'SEQUENCE_INVALID' });
    assert.equal(f.calls.filter(c => c.mode === 'migration' && c.args[0] === 'retain').length, 1);
    assert.deepEqual((await readReceipt(receiptFile(f))).completed, ['plan', 'retain']);
});
test('target environment prevents ambient profile/endpoint/credential drift', async t => {
    const f = await fixture(t),
        env = targetEnvironment(f.config, {
            PATH: '/bin',
            AGT_BASE: 'wrong',
            AGT_PROFILE: 'wrong',
            AWS_ENDPOINT_URL: 'wrong',
            AWS_ENDPOINT_URL_STS: 'wrong',
            AWS_ACCESS_KEY_ID: 'secret',
            AWS_SECRET_ACCESS_KEY: 'secret',
            NODE_OPTIONS: '--inspect',
            GIT_DIR: 'wrong',
        });
    assert.equal(env.AGT_BASE, f.config.endpoint);
    assert.equal(env.AWS_PROFILE, f.config.profile);
    assert.equal(env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS, 'true');
    for (const key of [
        'AWS_ENDPOINT_URL',
        'AWS_ENDPOINT_URL_STS',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'NODE_OPTIONS',
        'GIT_DIR',
    ])
        assert.ok(!(key in env));
});
test('real private process returns success, suppresses output, captures only strict deployId and applies umask', async t => {
    const f = await fixture(t),
        script = path.join(f.root, 'child.mjs'),
        output = path.join(f.root, 'private-output');
    await writeFile(
        script,
        `import{writeFileSync}from'node:fs';console.log('secret-value');console.error('signed-url-secret');console.log('12:01:01 deployId token-looking-secret');console.log('12:01:01 deployId dpl_wrong_nothex');console.log('12:01:01 deployId dpl_mabc1234_123abc');writeFileSync(${JSON.stringify(
            output,
        )},'private');`,
    );
    const progress = [];
    const result = await runPrivateChild({
        mode: 'migration',
        command: script,
        cwd: f.root,
        environment: { PATH: process.env.PATH },
        timeoutMs: 2000,
        onProgress: x => progress.push(x),
    });
    assert.equal(result.code, 0);
    assert.equal(result.reason, 'exited');
    assert.deepEqual(progress, [{ deployId: 'dpl_mabc1234_123abc' }]);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(result).includes('secret'));
    const sts = await runPrivateChild({
        mode: 'sts',
        command: process.execPath,
        args: ['-e', 'console.log(JSON.stringify({Account:"234567890123"}))'],
        cwd: f.root,
        environment: { PATH: process.env.PATH },
        timeoutMs: 2000,
    });
    assert.deepEqual(sts, { code: 0, reason: 'exited', account: '234567890123' });
});
test('real private process deadline and cancellation return uncertainty without raw errors', async t => {
    const f = await fixture(t),
        script = path.join(f.root, 'hang.mjs');
    await writeFile(script, 'await new Promise(()=>{});');
    const result = await runPrivateChild({
        mode: 'migration',
        command: script,
        cwd: f.root,
        environment: { PATH: process.env.PATH },
        timeoutMs: 80,
    });
    assert.equal(result.reason, 'timeout');
    assert.equal(result.code, null);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const stopped = await runPrivateChild({
        mode: 'migration',
        command: script,
        cwd: f.root,
        environment: { PATH: process.env.PATH },
        timeoutMs: 2000,
        signal: controller.signal,
    });
    assert.equal(stopped.reason, 'interrupted');
});
async function pinnedFixture(t) {
    const f = await fixture(t),
        exec = promisify(execFile);
    await mkdir(path.join(f.repo, 'scripts/agt'), { recursive: true });
    await writeFile(path.join(f.repo, 'scripts/migrate/migrate.mjs'), 'export {};');
    await writeFile(path.join(f.repo, 'scripts/agt/common.mjs'), 'export {};');
    const git = async args => (await exec('git', ['-C', f.repo, ...args])).stdout.trim();
    await git(['init']);
    await git(['add', '.']);
    await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    await git(['remote', 'add', 'origin', 'https://github.com/lemoncloud-io/eureka-deploy-api.git']);
    const revision = await git(['rev-parse', 'HEAD']);
    return { ...f, git, revision };
}
test('pinned repository validator checks origin/revision/tracked changes without network', async t => {
    const f = await pinnedFixture(t),
        { revision } = f;
    assert.equal(await validateRepository(f.config, { revision }), f.repo);
    await assert.rejects(validateRepository(f.config), { code: 'REVISION_MISMATCH' });
    await writeFile(path.join(f.repo, 'scripts/agt/common.mjs'), 'export const dirty=true;');
    await assert.rejects(validateRepository(f.config, { revision }), { code: 'REPOSITORY_DIRTY' });
});

test('final deployId line is persisted before process completion returns', async t => {
    const f = await fixture(t),
        script = path.join(f.root, 'final-line.mjs');
    await writeFile(script, "process.stdout.write('12:01:01 deployId dpl_mabc1234_fedcba\\n');");
    let saved = false;
    const result = await runPrivateChild({
        mode: 'migration',
        command: script,
        cwd: f.root,
        environment: { PATH: process.env.PATH },
        timeoutMs: 2000,
        onProgress: async () => {
            await new Promise(r => setTimeout(r, 30));
            saved = true;
        },
    });
    assert.equal(result.code, 0);
    assert.equal(saved, true);
});

test('parent SIGKILL preserves in-flight receipt and lock and kills its owned migration child', async t => {
    const f = await fixture(t),
        pidFile = path.join(f.root, 'child.pid'),
        childFile = path.join(f.repo, 'scripts/migrate/migrate.mjs'),
        outerFile = path.join(f.root, 'outer.mjs');
    await writeFile(
        childFile,
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(
            pidFile,
        )},String(process.pid));await new Promise(()=>{});`,
    );
    const core = new URL('./migrate-core.mjs', import.meta.url).href,
        runner = new URL('./migrate-process.mjs', import.meta.url).href;
    await writeFile(
        outerFile,
        `import {executeMigration} from ${JSON.stringify(core)};import {runPrivateChild} from ${JSON.stringify(
            runner,
        )};const c=${JSON.stringify(
            f.config,
        )};await executeMigration(c,'plan',{allowSensitiveBackup:true},{validateRepository:async()=>c.migrationRepo,runChild:r=>r.mode==='sts'?Promise.resolve({code:0,reason:'exited',account:c.account}):runPrivateChild(r)});`,
    );
    const outer = spawn(process.execPath, [outerFile], { cwd: f.root, stdio: 'ignore' });
    let childPid;
    onTestFinished(() => {
        try {
            outer.kill('SIGKILL');
        } catch {}
        if (childPid)
            try {
                process.kill(-childPid, 'SIGKILL');
            } catch {}
    });
    const until = async fn => {
        const end = Date.now() + 3000;
        while (Date.now() < end) {
            if (await fn()) return;
            await new Promise(r => setTimeout(r, 20));
        }
        assert.fail('fixture process state deadline');
    };
    await until(async () => {
        childPid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
        return childPid > 0;
    });
    const closed = new Promise(resolve => outer.once('close', resolve));
    outer.kill('SIGKILL');
    await closed;
    await until(() => {
        try {
            process.kill(childPid, 0);
            return false;
        } catch (error) {
            return error.code === 'ESRCH';
        }
    });
    const receipt = await readReceipt(receiptFile(f));
    assert.equal(receipt.status, 'in-flight');
    assert.equal(receipt.steps[0].boundary, 'canonical-migration');
    assert.ok(await stat(path.join(f.run, 'templates.lock')));
    await assert.rejects(executeMigration(f.config, 'retain', {}, f.deps), { code: 'SEQUENCE_INVALID' });
    assert.equal(f.calls.length, 0);
});

test('pinned source bytes reject hidden entry/import modifications', async t => {
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
        for (const rel of ['scripts/migrate/migrate.mjs', 'scripts/agt/common.mjs']) {
            const f = await pinnedFixture(t);
            await f.git(['update-index', flag, rel]);
            await writeFile(path.join(f.repo, rel), 'export const hiddenModification=true;');
            assert.equal(await f.git(['status', '--porcelain', '--untracked-files=no']), '');
            await assert.rejects(
                validateRepository(f.config, { revision: f.revision }),
                error => error.code === 'REPOSITORY_DIRTY' && error.message.includes('pinned Git blob'),
            );
        }
    }
});
test('pinned source rejects redirected scripts and migration/import ancestors', async t => {
    for (const rel of ['scripts', 'scripts/migrate', 'scripts/agt']) {
        const f = await pinnedFixture(t);
        await f.git(['update-index', '--assume-unchanged', 'scripts/migrate/migrate.mjs', 'scripts/agt/common.mjs']);
        const original = path.join(f.repo, rel),
            saved = path.join(f.root, 'redirected');
        await rename(original, saved);
        await symlink(saved, original);
        assert.equal(await f.git(['status', '--porcelain', '--untracked-files=no']), '');
        await assert.rejects(
            validateRepository(f.config, { revision: f.revision }),
            error => error.code === 'REPOSITORY_INVALID' && error.message.includes('ancestors'),
        );
    }
});
