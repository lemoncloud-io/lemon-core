/**
 * `bin/lib/local-runner.spec.mjs` (lemon-core)
 * - offline tests of local-runner.mjs / local-artifact / local-runtime / local-network (`lemon-lambda-local`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/local-runner.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { runLocal } from './local-runner.mjs';
import { writeZip, sha256 } from './pack-zip.mjs';

//* v5 B19: node:test had no per-test deadline; the process cases (fork/spawn) need more than 5 s on a busy host.
vi.setConfig({ testTimeout: 60_000 });
const root = fileURLToPath(new URL('../fixtures/local/', import.meta.url));
const defaults = { root, handler: { file: 'handler.cjs', export: 'lambda' }, timeoutMs: 3000 };

test('real child cold resets module state; warm reuses it with unique requests', async () => {
    for (const mode of ['cold', 'warm']) {
        const report = await runLocal({ ...defaults, mode, runs: 3, event: { answer: 42 } });
        assert.deepEqual(
            report.runs.map(run => run.status),
            ['success', 'success', 'success'],
        );
        assert.deepEqual(
            report.runs.map(run => run.result.count),
            mode === 'warm' ? [1, 2, 3] : [1, 1, 1],
        );
        assert.equal(new Set(report.runs.map(run => run.requestId)).size, 3);
        assert.equal(new Set(report.runs.map(run => run.sessionId)).size, mode === 'warm' ? 1 : 3);
        assert.deepEqual(
            report.runs.map(run => run.cold),
            mode === 'warm' ? [true, false, false] : [true, true, true],
        );
        for (const run of report.runs) {
            assert.notEqual(run.processId, process.pid);
            assert.ok(run.timings.totalMs >= run.timings.invokeMs);
        }
    }
});
test('ESM async returns and CJS sync returns use the same JSON contract', async () => {
    const report = await runLocal({
        ...defaults,
        handler: { file: 'esm.mjs', export: 'lambda' },
        mode: 'warm',
        events: [null, ['a', 3]],
    });
    assert.deepEqual(
        report.runs.map(run => run.result),
        [
            { count: 1, event: null },
            { count: 2, event: ['a', 3] },
        ],
    );
});
test('Lambda environment exists before import; parent secrets and Node hooks are scrubbed', async () => {
    const keys = [
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
        'AWS_PROFILE',
        'HOME',
        'NODE_OPTIONS',
        'NODE_PATH',
    ];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        for (const key of keys) process.env[key] = 'host-only-sentinel';
        const report = await runLocal({
            ...defaults,
            event: { action: 'env' },
            env: { EXPLICIT: 'yes' },
            functionName: 'test-function',
        });
        assert.equal(report.runs[0].status, 'success');
        const { env, initialName } = report.runs[0].result;
        assert.equal(initialName, 'test-function');
        assert.equal(env.EXPLICIT, 'yes');
        for (const key of keys) assert.equal(env[key], undefined, key);
    } finally {
        for (const key of keys)
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
    }
});
test('request context supplies IDs, settings and a decreasing parent deadline', async () => {
    const report = await runLocal({
        ...defaults,
        mode: 'warm',
        timeoutMs: 1500,
        functionName: 'example',
        memorySize: 256,
        events: [{ action: 'context' }, { action: 'wait', ms: 25 }],
    });
    const first = report.runs[0];
    assert.equal(first.result.awsRequestId, first.requestId);
    assert.equal(first.result.functionName, 'example');
    assert.equal(first.result.memoryLimitInMB, '256');
    assert.match(first.result.logGroupName, /example/);
    assert.match(first.result.invokedFunctionArn, /example/);
    assert.ok(first.result.remaining > 0 && first.result.remaining <= 1500);
    assert.ok(report.runs[1].result.remaining < 1490);
});
test('errors, infinite loops, process exits and unhandled rejections discard warm processes', async () => {
    for (const [action, status] of [
        ['throw', 'error'],
        ['primitive', 'error'],
        ['hang', 'timeout'],
        ['exit', 'crash'],
        ['reject', 'error'],
        ['uncaught', 'error'],
        ['bigint', 'error'],
    ]) {
        const report = await runLocal({
            ...defaults,
            mode: 'warm',
            timeoutMs: action === 'hang' ? 350 : 1500,
            events: [{}, { action }, {}],
        });
        assert.equal(report.runs[1].status, status, action);
        assert.equal(typeof report.runs[1].error.message, 'string');
        assert.deepEqual(
            report.runs.map(run => run.cold),
            [true, false, true],
            action,
        );
        assert.equal(report.runs[2].result.count, 1, action);
        assert.notEqual(report.runs[1].sessionId, report.runs[2].sessionId);
        if (action === 'hang') {
            assert.equal(report.runs[1].timedOut, true);
            assert.equal(report.runs[1].exit.signal, 'SIGKILL');
        }
        if (action === 'exit') assert.equal(report.runs[1].exit.code, 7);
    }
});
test('stdout and stderr have independent byte caps and retain truncation metadata', async () => {
    const report = await runLocal({ ...defaults, event: { action: 'logs' }, maxLogBytes: 123 });
    assert.equal(report.runs[0].status, 'success');
    for (const name of ['stdout', 'stderr']) {
        assert.equal(report.runs[0][name].bytes, 20000);
        assert.equal(Buffer.byteLength(report.runs[0][name].text), 123);
        assert.equal(report.runs[0][name].truncated, true);
    }
});
test('network guard blocks standard networking including ESM named imports and DNS promises', async () => {
    const report = await runLocal({ ...defaults, handler: { file: 'network.mjs', export: 'lambda' } });
    assert.equal(report.runs[0].status, 'success');
    assert.equal(Object.keys(report.runs[0].result).length, 8);
    assert.ok(Object.values(report.runs[0].result).every(value => value === 'LOCAL_NETWORK_DENIED'));
});
test('native source maps restore the exact original source line', async () => {
    const report = await runLocal({ ...defaults, handler: { file: 'mapped.cjs', export: 'lambda' } });
    assert.equal(report.runs[0].status, 'error');
    assert.match(report.runs[0].error.stack, /original-error\.ts:5:1/);
});
test('using the callback reports an explicit unsupported error', async () => {
    const report = await runLocal({ ...defaults, handler: { file: 'callback.cjs', export: 'lambda' } });
    assert.equal(report.runs[0].status, 'error');
    assert.equal(report.runs[0].phase, 'invoke');
    assert.match(report.runs[0].error.message, /Callback handlers are unsupported/);
});
test('artifact verifies ZIP and inventory hashes, extracts privately and preserves inputs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lambda-local-artifact-test-'));
    try {
        const zip = path.join(directory, 'lambda.zip');
        const archive = await writeZip(zip, [{ path: 'handler.cjs', source: path.join(root, 'handler.cjs') }]);
        const bytes = await readFile(zip);
        const manifest = {
            schemaVersion: 1,
            runtime: 'nodejs24.x',
            architecture: 'x86_64',
            archive: {
                file: 'lambda.zip',
                sha256: sha256(bytes),
                bytes: archive.bytes,
                uncompressedBytes: archive.uncompressedBytes,
                fileCount: archive.files.length,
            },
            validation: { handler: { file: 'handler.cjs', export: 'lambda' } },
            files: archive.files,
        };
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
        const report = await runLocal({ artifact: directory, event: { action: 'env' } });
        assert.equal(report.source.verified, true);
        assert.equal(report.runs[0].status, 'success');
        const extracted = report.runs[0].result.env.LAMBDA_TASK_ROOT;
        assert.notEqual(extracted, directory);
        await assert.rejects(stat(extracted), { code: 'ENOENT' });
        assert.equal(sha256(await readFile(zip)), sha256(bytes));
        manifest.files[0].sha256 = '0'.repeat(64);
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
        await assert.rejects(runLocal({ artifact: directory }), /ZIP integrity mismatch/);
        manifest.files = archive.files;
        manifest.archive.sha256 = '0'.repeat(64);
        await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
        await assert.rejects(runLocal({ artifact: directory }), /SHA-256/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('CLI emits a JSON report and separates invalid input from handler failure', () => {
    const cli = fileURLToPath(new URL('../lemon-lambda-local.mjs', import.meta.url));
    const args = [
        cli,
        '--root',
        root,
        '--handler-file',
        'handler.cjs',
        '--handler-export',
        'lambda',
        '--event',
        path.join(root, 'event.json'),
        '--json',
    ];
    const success = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).runs[0].status, 'success');
    const invalid = spawnSync(process.execPath, [...args, '--runs', '0'], { encoding: 'utf8' });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /runs/);
});

test('initialization infinite loops are killed by the parent deadline', async () => {
    const report = await runLocal({
        ...defaults,
        handler: { file: 'init-hang.cjs', export: 'lambda' },
        timeoutMs: 250,
    });
    assert.equal(report.runs[0].status, 'timeout');
    assert.equal(report.runs[0].phase, 'init');
    assert.equal(report.runs[0].timings.initMs, null);
    assert.equal(report.runs[0].exit.signal, 'SIGKILL');
});
test('an unused third parameter does not reject an async handler', async () => {
    const report = await runLocal({
        ...defaults,
        handler: { file: 'unused-callback.mjs', export: 'lambda' },
        event: null,
    });
    assert.equal(report.runs[0].status, 'success');
    assert.equal(report.runs[0].result, null);
});

test('UTF-8 truncation preserves a valid string inside the requested byte limit', async () => {
    const report = await runLocal({ ...defaults, event: { action: 'unicode' }, maxLogBytes: 7 });
    const output = report.runs[0].stdout;
    assert.equal(output.text, '한글');
    assert.equal(output.bytes, 1200);
    assert.equal(output.truncated, true);
    assert.ok(Buffer.byteLength(output.text) <= 7);
});

test('warm log captures report arrival windows and disclose earlier background origins', async () => {
    const report = await runLocal({
        ...defaults,
        mode: 'warm',
        events: [{ action: 'deferredLog' }, { action: 'wait', ms: 100 }],
    });
    assert.ok(report.runs.every(run => run.status === 'success'));
    assert.equal(report.runs[0].stdout.text, '');
    assert.match(report.runs[1].stdout.text, /background-from-request-A/);
    assert.match(report.measurements.logs, /background origins are not tracked/);
    assert.ok(report.limitations.some(value => /arrival windows/.test(value)));
});

test('timeouts and successful disposal cannot wait for descendant inherited pipes', async () => {
    for (const action of ['descendantHang', 'descendantReturn']) {
        const started = performance.now();
        const report = await runLocal({ ...defaults, timeoutMs: 200, event: { action } });
        const elapsed = performance.now() - started;
        const run = report.runs[0];
        assert.equal(run.status, action === 'descendantHang' ? 'timeout' : 'success');
        assert.ok(elapsed < 1400, `owned descendant must not prolong disposal: ${elapsed} ms`);
        assert.ok(run.cleanup.durationMs < 1000);
        assert.equal(
            run.cleanup.scope,
            process.platform === 'win32' ? 'runtime-process-only' : 'owned-posix-process-group',
        );
        if (action === 'descendantReturn' && process.platform !== 'win32') {
            // The owned process group was signaled; the OS may briefly retain a dead child as a zombie.
            assert.equal(run.cleanup.forcedPipeClose, false);
        }
    }
});

test.skipIf(process.platform === 'win32')('parent SIGTERM terminates its detached runtime process group', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lambda-local-signal-test-'));
    const pidFile = path.join(directory, 'pid');
    const moduleUrl = new URL('./local-runner.mjs', import.meta.url).href;
    const options = { ...defaults, timeoutMs: 5000, event: { action: 'signalHang', pidFile } };
    const driver = spawn(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `import { runLocal } from ${JSON.stringify(moduleUrl)}; await runLocal(${JSON.stringify(options)});`,
        ],
        { stdio: 'ignore' },
    );
    let runtimePid;
    try {
        const until = Date.now() + 2000;
        while (Date.now() < until) {
            try {
                runtimePid = Number(await readFile(pidFile, 'utf8'));
                break;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(runtimePid, 'runtime must start before parent signal');
        const closed = once(driver, 'close');
        driver.kill('SIGTERM');
        const [code, signal] = await closed;
        assert.equal(signal, 'SIGTERM');
        assert.equal(code, null);
        const reapedBy = Date.now() + 1000;
        let alive = true;
        while (Date.now() < reapedBy) {
            try {
                process.kill(runtimePid, 0);
            } catch (error) {
                if (error.code === 'ESRCH') {
                    alive = false;
                    break;
                }
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(alive, false, 'runtime must not survive parent SIGTERM');
    } finally {
        driver.kill('SIGKILL');
        if (runtimePid) {
            try {
                process.kill(runtimePid, 'SIGKILL');
            } catch {}
        }
        await rm(directory, { recursive: true, force: true });
    }
});
