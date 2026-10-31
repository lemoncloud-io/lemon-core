/**
 * `bin/lib/lambda-env.spec.mjs` (lemon-core)
 * - offline tests of `lemon-lambda-env` (`build`, `diff`): fake env files in temp dirs under `os.tmpdir()`,
 *   a stubbed Lambda client; no AWS, no network, no real service env file.
 * - every fixture value carries `MARKER`; it must never reach stdout, stderr or an error message.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B26: new cases (P0 build + read-only diff).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
    existsSync,
    chmodSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseEnvArgs } from '../lemon-lambda-env.mjs';
import { compareEnvironment, createEnvReader, stageEnvironment } from './lambda-env.mjs';

//* v5 B26: one case starts Node; the rest run in process.
vi.setConfig({ testTimeout: 60_000 });

// the value fragment that must never be printed.
const MARKER = 'never-print-this-secret-value';

// lemon-core root and the placeholder deploy config of the B19 specs.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const example = JSON.parse(readFileSync(path.join(repo, 'bin/fixtures/deploy/deploy.config.example.json'), 'utf8'));

// a fresh real temp dir, removed after the test.
const temp = (prefix = 'lemon-env-') => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
};

// a fake service env file (quoted `!` / `*AQIC` values, numbers, booleans) — never a real one.
const ENV_YAML = [
    'local:',
    `  NAME: local-${MARKER}`,
    'dev:',
    '  NAME: lemon-dev',
    `  SECRET: ${MARKER}`,
    `  BANG: '!${MARKER}'`,
    `  ENC_KEY: '*AQIC${MARKER}'`,
    '  PORT: 8080',
    '  RATIO: 1.5',
    '  ENABLED: true',
    '  OFF: false',
    '  QUOTED_NUM: "007"',
    '',
].join('\n');

// a service root holding `env/dev.yml` (or `yaml` text) plus a sibling dir outside the root.
const service = (yaml = ENV_YAML) => {
    const base = temp();
    const root = path.join(base, 'service');
    mkdirSync(path.join(root, 'env'), { recursive: true });
    writeFileSync(path.join(root, 'env', 'dev.yml'), yaml);
    return { base, root };
};

// run `main` in process; collect stdout / stderr.
const run = async (argv, cwd, deps = {}) => {
    const out = [];
    const err = [];
    const code = await main(argv, { stdout: s => out.push(s), stderr: s => err.push(s), cwd, ...deps });
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
};

// the result has no marker anywhere in what it printed.
const noValues = r => {
    assert.ok(!r.stdout.includes(MARKER), 'stdout leaks a value');
    assert.ok(!r.stderr.includes(MARKER), 'stderr leaks a value');
    assert.ok(!r.stdout.includes('*AQIC') && !r.stderr.includes('*AQIC'), 'ciphertext printed');
};

// a failed run: exit code, error code, and the JSON error line.
const failed = (r, exit, code) => {
    assert.equal(r.code, exit, r.stderr);
    assert.equal(r.stdout, '');
    const e = JSON.parse(r.stderr);
    assert.equal(e.status, 'failed');
    assert.equal(e.code, code);
    noValues(r);
    return e;
};

// the build argv of `env/dev.yml` → `out`.
const build = (out = '.artifacts/env/dev.json', envFile = 'env/dev.yml', stage = 'dev') => [
    'build',
    '--env-file',
    envFile,
    '--stage',
    stage,
    '--output',
    out,
];

test('build: Serverless rule — strings as is (! kept), number/boolean stringified, keys sorted, names-only report', async () => {
    const { root } = service();
    const r = await run(build(), root);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    noValues(r);
    assert.deepEqual(JSON.parse(r.stdout), {
        envFile: 'env/dev.yml',
        stage: 'dev',
        count: 9,
        keys: ['BANG', 'ENABLED', 'ENC_KEY', 'NAME', 'OFF', 'PORT', 'QUOTED_NUM', 'RATIO', 'SECRET'],
        encryptedKeys: ['ENC_KEY'],
        output: path.join('.artifacts', 'env', 'dev.json'),
    });
    const file = path.join(root, '.artifacts', 'env', 'dev.json');
    const text = readFileSync(file, 'utf8');
    const map = JSON.parse(text);
    assert.deepEqual(Object.keys(map), [...Object.keys(map)].sort());
    assert.deepEqual(map, {
        BANG: `!${MARKER}`,
        ENABLED: 'true',
        ENC_KEY: `*AQIC${MARKER}`,
        NAME: 'lemon-dev',
        OFF: 'false',
        PORT: '8080',
        QUOTED_NUM: '007',
        RATIO: '1.5',
        SECRET: MARKER,
    });
    // the other stage is not merged in.
    assert.ok(!text.includes(`local-${MARKER}`));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(root, '.artifacts')).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(root, '.artifacts', 'env')).mode & 0o777, 0o700);
});

test('build: an existing output file is replaced atomically with mode 0600 (no temp file left)', async () => {
    const { root } = service();
    writeFileSync(path.join(root, 'out.json'), '{"OLD":"x"}');
    chmodSync(path.join(root, 'out.json'), 0o644);
    const r = await run(build('out.json'), root);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(statSync(path.join(root, 'out.json')).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'out.json'), 'utf8')).SECRET, MARKER);
    assert.deepEqual(readFileSync(path.join(root, 'out.json'), 'utf8').includes('OLD'), false, 'old content replaced');
    const leftovers = (await import('node:fs')).readdirSync(root).filter(f => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
});

test('build: null, object, array and timestamp values are rejected naming the keys only', async () => {
    const { root } = service(
        [
            'dev:',
            `  OK: ${MARKER}`,
            '  EMPTY:',
            '  NULLED: null',
            `  NESTED: { inner: ${MARKER} }`,
            `  LIST: [${MARKER}, b]`,
            '  WHEN: 2026-01-01',
            '',
        ].join('\n'),
    );
    const r = await run(build(), root);
    const e = failed(r, 1, 'UNSUPPORTED_VALUES');
    assert.match(e.message, /EMPTY, LIST, NESTED, NULLED, WHEN/);
    assert.ok(!e.message.includes('OK'), 'a valid key is not listed');
    assert.ok(!existsSync(path.join(root, '.artifacts')), 'nothing written');
});

test('build: invalid key names are rejected naming the keys only', async () => {
    const { root } = service(
        [
            'dev:',
            `  GOOD_KEY: ${MARKER}`,
            `  bad-key: ${MARKER}`,
            `  _X: ${MARKER}`,
            `  A: ${MARKER}`,
            `  1A: ${MARKER}`,
            '',
        ].join('\n'),
    );
    const e = failed(await run(build(), root), 1, 'INVALID_KEYS');
    assert.match(e.message, /1A, A, _X, bad-key/);
    assert.ok(!e.message.includes('GOOD_KEY'));
});

test('build: a missing stage or a stage that is not a mapping names the stage only', async () => {
    const { root } = service(['dev:', `  NAME: ${MARKER}`, `prod: ${MARKER}`, `list: [${MARKER}]`, ''].join('\n'));
    for (const stage of ['test', 'prod', 'list']) {
        const e = failed(await run(build('o.json', 'env/dev.yml', stage), root), 1, 'STAGE_NOT_FOUND');
        assert.equal(e.message, `Stage ${stage} is missing or is not a mapping.`);
    }
    // a document that is not a mapping at all.
    writeFileSync(path.join(root, 'env', 'dev.yml'), `${MARKER}\n`);
    failed(await run(build(), root), 1, 'STAGE_NOT_FOUND');
});

test('build: a YAML parse error drops the source text (line number only)', async () => {
    for (const text of [`dev:\n  A: [${MARKER}\n`, `dev:\n  BANG: !${MARKER}\n`, `dev:\n  A: x\n  A: ${MARKER}\n`]) {
        const { root } = service(text);
        const e = failed(await run(build(), root), 1, 'ENV_FILE_INVALID');
        assert.match(e.message, /^Cannot parse env\/dev\.yml as YAML( \(line \d+\))?\.$/);
    }
});

test('build: --env-file must stay inside the service root (.., absolute, symlinked file or dir)', async () => {
    const { base, root } = service();
    writeFileSync(path.join(base, 'outside.yml'), ENV_YAML);
    mkdirSync(path.join(base, 'outdir'));
    writeFileSync(path.join(base, 'outdir', 'dev.yml'), ENV_YAML);
    symlinkSync(path.join(base, 'outside.yml'), path.join(root, 'env', 'link.yml'));
    symlinkSync(path.join(base, 'outdir'), path.join(root, 'linkdir'));
    for (const envFile of ['../outside.yml', path.join(base, 'outside.yml'), 'env/link.yml', 'linkdir/dev.yml']) {
        const r = await run(build('o.json', envFile), root);
        failed(r, 2, 'INVALID_ARGS');
    }
    assert.ok(!existsSync(path.join(root, 'o.json')));
    // a symlink that stays inside the root is fine; an absolute path inside the root too.
    symlinkSync(path.join(root, 'env', 'dev.yml'), path.join(root, 'env', 'alias.yml'));
    assert.equal((await run(build('o.json', 'env/alias.yml'), root)).code, 0);
    assert.equal((await run(build('o2.json', path.join(root, 'env', 'dev.yml')), root)).code, 0);
});

test('build: --output must stay inside the root and never be (or pass through) a symlink', async () => {
    const { base, root } = service();
    // `..`, absolute outside.
    for (const out of ['../o.json', path.join(base, 'o.json')]) failed(await run(build(out), root), 2, 'INVALID_ARGS');
    assert.ok(!existsSync(path.join(base, 'o.json')));
    // a symlinked directory that leads out.
    mkdirSync(path.join(base, 'outdir'));
    symlinkSync(path.join(base, 'outdir'), path.join(root, 'linkdir'));
    failed(await run(build('linkdir/sub/o.json'), root), 2, 'INVALID_ARGS');
    failed(await run(build('linkdir/o.json'), root), 2, 'INVALID_ARGS');
    assert.deepEqual((await import('node:fs')).readdirSync(path.join(base, 'outdir')), []);
    // the target itself is a symlink (even to a file inside the root): refused, the link target untouched.
    writeFileSync(path.join(root, 'real.json'), 'keep');
    symlinkSync(path.join(root, 'real.json'), path.join(root, 'link.json'));
    const e = failed(await run(build('link.json'), root), 2, 'INVALID_ARGS');
    assert.match(e.message, /--output must not be a symlink/);
    assert.equal(readFileSync(path.join(root, 'real.json'), 'utf8'), 'keep');
    // a directory as target; the env file itself as target.
    mkdirSync(path.join(root, 'adir'));
    failed(await run(build('adir'), root), 2, 'INVALID_ARGS');
    failed(await run(build('env/dev.yml'), root), 2, 'INVALID_ARGS');
    // the env file through a symlinked directory inside the root; a dangling symlinked directory.
    symlinkSync(path.join(root, 'env'), path.join(root, 'envlink'));
    failed(await run(build('envlink/dev.yml'), root), 2, 'INVALID_ARGS');
    symlinkSync(path.join(base, 'gone'), path.join(root, 'dangling'));
    failed(await run(build('dangling/o.json'), root), 2, 'INVALID_ARGS');
    assert.equal(readFileSync(path.join(root, 'env', 'dev.yml'), 'utf8'), ENV_YAML);
});

test('build: argument errors exit 2 (command, flags, stage name, extension, missing file → 1)', async () => {
    const { root } = service();
    writeFileSync(path.join(root, 'env', 'dev.json'), '{}');
    for (const argv of [
        [],
        ['deploy'],
        ['build'],
        ['build', '--env-file', 'env/dev.yml', '--stage', 'dev'],
        [...build(), '--stage', 'dev'],
        [...build(), '--apply'],
        ['build', '--env-file', '--stage', 'dev', '--output', 'o.json'],
        build('o.json', 'env/dev.yml', '../dev'),
        build('o.json', 'env/dev.yml', '__proto__'),
        build('o.json', 'env/dev.json'),
    ])
        failed(await run(argv, root), 2, 'INVALID_ARGS');
    failed(await run(build('o.json', 'env/none.yml'), root), 1, 'ENV_FILE_NOT_FOUND');
    assert.deepEqual(parseEnvArgs(['build', '-h']), { help: true });
    const help = await run(['--help'], root);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage: lemon-lambda-env build --env-file/);
    assert.match(help.stdout, /lemon-lambda-env diff --config/);
});

test('build as a process: the marker reaches only the output file', () => {
    const { root } = service();
    const p = spawnSync(process.execPath, [path.join(repo, 'bin', 'lemon-lambda-env.mjs'), ...build()], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        env: { PATH: process.env.PATH, HOME: root },
    });
    assert.equal(p.status, 0, p.stderr);
    assert.ok(!p.stdout.includes(MARKER) && !p.stderr.includes(MARKER));
    assert.ok(readFileSync(path.join(root, '.artifacts', 'env', 'dev.json'), 'utf8').includes(MARKER));
    // a failing run as a process: same JSON error line, exit 1, no value.
    writeFileSync(path.join(root, 'env', 'dev.yml'), `dev:\n  BAD: [${MARKER}]\n`);
    const f = spawnSync(process.execPath, [path.join(repo, 'bin', 'lemon-lambda-env.mjs'), ...build()], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30_000,
        env: { PATH: process.env.PATH, HOME: root },
    });
    assert.equal(f.status, 1);
    assert.equal(JSON.parse(f.stderr).code, 'UNSUPPORTED_VALUES');
    assert.ok(!f.stdout.includes(MARKER) && !f.stderr.includes(MARKER));
});

test('stageEnvironment / compareEnvironment are pure and names-only', () => {
    assert.deepEqual(stageEnvironment({ dev: { BB: 1, AA: '!x' } }, 'dev'), { AA: '!x', BB: '1' });
    assert.throws(() => stageEnvironment({ dev: new Date(0) }, 'dev'), { code: 'STAGE_NOT_FOUND' });
    // an inherited name (not an own key of the document) is not a stage.
    assert.throws(() => stageEnvironment({}, 'constructor'), { code: 'STAGE_NOT_FOUND' });
    const d = compareEnvironment({ AA: '1', BB: '2', CC: '*AQICa' }, { AA: '1', BB: '3', DD: '*AQICb' });
    assert.deepEqual(d, {
        counts: { same: 1, changed: 1, new: 1, liveOnly: 1 },
        same: ['AA'],
        changed: ['BB'],
        new: ['CC'],
        liveOnly: ['DD'],
        encryptedKeys: { same: [], changed: [], new: ['CC'], liveOnly: ['DD'] },
    });
});

// ----- diff -----

// a code-mode deploy config of the placeholder example (fake account 123456789012).
const codeConfig = () => {
    const c = structuredClone(example);
    for (const k of ['environmentFile', 'policy', 'routes', 'deletionProtection']) delete c[k];
    return { ...c, mode: 'code' };
};

// the function names of the example config.
const LAMBDA = `${example.project}-dev-lambda`;
const BACKEND = `${example.project}-dev-backend`;

// a fake ARN of `name` in the example account/region.
const arn = (name, account = example.account) => `arn:aws:lambda:${example.region}:${account}:function:${name}`;

// the built map of the diff cases (values carry the marker).
const BUILT = {
    SAME: `same-${MARKER}`,
    CHANGED: `file-${MARKER}`,
    NEW_KEY: `new-${MARKER}`,
    ENC_SAME: `*AQICsame-${MARKER}`,
    ENC_CHANGED: `*AQICfile-${MARKER}`,
};

// the live environments per function.
const LIVE = {
    [LAMBDA]: {
        SAME: `same-${MARKER}`,
        CHANGED: `live-${MARKER}`,
        ENC_SAME: `*AQICsame-${MARKER}`,
        ENC_CHANGED: `*AQIClive-${MARKER}`,
        STAGE: 'dev',
        ENC_LIVE: `*AQIConly-${MARKER}`,
    },
    [BACKEND]: { SAME: `same-${MARKER}`, CHANGED: `file-${MARKER}`, EXTRA: MARKER },
};

/**
 * a stubbed `LambdaClient`: records every command; `GetFunctionConfiguration` answers from `live`.
 * - `fail(name)` may throw instead; `patch(found)` may change the answer.
 */
const stubLambda = ({ live = LIVE, fail, patch = f => f } = {}) => {
    const calls = [];
    return {
        calls,
        client: {
            // the SDK `send` of one command.
            async send(command) {
                calls.push({ command: command.constructor.name, input: { ...command.input } });
                const name = command.input.FunctionName;
                fail?.(name);
                return patch({
                    FunctionName: name,
                    FunctionArn: arn(name),
                    ...(live[name] ? { Environment: { Variables: { ...live[name] } } } : {}),
                });
            },
            // must not be called for an injected client.
            destroy() {
                throw new Error('destroy of an injected client');
            },
        },
    };
};

// a service root with `deploy.json` (code config) and `.artifacts/env/dev.json` (built map).
const diffRoot = ({ config = codeConfig(), built = BUILT } = {}) => {
    const root = temp('lemon-env-diff-');
    writeFileSync(path.join(root, 'deploy.json'), typeof config === 'string' ? config : JSON.stringify(config));
    mkdirSync(path.join(root, '.artifacts', 'env'), { recursive: true });
    writeFileSync(
        path.join(root, '.artifacts', 'env', 'dev.json'),
        typeof built === 'string' ? built : JSON.stringify(built),
    );
    return root;
};

// run `diff` with the stub.
const diff = (root, stub) =>
    run(['diff', '--config', 'deploy.json', '--env', '.artifacts/env/dev.json'], root, {
        readerFactory: config => createEnvReader(config, { lambdaClient: stub.client }),
    });

test('diff: same / changed / new / liveOnly per function, names and counts only, GetFunctionConfiguration only', async () => {
    const root = diffRoot();
    const stub = stubLambda();
    const r = await diff(root, stub);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, '');
    noValues(r);
    assert.deepEqual(JSON.parse(r.stdout), {
        schemaVersion: 1,
        execution: 'read-only',
        target: { project: example.project, stage: 'dev', region: example.region },
        env: path.join('.artifacts', 'env', 'dev.json'),
        count: 5,
        encryptedKeys: ['ENC_CHANGED', 'ENC_SAME'],
        functions: {
            lambda: {
                name: LAMBDA,
                counts: { same: 2, changed: 2, new: 1, liveOnly: 2 },
                same: ['ENC_SAME', 'SAME'],
                changed: ['CHANGED', 'ENC_CHANGED'],
                new: ['NEW_KEY'],
                liveOnly: ['ENC_LIVE', 'STAGE'],
                encryptedKeys: { same: ['ENC_SAME'], changed: ['ENC_CHANGED'], new: [], liveOnly: ['ENC_LIVE'] },
            },
            backend: {
                name: BACKEND,
                counts: { same: 2, changed: 0, new: 3, liveOnly: 1 },
                same: ['CHANGED', 'SAME'],
                changed: [],
                new: ['ENC_CHANGED', 'ENC_SAME', 'NEW_KEY'],
                liveOnly: ['EXTRA'],
                encryptedKeys: { same: [], changed: [], new: ['ENC_CHANGED', 'ENC_SAME'], liveOnly: [] },
            },
        },
    });
    // read-only: exactly one GetFunctionConfiguration per function, nothing else.
    assert.deepEqual(stub.calls, [
        { command: 'GetFunctionConfigurationCommand', input: { FunctionName: LAMBDA } },
        { command: 'GetFunctionConfigurationCommand', input: { FunctionName: BACKEND } },
    ]);
});

test('diff: a function without an environment reports every file key as new', async () => {
    const stub = stubLambda({ live: {} });
    const r = await diff(diffRoot(), stub);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    for (const f of Object.values(out.functions)) {
        assert.deepEqual(f.counts, { same: 0, changed: 0, new: 5, liveOnly: 0 });
        assert.deepEqual(f.new, Object.keys(BUILT).sort());
    }
});

test('diff: config validation errors exit 2 (bad JSON, unknown key, bootstrap mode, bad stage)', async () => {
    const bootstrap = { ...structuredClone(example), environmentFile: 'env.json' };
    for (const config of [
        '{not json',
        { ...codeConfig(), extra: MARKER },
        bootstrap,
        { ...codeConfig(), stage: 'test' },
        { ...codeConfig(), schemaVersion: 2 },
    ]) {
        const stub = stubLambda();
        failed(await diff(diffRoot({ config }), stub), 2, 'INVALID_INPUT');
        assert.deepEqual(stub.calls, [], 'no AWS call on invalid input');
    }
});

test('diff: --env must be a string map with valid key names (errors name keys only, exit 2)', async () => {
    for (const [built, pattern] of [
        ['{not json', /Invalid --env JSON/],
        [JSON.stringify([MARKER]), /not a JSON object/],
        [{ GOOD: MARKER, 'bad-key': MARKER, _X: MARKER }, /key names: _X, bad-key/],
        [{ GOOD: MARKER, NUM: 1, NUL: null, OBJ: { a: MARKER } }, /values must be strings \(NUL, NUM, OBJ\)/],
    ]) {
        const stub = stubLambda();
        const e = failed(await diff(diffRoot({ built }), stub), 2, 'INVALID_INPUT');
        assert.match(e.message, pattern);
        assert.ok(!e.message.includes('GOOD'));
        assert.deepEqual(stub.calls, []);
    }
    failed(await run(['diff', '--config', 'deploy.json'], diffRoot()), 2, 'INVALID_ARGS');
    failed(
        await run(['diff', '--config', 'deploy.json', '--env', 'x', '--stage', 'dev'], diffRoot()),
        2,
        'INVALID_ARGS',
    );
});

test('diff: read failures exit 1 without the SDK message (missing function, access denied, other account, env error)', async () => {
    // a missing function names the function.
    const missing = stubLambda({
        fail: name => {
            if (name === BACKEND)
                throw Object.assign(new Error(`not found ${MARKER}`), { name: 'ResourceNotFoundException' });
        },
    });
    const e1 = failed(await diff(diffRoot(), missing), 1, 'FUNCTION_NOT_FOUND');
    assert.equal(e1.message, `Function ${BACKEND} does not exist.`);
    // access denied: only the error name.
    const denied = stubLambda({
        fail: () => {
            throw Object.assign(new Error(`User ${arn('x')} is not authorized ${MARKER}`), {
                name: 'AccessDeniedException',
            });
        },
    });
    const e2 = failed(await diff(diffRoot(), denied), 1, 'READ_FAILED');
    assert.equal(e2.message, `Could not read the configuration of ${LAMBDA} (AccessDeniedException).`);
    assert.ok(!e2.message.includes('arn:'));
    assert.equal(denied.calls.length, 1, 'stops at the first failure');
    // the profile points at another account.
    const other = stubLambda({ patch: f => ({ ...f, FunctionArn: arn(f.FunctionName, '210987654321') }) });
    failed(await diff(diffRoot(), other), 1, 'TARGET_MISMATCH');
    // the live environment cannot be decrypted.
    const envError = stubLambda({
        patch: f => ({ ...f, Environment: { Error: { ErrorCode: 'KMSAccessDeniedException', Message: MARKER } } }),
    });
    failed(await diff(diffRoot(), envError), 1, 'ENVIRONMENT_UNREADABLE');
    // an unexpected (non-Error) failure of the reader factory.
    const r = await run(['diff', '--config', 'deploy.json', '--env', '.artifacts/env/dev.json'], diffRoot(), {
        readerFactory: () => {
            throw new TypeError(MARKER);
        },
    });
    failed(r, 1, 'UNEXPECTED_ERROR');
});

test('package.json ships the bin and its library module', () => {
    const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
    assert.equal(pkg.bin['lemon-lambda-env'], 'bin/lemon-lambda-env.mjs');
    for (const f of ['bin/lemon-lambda-env.mjs', 'bin/lib/lambda-env.mjs']) assert.ok(pkg.files.includes(f), f);
    assert.ok(!pkg.files.includes('bin/lib/lambda-env.spec.mjs'));
});
