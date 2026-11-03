/**
 * `bin/lib/common.spec.mjs` (lemon-core)
 * - offline tests for the pure helpers in `common.mjs` (no AWS calls), the service root, the optional peers,
 *   and `--help` of every invoke / observe entry.
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B19: ported from lemon-templates-api `bin/lib/common.test.mjs` (node:test -> vitest), plus root / peer cases.
import { test, describe, vi, beforeAll, afterAll, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
import { STSClient } from '@aws-sdk/client-sts';
import { makeConsumer, SERVICE } from './fixtures/consumer.mjs';
import {
    parseArgs,
    checkStage,
    deriveStage,
    groupFunctionName,
    parseMaxBytes,
    redact,
    redactJson,
    stripControl,
    capBytes,
    maskHeaders,
    maskAccount,
    credentialSource,
    identityLine,
    outputFilter,
    ArgError,
    HarnessError,
    DEFAULT_MAX_BYTES,
    serviceRoot,
    readServiceName,
    tryServiceName,
    functionName,
    resolveAws,
    resolveIdentity,
    tryPeer,
    needPeer,
} from './common.mjs';

// a known list like the scripts' option tables.
const KNOWN = ['stage', 'confirm-stage', 'name', 'function', 'header', 'dry', 'follow', 'help', 'raw'];

// parse with the strict settings the scripts use.
const strict = argv =>
    parseArgs(argv, {
        booleans: ['dry', 'follow', 'help', 'raw'],
        aliases: { fn: 'function', f: 'follow' },
        known: KNOWN,
        maxPositional: 0,
    });

// assert that `fn` throws an `ArgError` (code 2) whose message matches `re`.
const throwsArg = (fn, re) =>
    assert.throws(fn, e => e instanceof ArgError && e.code === 2 && re.test(e.message), `expected ArgError ${re}`);

describe('strict options', () => {
    test('known options, aliases and short flags pass', () => {
        const o = strict(['--stage', 'dev', '--fn', 'backend', '-f', '--header', 'a:1', '--header', 'b:2', '--dry']);
        assert.equal(o.stage, 'dev');
        assert.equal(o.function, 'backend');
        assert.equal(o.follow, true);
        assert.deepEqual(o.header, ['a:1', 'b:2']);
        assert.equal(o.dry, true);
    });
    test('unknown long option is an error', () => {
        throwsArg(() => strict(['--bogus']), /^unknown option --bogus \(see --help\)$/);
    });
    test('unknown `--key=value` and `--no-x` are errors', () => {
        throwsArg(() => strict(['--bogus=1']), /unknown option --bogus/);
        throwsArg(() => strict(['--no-bogus']), /unknown option --no-bogus/);
    });
    test('unknown short flag is an error', () => {
        throwsArg(() => strict(['-x']), /unknown option -x/);
    });
    test('extra positional is an error', () => {
        throwsArg(() => strict(['prod']), /unknown argument prod/);
        throwsArg(() => strict(['--', 'x']), /unknown argument x/);
    });
    test('--help wins over unknown options', () => {
        const o = strict(['--bogus', '--help']);
        assert.equal(o.help, true);
    });
    test('without `known`, parsing stays permissive', () => {
        const o = parseArgs(['--anything', 'x', 'pos']);
        assert.equal(o.anything, 'x');
        assert.deepEqual(o._, ['pos']);
    });
});

describe('stage guard', () => {
    test('dev (default) passes without confirmation', () => {
        assert.equal(checkStage({}), 'dev');
        assert.equal(checkStage({ stage: 'dev' }), 'dev');
    });
    test('prod without --confirm-stage is an error', () => {
        throwsArg(() => checkStage({ stage: 'prod' }), /^stage "prod" needs --confirm-stage prod$/);
        throwsArg(() => checkStage({ stage: 'staging' }), /stage "staging" needs --confirm-stage staging/);
    });
    test('prod with the matching --confirm-stage passes', () => {
        assert.equal(checkStage({ stage: 'prod', confirm: 'prod' }), 'prod');
    });
    test('mismatched --confirm-stage is an error', () => {
        throwsArg(() => checkStage({ stage: 'prod', confirm: 'staging' }), /needs --confirm-stage prod/);
        throwsArg(() => checkStage({ stage: 'dev', confirm: 'prod' }), /does not match stage "dev"/);
        throwsArg(() => checkStage({ stage: 'prod', confirm: 'PROD' }), /needs --confirm-stage prod/);
    });
    test('--name derives the stage from <service>-<stage>-<fn>', () => {
        assert.equal(deriveStage('svc-dev-lambda', 'svc'), 'dev');
        assert.equal(deriveStage('svc-prod-v2-backend', 'svc'), 'prod-v2');
        assert.equal(deriveStage('other-dev-lambda', 'svc'), null);
        assert.equal(deriveStage('svc-lambda', 'svc'), null);
        assert.equal(deriveStage('svc-dev-lambda', null), null);
        assert.equal(checkStage({ name: 'svc-dev-lambda', service: 'svc' }), 'dev');
        throwsArg(() => checkStage({ name: 'svc-prod-lambda', service: 'svc' }), /stage "prod" needs/);
        assert.equal(checkStage({ name: 'svc-prod-lambda', service: 'svc', confirm: 'prod' }), 'prod');
    });
    test('--name and --stage that disagree both need the confirmation', () => {
        throwsArg(
            () => checkStage({ name: 'svc-prod-lambda', service: 'svc', stage: 'dev', confirm: 'prod' }),
            /does not match stage "dev"/,
        );
    });
    test('underivable --name needs --stage and --confirm-stage', () => {
        throwsArg(() => checkStage({ name: 'my-fn', service: 'svc' }), /cannot be derived/);
        throwsArg(() => checkStage({ name: 'my-fn', service: 'svc', stage: 'dev' }), /cannot be derived/);
        throwsArg(() => checkStage({ name: 'my-fn', service: 'svc', stage: 'dev', confirm: 'prod' }), /derived/);
        assert.equal(checkStage({ name: 'my-fn', service: 'svc', stage: 'dev', confirm: 'dev' }), 'dev');
    });
    test('log group maps to a function name', () => {
        assert.equal(groupFunctionName('/aws/lambda/svc-prod-lambda'), 'svc-prod-lambda');
        assert.equal(groupFunctionName('/custom/group'), null);
        throwsArg(() => checkStage({ name: 'svc-prod-lambda', service: 'svc', label: '--group' }), /needs/);
        throwsArg(() => checkStage({ name: '/custom/group', service: 'svc', label: '--group' }), /--group/);
    });
});

describe('redact', () => {
    test('account ids and ARNs', () => {
        assert.equal(redact('account 123456789012 here'), 'account <acct> here');
        assert.equal(redact('1234567890123 stays'), '1234567890123 stays');
        assert.equal(redact('role arn:aws:iam::123456789012:role/x done'), 'role <arn> done');
        assert.equal(redact('"arn:aws:lambda:ap-northeast-2:1:function:f"'), '"<arn>"');
    });
    test('access key ids', () => {
        // built at runtime so no key-shaped literal sits in the repo.
        const tail = 'EXAMPLE0'.repeat(2);
        assert.equal(redact(`k=AKIA${tail}.`), 'k=<aws-key>.');
        assert.equal(redact(`ASIA${tail}`), '<aws-key>');
    });
    test('bearer tokens', () => {
        assert.equal(redact('sent Bearer abc.def-123 ok'), 'sent Bearer <redacted> ok');
    });
    test('sensitive headers in `key: value`, JSON and `key=value` forms', () => {
        assert.equal(redact('Authorization: Bearer abc'), 'Authorization: <redacted>');
        assert.equal(redact('x-lemon-identity: {"sid":"s1"}'), 'x-lemon-identity: <redacted>');
        assert.equal(redact('{"x-api-key":"k1","host":"h"}'), '{"x-api-key":"<redacted>","host":"h"}');
        assert.equal(redact("{ cookie: 'a=1; b=2', host: 'h' }"), "{ cookie: '<redacted>', host: 'h' }");
        assert.equal(redact('Set-Cookie=sid42&x=1'), 'Set-Cookie=<redacted>&x=1');
        assert.equal(redact('{"Authorization" : "Bearer x"}'), '{"Authorization" : "<redacted>"}');
        assert.equal(redact('"cookie":"a\\"b"'), '"cookie":"<redacted>"');
    });
    test('JWT-looking tokens', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmnop';
        assert.equal(redact(`token in ${jwt} text`), 'token in <jwt> text');
    });
    test('values of secret-like key names', () => {
        assert.equal(redact('{"clientSecret":"s3"}'), '{"clientSecret":"<redacted>"}');
        assert.equal(redact('db_password=hunter2 user=a'), 'db_password=<redacted> user=a');
        assert.equal(redact('passwd: abc'), 'passwd: <redacted>');
        assert.equal(redact("{ accessToken: 'abc', n: 1 }"), "{ accessToken: '<redacted>', n: 1 }");
        assert.equal(redact('"private_key":"-----BEGIN"'), '"private_key":"<redacted>"');
        assert.equal(
            redact('apikey=1 api_key=2 access_key=3'),
            'apikey=<redacted> api_key=<redacted> access_key=<redacted>',
        );
    });
    test('IPv4, URLs and emails', () => {
        assert.equal(redact('from 10.0.0.12 ok'), 'from <ip> ok');
        assert.equal(redact('GET https://api.example.com/v1/x?a=1 done'), 'GET https://api.example.com/<path> done');
        assert.equal(redact('see http://host.local'), 'see http://host.local');
        assert.equal(redact('see http://host.local/'), 'see http://host.local/');
        assert.equal(redact('https://user:pw@host.io/p'), 'https://host.io/<path>');
        assert.equal(redact('mail a.b+c@example.co.kr now'), 'mail <email> now');
    });
    test('long adversarial inputs stay fast (no quadratic regex)', () => {
        const n = 256 * 1024;
        const inputs = [
            'a'.repeat(n),
            'a@'.repeat(n / 2),
            'eyJ'.repeat(n / 3),
            ' secret'.repeat(n / 7),
            'x: ['.repeat(n / 4),
        ];
        const t0 = Date.now();
        for (const v of inputs) outputFilter().log(v);
        assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
    });
    test('plain text passes unchanged', () => {
        const s = 'PERF: took=12ms status=200 id=abc-def';
        assert.equal(redact(s), s);
    });
});

describe('redactJson', () => {
    test('redacts string values recursively and keeps structure', () => {
        const v = {
            ok: true,
            n: 3,
            list: ['10.1.2.3', { email: 'x@y.io' }],
            headers: { Authorization: 'abc', Host: 'h' },
            multiValueHeaders: { cookie: ['a', 'b'] },
            auth: { refreshToken: { value: 'r' } },
            note: 'acct 123456789012',
        };
        assert.deepEqual(redactJson(v), {
            ok: true,
            n: 3,
            list: ['<ip>', { email: '<email>' }],
            headers: { Authorization: '<redacted>', Host: 'h' },
            multiValueHeaders: { cookie: ['<redacted>', '<redacted>'] },
            auth: { refreshToken: { value: '<redacted>' } },
            note: 'acct <acct>',
        });
    });
    test('`raw` keeps values but still caps them', () => {
        const v = { password: 'p', long: 'x'.repeat(20) };
        assert.deepEqual(redactJson(v, { raw: true, maxBytes: 10 }), {
            password: 'p',
            long: `${'x'.repeat(10)}…[truncated 10 bytes]`,
        });
    });
});

describe('stripControl', () => {
    test('drops ANSI escapes and C0 controls, keeps tab and newline', () => {
        assert.equal(stripControl('\x1b[31mred\x1b[0m'), 'red');
        assert.equal(stripControl('a\tb\nc'), 'a\tb\nc');
        assert.equal(stripControl('a\rb\x07c\x00d\x7f'), 'abcd');
        assert.equal(stripControl('\x1b]0;title\x07x'), 'x');
        assert.equal(stripControl('\x1bcreset'), 'reset');
        assert.equal(stripControl('\x9b2Jx'), '2Jx');
    });
    test('log filter strips even with --raw', () => {
        assert.equal(outputFilter({ raw: true }).log('\x1b[2Jip 10.0.0.1'), 'ip 10.0.0.1');
        assert.equal(outputFilter().log('\x1b[2Jip 10.0.0.1'), 'ip <ip>');
    });
});

describe('size cap', () => {
    test('short text passes, long text is cut with the byte count', () => {
        assert.equal(capBytes('abc', 3), 'abc');
        assert.equal(capBytes('abcdef', 4), 'abcd…[truncated 2 bytes]');
    });
    test('multi-byte characters are not split', () => {
        // '가' is 3 bytes in UTF-8.
        assert.equal(capBytes('가나다', 4), '가…[truncated 6 bytes]');
    });
    test('default is 64 KB and --max-bytes changes it (0 = no cap)', () => {
        assert.equal(DEFAULT_MAX_BYTES, 65536);
        const big = 'y'.repeat(DEFAULT_MAX_BYTES + 5);
        assert.match(outputFilter().text(big), /…\[truncated 5 bytes\]$/);
        assert.match(outputFilter({ raw: true }).text(big), /…\[truncated 5 bytes\]$/);
        assert.equal(parseMaxBytes(undefined), DEFAULT_MAX_BYTES);
        assert.equal(parseMaxBytes('100'), 100);
        assert.equal(parseMaxBytes('0'), Infinity);
        assert.equal(outputFilter({ maxBytes: parseMaxBytes('0') }).text(big), big);
        throwsArg(() => parseMaxBytes('abc'), /--max-bytes/);
        throwsArg(() => parseMaxBytes(true), /--max-bytes/);
    });
});

describe('header echo and identity line', () => {
    test('maskHeaders hides only sensitive header values', () => {
        const ev = {
            headers: { 'X-Lemon-Identity': 'abc', 'x-foo': 'bar' },
            multiValueHeaders: { 'X-Lemon-Identity': ['abc'], 'x-foo': ['bar'] },
            body: null,
        };
        assert.deepEqual(maskHeaders(ev), {
            headers: { 'X-Lemon-Identity': '<redacted>', 'x-foo': 'bar' },
            multiValueHeaders: { 'X-Lemon-Identity': ['<redacted>'], 'x-foo': ['bar'] },
            body: null,
        });
        // the original event (sent to Lambda) is not changed.
        assert.equal(ev.headers['X-Lemon-Identity'], 'abc');
        assert.deepEqual(maskHeaders({ cron: { name: '1MIN' } }), { cron: { name: '1MIN' } });
    });
    test('identity line masks the account id', () => {
        assert.equal(maskAccount('123456789012'), '****9012');
        const line = identityLine({ account: '123456789012', region: 'r', credentials: 'env', fn: 'f' });
        assert.equal(line, 'account=****9012 region=r credentials=env function=f');
        assert.doesNotMatch(line, /123456789012/);
    });
    test('credential source', () => {
        assert.equal(credentialSource({ profile: 'p' }, {}), 'profile:p');
        assert.equal(credentialSource({}, { AWS_PROFILE: 'q', AWS_ACCESS_KEY_ID: 'k' }), 'profile:q');
        assert.equal(credentialSource({}, { AWS_ACCESS_KEY_ID: 'k' }), 'env');
        assert.equal(credentialSource({}, {}), 'default-chain');
    });
});

//* v5 B19: the service root is the consumer's cwd (or `--cwd`), not the tool's own repo.
describe('service root (B19)', () => {
    // one temp consumer for this block.
    let C;
    beforeAll(() => {
        C = makeConsumer();
    });
    afterAll(() => C.done());
    afterEach(() => vi.restoreAllMocks());

    test('serviceRoot: process.cwd() by default, `--cwd` resolved against it, a bad value is an ArgError', () => {
        vi.spyOn(process, 'cwd').mockReturnValue(C.root);
        assert.equal(serviceRoot(), C.root);
        assert.equal(serviceRoot(null), C.root);
        assert.equal(serviceRoot(C.root), resolve(C.root));
        vi.restoreAllMocks();
        assert.equal(serviceRoot(relative(process.cwd(), C.root)), resolve(C.root));
        throwsArg(() => serviceRoot(true), /^--cwd needs a directory$/);
        throwsArg(() => serviceRoot(''), /^--cwd needs a directory$/);
    });
    test('readServiceName / functionName read `service:` under the root', () => {
        assert.equal(readServiceName(C.root), SERVICE);
        assert.equal(functionName({ cwd: C.root }), `${SERVICE}-dev-lambda`);
        assert.equal(functionName({ cwd: C.root, stage: 'prod', fn: 'backend' }), `${SERVICE}-prod-backend`);
        assert.equal(functionName({ name: 'x' }), 'x');
        // without `--cwd`: the process cwd.
        vi.spyOn(process, 'cwd').mockReturnValue(C.root);
        assert.equal(readServiceName(), SERVICE);
        assert.equal(tryServiceName(), SERVICE);
        assert.equal(functionName({}), `${SERVICE}-dev-lambda`);
    });
    test('a root without serverless.yml (or without `service:`) asks for --name', () => {
        const none = makeConsumer();
        const bare = makeConsumer({ files: { 'serverless.yml': 'provider:\n  name: aws\n' } });
        try {
            throwsArg(() => readServiceName(`${none.root}/missing`), /^cannot read serverless\.yml .*pass --name/);
            throwsArg(() => readServiceName(bare.root), /^no top-level `service:` in serverless\.yml/);
            assert.equal(tryServiceName(bare.root), null);
            throwsArg(() => functionName({ cwd: bare.root }), /pass --name <function-name>/);
            throwsArg(() => functionName({ cwd: C.root, fn: 'web' }), /--function must be lambda or backend/);
        } finally {
            none.done();
            bare.done();
        }
    });
});

//* v5 B19: the AWS SDK packages are optional peers; a missing one gives the install hint.
describe('optional peers (B19)', () => {
    afterEach(() => vi.restoreAllMocks());

    test('tryPeer: the module when installed, null when the package is missing', async () => {
        const sts = await tryPeer('@aws-sdk/client-sts');
        assert.equal(typeof sts.STSClient, 'function');
        assert.equal(await tryPeer('@aws-sdk/no-such-package-b19'), null);
    });
    test('needPeer: a HarnessError (code 1) with `npm i -D <name>`', () => {
        assert.equal(needPeer({ a: 1 }, 'x').a, 1);
        assert.throws(
            () => needPeer(null, '@aws-sdk/client-cloudwatch-logs'),
            e =>
                e instanceof HarnessError &&
                e.code === 1 &&
                e.message ===
                    'missing optional peer @aws-sdk/client-cloudwatch-logs: install it with `npm i -D @aws-sdk/client-cloudwatch-logs`',
        );
    });
    test('resolveAws: region default / env / flag, and --profile credentials (no AWS call)', () => {
        const before = process.env.AWS_REGION;
        try {
            delete process.env.AWS_REGION;
            assert.deepEqual(resolveAws({}), { region: 'ap-northeast-2' });
            process.env.AWS_REGION = 'us-east-1';
            assert.deepEqual(resolveAws({}), { region: 'us-east-1' });
            assert.equal(resolveAws({ region: 'eu-west-1' }).region, 'eu-west-1');
            assert.equal(typeof resolveAws({ profile: 'p' }).credentials, 'function');
        } finally {
            if (before === undefined) delete process.env.AWS_REGION;
            else process.env.AWS_REGION = before;
        }
    });
    test('resolveIdentity: STS stubbed at the client; the banner masks the account; errors keep the name only', async () => {
        const send = vi.spyOn(STSClient.prototype, 'send').mockResolvedValue({ Account: '123456789012' });
        const line = await resolveIdentity({ region: 'r' }, {}, 'fn-1');
        assert.match(line, /^account=\*\*\*\*9012 region=r credentials=\S+ function=fn-1$/);
        assert.equal(send.mock.calls.length, 1);
        send.mockRejectedValue(Object.assign(new Error('arn:aws:iam::123456789012:user/x'), { name: 'Denied' }));
        await assert.rejects(
            resolveIdentity({ region: 'r' }, {}, 'fn-1'),
            e => e instanceof HarnessError && e.message === 'cannot resolve AWS identity (Denied)',
        );
    });
});

// the five entries of B19-a, with the usage line each prints.
const ENTRIES = [
    ['lemon-lambda-invoke', /^usage: lemon-lambda-invoke \[options\]$/m],
    ['lemon-lambda-logs', /^usage: lemon-lambda-logs \[options\]$/m],
    ['lemon-lambda-perf', /^usage: lemon-lambda-perf \[options\]$/m],
    ['lemon-fields-admin', /^usage: lemon-fields-admin --target express\|lambda \[options\]$/m],
    ['lemon-loop-check', /^usage: lemon-loop-check \[options\]$/m],
];

//* v5 B19: each installed bin answers `--help` from a consumer root (no AWS call, nothing on stderr).
describe('entries --help (B19)', () => {
    // an empty dir: `--help` needs no serverless.yml.
    let C;
    beforeAll(() => {
        C = makeConsumer();
    });
    afterAll(() => C.done());

    test.each(ENTRIES)('%s --help exits 0 with the usage', (bin, usage) => {
        const script = fileURLToPath(new URL(`../${bin}.mjs`, import.meta.url));
        const r = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', cwd: C.root });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, usage);
        assert.match(r.stdout, /--cwd <dir> /);
        assert.equal(r.stderr, '');
    });
});
