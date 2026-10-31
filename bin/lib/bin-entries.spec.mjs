/**
 * `bin/lib/bin-entries.spec.mjs` (lemon-core)
 * - offline tests of the 5 build/deploy entries as a consumer starts them: `--help` per entry, the npm `bin`
 *   symlink "run when main" check, and the forked workers from an installed `node_modules/lemon-core/bin/lib/`.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`). Temp dirs under `os.tmpdir()`; no AWS, no network.
 */
//* v5 B19: new cases of B19-b (entries, bin symlink, installed layout, optional peers, org defaults).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    symlinkSync,
    cpSync,
    writeFileSync,
    readFileSync,
    realpathSync,
    statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMain } from './is-main.mjs';
import { assertPeer, importPeer, installHint } from './optional-peer.mjs';
import { ORG_DEFAULTS } from './org-defaults.mjs';
import { createDeployClient } from './deploy-client.mjs';
import { validateConfig } from './deploy-plan.mjs';

//* v5 B19: the child processes below start Node a few times per case.
vi.setConfig({ testTimeout: 60_000 });

// lemon-core root, its `bin/`, and the package manifest.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const binDir = path.join(repo, 'bin');
const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
const fixtures = path.join(binDir, 'fixtures', 'local');

// the 5 entries of B19-b and a word of their `--help` text.
const ENTRIES = {
    'lemon-lambda-pack': /Usage: npm run pack/,
    'lemon-lambda-local': /Usage: npm run lambda:local/,
    'lemon-lambda-deploy': /Usage: npm run lambda:deploy --/,
    'lemon-lambda-deploy-dev': /Usage: npm run lambda:deploy:dev/,
    'lemon-lambda-migrate': /Usage: npm run lambda:migrate/,
};

// a fresh temp dir, removed after the test.
const temp = prefix => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
};

// run `node <file> ...args` with a clean env (no AWS credentials) from `cwd`.
const node = (file, args, cwd, env = {}) =>
    spawnSync(process.execPath, [file, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: { PATH: process.env.PATH, HOME: cwd, AWS_EC2_METADATA_DISABLED: 'true', ...env },
    });

/**
 * a consumer dir laid out like `npm i -D lemon-core`: a real copy of `bin/` under `node_modules/lemon-core/`
 * (its `node_modules` linked to this repo's, for the peers) and the `node_modules/.bin/<name>` symlinks.
 */
const consumer = () => {
    const root = temp('lemon-bin-consumer-');
    const installed = path.join(root, 'node_modules', 'lemon-core');
    mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(installed, { recursive: true });
    cpSync(binDir, path.join(installed, 'bin'), { recursive: true, filter: src => !src.endsWith('.spec.mjs') });
    writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: 'lemon-core', version: pkg.version }));
    symlinkSync(path.join(repo, 'node_modules'), path.join(installed, 'node_modules'), 'dir');
    for (const [name, target] of Object.entries(pkg.bin))
        symlinkSync(path.join('..', 'lemon-core', target), path.join(root, 'node_modules', '.bin', name));
    return { root, installed, bin: name => path.join(root, 'node_modules', '.bin', name) };
};

test('package.json declares the 5 entries as executable bins and ships their modules, not the specs', () => {
    for (const name of Object.keys(ENTRIES)) {
        const file = pkg.bin[name];
        assert.equal(file, `bin/${name}.mjs`);
        assert.ok(pkg.files.includes(file), `${file} in files`);
        const text = readFileSync(path.join(repo, file), 'utf8');
        assert.ok(text.startsWith('#!/usr/bin/env node\n'), `${file} shebang`);
        assert.ok(statSync(path.join(repo, file)).mode & 0o111, `${file} executable`);
    }
    assert.ok(!pkg.files.some(f => f.endsWith('.spec.mjs') || f.includes('test-fixture') || f.includes('fixtures')));
});

test('each entry prints its usage with --help (exit 0) from a consumer dir, without AWS access', () => {
    const cwd = temp('lemon-bin-help-');
    for (const [name, usage] of Object.entries(ENTRIES)) {
        const run = node(path.join(binDir, `${name}.mjs`), ['--help'], cwd);
        assert.equal(run.status, 0, `${name}: ${run.stderr}`);
        assert.match(run.stdout, usage);
        assert.equal(run.stderr, '');
    }
});

test('each entry runs --help through the npm bin symlink of an installed copy (run-when-main check)', () => {
    const c = consumer();
    for (const [name, usage] of Object.entries(ENTRIES)) {
        const run = node(c.bin(name), ['--help'], c.root);
        assert.equal(run.status, 0, `${name}: ${run.stderr}`);
        assert.match(run.stdout, usage, `${name} printed nothing: the main check failed through the symlink`);
    }
});

test('isMain resolves the bin symlink; the unresolved path.resolve() check of the source does not', () => {
    const c = consumer();
    const entry = path.join(c.installed, 'bin', 'lemon-lambda-deploy.mjs');
    const url = pathToFileURL(entry).href;
    assert.equal(isMain(url, c.bin('lemon-lambda-deploy')), true);
    assert.equal(isMain(url, entry), true);
    // the source compared `pathToFileURL(path.resolve(argv[1]))`: a symlink never matched.
    assert.notEqual(url, pathToFileURL(path.resolve(c.bin('lemon-lambda-deploy'))).href);
    assert.equal(isMain(url, path.join(c.installed, 'bin', 'lemon-lambda-migrate.mjs')), false);
    assert.equal(isMain(url, path.join(c.root, 'missing.mjs')), false);
    assert.equal(isMain(url, undefined), false);
});

test('lemon-lambda-local forks its runtime from node_modules/lemon-core/bin/lib (installed copy)', () => {
    const c = consumer();
    const run = node(
        c.bin('lemon-lambda-local'),
        ['--root', fixtures, '--handler-file', 'handler.cjs', '--handler-export', 'lambda'].concat([
            '--event',
            path.join(fixtures, 'event.json'),
            '--json',
        ]),
        c.root,
    );
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.runs[0].status, 'success');
    assert.notEqual(report.runs[0].processId, process.pid);
});

test('credential worker and private migration child fork from the installed copy', () => {
    const c = consumer();
    const lib = name => pathToFileURL(path.join(c.installed, 'bin', 'lib', name)).href;
    // a local credential_process helper (no AWS): the worker must fork from the copy and return it.
    const helper = path.join(c.root, 'credential-helper.mjs');
    writeFileSync(
        helper,
        "console.log(JSON.stringify({Version:1,AccessKeyId:'FAKEKEY',SecretAccessKey:'fake-secret'}));",
    );
    const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
    const awsConfig = path.join(c.root, 'aws-config');
    writeFileSync(awsConfig, `[profile localtest]\ncredential_process = ${quote(process.execPath)} ${quote(helper)}\n`);
    writeFileSync(path.join(c.root, 'aws-credentials'), '');
    const script = path.join(c.root, 'forks.mjs');
    writeFileSync(
        script,
        [
            `import { boundedCredentialProvider } from ${JSON.stringify(lib('deploy-credentials.mjs'))};`,
            `import { runPrivateChild } from ${JSON.stringify(lib('migrate-process.mjs'))};`,
            `const provider = boundedCredentialProvider({ profile: 'localtest', timeoutMs: 10000 });`,
            `const credentials = await provider(); provider.close();`,
            `const child = await runPrivateChild({ mode: 'migration', command: ${JSON.stringify(
                helper,
            )}, cwd: process.cwd(),`,
            `  environment: { PATH: process.env.PATH }, timeoutMs: 10000 });`,
            `console.log(JSON.stringify({ key: credentials.accessKeyId, code: child.code, reason: child.reason }));`,
        ].join('\n'),
    );
    const run = node(script, [], c.root, {
        AWS_CONFIG_FILE: awsConfig,
        AWS_SHARED_CREDENTIALS_FILE: path.join(c.root, 'aws-credentials'),
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { key: 'FAKEKEY', code: 0, reason: 'exited' });
});

test('a missing optional peer fails with the npm i -D hint; present peers resolve', async () => {
    assert.equal(
        installHint('@aws-sdk/client-lambda'),
        'Optional peer @aws-sdk/client-lambda is missing; run: npm i -D @aws-sdk/client-lambda',
    );
    assert.throws(() => assertPeer('@lemon-core-missing/peer'), /npm i -D @lemon-core-missing\/peer/);
    await assert.rejects(importPeer('@lemon-core-missing/peer'), /npm i -D @lemon-core-missing\/peer/);
    // a stubbed loader: only "not found" of that package becomes the hint; other errors pass through.
    const notFound = Object.assign(new Error("Cannot find package '@aws-sdk/client-lambda'"), {
        code: 'ERR_MODULE_NOT_FOUND',
    });
    await assert.rejects(
        importPeer(
            '@aws-sdk/client-lambda',
            hint => Object.assign(new Error(hint), { code: 'MISSING_PEER' }),
            async () => {
                throw notFound;
            },
        ),
        { code: 'MISSING_PEER', message: /npm i -D @aws-sdk\/client-lambda/ },
    );
    await assert.rejects(
        importPeer('@aws-sdk/client-lambda', undefined, async () => {
            throw new Error('boom');
        }),
        /boom/,
    );
    assertPeer('@aws-sdk/client-lambda');
    assertPeer('@aws-sdk/credential-providers');
    assertPeer('@smithy/signature-v4');
});

test('the deploy client signs with lemon-core @smithy/signature-v4 and a node:crypto sha256 (no extra deps)', async () => {
    const example = JSON.parse(
        readFileSync(path.join(binDir, 'fixtures', 'deploy', 'deploy.config.example.json'), 'utf8'),
    );
    const { environmentFile, policy, routes, deletionProtection, ...code } = example;
    let observed;
    const client = await createDeployClient(validateConfig({ ...code, mode: 'code' }), {
        credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'test-secret' },
        fetchImpl: async (url, options) => {
            observed = { url, options };
            return { status: 200, json: async () => ({ ok: true }) };
        },
        lambdaClient: { destroy() {} },
    });
    const result = await client.request({ tool: 'aws.lambda.ensure-function@1', method: 'GET', deployId: 'dpl_x' });
    assert.deepEqual(result, { http: 200, result: { ok: true } });
    assert.match(observed.options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    assert.equal(observed.url.pathname, '/dev/tools/aws.lambda.ensure-function@1/status');
    client.close();
    for (const name of ['@aws-crypto/sha256-js', '@smithy/protocol-http'])
        assert.ok(!JSON.stringify({ ...pkg.dependencies, ...pkg.peerDependencies }).includes(name), name);
});

test('org-specific defaults are one frozen block without hostnames, account numbers, ARNs or tokens', () => {
    assert.ok(
        Object.isFrozen(ORG_DEFAULTS) &&
            Object.isFrozen(ORG_DEFAULTS.deploy) &&
            Object.isFrozen(ORG_DEFAULTS.deploy.abortReasonPrefixes) &&
            Object.isFrozen(ORG_DEFAULTS.migration) &&
            Object.isFrozen(ORG_DEFAULTS.migration.targets) &&
            ORG_DEFAULTS.migration.targets.every(t => Object.isFrozen(t)),
    );
    const text = JSON.stringify(ORG_DEFAULTS);
    assert.doesNotMatch(text, /\b\d{12}\b|arn:|https?:|\.com\b|amazonaws/);
    assert.equal(ORG_DEFAULTS.deploy.toolNamespace, 'lemon.deploy');
    //* v5 B24: every reviewed target is the dev stack of its project.
    for (const t of ORG_DEFAULTS.migration.targets) assert.equal(t.stack, `${t.project}-dev`);
});
