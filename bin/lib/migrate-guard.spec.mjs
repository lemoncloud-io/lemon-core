/**
 * `bin/lib/migrate-guard.spec.mjs` (lemon-core)
 * - offline tests of the B30 migration guard (`bin/lib/migrate-guard.mjs`): N14 inside / outside the reviewed
 *   registry, the host lock, the journal and its recovery (V12), and the secret canary (V13).
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`). Temp dirs under `os.tmpdir()`; loopback listens on free ports
 *   only (`listen(0)` then closed); fake adapters; no AWS, no network.
 */
//* v5 B30: new spec of the migration guard library.
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, stat, realpath } from 'node:fs/promises';
import { fork } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { TARGETS } from './migrate-core.mjs';
import {
    classifyTarget,
    loadInstall,
    initializeRoot,
    acquireHostLock,
    readRegistry,
    registerTarget,
    operationState,
    resolveOperation,
    guardedWrite,
    guardStatus,
    unsupportedVolume,
    runStateRefOf,
    BLOCKED_REASONS,
} from './migrate-guard.mjs';

//* v5 B30: the child-process and lock cases start Node and listen a few times.
vi.setConfig({ testTimeout: 60_000 });

// the expected account / region of the private config (synthetic; not a canary).
const EXPECTED = Object.freeze({ account: '123456789012', region: 'ap-northeast-2' });
// two reviewed targets (A, B) and one general deploy target (C) outside the registry.
const [A, B] = TARGETS;
const C = Object.freeze({ project: 'other-api', stage: 'dev' });
// the target input of a registry entry (project + stage, stack left to the registry).
const inputOf = t => ({ project: t.project, stage: t.stage });

// a fresh real-path temp dir, removed after the test.
async function temp() {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lemon-guard-')));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

// a free loopback port: listen on 0, read the port, close.
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

// listen on a port with a plain server (another holder of the port).
async function occupy(port) {
    const server = net.createServer(s => s.destroy());
    await new Promise(resolve => server.listen({ host: '127.0.0.1', port }, resolve));
    onTestFinished(() => new Promise(resolve => server.close(() => resolve())));
    return server;
}

// the install file contents of a root and a port (synthetic installation).
const installJson = (root, port, extra = {}) => ({
    schemaVersion: 1,
    root,
    port,
    machineId: 'spec-machine',
    localVolume: { confirmedBy: 'spec fixture (local temp dir)', at: '2026-11-01T00:00:00.000Z' },
    ...extra,
});

// a registry entry of a target with the expected account / region.
const entryOf = (t, over = {}) => ({
    identity: { project: t.project, stage: t.stage, stack: t.stack },
    account: EXPECTED.account,
    region: EXPECTED.region,
    runStateRef: runStateRefOf(`runs/${t.stack}`),
    class: 'verified-no-op',
    runState: 'completed',
    baselineKind: 'run-receipt',
    ...over,
});

/** an installation: install file outside the root, root initialized (optional), targets registered (optional). */
async function setup({ init = true, register = [A, B], config = {} } = {}) {
    const base = await temp();
    const root = path.join(base, 'root');
    const port = await freePort();
    const installFile = path.join(base, 'guard-install.json');
    await writeFile(installFile, JSON.stringify(installJson(root, port, config)), { mode: 0o600 });
    let install = null;
    if (init) {
        await initializeRoot({ root, port, machineId: 'spec-machine' });
        install = await loadInstall({ installFile, env: {} });
        for (const t of register) await registerTarget(install, entryOf(t));
    }
    return { base, root, port, installFile, install };
}

// a fake adapter that counts its calls; `write` runs `impl` (default: a completed write).
const fakeAdapter = (impl = async () => ({ requestIds: ['req-1'], receiptDigest: 'a'.repeat(64) })) => {
    const calls = { write: 0, passthrough: 0, args: [] };
    return {
        calls,
        write: async args => {
            calls.write++;
            calls.args.push(args);
            return impl(args);
        },
        passthrough: async () => {
            calls.passthrough++;
            return 'general-deploy-result';
        },
    };
};

// the guarded write of a target in an installation (one place for the common arguments).
const write = (s, t, adapter, over = {}) =>
    guardedWrite({
        input: inputOf(t),
        expected: EXPECTED,
        install: s.installFile,
        env: {},
        adapter,
        holder: 'spec-session',
        ...over,
    });

// the journal files of a root (name → parsed record).
async function journal(root) {
    const dir = path.join(root, 'journal');
    const names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort();
    return Promise.all(
        names.map(async name => ({ name, rec: JSON.parse(await readFile(path.join(dir, name), 'utf8')) })),
    );
}

// every file below a dir (relative path → text).
async function tree(dir) {
    const out = {};
    for (const e of await readdir(dir, { withFileTypes: true, recursive: true }))
        if (e.isFile())
            out[path.relative(dir, path.join(e.parentPath, e.name))] = await readFile(
                path.join(e.parentPath, e.name),
                'utf8',
            );
    return out;
}

// a proxy that records every property read (an fs / net spy that must stay untouched).
const untouched = touched => new Proxy({}, { get: (_, k) => (touched.push(String(k)), undefined) });

//* ---- V12: N14 inside / outside the registry, lock, journal, recovery ----

// why: N14 — a general deploy outside the registry must keep its own path with no guard state I/O at all.
test('V12-1 outside the registry: not-applicable, passthrough once, no fs / net access, no port taken', async () => {
    const base = await temp();
    const missing = path.join(base, 'no-install.json');
    const touched = [];
    const deps = { fs: untouched(touched), net: untouched(touched) };
    const adapter = fakeAdapter();
    const env = { LEMON_MIGRATION_GUARD_INSTALL: missing, MIGRATION_STATE_DIR: path.join(base, 'no-root') };
    const r = await guardedWrite({ input: C, expected: EXPECTED, install: missing, env, adapter, holder: 'h', deps });
    assert.deepEqual(r, {
        applicability: 'not-applicable',
        reason: 'outside-registry',
        adapterResult: 'general-deploy-result',
    });
    assert.equal(adapter.calls.passthrough, 1);
    assert.equal(adapter.calls.write, 0);
    // no expected / holder is even needed outside the registry.
    const r2 = await guardedWrite({ input: { ...C, stack: 'other-api-dev' }, adapter, deps });
    assert.equal(r2.applicability, 'not-applicable');
    assert.deepEqual(await guardStatus(C, undefined, { install: missing, env, deps }), {
        applicability: 'not-applicable',
        reason: 'outside-registry',
    });
    assert.deepEqual(touched, []);
    assert.deepEqual(await readdir(base), []);
});

// why: an applicable target without a root must stop before the adapter and create nothing.
test('V12-2 inside the registry without a root: blocked root-missing, adapter not called, no file created', async () => {
    const s = await setup({ init: false });
    const before = await readdir(s.base);
    const adapter = fakeAdapter();
    const r = await write(s, A, adapter);
    assert.deepEqual(r, {
        applicability: 'applicable',
        status: 'blocked',
        reason: 'root-missing',
        identity: { project: A.project, stage: A.stage, stack: A.stack },
    });
    assert.equal(adapter.calls.write, 0);
    assert.equal(adapter.calls.passthrough, 0);
    assert.deepEqual(await readdir(s.base), before);
    assert.equal((await guardStatus(inputOf(A), EXPECTED, { install: s.installFile, env: {} })).reason, 'root-missing');
    assert.ok(BLOCKED_REASONS.includes('root-missing'));
});

// why: registration never decides applicability; the checkout (cwd) never changes the answer; stack rules hold.
test('V12-3 registration, checkout independence and the stack rule', async () => {
    const s = await setup();
    // a deleted registration: still applicable, blocked not-registered.
    const reg = JSON.parse(await readFile(path.join(s.root, 'registry.json'), 'utf8'));
    await writeFile(path.join(s.root, 'registry.json'), JSON.stringify({ ...reg, entries: {} }), { mode: 0o600 });
    const adapter = fakeAdapter();
    const r = await write(s, A, adapter);
    assert.equal(r.applicability, 'applicable');
    assert.equal(r.reason, 'not-registered');
    assert.equal(adapter.calls.write, 0);
    // registered again: the result is the same from another checkout (cwd).
    await registerTarget(s.install, entryOf(A));
    const cwd = process.cwd();
    const other = await temp();
    let fromOther;
    try {
        process.chdir(other);
        fromOther = await guardStatus(inputOf(A), EXPECTED, { install: s.installFile, env: {} });
    } finally {
        process.chdir(cwd);
    }
    assert.deepEqual(fromOther, await guardStatus(inputOf(A), EXPECTED, { install: s.installFile, env: {} }));
    assert.equal(fromOther.status, 'ready');
    // another stack: refused (TARGET_MISMATCH), not read as outside the registry.
    assert.throws(() => classifyTarget({ ...inputOf(A), stack: `${A.stack}-x` }), { code: 'TARGET_MISMATCH' });
    await assert.rejects(write(s, A, adapter, { input: { ...inputOf(A), stack: 'x' } }), { code: 'TARGET_MISMATCH' });
    assert.equal(adapter.calls.write, 0);
    // no stack: the registry value is used.
    const c = classifyTarget(inputOf(A));
    assert.deepEqual(c.identity, { project: A.project, stage: A.stage, stack: A.stack });
    const done = await write(s, A, adapter);
    assert.equal(done.status, 'completed');
    assert.equal(adapter.calls.args[0].identity.stack, A.stack);
    // exact match only: no trim / case folding.
    assert.equal(classifyTarget({ project: ` ${A.project}`, stage: A.stage }).applicability, 'not-applicable');
    assert.equal(classifyTarget({ project: A.project.toUpperCase(), stage: A.stage }).applicability, 'not-applicable');
    assert.throws(() => classifyTarget({ project: A.project }), { code: 'INVALID_INPUT' });
    assert.throws(() => classifyTarget(null), { code: 'INVALID_INPUT' });
    // a target registered under another account / region is an identity mismatch.
    const moved = await guardStatus(
        inputOf(A),
        { ...EXPECTED, account: '210987654321' },
        { install: s.installFile, env: {} },
    );
    assert.equal(moved.reason, 'identity-mismatch');
    // a registry entry whose stack differs (an older list) is an identity mismatch too.
    const now = JSON.parse(await readFile(path.join(s.root, 'registry.json'), 'utf8'));
    const key = `${EXPECTED.account}/${EXPECTED.region}/${A.stage}/${A.project}`;
    now.entries[key].identity.stack = 'older-stack';
    await writeFile(path.join(s.root, 'registry.json'), JSON.stringify(now), { mode: 0o600 });
    assert.equal((await write(s, A, adapter)).reason, 'identity-mismatch');
});

// why: one unresolved operation of any target blocks every reviewed target of the installation, never a general one.
test('V12-4 journal unknown of A blocks B (journal-unresolved); C outside stays not-applicable', async () => {
    const s = await setup();
    const boom = fakeAdapter(async () => {
        throw new Error('network reset');
    });
    await assert.rejects(write(s, A, boom), { code: 'WRITE_UNKNOWN' });
    const adapterB = fakeAdapter();
    assert.deepEqual(await write(s, B, adapterB), {
        applicability: 'applicable',
        status: 'blocked',
        reason: 'journal-unresolved',
        identity: { project: B.project, stage: B.stage, stack: B.stack },
    });
    assert.equal(adapterB.calls.write, 0);
    const adapterC = fakeAdapter();
    const c = await write(s, C, adapterC);
    assert.equal(c.applicability, 'not-applicable');
    assert.equal(adapterC.calls.passthrough, 1);
    // the lock was released after the blocked call.
    const lock = await acquireHostLock({ port: s.port, holder: 'after' });
    await lock.release();
});

// why: the host lock admits one holder at a time and is free again after release.
test('V12-5 two concurrent acquireHostLock: one wins, one LOCK_BUSY; free again after release', async () => {
    const port = await freePort();
    const results = await Promise.allSettled([
        acquireHostLock({ port, holder: 'one' }),
        acquireHostLock({ port, holder: 'two' }),
    ]);
    const won = results.filter(r => r.status === 'fulfilled');
    const lost = results.filter(r => r.status === 'rejected');
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, 'LOCK_BUSY');
    const lock = won[0].value;
    assert.equal(lock.port, port);
    assert.ok(Date.parse(lock.acquiredAt));
    // a connection gets no data and is closed.
    const bytes = await new Promise((resolve, reject) => {
        let n = 0;
        const socket = net.connect({ host: '127.0.0.1', port });
        socket.on('data', d => (n += d.length));
        socket.on('close', () => resolve(n));
        socket.on('error', reject);
    });
    assert.equal(bytes, 0);
    await lock.release();
    await lock.release();
    const again = await acquireHostLock({ port, holder: 'three' });
    await again.release();
    // port 0 (automatic) and a privileged port are refused before any listen.
    await assert.rejects(acquireHostLock({ port: 0, holder: 'x' }), { code: 'INVALID_INPUT' });
    await assert.rejects(acquireHostLock({ port: 80, holder: 'x' }), { code: 'INVALID_INPUT' });
});

// why: a killed holder must not leave a stale lock: the OS frees the port with the process.
test('V12-6 a child holding the lock is SIGKILLed: the parent takes the same port within 2 s', async () => {
    const base = await temp();
    const port = await freePort();
    const script = path.join(base, 'hold-lock.mjs');
    const lib = pathToFileURL(fileURLToPath(new URL('./migrate-guard.mjs', import.meta.url))).href;
    await writeFile(
        script,
        `import { acquireHostLock } from ${JSON.stringify(lib)};\n` +
            `await acquireHostLock({ port: Number(process.argv[2]), holder: 'child' });\n` +
            `process.send('locked');\n`,
    );
    const child = fork(script, [String(port)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    await new Promise((resolve, reject) => {
        child.once('message', m => (m === 'locked' ? resolve() : reject(new Error(`${m}`))));
        child.once('exit', code => reject(new Error(`child exited ${code}`)));
    });
    await assert.rejects(acquireHostLock({ port, holder: 'parent' }), { code: 'LOCK_BUSY' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
    const t0 = Date.now();
    let lock = null;
    // retry briefly: the kernel closes the socket of the dead process at once.
    while (!lock && Date.now() - t0 <= 2000) {
        lock = await acquireHostLock({ port, holder: 'parent' }).catch(e => {
            if (e.code !== 'LOCK_BUSY') throw e;
            return new Promise(resolve => setTimeout(() => resolve(null), 25));
        });
    }
    assert.ok(lock, 'lock taken');
    assert.ok(Date.now() - t0 <= 2000);
    await lock.release();
});

// why: a crash after the inflight record must block later writes until an owner decision is recorded, append-only.
test('V12-7 adapter throws after inflight: unknown, blocked, decisionRef required, original kept, then writes again', async () => {
    const s = await setup();
    let seenInflight = null;
    const crash = fakeAdapter(async ({ operationId }) => {
        // the inflight record is on disk before the write starts.
        seenInflight = (await journal(s.root)).find(j => j.rec.operationId === operationId)?.rec.state;
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    });
    const err = await write(s, A, crash).catch(e => e);
    assert.equal(err.code, 'WRITE_UNKNOWN');
    assert.equal(err.unknown, true);
    assert.equal(seenInflight, 'inflight');
    const [first] = await journal(s.root);
    assert.equal(first.rec.state, 'unknown');
    assert.equal(first.rec.operationId, err.operationId);
    assert.deepEqual(first.rec.error, { code: 'ECONNRESET', message: 'socket hang up' });
    assert.match(first.name, /^\d{8}T\d{9}Z-[0-9a-f-]{36}\.json$/);
    assert.equal((await stat(path.join(s.root, 'journal', first.name))).mode & 0o777, 0o600);
    assert.equal(await operationState(s.install), 'unknown');
    const next = fakeAdapter();
    assert.equal((await write(s, A, next)).reason, 'journal-unresolved');
    assert.equal(next.calls.write, 0);
    // a blank decision ref (a reason text alone) does not resolve.
    for (const decisionRef of ['', '   ', undefined, 'x'.repeat(201)])
        await assert.rejects(resolveOperation(s.install, err.operationId, { decisionRef }), { code: 'INVALID_INPUT' });
    assert.equal(await operationState(s.install), 'unknown');
    const res = await resolveOperation(s.install, err.operationId, {
        decisionRef: 'owner decision D-1 (review thread)',
    });
    assert.equal(res.state, 'unknown');
    await assert.rejects(resolveOperation(s.install, err.operationId, { decisionRef: 'again' }), {
        code: 'OPERATION_RESOLVED',
    });
    // append: every original field is unchanged, the resolution is added.
    const [after] = await journal(s.root);
    const { resolution, ...original } = after.rec;
    assert.deepEqual(original, first.rec);
    assert.equal(resolution.decisionRef, 'owner decision D-1 (review thread)');
    assert.equal(await operationState(s.install), 'idle');
    const done = await write(s, A, next);
    assert.equal(done.status, 'completed');
    assert.equal(next.calls.write, 1);
    const rec = (await journal(s.root)).find(j => j.rec.operationId === done.operationId).rec;
    assert.equal(rec.state, 'completed');
    assert.deepEqual(rec.requestIds, ['req-1']);
    assert.equal(rec.receiptDigest, 'a'.repeat(64));
    // a completed operation is not "resolved".
    await assert.rejects(resolveOperation(s.install, done.operationId, { decisionRef: 'x' }), {
        code: 'OPERATION_NOT_UNRESOLVED',
    });
    // an invalid adapter result is an unknown end too.
    const odd = fakeAdapter(async () => ({ requestIds: 'not-a-list' }));
    await assert.rejects(write(s, A, odd), { code: 'WRITE_UNKNOWN' });
    assert.equal(await operationState(s.install), 'unknown');
});

// why: a process killed between inflight and completed leaves inflight; damaged files are unresolved too.
test('V12-7b a left-over inflight file and a damaged journal file both block', async () => {
    const s = await setup();
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const name = `20261101T000000000Z-${id}.json`;
    const rec = {
        schemaVersion: 1,
        operationId: id,
        identity: { project: A.project, stage: A.stage, stack: A.stack },
        holder: 'gone',
        startedAt: '2026-11-01T00:00:00.000Z',
        state: 'inflight',
        requestIds: [],
    };
    await writeFile(path.join(s.root, 'journal', name), JSON.stringify(rec), { mode: 0o600 });
    assert.equal(await operationState(s.install), 'inflight');
    assert.equal((await write(s, B, fakeAdapter())).reason, 'journal-unresolved');
    await resolveOperation(s.install, id, { decisionRef: 'owner decision D-2' });
    assert.equal(await operationState(s.install), 'idle');
    // a temp file of an interrupted atomic write is not a record.
    await writeFile(path.join(s.root, 'journal', `.${name}.tmp-${id}`), '{', { mode: 0o600 });
    assert.equal(await operationState(s.install), 'idle');
    // a damaged file (not JSON, or another schema) is unknown.
    await writeFile(path.join(s.root, 'journal', `20261101T000000001Z-${id.replace('0f', '1f')}.json`), '{', {
        mode: 0o600,
    });
    assert.equal(await operationState(s.install), 'unknown');
    assert.equal(
        (await guardStatus(inputOf(B), EXPECTED, { install: s.installFile, env: {} })).reason,
        'journal-unresolved',
    );
});

// why: the install file is the only source of the root; a copied / other / synced / symlinked root is refused.
test('V12-8 install and root checks: state-dir env, root install.json, port, symlink, sync volume', async () => {
    const s = await setup();
    const adapter = fakeAdapter();
    // MIGRATION_STATE_DIR naming another dir.
    await assert.rejects(
        loadInstall({ installFile: s.installFile, env: { MIGRATION_STATE_DIR: path.join(s.base, 'x') } }),
        { code: 'ROOT_MISMATCH' },
    );
    assert.equal(
        (await write(s, A, adapter, { env: { MIGRATION_STATE_DIR: path.join(s.base, 'x') } })).reason,
        'root-mismatch',
    );
    // the same dir is accepted; the install path can come from the env.
    const viaEnv = await loadInstall({
        env: { LEMON_MIGRATION_GUARD_INSTALL: s.installFile, MIGRATION_STATE_DIR: s.root },
    });
    assert.equal(viaEnv.root, s.root);
    assert.ok(Object.isFrozen(viaEnv));
    // the root install.json names another port.
    const marker = JSON.parse(await readFile(path.join(s.root, 'install.json'), 'utf8'));
    await writeFile(
        path.join(s.root, 'install.json'),
        JSON.stringify({ ...marker, port: marker.port === 65535 ? 65534 : marker.port + 1 }),
        { mode: 0o600 },
    );
    assert.equal((await write(s, A, adapter)).reason, 'root-mismatch');
    await writeFile(path.join(s.root, 'install.json'), JSON.stringify(marker), { mode: 0o600 });
    assert.equal((await guardStatus(inputOf(A), EXPECTED, { install: s.installFile, env: {} })).status, 'ready');
    // port 0 / 80 / not an integer, extra key, missing file: INSTALL_INVALID.
    const bad = path.join(s.base, 'bad-install.json');
    for (const over of [
        { port: 0 },
        { port: 80 },
        { port: 1023 },
        { port: 8080.5 },
        { port: '8080' },
        { extra: 1 },
        { machineId: 'a b' },
    ]) {
        await writeFile(bad, JSON.stringify({ ...installJson(s.root, s.port), ...over }));
        await assert.rejects(loadInstall({ installFile: bad, env: {} }), { code: 'INSTALL_INVALID' });
    }
    assert.equal((await write(s, A, adapter, { install: bad })).reason, 'install-invalid');
    await assert.rejects(loadInstall({ installFile: path.join(s.base, 'none.json'), env: {} }), {
        code: 'INSTALL_INVALID',
    });
    await assert.rejects(loadInstall({ env: {} }), { code: 'INSTALL_INVALID' });
    // a symlinked root and a relative root: ROOT_INVALID.
    const link = path.join(s.base, 'root-link');
    await symlink(s.root, link);
    await writeFile(bad, JSON.stringify(installJson(link, s.port)));
    await assert.rejects(loadInstall({ installFile: bad, env: {} }), { code: 'ROOT_INVALID' });
    assert.equal((await write(s, A, adapter, { install: bad })).reason, 'root-invalid');
    await writeFile(bad, JSON.stringify(installJson('relative/root', s.port)));
    await assert.rejects(loadInstall({ installFile: bad, env: {} }), { code: 'ROOT_INVALID' });
    // a sync-app segment or a mount prefix: ROOT_UNSUPPORTED_VOLUME (checked on the path, nothing created).
    await writeFile(bad, JSON.stringify(installJson(path.join(s.base, 'Dropbox', 'root'), s.port)));
    await assert.rejects(loadInstall({ installFile: bad, env: {} }), { code: 'ROOT_UNSUPPORTED_VOLUME' });
    assert.equal((await write(s, A, adapter, { install: bad })).reason, 'root-unsupported-volume');
    for (const p of [
        '/Volumes/usb/root',
        '/mnt/x',
        '/net/host/x',
        '/u/Library/Mobile Documents/x',
        '/u/Dropbox (Personal)/x',
        '/u/OneDrive - Org/x',
        '/u/Box/x',
        '/u/iCloud Drive/x',
    ])
        assert.equal(unsupportedVolume(p), true, p);
    for (const p of ['/u/Sandbox/x', '/u/Inbox/x', '/u/rsync/x', '/u/work/root'])
        assert.equal(unsupportedVolume(p), false, p);
    // the install file inside the root is refused.
    await writeFile(path.join(s.root, 'inner-install.json'), JSON.stringify(installJson(s.root, s.port)), {
        mode: 0o600,
    });
    await assert.rejects(loadInstall({ installFile: path.join(s.root, 'inner-install.json'), env: {} }), {
        code: 'INSTALL_INVALID',
    });
    assert.equal(adapter.calls.write, 0);
});

// why: a root without proof of a normal initial state stays blocked and is never repaired automatically.
test('V12-9 no journal/ and no initializedAt is unknown; initializeRoot gives idle once, then ROOT_EXISTS', async () => {
    const base = await temp();
    const port = await freePort();
    const manual = path.join(base, 'manual');
    await mkdir(manual, { mode: 0o700 });
    await writeFile(
        path.join(manual, 'install.json'),
        JSON.stringify({ schemaVersion: 1, root: manual, port, machineId: 'spec-machine' }),
        { mode: 0o600 },
    );
    const installFile = path.join(base, 'manual-install.json');
    await writeFile(installFile, JSON.stringify(installJson(manual, port)), { mode: 0o600 });
    const install = await loadInstall({ installFile, env: {} });
    assert.equal(await operationState(install), 'unknown');
    assert.equal(
        (await guardStatus(inputOf(A), EXPECTED, { install: installFile, env: {} })).reason,
        'journal-unresolved',
    );
    // no automatic initialization of an existing root.
    await assert.rejects(initializeRoot(install), { code: 'ROOT_EXISTS' });
    assert.deepEqual(await readdir(manual), ['install.json']);
    // a new root: initialized once (0700 dirs, 0600 files, initializedAt), idle.
    const fresh = { root: path.join(base, 'fresh'), port, machineId: 'spec-machine' };
    const init = await initializeRoot(fresh);
    assert.ok(Date.parse(init.initializedAt));
    assert.equal((await stat(fresh.root)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(fresh.root, 'journal'))).mode & 0o777, 0o700);
    for (const f of ['install.json', 'registry.json'])
        assert.equal((await stat(path.join(fresh.root, f))).mode & 0o777, 0o600);
    const marker = JSON.parse(await readFile(path.join(fresh.root, 'install.json'), 'utf8'));
    assert.deepEqual(marker, {
        schemaVersion: 1,
        root: fresh.root,
        port,
        machineId: 'spec-machine',
        initializedAt: init.initializedAt,
    });
    assert.deepEqual(await readRegistry(fresh), { schemaVersion: 1, machineId: 'spec-machine', entries: {} });
    assert.equal(await operationState(fresh), 'idle');
    await assert.rejects(initializeRoot(fresh), { code: 'ROOT_EXISTS' });
    // a removed journal/ after initialization is unknown again (history lost).
    await rm(path.join(fresh.root, 'journal'), { recursive: true });
    assert.equal(await operationState(fresh), 'unknown');
});

// why: a damaged target list is fail-closed: refused for every input, never read as "outside the registry".
test('V12-10 REGISTRY_INVALID: duplicate project+stage, unfrozen list, missing revision', async () => {
    const dup = Object.freeze([...TARGETS, Object.freeze({ ...A })]);
    const adapter = fakeAdapter();
    for (const targets of [
        dup,
        [...TARGETS],
        Object.freeze([Object.freeze({ project: 'p', stage: 'dev', stack: 's' })]),
    ]) {
        assert.throws(() => classifyTarget(inputOf(A), { targets }), { code: 'REGISTRY_INVALID' });
        assert.throws(() => classifyTarget(C, { targets }), { code: 'REGISTRY_INVALID' });
        await assert.rejects(guardedWrite({ input: C, adapter, deps: { targets } }), { code: 'REGISTRY_INVALID' });
        await assert.rejects(guardStatus(C, EXPECTED, { deps: { targets } }), { code: 'REGISTRY_INVALID' });
    }
    assert.equal(adapter.calls.write + adapter.calls.passthrough, 0);
    // the shipped registry passes.
    assert.equal(classifyTarget(inputOf(B)).applicability, 'applicable');
});

// why: plan / read paths must work while a write holds the lock, and must never take the lock themselves.
test('V12-11 guardStatus reads while the port is held elsewhere and takes no lock', async () => {
    const s = await setup({ register: [A] });
    await occupy(s.port);
    let servers = 0;
    const deps = { net: { createServer: (...a) => (servers++, net.createServer(...a)) } };
    assert.deepEqual(await guardStatus(inputOf(A), EXPECTED, { install: s.installFile, env: {}, deps }), {
        applicability: 'applicable',
        status: 'ready',
        identity: { project: A.project, stage: A.stage, stack: A.stack },
    });
    assert.equal(
        (await guardStatus(inputOf(B), EXPECTED, { install: s.installFile, env: {}, deps })).reason,
        'not-registered',
    );
    assert.equal(servers, 0);
    // the write itself is busy while the port is held.
    const adapter = fakeAdapter();
    assert.equal((await write(s, A, adapter, { deps })).reason, 'busy');
    assert.equal(servers, 1);
    assert.equal(adapter.calls.write, 0);
    assert.deepEqual(await journal(s.root), []);
});

//* ---- V13: secret canary ----

// why: secrets in holder, decision ref, adapter errors and the install note must never reach state files or outputs.
test('V13-12 canary strings never appear in journal, registry, thrown messages or returned objects', async () => {
    const CANARIES = [
        'AKIAABCDEFGHIJKLMNOP',
        'arn:aws:iam::987654321098:role/canary',
        '987654321098',
        'SECRET_CANARY_7f3a9c',
    ];
    const mix = CANARIES.join(' ');
    const s = await setup({ config: { localVolume: { confirmedBy: `ops ${mix}`, at: '2026-11-01T00:00:00.000Z' } } });
    const outputs = [];
    // collect a message or a returned object as text.
    const keep = x => (outputs.push(x instanceof Error ? x.message : JSON.stringify(x)), x);
    const holder = `session ${mix}`;
    const boom = fakeAdapter(async () => {
        throw Object.assign(new Error(`denied for ${mix} token=${CANARIES[3]}`), { code: CANARIES[3] });
    });
    const err = await write(s, A, boom, { holder }).catch(keep);
    assert.equal(err.code, 'WRITE_UNKNOWN');
    keep(await write(s, B, fakeAdapter(), { holder }));
    keep(await resolveOperation(s.install, err.operationId, { decisionRef: `decision ${mix}` }));
    keep(await write(s, A, fakeAdapter(), { holder }));
    keep(await guardStatus(inputOf(A), EXPECTED, { install: s.installFile, env: {} }));
    // canaries in validated fields are refused without echoing them.
    keep(
        await write(s, A, fakeAdapter(), { expected: { account: CANARIES[1], region: EXPECTED.region } }).catch(e => e),
    );
    keep(await write(s, A, fakeAdapter(), { expected: { ...EXPECTED, note: CANARIES[0] } }).catch(e => e));
    keep(await registerTarget(s.install, entryOf(A, { class: CANARIES[3] })).catch(e => e));
    keep(await registerTarget(s.install, entryOf(A, { region: CANARIES[1] })).catch(e => e));
    const lock = await acquireHostLock({ port: s.port, holder: mix });
    keep({ holder: lock.holder, port: lock.port });
    await lock.release();
    const files = await tree(s.root);
    assert.ok(Object.keys(files).some(f => f.startsWith('journal')));
    const texts = [...Object.values(files), ...outputs];
    for (const canary of CANARIES)
        for (const text of texts) assert.equal(text.includes(canary), false, `canary ${canary.slice(0, 4)}… leaked`);
    // no message names the root path or the expected account.
    for (const text of outputs) {
        assert.equal(text.includes(s.base), false);
        assert.equal(text.includes(EXPECTED.account), false);
    }
    // the journal kept a scrubbed holder and error message (bounded).
    const recs = (await journal(s.root)).map(j => j.rec);
    assert.ok(recs.every(r => r.holder.length <= 200 && r.holder.startsWith('session ')));
    assert.ok(recs.some(r => r.error?.code === 'ADAPTER_ERROR'));
});
