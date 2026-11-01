/**
 * `bin/lib/guard-cli.spec.mjs` (lemon-core)
 * - offline tests of the B31 `lemon-lambda-guard` commands (`bin/lib/guard-cli.mjs`): init (normal, refused twice,
 *   input errors, rollback), register (normal, enum / path / target refusals), status, resolve (normal,
 *   `INVALID_INPUT`, unknown operation) and help.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`). Temp dirs under `os.tmpdir()`, free loopback ports; no AWS, no network.
 */
//* v5 B31: new spec of the guard CLI.
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { TARGETS } from './migrate-core.mjs';
import { INSTALL_ENV, loadInstall, readRegistry, guardedWrite, runStateRefOf } from './migrate-guard.mjs';
import { main, parseGuardArgs, GUARD_HELP } from './guard-cli.mjs';
import { fixture as migrationFixture } from './migrate-test-fixture.mjs';
import { guardFixture, guardTemp, freePort } from './guard-test-fixture.mjs';

//* v5 B31: the cases listen on loopback ports a few times.
vi.setConfig({ testTimeout: 60_000 });

// the templates reviewed target and the fixture installation values.
const TEMPLATES = TARGETS.find(t => t.project === 'lemon-templates-api');
const ACCOUNT = '234567890123';
const REGION = 'ap-northeast-2';
// sha256 hex of a text.
const sha = text => createHash('sha256').update(text).digest('hex');

// run one command; returns the exit code and the stdout / stderr lines.
async function cli(argv, deps = {}) {
    const out = [],
        err = [];
    const code = await main(argv, { ...deps, stdout: s => out.push(s), stderr: s => err.push(s) });
    // a JSON line or undefined (the help text is not JSON).
    const parse = line => {
        try {
            return JSON.parse(line);
        } catch {
            return undefined;
        }
    };
    return { code, out, err, json: parse(out[0]), error: parse(err[0]) };
}

// a proxy that records every property read (a guard fs / net that must stay untouched).
const untouched = touched => new Proxy({}, { get: (_, k) => (touched.push(String(k)), undefined) });

// the register argv of a config with settled run-state values (overridable).
const registerArgs = (configFile, runRef, over = {}) => {
    const v = { runState: 'completed', class: 'verified-no-op', baselineKind: 'run-receipt', ...over };
    return [
        'register',
        '--config',
        configFile,
        '--run-state',
        v.runState,
        '--class',
        v.class,
        '--baseline-kind',
        v.baselineKind,
        '--run-ref',
        runRef,
    ];
};

// a deploy config of `project` (dev stage, code mode) in `dir`.
async function deployConfig(dir, project) {
    const file = path.join(dir, `${project}.deploy.json`);
    await writeFile(
        file,
        JSON.stringify({
            schemaVersion: 1,
            mode: 'code',
            project,
            stage: 'dev',
            region: REGION,
            account: ACCOUNT,
            profile: 'local-fixture',
            endpoint: `https://localfixture.execute-api.${REGION}.amazonaws.com/dev`,
            artifactBucket: `${ACCOUNT}-deploy-artifacts`,
            keyPrefix: `${project}/dev`,
        }),
    );
    return file;
}

// why: the help names every command and the exit codes; arguments outside a command are input errors.
test('help prints the usage (exit 0); unknown, repeated or missing options are INVALID_ARGS (exit 2)', async () => {
    for (const argv of [['--help'], ['-h'], ['status', '--help']]) {
        const r = await cli(argv);
        assert.deepEqual([r.code, r.out, r.err], [0, [GUARD_HELP], []]);
    }
    assert.match(GUARD_HELP, /^Usage: lemon-lambda-guard <init\|register\|status\|resolve>/);
    for (const argv of [
        [],
        ['bogus'],
        ['status'],
        ['status', '--config'],
        ['status', '--config', 'a', '--config', 'b'],
        ['init', '--root', '/x', '--port', '2000'],
        ['resolve', '--operation', 'x', '--ref', 'y', '--digest', 'z', '--extra', 'w'],
    ]) {
        const r = await cli(argv);
        assert.equal(r.code, 2, argv.join(' '));
        assert.deepEqual(Object.keys(r.error), ['status', 'code', 'message']);
        assert.deepEqual([r.error.status, r.error.code], ['failed', 'INVALID_ARGS']);
        assert.equal(r.err[0].includes('\n'), false);
    }
    assert.deepEqual(parseGuardArgs(['status', '--config', 'c.json']), { command: 'status', configFile: 'c.json' });
});

// why: D-7 — init writes the install file once (0600) and sets up its root; a second init is refused.
test('init writes the install file and the root; a second init is INSTALL_EXISTS and changes nothing', async () => {
    const base = await guardTemp();
    const installFile = path.join(base, 'home', '.lemon-core', 'migration-guard.install.json');
    const env = { [INSTALL_ENV]: installFile };
    const root = path.join(base, 'root');
    const port = await freePort();
    const now = () => new Date('2026-11-01T01:02:03.000Z');
    const deps = { env, hostname: () => 'spec-host', now };
    const r = await cli(['init', '--root', root, '--port', String(port), '--confirmed-by', 'spec operator'], deps);
    assert.equal(r.code, 0, r.err.join());
    assert.deepEqual(r.json, { status: 'initialized', installFile, root, port });
    const written = JSON.parse(await readFile(installFile, 'utf8'));
    assert.deepEqual(written, {
        schemaVersion: 1,
        root,
        port,
        machineId: sha('spec-host').slice(0, 16),
        localVolume: { confirmedBy: 'spec operator', at: '2026-11-01T01:02:03.000Z' },
    });
    assert.equal((await stat(installFile)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(root)).sort(), ['install.json', 'journal', 'registry.json']);
    const install = await loadInstall({ env });
    assert.deepEqual([install.root, install.port], [root, port]);
    // a second init (any root) is refused; the install file and the root stay as they were.
    const before = await readFile(installFile, 'utf8');
    const again = await cli(
        ['init', '--root', path.join(base, 'root2'), '--port', String(port), '--confirmed-by', 'x'],
        deps,
    );
    assert.deepEqual([again.code, again.error.code], [1, 'INSTALL_EXISTS']);
    assert.equal(await readFile(installFile, 'utf8'), before);
    assert.equal(await stat(path.join(base, 'root2')).catch(() => null), null);
    assert.ok(!again.err[0].includes(base));
});

// why: init input errors are exit 2; a root that exists already rolls the new install file back (exit 1).
test('init refuses a relative root, a port outside 1024..65535 and a blank name; an existing root is rolled back', async () => {
    const base = await guardTemp();
    const env = { [INSTALL_ENV]: path.join(base, 'install.json') };
    for (const [root, port, name] of [
        ['relative/root', '2000', 'x'],
        [path.join(base, 'r'), '80', 'x'],
        [path.join(base, 'r'), '70000', 'x'],
        [path.join(base, 'r'), '2000.5', 'x'],
        [path.join(base, 'r'), '2000', '   '],
    ]) {
        const r = await cli(['init', '--root', root, '--port', port, '--confirmed-by', name], { env });
        assert.deepEqual([r.code, r.error.code], [2, 'INVALID_ARGS'], `${root} ${port}`);
    }
    // the install file inside the root is an input error too.
    const inside = await cli(['init', '--root', base, '--port', '2000', '--confirmed-by', 'x'], {
        env: { [INSTALL_ENV]: path.join(base, 'in-root.json') },
    });
    assert.deepEqual([inside.code, inside.error.code], [2, 'INVALID_INPUT']);
    // an existing root: initializeRoot refuses it, and the install file just written is removed again.
    const existing = path.join(base, 'existing');
    await mkdir(existing);
    const r = await cli(['init', '--root', existing, '--port', String(await freePort()), '--confirmed-by', 'x'], {
        env,
    });
    assert.deepEqual([r.code, r.error.code], [1, 'ROOT_EXISTS']);
    assert.equal(await stat(env[INSTALL_ENV]).catch(() => null), null);
    assert.deepEqual(await readdir(existing), []);
});

// why: D-7 — register takes the identity and the expected account / region from a validated config.
test('register adds a reviewed target from a migration config; status turns from not-registered to ready', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: ACCOUNT, region: REGION, targets: [] });
    const runRef = path.join(f.run);
    const blocked = await cli(['status', '--config', f.configFile], { env: g.env });
    assert.equal(blocked.code, 1);
    assert.deepEqual(blocked.json, {
        applicability: 'applicable',
        status: 'blocked',
        reason: 'not-registered',
        identity: { project: TEMPLATES.project, stage: 'dev', stack: TEMPLATES.stack },
    });
    const r = await cli(registerArgs(f.configFile, runRef), { env: g.env });
    assert.equal(r.code, 0, r.err.join());
    assert.equal(r.json.status, 'registered');
    assert.equal(r.json.replaced, false);
    assert.deepEqual(
        { ...r.json.entry, registeredAt: '<t>' },
        {
            identity: { project: TEMPLATES.project, stage: 'dev', stack: TEMPLATES.stack },
            account: ACCOUNT,
            region: REGION,
            runStateRef: runStateRefOf(runRef),
            class: 'verified-no-op',
            runState: 'completed',
            baselineKind: 'run-receipt',
            registeredAt: '<t>',
        },
    );
    // the run-state path itself is never stored or printed.
    assert.ok(!r.out[0].includes(runRef));
    const registry = await readRegistry(g.install);
    assert.deepEqual(Object.keys(registry.entries), [`${ACCOUNT}/${REGION}/dev/${TEMPLATES.project}`]);
    const ready = await cli(['status', '--config', f.configFile], { env: g.env });
    assert.deepEqual([ready.code, ready.json.status], [0, 'ready']);
    // a deploy config of the same target names the same entry (stack from the registry).
    const deployFile = await deployConfig(f.root, TEMPLATES.project);
    const viaDeploy = await cli(['status', '--config', deployFile], { env: g.env });
    assert.deepEqual([viaDeploy.code, viaDeploy.json.status], [0, 'ready']);
    // registering again keeps the previous entry in history.
    const again = await cli(registerArgs(deployFile, runRef, { runState: 'none', baselineKind: 'first-observation' }), {
        env: g.env,
    });
    assert.deepEqual([again.code, again.json.replaced], [0, true]);
    const [entry] = Object.values((await readRegistry(g.install)).entries);
    assert.deepEqual([entry.runState, entry.history.length], ['none', 1]);
});

// why: D-7 — enums, a relative run-state path and a target outside the registry are input errors (exit 2).
test('register refuses values outside the enums, a relative run-ref and a target outside the registry', async t => {
    const f = await migrationFixture(t);
    const g = await guardFixture({ account: ACCOUNT, region: REGION, targets: [] });
    for (const over of [{ runState: 'done' }, { class: 'ok' }, { baselineKind: 'guess' }]) {
        const r = await cli(registerArgs(f.configFile, f.run, over), { env: g.env });
        assert.deepEqual([r.code, r.error.code], [2, 'INVALID_INPUT'], JSON.stringify(over));
    }
    const relative = await cli(registerArgs(f.configFile, 'runs/stack'), { env: g.env });
    assert.deepEqual([relative.code, relative.error.code], [2, 'INVALID_INPUT']);
    const other = await cli(registerArgs(await deployConfig(f.root, 'sample-x-api'), f.run), { env: g.env });
    assert.deepEqual([other.code, other.error.code], [2, 'TARGET_MISMATCH']);
    const unreadable = await cli(registerArgs(path.join(f.root, 'missing.json'), f.run), { env: g.env });
    assert.deepEqual([unreadable.code, unreadable.error.code], [2, 'INVALID_INPUT']);
    // no message carries a path or the account.
    for (const r of [relative, other, unreadable]) assert.ok(!r.err[0].includes(f.root) && !r.err[0].includes(ACCOUNT));
    assert.deepEqual((await readRegistry(g.install)).entries, {});
});

// why: D-7 — status prints guardStatus as is; outside the registry it is not-applicable with no guard state I/O.
test('status of a target outside the registry is not-applicable (exit 0) without guard state I/O', async () => {
    const base = await guardTemp();
    const touched = [];
    const guardDeps = { fs: untouched(touched), net: untouched(touched), homedir: () => touched.push('homedir') };
    const r = await cli(['status', '--config', await deployConfig(base, 'sample-x-api')], { env: {}, guardDeps });
    assert.deepEqual([r.code, r.json], [0, { applicability: 'not-applicable', reason: 'outside-registry' }]);
    assert.deepEqual(touched, []);
    // a reviewed target without an installation: blocked install-invalid (exit 1).
    const missing = await cli(['status', '--config', await deployConfig(base, TEMPLATES.project)], {
        env: { [INSTALL_ENV]: path.join(base, 'none.json') },
    });
    assert.deepEqual([missing.code, missing.json.status, missing.json.reason], [1, 'blocked', 'install-invalid']);
});

// why: D-7 — resolve records the owner decision; the target is ready again; bad inputs are INVALID_INPUT.
test('resolve clears an unknown operation with a decision; invalid decisions are INVALID_INPUT, unknown ids not found', async () => {
    const base = await guardTemp();
    const g = await guardFixture({ account: ACCOUNT, region: REGION });
    const configFile = await deployConfig(base, TEMPLATES.project);
    // an unknown write of the target (the adapter throws after the inflight record).
    const operationId = await guardedWrite({
        input: { project: TEMPLATES.project, stage: 'dev' },
        expected: { account: ACCOUNT, region: REGION },
        env: g.env,
        holder: 'spec-session',
        adapter: {
            write: async () => {
                throw new Error('lost connection');
            },
        },
    }).catch(e => e.operationId);
    const blocked = await cli(['status', '--config', configFile], { env: g.env });
    assert.deepEqual([blocked.code, blocked.json.reason], [1, 'journal-unresolved']);
    const digest = sha('owner decision text');
    for (const [op, ref, dig] of [
        [operationId, 'D1@8f6396aa', 'not-a-digest'],
        [operationId, 'ticket-123456789012', digest],
        [operationId, 'has space', digest],
        ['not-a-uuid', 'D1@8f6396aa', digest],
    ]) {
        const r = await cli(['resolve', '--operation', op, '--ref', ref, '--digest', dig], { env: g.env });
        assert.deepEqual([r.code, r.error.code], [2, 'INVALID_INPUT'], ref);
        assert.ok(!r.err[0].includes('123456789012'));
    }
    const notFound = await cli(
        ['resolve', '--operation', '00000000-0000-4000-8000-000000000000', '--ref', 'D1@8f6396aa', '--digest', digest],
        { env: g.env },
    );
    assert.deepEqual([notFound.code, notFound.error.code], [1, 'OPERATION_NOT_FOUND']);
    const r = await cli(['resolve', '--operation', operationId, '--ref', 'D1@8f6396aa', '--digest', digest], {
        env: g.env,
    });
    assert.equal(r.code, 0, r.err.join());
    assert.deepEqual(
        [r.json.status, r.json.operationId, r.json.state, r.json.resolution.decision],
        ['resolved', operationId, 'unknown', { ref: 'D1@8f6396aa', digest }],
    );
    const ready = await cli(['status', '--config', configFile], { env: g.env });
    assert.deepEqual([ready.code, ready.json.status], [0, 'ready']);
    // a second resolve is refused (append-only).
    const twice = await cli(['resolve', '--operation', operationId, '--ref', 'D2@8f6396aa', '--digest', digest], {
        env: g.env,
    });
    assert.deepEqual([twice.code, twice.error.code], [1, 'OPERATION_RESOLVED']);
});

// why: a command that needs the installation fails with the guard code and no path when it is missing.
test('register / resolve without an installation fail with INSTALL_INVALID (exit 1), no path in the message', async t => {
    const f = await migrationFixture(t);
    const env = { [INSTALL_ENV]: path.join(f.root, 'none.json') };
    const reg = await cli(registerArgs(f.configFile, f.run), { env });
    const res = await cli(
        [
            'resolve',
            '--operation',
            '00000000-0000-4000-8000-000000000000',
            '--ref',
            'D1@8f6396aa',
            '--digest',
            sha('x'),
        ],
        { env },
    );
    for (const r of [reg, res]) {
        assert.deepEqual([r.code, r.error.code], [1, 'INSTALL_INVALID']);
        assert.ok(!r.err[0].includes(f.root));
    }
});
