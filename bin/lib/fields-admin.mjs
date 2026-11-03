/**
 * `bin/lib/fields-admin.mjs` (lemon-core)
 * - check `GET /<type>/fields/admin` on the local express server or the deployed Lambda with
 *   `checkFieldsAdmin()` of lemon-core (the same verifier and fixture as the service's own spec).
 * - all logic of `lemon-fields-admin`: no `process.exit`; `fetch`, the Lambda invoker, the STS banner,
 *   and the printers are injectable, so the tests run offline.
 * - the service root (default fixture, `package.json`, `serverless.yml`) is `--cwd <dir>`, else `process.cwd()`.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/fields-admin.mjs` (snapshot d57dc5b); root = cwd.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseArgs,
    resolveAws,
    functionName,
    checkStage,
    tryServiceName,
    parseMaxBytes,
    outputFilter,
    maskHeaders,
    resolveIdentity,
    HarnessError,
    ArgError,
    DEFAULT_REGION,
    serviceRoot,
} from './common.mjs';
import { webEvent } from './event.mjs';

// the compiled verifier of lemon-core itself (`bin/` and `dist/` are siblings in the package and in the repo).
//* v5 B19: inside lemon-core the verifier is read from `../../dist` (CJS), not through the package name.
export const CORE_FILE = fileURLToPath(new URL('../../dist/extended/cores/fields-admin.js', import.meta.url));

// `checkFieldsAdmin()` of lemon-core, loaded on first use (throws `HarnessError` when `dist/` is not built).
//* v5 B19: lazy, so `--help` / `--dry` work in a repo checkout without `npm run build`.
const coreCheck = () => {
    if (!existsSync(CORE_FILE)) throw new HarnessError('lemon-core dist/ is not built (run `npm run build`)', 1);
    return createRequire(import.meta.url)(CORE_FILE).checkFieldsAdmin;
};

// the fixture used when `--type mocks` and no `--expect` (repo-relative, shared with the jest spec).
export const DEFAULT_EXPECT = 'src/modules/mock/fields-admin.expected.json';

// the type that has a default fixture.
export const DEFAULT_TYPE = 'mocks';

// help text for `--help`.
export const HELP = [
    'Check GET /<type>/fields/admin with checkFieldsAdmin() of lemon-core.',
    '',
    'usage: lemon-fields-admin --target express|lambda [options]',
    '       npm run fields:admin -- --target express|lambda [options]',
    '',
    'common:',
    '  --target <t>            express | lambda (required)',
    `  --type <type>           api type (default: ${DEFAULT_TYPE})`,
    `  --expect <file>         expected values (default for ${DEFAULT_TYPE}: ${DEFAULT_EXPECT}; else structural check only)`,
    '  --cwd <dir>             service root (serverless.yml, package.json, the default --expect; default: the current directory)',
    '  --json                  print { target, type, status, report, check, gate } only',
    '  --raw                   do not redact the output (control stripping and the size cap stay)',
    '  --max-bytes <n>         cap for one printed text (default: 65536; 0 = no cap)',
    '  --help                  show this help',
    '',
    'express (a locally started server with LOCAL_MODE=1):',
    '  --url <base>            server base URL (default: http://127.0.0.1:<"port" of package.json>)',
    '',
    'lambda (direct invoke with IAM credentials; same target options as lambda:invoke):',
    '  --stage <stage>         deploy stage (default: dev)',
    '  --confirm-stage <stage> required for any stage other than dev (same value as the stage)',
    '  --function, --fn <fn>   lambda | backend (default: lambda)',
    '  --name <name>           full function name (overrides <service>-<stage>-<fn>)',
    `  --region <region>       AWS region (default: $AWS_REGION or ${DEFAULT_REGION})`,
    '  --profile <name>        named profile from ~/.aws (default: SDK default chain)',
    '  --dry                   print the target and both events, do not call AWS',
    '  --no-gate               skip the gate check (external event must answer 403)',
    '',
    'exit codes: 0 = http 200, ok, and gate closed (or skipped); 1 = otherwise; 2 = bad arguments.',
];

// flags that never take a value.
const BOOLEANS = ['json', 'raw', 'help', 'dry', 'gate'];

// options for `--target lambda` only.
const LAMBDA_ONLY = ['stage', 'confirm-stage', 'function', 'name', 'region', 'profile', 'dry', 'gate'];

// options for `--target express` only.
const EXPRESS_ONLY = ['url'];

// every accepted option (aliases resolve to these).
//* v5 B19: `cwd` (the service root) applies to both targets.
const KNOWN = ['target', 'type', 'expect', 'max-bytes', 'cwd', ...EXPRESS_ONLY, ...LAMBDA_ONLY, ...BOOLEANS];

// keys an `--expect` file may hold (`runtime` is set by the target).
const EXPECT_KEYS = ['type', 'model', 'source', 'counts', 'extra', 'core', 'lemonCore'];

// parse argv strictly and check the option combinations (throws `ArgError`).
export const parseOptions = argv => {
    const opts = parseArgs(argv, { booleans: BOOLEANS, aliases: { fn: 'function' }, known: KNOWN, maxPositional: 0 });
    if (opts.help) return opts;
    // the target decides which options apply.
    if (!['express', 'lambda'].includes(opts.target)) {
        throw new ArgError(`--target must be express or lambda (got: ${opts.target ?? 'none'})`);
    }
    const [others, owner] = opts.target === 'express' ? [LAMBDA_ONLY, 'lambda'] : [EXPRESS_ONLY, 'express'];
    const wrong = others.find(k => opts[k] !== undefined);
    // `gate` is only ever given as `--no-gate`.
    const shown = wrong === 'gate' ? 'no-gate' : wrong;
    if (wrong) throw new ArgError(`--${shown} applies to --target ${owner} only`);
    if (opts.gate === true) throw new ArgError('--gate is the default; use --no-gate to skip the gate check');
    // `--type` must be one path segment.
    if (opts.type !== undefined && !(typeof opts.type === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(opts.type))) {
        throw new ArgError(`--type must be one path segment like mocks (got: ${opts.type})`);
    }
    if (opts.expect !== undefined && !(typeof opts.expect === 'string' && opts.expect)) {
        throw new ArgError('--expect needs a file path');
    }
    if (opts.url !== undefined && !(typeof opts.url === 'string' && /^https?:\/\/[^/\s]+/.test(opts.url))) {
        throw new ArgError(`--url must be an http(s) base URL (got: ${opts.url})`);
    }
    parseMaxBytes(opts['max-bytes']);
    //* v5 B19: a bad `--cwd` is an argument error up front.
    serviceRoot(opts.cwd);
    return opts;
};

// read the expected values: `--expect`, else the default fixture for `mocks`, else `{}` (throws `ArgError`).
//* v5 B19: the default fixture is read under `root` (the service root); `--expect` stays relative to the process cwd.
export const loadExpect = (file, type, root = serviceRoot()) => {
    if (file === undefined && type !== DEFAULT_TYPE) return {};
    const path = file === undefined ? join(root, DEFAULT_EXPECT) : file;
    const shown = file === undefined ? DEFAULT_EXPECT : file;
    let text = '';
    try {
        text = readFileSync(path, 'utf8');
    } catch (e) {
        throw new ArgError(`cannot read --expect ${shown} (${e.code || e.message})`);
    }
    let value;
    try {
        value = JSON.parse(text);
    } catch (e) {
        throw new ArgError(`invalid JSON in --expect ${shown}: ${e.message}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ArgError(`--expect ${shown} must hold a JSON object`);
    }
    // a typo in a key would silently skip that check.
    const unknown = Object.keys(value).find(k => !EXPECT_KEYS.includes(k));
    if (unknown)
        throw new ArgError(`unknown key "${unknown}" in --expect ${shown} (allowed: ${EXPECT_KEYS.join(', ')})`);
    return value;
};

// default express base URL from `"port"` in `<root>/package.json` (throws `ArgError`).
//* v5 B19: `root` (default: the service root) instead of the tool's own repo.
export const defaultUrl = (root = serviceRoot()) => {
    let port;
    try {
        port = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).port;
    } catch (e) {
        throw new ArgError(`cannot read package.json (${e.message}); pass --url <base>`);
    }
    if (!port) throw new ArgError('no "port" in package.json; pass --url <base>');
    return `http://127.0.0.1:${port}`;
};

// parse a JSON text, or return undefined.
const tryJson = text => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

// check one response: http 200 and `checkFieldsAdmin(report, want)`; returns `{ status, report, check }`.
export const evaluate = (status, text, want) => {
    if (status !== 200) {
        const body = `${text ?? ''}`.trim();
        return { status, report: null, check: { ok: false, issues: [`expected http 200 got ${status}: ${body}`] } };
    }
    const report = tryJson(text);
    // a non-JSON body is not an object, so the verifier reports it.
    const check = coreCheck()(report === undefined ? text : report, want);
    return { status, report: report === undefined ? null : report, check };
};

// `fetch` the report from the express server (transport errors throw `HarnessError` code 1).
export const fetchExpress = async ({ base, type, want, fetchFn }) => {
    const url = `${base.replace(/\/+$/, '')}/${type}/fields/admin`;
    let resp;
    try {
        resp = await fetchFn(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
        // `fetch failed` hides the reason in `cause` (ex: ECONNREFUSED).
        throw new HarnessError(`cannot reach ${url} (${e?.cause?.code || e?.cause?.message || e?.message || e})`, 1);
    }
    return { ...evaluate(resp.status, await resp.text(), want), gate: null };
};

// `statusCode` and `body` of a web handler payload, or nulls.
const webPayload = r => {
    const payload = r.text ? tryJson(r.text) : undefined;
    if (!payload || typeof payload !== 'object' || !('statusCode' in payload)) return { http: null, body: r.text };
    return { http: payload.statusCode, body: payload.body };
};

// short reason when the invoke itself failed (non-2xx `StatusCode` or a `FunctionError`), else null.
const invokeFailure = r =>
    r.functionError || !(r.statusCode >= 200 && r.statusCode < 300)
        ? `lambda invoke failed: status=${r.statusCode} function-error=${r.functionError || 'none'}`
        : null;

// invoke the admin (internal) event, then the gate (external) event unless skipped.
export const invokeTargets = async ({ events, want, invoke }) => {
    const r = await invoke(events.admin);
    const failed = invokeFailure(r);
    const { http, body } = webPayload(r);
    const result = failed
        ? { status: http, report: null, check: { ok: false, issues: [`${failed}: ${`${r.text ?? ''}`.trim()}`] } }
        : evaluate(http, body, want);
    // gate: the external shape must answer 403 (API Gateway path is closed by design).
    if (!events.gate) return { ...result, gate: null };
    const g = await invoke(events.gate);
    const gs = invokeFailure(g) ? `function-error:${g.functionError || g.statusCode}` : webPayload(g).http;
    return { ...result, gate: { status: gs, closed: gs === 403 } };
};

// `runtime=` text of a report: `local`, `lambda:<name>`, or `-`.
const runtimeText = T => {
    if (!T || typeof T !== 'object') return '-';
    if (typeof T.lambda === 'string' && T.lambda) return `lambda:${T.lambda}`;
    return T.local === true ? 'local' : '-';
};

// value or `-` for the summary line.
const or = v => (v === undefined || v === null || v === '' ? '-' : `${v}`);

// the text lines of one result (summary, one line per issue, gate).
export const textLines = ({ target, type, status, report, check, gate }) => {
    const R = report && typeof report === 'object' ? report : {};
    const C = R.counts && typeof R.counts === 'object' ? R.counts : {};
    const lines = [
        `fields/admin target=${target} type=${type} http=${or(status)} ok=${check.ok} source=${or(R.source)}` +
            ` counts=${or(C.core)}/${or(C.fields)}/${or(C.extra)} runtime=${runtimeText(R.runtime)}` +
            ` lemon-core=${or(R.runtime?.lemonCore)} issues=${check.issues.length}`,
        ...check.issues.map(s => `  - ${s}`),
    ];
    if (gate) lines.push(gate.closed ? 'gate=closed(403)' : `gate=open(${or(gate.status)})`);
    return lines;
};

// exit code of a result: 0 only for http 200, ok, and a closed (or skipped) gate.
export const exitCode = ({ status, check, gate }) => (status === 200 && check.ok && (!gate || gate.closed) ? 0 : 1);

// default Lambda invoker for the resolved SDK config (SDK loaded only when needed).
const defaultInvoker = (aws, name) => {
    let client = null;
    return async event => {
        const { createClient, invokeLambda } = await import('./invoke.mjs');
        client = client || createClient(aws);
        return invokeLambda(client, { name, event });
    };
};

// run the check; returns the exit code. deps: `{ fetch, invoke, identity, log, error }` (all optional).
export const run = async (argv, deps = {}) => {
    const log = deps.log || (s => console.log(s));
    const error = deps.error || (s => console.error(s));
    let out = outputFilter();
    try {
        const opts = parseOptions(argv);
        if (opts.help) {
            log(HELP.join('\n'));
            return 0;
        }
        out = outputFilter({ raw: !!opts.raw, maxBytes: parseMaxBytes(opts['max-bytes']) });
        const target = opts.target;
        const type = opts.type || DEFAULT_TYPE;
        //* v5 B19: the service root of this run.
        const root = serviceRoot(opts.cwd);
        const expect = loadExpect(opts.expect, type, root);
        let result;
        if (target === 'express') {
            // express: a local server (`LOCAL_MODE=1`), not in Lambda.
            const want = { ...expect, runtime: { local: true, lambda: false } };
            const base = opts.url || defaultUrl(root);
            result = await fetchExpress({ base, type, want, fetchFn: deps.fetch || globalThis.fetch });
        } else {
            // stage guard before anything else touches the target (same as lambda:invoke).
            const hasName = typeof opts.name === 'string' && opts.name;
            checkStage({
                stage: opts.stage,
                confirm: opts['confirm-stage'],
                name: hasName ? opts.name : undefined,
                service: hasName ? tryServiceName(root) : null,
            });
            const stage = typeof opts.stage === 'string' && opts.stage ? opts.stage : 'dev';
            const aws = resolveAws(opts);
            const name = functionName(opts);
            const path = `/${type}/fields/admin`;
            // admin: internal shape (no Host) like a direct invoke; gate: external shape (Host) like API Gateway.
            const events = {
                admin: webEvent({ path, internal: true }, stage),
                gate: opts.gate === false ? null : webEvent({ path }, stage),
            };
            if (opts.dry) {
                log(`fields/admin target=lambda function=${name} region=${aws.region} path=${path} (dry)`);
                log('--- event: admin (internal, expect 200) ---');
                log(JSON.stringify(maskHeaders(events.admin), null, 2));
                if (events.gate) {
                    log('--- event: gate (external, expect 403) ---');
                    log(JSON.stringify(maskHeaders(events.gate), null, 2));
                }
                return 0;
            }
            // identity banner first; an STS failure stops before Lambda is called.
            error(await (deps.identity || resolveIdentity)(aws, opts, name));
            const want = { ...expect, runtime: { local: false, external: false, lambda: name } };
            result = await invokeTargets({ events, want, invoke: deps.invoke || defaultInvoker(aws, name) });
        }
        const full = { target, type, ...result };
        if (opts.json) {
            const { status, report, check, gate } = full;
            log(JSON.stringify(out.json({ target, type, status, report, check, gate })));
        } else {
            textLines(full).forEach(line => log(out.text(line)));
        }
        return exitCode(full);
    } catch (e) {
        // harness errors keep their exit code; anything else (SDK) is redacted and exits 1.
        if (e instanceof HarnessError) {
            error(`ERROR: ${e.message}`);
            return e.code;
        }
        error(`ERROR: ${out.log(`${e?.name || 'Error'}: ${e?.message ?? e}`)}`);
        return 1;
    }
};
