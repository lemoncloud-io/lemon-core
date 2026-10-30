/**
 * `bin/lib/migrate-diagnostic.spec.mjs` (lemon-core)
 * - offline tests of migrate-diagnostic.mjs (`lemon-lambda-migrate`): temp dirs under `os.tmpdir()`, stubbed clients/children, no AWS, no network.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/migrate-diagnostic.test.mjs` (node:test -> vitest; every case kept).
import { test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { classifyMigrationError, validateDiagnostic, diagnosticFromMessage } from './migrate-diagnostic.mjs';
import { runPrivateChild } from './migrate-process.mjs';
import { fixture } from './migrate-test-fixture.mjs';
import { executeMigration, readReceipt } from './migrate-core.mjs';
import { main } from '../lemon-lambda-migrate.mjs';

//* v5 B19: node:test had no per-test deadline; the process cases (fork/spawn) need more than 5 s on a busy host.
vi.setConfig({ testTimeout: 60_000 });

const SECRET = 'NEVER-EMIT-token-AKIA-secret-url';
const onlyAllowed = diagnostic => {
    assert.deepEqual(
        Object.keys(diagnostic).sort(),
        ['kind', 'errorType', 'awsCode', 'operation', 'sourceFile', 'line'].sort(),
    );
    assert.ok(!JSON.stringify(diagnostic).includes(SECRET));
    assert.ok(!JSON.stringify(diagnostic).includes('://'));
};
const location = '/private/fixture/scripts/migrate/migrate.mjs';
const makeError = (Constructor, source = location, line = 93) => {
    const error = new Constructor(SECRET);
    Object.defineProperty(error, 'stack', {
        value: `${Constructor.name}: ${SECRET}\n    at work (${pathToFileURL(source).href}:${line}:12)`,
    });
    return error;
};

test('diagnostic accepts only known JS types and exact canonical source basename/line', () => {
    for (const Constructor of [
        Error,
        TypeError,
        ReferenceError,
        SyntaxError,
        RangeError,
        URIError,
        EvalError,
        AggregateError,
    ]) {
        const result = classifyMigrationError(makeError(Constructor), { migrationFile: location });
        assert.equal(result.kind, 'javascript');
        assert.equal(result.errorType, Constructor.name);
        assert.equal(result.sourceFile, 'migrate.mjs');
        assert.equal(result.line, 93);
        onlyAllowed(result);
    }
    const common = classifyMigrationError(makeError(TypeError, '/private/fixture/scripts/agt/common.mjs', 43), {
        migrationFile: location,
    });
    assert.equal(common.sourceFile, 'common.mjs');
    assert.equal(common.line, 43);
    for (const source of [
        '/private/secret/common.mjs',
        '/private/other/migrate.mjs',
        '/private/fixture/scripts/migrate/else.mjs',
    ]) {
        const result = classifyMigrationError(makeError(Error, source), { migrationFile: location });
        assert.equal(result.sourceFile, 'other');
        assert.equal(result.line, null);
        onlyAllowed(result);
    }
    for (const line of [0, -1, 100001, 9999999])
        assert.equal(classifyMigrationError(makeError(Error, location, line), { migrationFile: location }).line, null);
});
test('AWS CLI recognizes fixed code/operation header only, never raw message or trailing values', () => {
    const error = makeError(Error);
    error.stderr = `\nAn error occurred (AccessDeniedException) when calling the GetFunctionConfiguration operation: ${SECRET} https://signed.invalid/?secret=${SECRET}`;
    const result = classifyMigrationError(error, { migrationFile: location });
    assert.equal(result.kind, 'aws-cli');
    assert.equal(result.awsCode, 'AccessDeniedException');
    assert.equal(result.operation, 'GetFunctionConfiguration');
    assert.equal(result.errorType, 'other');
    onlyAllowed(result);
    for (const stderr of [
        `An error occurred (${SECRET}) when calling the GetFunction operation: x`,
        `An error occurred (AccessDenied) when calling the ${SECRET} operation: x`,
        `arbitrary ${SECRET}`,
    ]) {
        const e = makeError(Error);
        e.stderr = stderr;
        const d = classifyMigrationError(e, { migrationFile: location });
        assert.equal(d.awsCode, 'other');
        assert.equal(d.operation, 'other');
        onlyAllowed(d);
    }
    const messageOnly = makeError(Error);
    messageOnly.message = 'An error occurred (AccessDenied) when calling the GetFunction operation: ' + SECRET;
    assert.equal(classifyMigrationError(messageOnly).awsCode, 'other');
});
test('malicious strings, custom prototypes, getters and proxies are not evaluated or forwarded', () => {
    let calls = 0;
    const object = {};
    for (const field of ['name', 'message', 'stack', 'stderr', 'constructor'])
        Object.defineProperty(object, field, {
            get() {
                calls++;
                throw Error(SECRET);
            },
            enumerable: true,
        });
    onlyAllowed(classifyMigrationError(object, { migrationFile: location }));
    assert.equal(calls, 0);
    const error = new Error();
    Object.defineProperty(error, 'message', {
        get() {
            calls++;
            return SECRET;
        },
    });
    onlyAllowed(classifyMigrationError(error, { migrationFile: location }));
    assert.equal(calls, 0);
    const proxy = new Proxy(
        {},
        {
            get() {
                calls++;
                throw Error(SECRET);
            },
            getPrototypeOf() {
                calls++;
                throw Error(SECRET);
            },
            ownKeys() {
                calls++;
                throw Error(SECRET);
            },
        },
    );
    for (const value of [SECRET, null, undefined, proxy, Object.create({ name: SECRET })]) {
        const d = classifyMigrationError(value, { migrationFile: location });
        assert.equal(d.kind, 'other');
        onlyAllowed(d);
    }
    assert.equal(calls, 0);
    const previous = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
    Object.defineProperty(Error, 'prepareStackTrace', {
        configurable: true,
        get() {
            calls++;
            return () => SECRET;
        },
    });
    try {
        onlyAllowed(classifyMigrationError(new Error(), { migrationFile: location }));
        assert.equal(calls, 0);
    } finally {
        if (previous) Object.defineProperty(Error, 'prepareStackTrace', previous);
        else delete Error.prepareStackTrace;
    }
});
test('IPC diagnostics are reconstructed and unknown values/extra fields cannot cross the boundary', () => {
    for (const diagnostic of [
        { kind: SECRET, errorType: SECRET, awsCode: SECRET, operation: SECRET, sourceFile: SECRET, line: SECRET },
        { kind: 'aws-cli', awsCode: 'AccessDenied', operation: SECRET },
        { kind: 'javascript', errorType: 'TypeError', sourceFile: 'migrate.mjs', line: 2, secret: SECRET },
    ])
        onlyAllowed(diagnosticFromMessage({ diagnostic }));
    assert.equal(
        diagnosticFromMessage({ diagnostic: { kind: 'javascript', errorType: 'TypeError', extra: SECRET } }).kind,
        'other',
    );
    let calls = 0;
    const message = {};
    Object.defineProperty(message, 'diagnostic', {
        get() {
            calls++;
            throw Error(SECRET);
        },
    });
    assert.equal(diagnosticFromMessage(message).kind, 'other');
    assert.equal(calls, 0);
    assert.equal(
        validateDiagnostic({
            kind: 'javascript',
            errorType: {
                toString() {
                    throw Error(SECRET);
                },
            },
        }).errorType,
        'other',
    );
});
test('real private child reports safe JS/AWS diagnostics with source line and suppresses raw output', async t => {
    const f = await fixture(t),
        script = path.join(f.repo, 'scripts/migrate/migrate.mjs');
    await writeFile(
        script,
        `console.log(${JSON.stringify(SECRET)});console.error(${JSON.stringify(
            SECRET,
        )});throw new TypeError(${JSON.stringify(SECRET)});`,
    );
    const request = {
        mode: 'migration',
        command: script,
        cwd: f.root,
        environment: { PATH: process.env.PATH },
        timeoutMs: 2000,
    };
    const js = await runPrivateChild(request);
    assert.equal(js.code, 1);
    assert.equal(js.reason, 'failed');
    assert.equal(js.diagnostic.errorType, 'TypeError');
    assert.equal(js.diagnostic.sourceFile, 'migrate.mjs');
    assert.equal(js.diagnostic.line, 1);
    onlyAllowed(js.diagnostic);
    await mkdir(path.join(f.repo, 'scripts/agt'), { recursive: true });
    await writeFile(
        path.join(f.repo, 'scripts/agt/common.mjs'),
        `const error=new Error(${JSON.stringify(SECRET)});error.stderr=${JSON.stringify(
            'aws: [ERROR]: An error occurred (ValidationError) when calling the GetTemplate operation: ' + SECRET,
        )};throw error;`,
    );
    await writeFile(script, "await import('../agt/common.mjs');");
    const aws = await runPrivateChild(request);
    assert.equal(aws.diagnostic.kind, 'aws-cli');
    assert.equal(aws.diagnostic.operation, 'GetTemplate');
    assert.equal(aws.diagnostic.sourceFile, 'common.mjs');
    onlyAllowed(aws.diagnostic);
});
test('real nonzero direct exit and forged IPC remain classified without exposing arbitrary values', async t => {
    const f = await fixture(t),
        script = path.join(f.repo, 'scripts/migrate/migrate.mjs'),
        request = {
            mode: 'migration',
            command: script,
            cwd: f.root,
            environment: { PATH: process.env.PATH },
            timeoutMs: 2000,
        };
    await writeFile(script, `console.error(${JSON.stringify(SECRET)});process.exit(2);`);
    const direct = await runPrivateChild(request);
    assert.equal(direct.code, 2);
    assert.equal(direct.diagnostic.kind, 'process');
    onlyAllowed(direct.diagnostic);
    await writeFile(
        script,
        `await new Promise(()=>process.send({diagnostic:{kind:'javascript',errorType:${JSON.stringify(
            SECRET,
        )},sourceFile:${JSON.stringify(SECRET)},line:3,raw:${JSON.stringify(SECRET)}}},()=>process.exit(1)));`,
    );
    const forged = await runPrivateChild(request);
    assert.equal(forged.code, 1);
    assert.equal(forged.diagnostic.kind, 'other');
    onlyAllowed(forged.diagnostic);
});
test('failed step receipt and CLI JSON propagate safe diagnostic while exit/state semantics remain', async t => {
    const f = await fixture(t),
        script = path.join(f.repo, 'scripts/migrate/migrate.mjs');
    await writeFile(script, `throw new ReferenceError(${JSON.stringify(SECRET)});`);
    const deps = {
        ...f.deps,
        runChild: r =>
            r.mode === 'sts'
                ? Promise.resolve({ code: 0, reason: 'exited', account: f.config.account })
                : runPrivateChild(r),
    };
    let failure;
    try {
        await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, deps);
    } catch (error) {
        failure = error;
    }
    assert.equal(failure.exitCode, 3);
    assert.equal(failure.unknown, true);
    assert.equal(failure.diagnostic.errorType, 'ReferenceError');
    const state = await readReceipt(failure.receipt);
    assert.equal(state.status, 'unknown');
    assert.equal(state.steps[0].diagnostic.errorType, 'ReferenceError');
    assert.ok(!(await readFile(failure.receipt, 'utf8').then(s => s.includes(SECRET))));
    const second = await fixture(t);
    const errors = [];
    const diag = {
        kind: 'aws-cli',
        awsCode: 'AccessDenied',
        operation: 'DescribeStackResources',
        sourceFile: 'common.mjs',
        line: 39,
    };
    const code = await main(['plan', '--config', second.configFile, '--execute', '--allow-sensitive-backup'], {
        ...second.deps,
        runChild: async r =>
            r.mode === 'sts'
                ? { code: 0, reason: 'exited', account: second.config.account }
                : { code: 1, reason: 'failed', diagnostic: diag },
        stdout: assert.fail,
        stderr: s => errors.push(s),
    });
    assert.equal(code, 3);
    const output = JSON.parse(errors[0]);
    assert.equal(output.status, 'unknown');
    assert.deepEqual(output.diagnostic, validateDiagnostic(diag));
    onlyAllowed(output.diagnostic);
});
test('STS failure diagnostics are retained without changing blocked state or invoking migration', async t => {
    const f = await fixture(t);
    let calls = 0;
    await assert.rejects(
        executeMigration(
            f.config,
            'plan',
            { allowSensitiveBackup: true },
            {
                ...f.deps,
                runChild: async () => {
                    calls++;
                    return {
                        code: 1,
                        reason: 'failed',
                        diagnostic: { kind: 'aws-cli', awsCode: 'ExpiredToken', operation: 'GetCallerIdentity' },
                    };
                },
            },
        ),
        error => error.exitCode === 1 && !error.unknown && error.diagnostic.awsCode === 'ExpiredToken',
    );
    assert.equal(calls, 1);
    const state = await readReceipt(path.join(f.run, 'templates-receipt.json'));
    assert.equal(state.status, 'blocked');
    assert.equal(state.steps[0].diagnostic.operation, 'GetCallerIdentity');
});

test('known API Gateway throttle header is classified without its service error text', () => {
    const error = new Error(SECRET);
    error.stderr = 'An error occurred (TooManyRequestsException) when calling the GetResources operation: ' + SECRET;
    const result = classifyMigrationError(error);
    assert.equal(result.kind, 'aws-cli');
    assert.equal(result.awsCode, 'TooManyRequestsException');
    assert.equal(result.operation, 'GetResources');
    onlyAllowed(result);
});

test('AWS CLI ERROR prefix preserves known throttle classification without accepting arbitrary prefixes', () => {
    const header = 'An error occurred (TooManyRequestsException) when calling the GetResources operation: ' + SECRET;
    const error = new Error(SECRET);
    error.stderr = 'aws: [ERROR]: ' + header;
    const result = classifyMigrationError(error);
    assert.equal(result.kind, 'aws-cli');
    assert.equal(result.awsCode, 'TooManyRequestsException');
    assert.equal(result.operation, 'GetResources');
    onlyAllowed(result);
    for (const prefix of ['aws: [SECRET]: ', SECRET + ' ', 'aws: [ERROR]: ' + SECRET + ' ']) {
        error.stderr = prefix + header;
        const rejected = classifyMigrationError(error);
        assert.equal(rejected.awsCode, 'other');
        assert.equal(rejected.operation, 'other');
        onlyAllowed(rejected);
    }
});

test('proxy ancestors are never traversed while classifying a thrown object', () => {
    let traps = 0;
    const proxy = new Proxy(
        {},
        {
            getPrototypeOf() {
                traps++;
                throw new Error(SECRET);
            },
        },
    );
    const result = classifyMigrationError(Object.create(proxy), { migrationFile: location });
    assert.equal(traps, 0);
    assert.equal(result.kind, 'other');
    onlyAllowed(result);
});
test('proxy-ancestor child failure cannot become successful retain and preserves unknown lock', async t => {
    const f = await fixture(t);
    await executeMigration(f.config, 'plan', { allowSensitiveBackup: true }, f.deps);
    const script = path.join(f.repo, 'scripts/migrate/migrate.mjs');
    await writeFile(script, 'throw Object.create(new Proxy({}, {getPrototypeOf(){process.exit(0);}}));');
    const deps = {
        ...f.deps,
        runChild: r =>
            r.mode === 'sts'
                ? Promise.resolve({ code: 0, reason: 'exited', account: f.config.account })
                : runPrivateChild(r),
    };
    await assert.rejects(
        executeMigration(f.config, 'retain', {}, deps),
        error =>
            error.exitCode === 3 && error.unknown && error.code === 'PHASE_FAILED' && error.diagnostic.kind === 'other',
    );
    const receipt = await readReceipt(path.join(f.run, 'templates-receipt.json'));
    assert.equal(receipt.status, 'unknown');
    assert.deepEqual(receipt.completed, ['plan']);
    const step = receipt.steps.at(-1);
    assert.equal(step.phase, 'retain');
    assert.equal(step.status, 'unknown');
    assert.equal(step.exitCode, 1);
    onlyAllowed(step.diagnostic);
    assert.ok(await stat(path.join(f.run, 'templates.lock')));
});
