/**
 * `bin/lib/event.spec.mjs` (lemon-core)
 * - offline tests for the web event builder in `event.mjs` and the `--internal` / `--identity` options.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/event.test.mjs` (node:test -> vitest); the CLI runs in a temp root.
import { test, describe, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { webEvent, toRoute, checkWebOptions, eventLabel, parseIdentity, IDENTITY_WARNING } from './event.mjs';
import { maskHeaders, ArgError } from './common.mjs';
import { makeConsumer, SERVICE } from './fixtures/consumer.mjs';

// the invoke script, run with `--dry` only (no AWS call).
const SCRIPT = fileURLToPath(new URL('../lemon-lambda-invoke.mjs', import.meta.url));

// the temp consumer root the CLI runs in (its `serverless.yml` gives the service name).
let C;
beforeAll(() => {
    C = makeConsumer();
});
afterAll(() => C.done());

// run the invoke script offline and return `{ status, stdout, stderr }`.
//* v5 B19: `cwd` = the temp consumer root (the tool reads `serverless.yml` from the process cwd).
const dry = (args, cwd = C.root) => spawnSync(process.execPath, [SCRIPT, ...args, '--dry'], { encoding: 'utf8', cwd });

// assert that `fn` throws an `ArgError` (code 2) whose message matches `re`.
const throwsArg = (fn, re) =>
    assert.throws(fn, e => e instanceof ArgError && e.code === 2 && re.test(e.message), `expected ArgError ${re}`);

// header names of one header map, lower-cased.
const names = H => Object.keys(H).map(k => k.toLowerCase());

describe('web event', () => {
    test('default event has `Host: localhost` in both header maps', () => {
        const ev = webEvent({ path: '/hello/0' }, 'dev');
        assert.equal(ev.headers.Host, 'localhost');
        assert.deepEqual(ev.multiValueHeaders.Host, ['localhost']);
        assert.equal(ev.requestContext.domainName, undefined);
        assert.equal(eventLabel('web', {}), 'web');
    });
    test('toRoute maps `/{type}/{id}/{cmd}`', () => {
        assert.deepEqual(toRoute('/'), { resource: '/', pathParameters: null });
        assert.deepEqual(toRoute('/hello/0'), { resource: '/hello/{id}', pathParameters: { id: '0' } });
        assert.deepEqual(toRoute('/mocks/fields/admin'), {
            resource: '/mocks/{id}/{cmd}',
            pathParameters: { id: 'fields', cmd: 'admin' },
        });
    });
    test('`--internal` drops every host header and keeps the rest', () => {
        const base = webEvent({ path: '/mocks/fields/admin' }, 'dev');
        const ev = webEvent({ path: '/mocks/fields/admin', internal: true, header: ['host:x'] }, 'dev');
        assert.ok(!names(ev.headers).includes('host'));
        assert.ok(!names(ev.multiValueHeaders).includes('host'));
        assert.equal(ev.requestContext.domainName, undefined);
        // everything but the host header stays.
        const { Host, ...rest } = base.headers;
        assert.equal(Host, 'localhost');
        assert.deepEqual(ev.headers, rest);
        assert.equal(ev.resource, base.resource);
        assert.equal(eventLabel('web', { internal: true }), 'web(internal)');
    });
    test('`--identity` sets x-lemon-identity verbatim and is masked for echo', () => {
        const id = '{"sid":"s1", "uid":"u1"}';
        const ev = webEvent({ path: '/x', internal: true, identity: id }, 'dev');
        assert.equal(ev.headers['x-lemon-identity'], id);
        assert.deepEqual(ev.multiValueHeaders['x-lemon-identity'], [id]);
        const masked = maskHeaders(ev);
        assert.equal(masked.headers['x-lemon-identity'], '<redacted>');
        assert.deepEqual(masked.multiValueHeaders['x-lemon-identity'], ['<redacted>']);
    });
    test('invalid `--identity` JSON is an ArgError (code 2)', () => {
        throwsArg(() => parseIdentity('{bad'), /^--identity is not valid JSON$/);
        throwsArg(() => parseIdentity(true), /--identity needs a JSON string/);
        throwsArg(() => webEvent({ identity: '{bad' }, 'dev'), /not valid JSON/);
        assert.equal(parseIdentity(undefined), undefined);
    });
    test('web-only options with another event kind are errors', () => {
        throwsArg(() => checkWebOptions('cron', { internal: true }), /^--internal applies to --event web only$/);
        throwsArg(() => checkWebOptions('sns', { identity: '{}' }), /^--identity applies to --event web only$/);
        assert.deepEqual(checkWebOptions('cron', {}), []);
    });
    test('`--identity` without `--internal` warns', () => {
        assert.deepEqual(checkWebOptions('web', { identity: '{}' }), [IDENTITY_WARNING]);
        assert.deepEqual(checkWebOptions('web', { identity: '{}', internal: true }), []);
    });
});

describe('lambda-invoke --dry', () => {
    test('`--internal --identity` passes strict options; no host key, identity masked', () => {
        const r = dry(['--internal', '--path', '/mocks/fields/admin', '--identity', '{"sid":"s1"}']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout.split('\n')[0], / event=web\(internal\) GET \/mocks\/fields\/admin /);
        assert.doesNotMatch(r.stdout, /"host"/i);
        assert.doesNotMatch(r.stdout, /s1/);
        assert.match(r.stdout, /"x-lemon-identity": "<redacted>"/);
        assert.equal(r.stderr, '');
    });
    test('`--identity` alone warns on stderr and continues', () => {
        const r = dry(['--identity', '{}']);
        assert.equal(r.status, 0);
        assert.equal(r.stderr.trim(), IDENTITY_WARNING);
        assert.match(r.stdout, /"Host": "localhost"/);
    });
    test('bad uses exit 2', () => {
        const cron = dry(['--internal', '--event', 'cron']);
        assert.equal(cron.status, 2);
        assert.equal(cron.stderr.trim(), 'ERROR: --internal applies to --event web only');
        const bad = dry(['--identity', '{bad']);
        assert.equal(bad.status, 2);
        assert.equal(bad.stderr.trim(), 'ERROR: --identity is not valid JSON');
    });
    //* v5 B19: the target name comes from the root `serverless.yml` (process cwd, or `--cwd`).
    test('the function name is `<service of the root>-<stage>-<fn>`; `--cwd` points at another root', () => {
        const here = dry([]);
        assert.equal(here.status, 0, here.stderr);
        assert.match(here.stdout.split('\n')[0], new RegExp(`^invoke ${SERVICE}-dev-lambda event=web GET / `));
        const there = dry(['--cwd', C.root, '--fn', 'backend'], tmpdir());
        assert.equal(there.status, 0, there.stderr);
        assert.match(there.stdout.split('\n')[0], new RegExp(`^invoke ${SERVICE}-dev-backend `));
        // no serverless.yml in the process cwd and no `--cwd`: exit 2 with the hint.
        const none = dry([], tmpdir());
        assert.equal(none.status, 2);
        assert.match(none.stderr, /^ERROR: cannot read serverless\.yml .*pass --name <function-name> instead/);
        const named = dry(['--name', 'my-fn', '--stage', 'dev', '--confirm-stage', 'dev'], tmpdir());
        assert.equal(named.status, 0, named.stderr);
        assert.match(named.stdout, /^invoke my-fn /);
    });
});
