/**
 * `bin/lib/fields-admin.spec.mjs` (lemon-core)
 * - offline tests for `fields-admin.mjs` (fake `fetch` and fake Lambda invoker; no AWS, no server).
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`); the checks of a 200 report need `dist/` (`npm run build`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/fields-admin.test.mjs` (node:test -> vitest), plus root cases.
import { test, describe, vi, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, parseOptions, loadExpect, defaultUrl, textLines, DEFAULT_EXPECT, CORE_FILE } from './fields-admin.mjs';
import { invokeLambda } from './invoke.mjs';
import { functionName, ArgError } from './common.mjs';
import { makeConsumer, SERVICE, PORT } from './fixtures/consumer.mjs';

// the CLI entry, run with `--dry` / `--help` only (no AWS call).
const SCRIPT = fileURLToPath(new URL('../lemon-fields-admin.mjs', import.meta.url));

//* v5 B19: the verifier of lemon-core itself (`dist/`, CJS); the cases that reach it are skipped without a build.
const HAS_DIST = existsSync(CORE_FILE);
const { checkFieldsAdmin } = HAS_DIST ? createRequire(import.meta.url)(CORE_FILE) : {};

// the default fixture of `mocks` in the temp consumer root (matches the canned report below).
const FIXTURE = { type: 'mocks', model: 'mock', source: 'list', counts: { core: 16, fields: 16, extra: 2 } };
FIXTURE.extra = ['name', 'aliasId'];

//* v5 B19: the temp consumer root (`serverless.yml`, `package.json` with `port`, the default fixture).
const C = makeConsumer({ files: { [DEFAULT_EXPECT]: JSON.stringify(FIXTURE) } });
afterAll(() => C.done());

// every in-process run reads the root from `process.cwd()` = the temp consumer.
beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(C.root);
});
afterEach(() => vi.restoreAllMocks());

// the function name the lambda target resolves by default (dev).
const NAME = functionName({ cwd: C.root });

// the 403 text of the gate (lemon-core `doGetAdmin`).
const DENIED = '403 NOT ALLOWED - fields/admin is local or direct-invoke only @doGetAdmin(mocks/fields)';

// 16 core names (with `id`, `_id`), and a list-fed manager that drops two and adds two.
const CORE = ['id', '_id', 'ns', 'type', 'sid', 'uid', 'gid', 'lock', 'next', 'meta'];
CORE.push('createdAt', 'updatedAt', 'deletedAt', 'stereo', '$', '_key');
const FIELDS = [...CORE.filter(k => !['$', '_key'].includes(k)), 'name', 'aliasId'];

// a canned `fields/admin` report of `/mocks` with the given runtime.
const report = (runtime, over = {}) => ({
    id: 'fields',
    type: 'mocks',
    model: 'mock',
    core: [...CORE],
    fields: [...FIELDS],
    extra: ['name', 'aliasId'],
    counts: { core: 16, fields: 16, extra: 2 },
    source: 'list',
    ok: true,
    issues: [],
    runtime: { node: 'v24.0.0', lemonCore: '5.0.0', ...runtime },
    ...over,
});

// runtime of the local express server and of the deployed Lambda (direct invoke).
const LOCAL = { local: true, external: true, lambda: null };
const LAMBDA = { local: false, external: false, lambda: NAME };

// a fake `fetch` answering `status` with `body`; records each call.
const fakeFetch = (status, body) => {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init });
        return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
    };
    return Object.assign(fn, { calls });
};

// a fake invoker: internal events get (adminCode, body), external ones get gateCode; records each event.
const fakeInvoke = ({ adminCode = 200, body, gateCode = 403, functionError } = {}) => {
    const events = [];
    const fn = async event => {
        events.push(event);
        const external = 'Host' in event.headers;
        const payload = external
            ? { statusCode: gateCode, body: gateCode === 403 ? DENIED : JSON.stringify(body) }
            : { statusCode: adminCode, body: typeof body === 'string' ? body : JSON.stringify(body) };
        return { statusCode: 200, functionError, text: JSON.stringify(payload), took: 1 };
    };
    return Object.assign(fn, { events });
};

// run with captured output and a fake STS banner; returns `{ code, out, err, lines }`.
const call = async (argv, deps = {}) => {
    const out = [];
    const err = [];
    const identity = async () => `account=****0000 region=x credentials=default-chain function=${NAME}`;
    const code = await run(argv, { log: s => out.push(s), error: s => err.push(s), identity, ...deps });
    return { code, out: out.join('\n'), err: err.join('\n'), lines: out.join('\n').split('\n') };
};

// assert that `fn` throws an `ArgError` (code 2) whose message matches `re`.
const throwsArg = (fn, re) =>
    assert.throws(fn, e => e instanceof ArgError && e.code === 2 && re.test(e.message), `expected ArgError ${re}`);

// a temp dir with one file of `text`; returns its path and a cleanup.
const tempFile = text => {
    const dir = mkdtempSync(join(tmpdir(), 'fields-admin-'));
    const file = join(dir, 'expect.json');
    writeFileSync(file, text);
    return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
};

describe('fields-admin arguments', () => {
    test('unknown option, missing or invalid --target exit 2', async () => {
        const unknown = await call(['--target', 'express', '--foo']);
        assert.equal(unknown.code, 2);
        assert.equal(unknown.err, 'ERROR: unknown option --foo (see --help)');
        const missing = await call([]);
        assert.equal(missing.code, 2);
        assert.equal(missing.err, 'ERROR: --target must be express or lambda (got: none)');
        const invalid = await call(['--target', 'api']);
        assert.equal(invalid.code, 2);
        assert.match(invalid.err, /--target must be express or lambda \(got: api\)/);
    });
    test('options of the other target, --gate, and a bad --type exit 2', () => {
        throwsArg(
            () => parseOptions(['--target', 'express', '--stage', 'dev']),
            /^--stage applies to --target lambda only$/,
        );
        throwsArg(
            () => parseOptions(['--target', 'express', '--no-gate']),
            /^--no-gate applies to --target lambda only$/,
        );
        throwsArg(
            () => parseOptions(['--target', 'lambda', '--url', 'http://x']),
            /^--url applies to --target express only$/,
        );
        throwsArg(() => parseOptions(['--target', 'lambda', '--gate']), /use --no-gate/);
        throwsArg(() => parseOptions(['--target', 'express', '--type', '../x']), /--type must be one path segment/);
        throwsArg(
            () => parseOptions(['--target', 'express', '--url', 'ftp://x']),
            /--url must be an http\(s\) base URL/,
        );
        throwsArg(() => parseOptions(['--target', 'express', '--max-bytes', 'x']), /--max-bytes needs/);
    });
    test('bad --expect: missing file, invalid JSON, not an object, unknown key', () => {
        throwsArg(
            () => loadExpect('no-such-file.json', 'mocks'),
            /^cannot read --expect no-such-file.json \(ENOENT\)$/,
        );
        for (const [text, re] of [
            ['{bad', /^invalid JSON in --expect /],
            ['[1]', /must hold a JSON object$/],
            ['{"runtime":{}}', /^unknown key "runtime" in --expect /],
        ]) {
            const t = tempFile(text);
            try {
                throwsArg(() => loadExpect(t.file, 'mocks'), re);
            } finally {
                t.done();
            }
        }
    });
    test('the run exits 2 on a bad --expect', async () => {
        const r = await call(['--target', 'express', '--expect', 'no-such-file.json'], { fetch: fakeFetch(200, {}) });
        assert.equal(r.code, 2);
        assert.match(r.err, /^ERROR: cannot read --expect no-such-file.json/);
    });
    test('default --expect is the shared fixture for mocks only', () => {
        const fixture = loadExpect(undefined, 'mocks');
        assert.deepEqual(Object.keys(fixture).sort(), ['counts', 'extra', 'model', 'source', 'type']);
        assert.equal(fixture.type, 'mocks');
        assert.deepEqual(loadExpect(undefined, 'tests'), {});
        assert.equal(DEFAULT_EXPECT, 'src/modules/mock/fields-admin.expected.json');
        assert.match(defaultUrl(), /^http:\/\/127\.0\.0\.1:\d+$/);
    });
    //* v5 B19: the default fixture and `port` are read under the service root (process cwd, or `--cwd`).
    test('the root: fixture and port of the process cwd, or of `--cwd`; a missing one exits 2', async () => {
        assert.equal(NAME, `${SERVICE}-dev-lambda`);
        assert.equal(defaultUrl(), `http://127.0.0.1:${PORT}`);
        const other = makeConsumer({ port: 9911, files: { [DEFAULT_EXPECT]: '{"type":"other"}' } });
        const bare = makeConsumer({ port: null });
        try {
            assert.equal(defaultUrl(other.root), 'http://127.0.0.1:9911');
            assert.deepEqual(loadExpect(undefined, 'mocks', other.root), { type: 'other' });
            throwsArg(() => defaultUrl(bare.root), /^no "port" in package\.json; pass --url <base>$/);
            throwsArg(() => defaultUrl(join(bare.root, 'none')), /^cannot read package\.json /);
            throwsArg(() => loadExpect(undefined, 'mocks', bare.root), /^cannot read --expect src\/modules/);
            // `--cwd` on the run: the other root's port (status 403: no verifier needed).
            const fetch = fakeFetch(403, DENIED);
            const r = await call(['--target', 'express', '--type', 'tests', '--cwd', other.root], { fetch });
            assert.equal(r.code, 1);
            assert.equal(fetch.calls[0].url, 'http://127.0.0.1:9911/tests/fields/admin');
            const miss = await call(['--target', 'express', '--cwd', bare.root], { fetch: fakeFetch(200, {}) });
            assert.equal(miss.code, 2);
            assert.match(miss.err, /^ERROR: cannot read --expect /);
            throwsArg(() => parseOptions(['--target', 'express', '--cwd']), /^--cwd needs a directory$/);
            assert.match(CORE_FILE, /dist[\\/]extended[\\/]cores[\\/]fields-admin\.js$/);
        } finally {
            other.done();
            bare.done();
        }
    });
    test('--help exits 0 with any other argument', async () => {
        const r = await call(['--help', '--foo']);
        assert.equal(r.code, 0);
        assert.match(r.lines[0], /checkFieldsAdmin\(\) of lemon-core/);
    });
});

describe('fields-admin targets', () => {
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('the same report content gives the identical check on both targets', async () => {
        const good = report(LOCAL);
        const express = await call(['--target', 'express', '--json'], { fetch: fakeFetch(200, good) });
        const lambda = await call(['--target', 'lambda', '--json'], { invoke: fakeInvoke({ body: report(LAMBDA) }) });
        assert.equal(express.code, 0, express.out);
        assert.equal(lambda.code, 0, lambda.out);
        assert.deepEqual(JSON.parse(express.out).check, { ok: true, issues: [] });
        assert.deepEqual(JSON.parse(lambda.out).check, JSON.parse(express.out).check);
        // a tampered count fails the same way on both.
        const bad = { counts: { core: 16, fields: 15, extra: 2 } };
        const e2 = await call(['--target', 'express', '--json'], { fetch: fakeFetch(200, report(LOCAL, bad)) });
        const l2 = await call(['--target', 'lambda', '--json'], { invoke: fakeInvoke({ body: report(LAMBDA, bad) }) });
        assert.equal(e2.code, 1);
        assert.equal(l2.code, 1);
        assert.deepEqual(JSON.parse(l2.out).check, JSON.parse(e2.out).check);
        assert.ok(JSON.parse(e2.out).check.issues.includes('counts.fields=15 but fields has 16'));
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('both targets use checkFieldsAdmin with the fixture and their own runtime', async () => {
        const fixture = loadExpect(undefined, 'mocks');
        const one = report(LOCAL);
        const express = await call(['--target', 'express', '--json'], { fetch: fakeFetch(200, one) });
        const lambda = await call(['--target', 'lambda', '--json'], { invoke: fakeInvoke({ body: one }) });
        const wantE = checkFieldsAdmin(one, { ...fixture, runtime: { local: true, lambda: false } });
        const wantL = checkFieldsAdmin(one, { ...fixture, runtime: { local: false, external: false, lambda: NAME } });
        assert.deepEqual(JSON.parse(express.out).check, wantE);
        assert.deepEqual(JSON.parse(lambda.out).check, wantL);
        // a local report is not the deployed Lambda.
        assert.equal(lambda.code, 1);
        assert.ok(wantL.issues.includes(`expected runtime.lambda=${NAME} got null`));
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)(
        'express: GET <base>/<type>/fields/admin with Accept json, and the summary line',
        async () => {
            const fetch = fakeFetch(200, report(LOCAL));
            const r = await call(['--target', 'express', '--url', 'http://127.0.0.1:9/'], { fetch });
            assert.equal(r.code, 0, r.out);
            assert.equal(fetch.calls[0].url, 'http://127.0.0.1:9/mocks/fields/admin');
            assert.equal(fetch.calls[0].init.headers.Accept, 'application/json');
            assert.deepEqual(r.lines, [
                'fields/admin target=express type=mocks http=200 ok=true source=list counts=16/16/2 runtime=local lemon-core=5.0.0 issues=0',
            ]);
        },
    );
    test('express 403 exits 1 with the http status and the server text', async () => {
        const r = await call(['--target', 'express'], { fetch: fakeFetch(403, DENIED) });
        assert.equal(r.code, 1);
        assert.match(r.lines[0], / http=403 ok=false source=- counts=-\/-\/- runtime=- lemon-core=- issues=1$/);
        assert.equal(r.lines[1], `  - expected http 200 got 403: ${DENIED}`);
    });
    test('express transport error exits 1', async () => {
        const fetch = async () => {
            throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        };
        const r = await call(['--target', 'express', '--url', 'http://127.0.0.1:9'], { fetch });
        assert.equal(r.code, 1);
        assert.equal(r.err, 'ERROR: cannot reach http://127.0.0.1:9/mocks/fields/admin (ECONNREFUSED)');
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('lambda: internal admin event, then the external gate event closed with 403', async () => {
        const invoke = fakeInvoke({ body: report(LAMBDA) });
        const r = await call(['--target', 'lambda'], { invoke });
        assert.equal(r.code, 0, r.out);
        assert.equal(invoke.events.length, 2);
        const [admin, gate] = invoke.events;
        assert.equal(admin.path, '/mocks/fields/admin');
        assert.ok(!Object.keys(admin.headers).some(k => k.toLowerCase() === 'host'));
        assert.equal(gate.headers.Host, 'localhost');
        assert.deepEqual(r.lines, [
            `fields/admin target=lambda type=mocks http=200 ok=true source=list counts=16/16/2 runtime=lambda:${NAME} lemon-core=5.0.0 issues=0`,
            'gate=closed(403)',
        ]);
        assert.match(r.err, /^account=\*\*\*\*0000 /);
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('lambda gate answering 200 exits 1 with gate=open(200)', async () => {
        const r = await call(['--target', 'lambda'], { invoke: fakeInvoke({ body: report(LAMBDA), gateCode: 200 }) });
        assert.equal(r.code, 1);
        assert.match(r.lines[0], / ok=true /);
        assert.equal(r.lines.at(-1), 'gate=open(200)');
    });
    test('lambda FunctionError exits 1', async () => {
        const r = await call(['--target', 'lambda'], { invoke: fakeInvoke({ body: {}, functionError: 'Unhandled' }) });
        assert.equal(r.code, 1);
        assert.match(r.out, /lambda invoke failed: status=200 function-error=Unhandled/);
        assert.equal(r.lines.at(-1), 'gate=open(function-error:Unhandled)');
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('--no-gate skips the gate event', async () => {
        const invoke = fakeInvoke({ body: report(LAMBDA), gateCode: 200 });
        const r = await call(['--target', 'lambda', '--no-gate'], { invoke });
        assert.equal(r.code, 0, r.out);
        assert.equal(invoke.events.length, 1);
        assert.ok(!r.out.includes('gate='));
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('--json prints { target, type, status, report, check, gate } only', async () => {
        const one = report(LAMBDA);
        const r = await call(['--target', 'lambda', '--json'], { invoke: fakeInvoke({ body: one }) });
        const json = JSON.parse(r.out);
        assert.deepEqual(Object.keys(json), ['target', 'type', 'status', 'report', 'check', 'gate']);
        assert.deepEqual(json, {
            target: 'lambda',
            type: 'mocks',
            status: 200,
            report: one,
            check: { ok: true, issues: [] },
            gate: { status: 403, closed: true },
        });
        const e = await call(['--target', 'express', '--json'], { fetch: fakeFetch(200, report(LOCAL)) });
        assert.equal(JSON.parse(e.out).gate, null);
    });
    //* needs the built verifier (`dist/`); the coordinator builds before testing.
    test.skipIf(!HAS_DIST)('another --type without --expect runs the structural check only', async () => {
        const one = report(LOCAL, { type: 'tests', model: 'test' });
        const r = await call(['--target', 'express', '--type', 'tests'], { fetch: fakeFetch(200, one) });
        assert.equal(r.code, 0, r.out);
        assert.match(r.lines[0], /^fields\/admin target=express type=tests http=200 ok=true /);
    });
    test('textLines keeps the summary format for a missing report', () => {
        const lines = textLines({
            target: 'lambda',
            type: 'mocks',
            status: null,
            report: null,
            check: { ok: false, issues: ['x'] },
            gate: { status: 403, closed: true },
        });
        assert.deepEqual(lines, [
            'fields/admin target=lambda type=mocks http=- ok=false source=- counts=-/-/- runtime=- lemon-core=- issues=1',
            '  - x',
            'gate=closed(403)',
        ]);
    });
});

describe('fields-admin --dry and invokeLambda', () => {
    test('--dry prints the target and both events, no AWS call (no stderr)', () => {
        //* v5 B19: `cwd` = the temp consumer root.
        const r = spawnSync(process.execPath, [SCRIPT, '--target', 'lambda', '--dry'], {
            encoding: 'utf8',
            cwd: C.root,
        });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stderr, '');
        const lines = r.stdout.split('\n');
        assert.match(
            lines[0],
            /^fields\/admin target=lambda function=\S+ region=\S+ path=\/mocks\/fields\/admin \(dry\)$/,
        );
        assert.ok(lines[0].includes(` function=${NAME} `));
        const at = lines.indexOf('--- event: gate (external, expect 403) ---');
        assert.ok(lines.includes('--- event: admin (internal, expect 200) ---') && at > 0);
        // the admin event has no host header; the gate event has one.
        assert.doesNotMatch(lines.slice(0, at).join('\n'), /"host"/i);
        assert.match(lines.slice(at).join('\n'), /"Host": "localhost"/);
        const one = spawnSync(process.execPath, [SCRIPT, '--target', 'lambda', '--dry', '--no-gate'], {
            encoding: 'utf8',
            cwd: C.root,
        });
        assert.equal(one.status, 0);
        assert.ok(!one.stdout.includes('--- event: gate'));
    });
    test('the stage guard runs before --dry', () => {
        const r = spawnSync(process.execPath, [SCRIPT, '--target', 'lambda', '--stage', 'prod', '--dry'], {
            encoding: 'utf8',
            cwd: C.root,
        });
        assert.equal(r.status, 2);
        assert.equal(r.stderr.trim(), 'ERROR: stage "prod" needs --confirm-stage prod');
    });
    test('invokeLambda sends one RequestResponse call and decodes the payload', async () => {
        const sent = [];
        const client = {
            send: async cmd => {
                sent.push(cmd.input);
                return { StatusCode: 200, Payload: new TextEncoder().encode('{"statusCode":200}'), LogResult: 'eA==' };
            },
        };
        const r = await invokeLambda(client, { name: 'fn', event: { a: 1 }, tail: true });
        assert.equal(sent[0].FunctionName, 'fn');
        assert.equal(sent[0].InvocationType, 'RequestResponse');
        assert.equal(sent[0].LogType, 'Tail');
        assert.equal(Buffer.from(sent[0].Payload).toString(), '{"a":1}');
        assert.deepEqual(
            { ...r, took: 0 },
            {
                statusCode: 200,
                functionError: undefined,
                text: '{"statusCode":200}',
                logResult: 'eA==',
                requestId: null,
                took: 0,
            },
        );
        const a = await invokeLambda(client, { name: 'fn', event: {}, async: true, tail: true });
        assert.equal(sent[1].InvocationType, 'Event');
        assert.equal(sent[1].LogType, 'None');
        assert.equal(a.statusCode, 200);
    });
});
