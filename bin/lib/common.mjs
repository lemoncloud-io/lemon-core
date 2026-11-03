/**
 * `bin/lib/common.mjs` (lemon-core)
 * - shared helpers of the invoke / observe tools (`lemon-lambda-invoke`, `lemon-lambda-logs`, `lemon-lambda-perf`,
 *   `lemon-fields-admin`, `lemon-loop-check`).
 * - never reads `env/*.yml`; only the top-level `service:` line of `<root>/serverless.yml`.
 * - the service root is the consumer's package root: `--cwd <dir>`, else `process.cwd()` (npm runs scripts there).
 * - the testable parts are pure: they throw `ArgError` / `HarnessError` and never call `process.exit`.
 */
//* v5 B19: moved from lemon-templates-api `bin/lib/common.mjs` (snapshot d57dc5b); root = cwd, AWS SDK peers guarded.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// default region (same as `provider.region` default in `serverless.yml`).
export const DEFAULT_REGION = 'ap-northeast-2';

// the only stage that runs without `--confirm-stage`.
export const SAFE_STAGE = 'dev';

// default cap for one printed response body or one log message (64 KB).
export const DEFAULT_MAX_BYTES = 64 * 1024;

// an error the scripts print as `ERROR: <message>` and exit with `code`.
export class HarnessError extends Error {
    // keep the exit code next to the message.
    constructor(message, code = 1) {
        super(message);
        this.name = 'HarnessError';
        this.code = code;
    }
}

// a bad-argument error (exit 2).
export class ArgError extends HarnessError {
    // always exit code 2.
    constructor(message) {
        super(message, 2);
        this.name = 'ArgError';
    }
}

// flags that collect every occurrence into an array.
const ARRAY_FLAGS = ['header', 'query'];

// an optional peer (AWS SDK) as a module, or null when the package itself is not installed (other errors throw).
//* v5 B19: the AWS SDK packages are optional peers of lemon-core; a missing one must not crash `--help` / `--dry`.
export const tryPeer = async name => {
    try {
        return await import(name);
    } catch (e) {
        //* only "this package is not found" means missing; a broken install still throws.
        const missing = e?.code === 'ERR_MODULE_NOT_FOUND' && `${e?.message}`.includes(`'${name}'`);
        if (missing) return null;
        throw e;
    }
};

// the module of an optional peer, or a `HarnessError` (code 1) with the install hint.
//* v5 B19: a clear message instead of a stack trace when the consumer has not installed the peer.
export const needPeer = (mod, name) => {
    if (mod) return mod;
    throw new HarnessError(`missing optional peer ${name}: install it with \`npm i -D ${name}\``, 1);
};

// `@aws-sdk/credential-providers` (for `--profile`), or null when not installed.
//* v5 B19: was a static import; now loaded once here and checked only when `--profile` is given.
const PROVIDERS = await tryPeer('@aws-sdk/credential-providers');

// push a value into a key, as array for repeatable flags.
const assign = (out, key, value) => {
    if (ARRAY_FLAGS.includes(key)) out[key] = [...(out[key] || []), value];
    else out[key] = value;
};

// parse argv into `{ _: positional[], ...flags }`; `booleans` never consume the next token.
// with `known`, an unknown option or more than `maxPositional` positionals throws `ArgError` (unless `--help`).
export const parseArgs = (argv, { booleans = [], aliases = {}, known = null, maxPositional = Infinity } = {}) => {
    const out = { _: [] };
    const errors = [];
    // record an option that is not in `known` (aliases are resolved before this check).
    const check = (key, shown) => {
        if (known && !known.includes(key)) errors.push(`unknown option ${shown} (see --help)`);
    };
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        // `--` ends flag parsing.
        if (tok === '--') {
            out._.push(...argv.slice(i + 1));
            break;
        }
        // short flag like `-f` (boolean only), mapped through aliases.
        if (/^-[a-zA-Z]$/.test(tok)) {
            const key = aliases[tok.slice(1)] || tok.slice(1);
            check(key, tok);
            assign(out, key, true);
            continue;
        }
        // positional argument.
        if (!tok.startsWith('--')) {
            out._.push(tok);
            continue;
        }
        const body = tok.slice(2);
        const eq = body.indexOf('=');
        // `--key=value` form.
        if (eq >= 0) {
            const key = aliases[body.slice(0, eq)] || body.slice(0, eq);
            check(key, `--${body.slice(0, eq)}`);
            assign(out, key, body.slice(eq + 1));
            continue;
        }
        const key = aliases[body] || body;
        // `--no-x` sets x=false.
        if (key.startsWith('no-')) {
            check(aliases[key.slice(3)] || key.slice(3), tok);
            out[key.slice(3)] = false;
            continue;
        }
        check(key, tok);
        // `--flag` boolean, or `--key value` (a lone `-` counts as a value, e.g. stdin).
        const next = argv[i + 1];
        const hasValue = next !== undefined && (next === '-' || !next.startsWith('-'));
        if (booleans.includes(key) || !hasValue) {
            assign(out, key, true);
        } else {
            assign(out, key, next);
            i++;
        }
    }
    // extra positionals are reported like unknown options.
    if (known && out._.length > maxPositional) {
        for (const tok of out._.slice(maxPositional)) errors.push(`unknown argument ${tok} (see --help)`);
    }
    // `--help` always wins over argument errors.
    if (errors.length && !out.help) throw new ArgError(errors[0]);
    return out;
};

// true for a non-empty string option value.
const isStr = v => typeof v === 'string' && v.length > 0;

// build SDK client config: region + optional named-profile credentials.
export const resolveAws = (opts = {}) => {
    const region = isStr(opts.region) ? opts.region : process.env.AWS_REGION || DEFAULT_REGION;
    // without --profile, leave credentials undefined so the SDK default chain (incl. AWS_PROFILE) applies.
    if (isStr(opts.profile)) {
        //* v5 B19: `fromIni` from the guarded optional peer.
        const { fromIni } = needPeer(PROVIDERS, '@aws-sdk/credential-providers');
        return { region, credentials: fromIni({ profile: opts.profile }) };
    }
    return { region };
};

// the service root: `--cwd <dir>` (relative to the process cwd), else `process.cwd()` (throws `ArgError`).
//* v5 B19: replaces the templates-api repo root (`new URL('../../', import.meta.url)`) of the source tools.
export const serviceRoot = cwd => {
    if (cwd === undefined || cwd === null) return process.cwd();
    if (!isStr(cwd)) throw new ArgError('--cwd needs a directory');
    return resolve(cwd);
};

// read `service:` from `<root>/serverless.yml` with a simple regex (throws `ArgError`).
//* v5 B19: `root` (default: the service root) instead of the tool's own repo.
export const readServiceName = (root = serviceRoot()) => {
    const file = join(root, 'serverless.yml');
    let text = '';
    try {
        text = readFileSync(file, 'utf8');
    } catch (e) {
        throw new ArgError(`cannot read serverless.yml (${e.message}); pass --name <function-name> instead`);
    }
    const m = text.match(/^service:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*(#.*)?$/m);
    if (!m) throw new ArgError('no top-level `service:` in serverless.yml; pass --name <function-name> instead');
    return m[1];
};

// service name, or null when `serverless.yml` cannot give one (used only for stage derivation).
//* v5 B19: `root` as in `readServiceName()`.
export const tryServiceName = (root = serviceRoot()) => {
    try {
        return readServiceName(root);
    } catch {
        return null;
    }
};

// resolve the deployed function name: --name, else `<service>-<stage>-<fn>` (`service:` read under `opts.cwd`).
export const functionName = (opts = {}, service = null) => {
    if (isStr(opts.name)) return opts.name;
    const stage = isStr(opts.stage) ? opts.stage : SAFE_STAGE;
    const fn = opts.function || opts.fn || 'lambda';
    // only the two functions defined in serverless.yml are accepted.
    if (!['lambda', 'backend'].includes(fn)) throw new ArgError(`--function must be lambda or backend (got: ${fn})`);
    //* v5 B19: the service name comes from the root given by `--cwd` (else `process.cwd()`).
    return `${service || readServiceName(serviceRoot(opts.cwd))}-${stage}-${fn}`;
};

// stage part of `<service>-<stage>-<fn>`, or null when the name does not have that shape.
export const deriveStage = (name, service) => {
    if (!isStr(name) || !isStr(service) || !name.startsWith(`${service}-`)) return null;
    const rest = name.slice(service.length + 1);
    const at = rest.lastIndexOf('-');
    // both `<stage>` and `<fn>` must be non-empty.
    if (at <= 0 || at === rest.length - 1) return null;
    return rest.slice(0, at);
};

// function name inside a `/aws/lambda/<name>` log group, or null for any other group.
export const groupFunctionName = group => {
    const m = isStr(group) ? group.match(/^\/aws\/lambda\/(.+)$/) : null;
    return m ? m[1] : null;
};

// stage guard: only `dev` runs unconfirmed; any other stage needs `--confirm-stage <same stage>`.
// `name` (from --name or --group) must derive to a stage; if it cannot, --stage and --confirm-stage are both required.
// returns the guarded stage, or throws `ArgError`.
export const checkStage = ({ stage, confirm, name, service, label = '--name' } = {}) => {
    const given = isStr(stage) ? stage : null;
    const sure = isStr(confirm) ? confirm : null;
    const stages = [];
    if (name !== undefined && name !== null) {
        const derived = deriveStage(name, service);
        // an underivable target is never trusted as dev.
        if (derived === null) {
            if (!given || sure !== given) {
                throw new ArgError(
                    `stage of ${label} "${name}" cannot be derived; pass --stage <stage> --confirm-stage <stage>`,
                );
            }
            return given;
        }
        stages.push(derived);
        if (given && given !== derived) stages.push(given);
    } else {
        stages.push(given || SAFE_STAGE);
    }
    // every stage in play must be dev or confirmed with the exact value.
    for (const s of stages) {
        if (s !== SAFE_STAGE && sure !== s) throw new ArgError(`stage "${s}" needs --confirm-stage ${s}`);
        if (sure !== null && sure !== s) throw new ArgError(`--confirm-stage ${sure} does not match stage "${s}"`);
    }
    return stages[0];
};

// parse `--max-bytes <n>`: default 64 KB, `0` means no cap.
export const parseMaxBytes = value => {
    if (value === undefined) return DEFAULT_MAX_BYTES;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        throw new ArgError(`--max-bytes needs a non-negative integer (got: ${value})`);
    }
    const n = Number(value);
    return n === 0 ? Infinity : n;
};

// time units for relative --since values.
const UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

// parse `30s` / `5m` / `2h` / `1d` / ISO date / epoch-ms into epoch ms (default `5m`).
export const parseSince = (str, now = Date.now()) => {
    const s = isStr(str) ? str.trim() : '5m';
    const rel = s.match(/^(\d+)([smhd])$/);
    if (rel) return now - Number(rel[1]) * UNITS[rel[2]];
    // plain digits are treated as epoch ms.
    if (/^\d{12,}$/.test(s)) return Number(s);
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new ArgError(`invalid --since value: ${s} (use 30s, 5m, 2h, 1d or an ISO date)`);
    return t;
};

// ---------------------------------------------------------------------------
// identity banner
// ---------------------------------------------------------------------------

// mask an account id to its last 4 digits.
export const maskAccount = account => `****${`${account || ''}`.slice(-4)}`;

// where the credentials come from: --profile, AWS_PROFILE, env keys, or the rest of the SDK chain.
export const credentialSource = (opts = {}, env = process.env) => {
    if (isStr(opts.profile)) return `profile:${opts.profile}`;
    // the SDK default chain skips env keys when AWS_PROFILE is set.
    if (isStr(env.AWS_PROFILE)) return `profile:${env.AWS_PROFILE}`;
    if (isStr(env.AWS_ACCESS_KEY_ID)) return 'env';
    return 'default-chain';
};

// one stderr line; never the full account id or the ARN.
export const identityLine = ({ account, region, credentials, fn }) =>
    `account=${maskAccount(account)} region=${region} credentials=${credentials} function=${fn}`;

// call STS GetCallerIdentity and return the banner line (throws `HarnessError` code 1).
export const resolveIdentity = async (aws, opts, fn) => {
    //* v5 B19: a missing `@aws-sdk/client-sts` is reported with the install hint (not as an STS failure).
    const { STSClient, GetCallerIdentityCommand } = needPeer(
        await tryPeer('@aws-sdk/client-sts'),
        '@aws-sdk/client-sts',
    );
    try {
        const resp = await new STSClient(aws).send(new GetCallerIdentityCommand({}));
        return identityLine({ account: resp.Account, region: aws.region, credentials: credentialSource(opts), fn });
    } catch (e) {
        // only the error name: STS messages can carry the ARN.
        throw new HarnessError(`cannot resolve AWS identity (${e?.name || 'Error'})`, 1);
    }
};

// ---------------------------------------------------------------------------
// output safety: control stripping, redaction, size cap
// ---------------------------------------------------------------------------

// header / field names whose values are always hidden.
export const SENSITIVE_HEADERS = ['authorization', 'x-lemon-identity', 'x-api-key', 'cookie', 'set-cookie'];

// key-name fragments whose string values are hidden.
export const SENSITIVE_KEY_PARTS = [
    'secret',
    'password',
    'passwd',
    'token',
    'private_key',
    'apikey',
    'api_key',
    'access_key',
];

// true when a key name is a sensitive header or contains a sensitive fragment.
export const isSensitiveKey = key => {
    const k = `${key}`.toLowerCase();
    return SENSITIVE_HEADERS.includes(k) || SENSITIVE_KEY_PARTS.some(p => k.includes(p));
};

// drop ANSI escapes (CSI / OSC / others) and control characters; keeps `\t` and `\n`.
export const stripControl = text =>
    `${text}`
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
        .replace(/\x1b[ -/]*[0-~]?/g, '')
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');

// escape a literal for use inside a RegExp.
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// key + separator matcher: optional quotes around the key, then `:` or `=`.
const keyedRe = keyPattern => new RegExp(`(^|[^A-Za-z0-9_.-])(["']?)(${keyPattern})\\2([ \\t]*[:=][ \\t]*)`, 'gi');

// sensitive header names, matched exactly.
const HEADER_KEY_RE = keyedRe(SENSITIVE_HEADERS.map(escapeRe).join('|'));

// any key name containing a sensitive fragment (bounded, so long word runs stay linear).
const NAME_KEY_RE = keyedRe(
    `[A-Za-z0-9_.-]{0,64}(?:${SENSITIVE_KEY_PARTS.map(escapeRe).join('|')})[A-Za-z0-9_.-]{0,64}`,
);

// end of a balanced `{...}` / `[...]` starting at `start` (quotes respected), or the text end.
const bracketEnd = (text, start) => {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        // skip quoted strings with escapes.
        if (c === '"' || c === "'") {
            for (i++; i < text.length && text[i] !== c; i += text[i] === '\\' ? 2 : 1);
            continue;
        }
        if (c === '{' || c === '[') depth++;
        else if ((c === '}' || c === ']') && --depth === 0) return i + 1;
    }
    return text.length;
};

// value span starting at `start`: a quoted string (quotes kept), else up to a delimiter.
const valueSpan = (text, start, sep) => {
    const q = text[start];
    // quoted value: up to the matching unescaped quote.
    if (q === '"' || q === "'") {
        let i = start + 1;
        while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1;
        return { from: start + 1, to: Math.min(i, text.length) };
    }
    // a JSON-ish object / array value is hidden as a whole.
    if (q === '{' || q === '[') return { from: start, to: bracketEnd(text, start) };
    // `key: value` runs to the end of the line or a closing bracket / comma; `key=value` stops at more delimiters.
    const stop = sep === ':' ? /[\r\n,}\]]/ : /[\s&,;"'}\]]/;
    let i = start;
    while (i < text.length && !stop.test(text[i])) i++;
    // do not swallow trailing blanks.
    while (i > start && /[ \t]/.test(text[i - 1])) i--;
    return { from: start, to: i };
};

// replace every value that follows a matching key with `<redacted>`.
const redactKeyed = (text, re) => {
    let out = '';
    let last = 0;
    re.lastIndex = 0;
    // walk all key matches; values are cut by `valueSpan`.
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const start = m.index + m[0].length;
        const { from, to } = valueSpan(text, start, m[4].trim());
        if (to <= from) continue;
        out += `${text.slice(last, from)}<redacted>`;
        last = to;
        re.lastIndex = Math.max(re.lastIndex, to);
    }
    return out + text.slice(last);
};

// shorten a URL to scheme + host (userinfo dropped); a non-root path/query becomes `/<path>`.
const shortUrl = (all, scheme, authority, tail) => {
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    return `${scheme}://${host}${tail && tail !== '/' ? '/<path>' : tail}`;
};

// redact one text, in the documented order.
export const redact = text => {
    let s = `${text}`;
    // 1. account ids and ARNs.
    s = s.replace(/\b\d{12}\b/g, '<acct>');
    s = s.replace(/arn:aws[a-z-]*:[^\s"'`]*/g, '<arn>');
    // 2. access key ids.
    s = s.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '<aws-key>');
    // 3. sensitive headers / fields, then any remaining bearer token.
    s = redactKeyed(s, HEADER_KEY_RE);
    s = s.replace(/\bBearer[ \t]+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>');
    // 4. JWT-looking tokens.
    s = s.replace(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>');
    // 5. values of keys named like secrets.
    s = redactKeyed(s, NAME_KEY_RE);
    // 6. IPv4, URLs (path dropped), emails.
    s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>');
    s = s.replace(/\b(https?):\/\/([^/\s"'`?#]+)([^\s"'`,]*)/gi, shortUrl);
    s = s.replace(
        /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+/g,
        '<email>',
    );
    return s;
};

// cut a text to `maxBytes` UTF-8 bytes and append `…[truncated N bytes]`.
export const capBytes = (text, maxBytes = DEFAULT_MAX_BYTES) => {
    const s = `${text}`;
    const buf = Buffer.from(s, 'utf8');
    if (!(buf.length > maxBytes)) return s;
    // drop a half-cut multi-byte character at the end.
    const kept = buf.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '');
    return `${kept}…[truncated ${buf.length - Buffer.byteLength(kept, 'utf8')} bytes]`;
};

// walk a JSON value: redact (and cap) string leaves; keys under a sensitive name are fully hidden.
export const redactJson = (value, { raw = false, maxBytes = DEFAULT_MAX_BYTES } = {}, hidden = false) => {
    if (typeof value === 'string') {
        return hidden && !raw ? '<redacted>' : capBytes(raw ? value : redact(value), maxBytes);
    }
    if (Array.isArray(value)) return value.map(v => redactJson(v, { raw, maxBytes }, hidden));
    // objects keep their keys; a sensitive key hides every string below it.
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, redactJson(v, { raw, maxBytes }, hidden || isSensitiveKey(k))]),
        );
    }
    return value;
};

// output filters for one run: `text` for bodies, `log` for log content (always control-stripped),
// `json` for parsed values (string leaves capped unless `cap: false`), `cap` for text that is already redacted.
export const outputFilter = ({ raw = false, maxBytes = DEFAULT_MAX_BYTES } = {}) => ({
    text: s => capBytes(raw ? `${s}` : redact(s), maxBytes),
    cap: s => capBytes(s, maxBytes),
    log: s => capBytes(raw ? stripControl(s) : redact(stripControl(s)), maxBytes),
    json: (v, { cap = true } = {}) => redactJson(v, { raw, maxBytes: cap ? maxBytes : Infinity }),
});

// hide the values of sensitive header names (case-insensitive) in one header map.
const maskHeaderMap = H => {
    if (!H || typeof H !== 'object') return H;
    return Object.fromEntries(
        Object.entries(H).map(([k, v]) => {
            if (!SENSITIVE_HEADERS.includes(`${k}`.toLowerCase())) return [k, v];
            return [k, Array.isArray(v) ? v.map(() => '<redacted>') : '<redacted>'];
        }),
    );
};

// copy an event with sensitive `headers` / `multiValueHeaders` values replaced by `<redacted>` (for echo only).
export const maskHeaders = event => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
    const out = { ...event };
    if ('headers' in out) out.headers = maskHeaderMap(out.headers);
    if ('multiValueHeaders' in out) out.multiValueHeaders = maskHeaderMap(out.multiValueHeaders);
    return out;
};

// ---------------------------------------------------------------------------
// process helpers (scripts only)
// ---------------------------------------------------------------------------

// print help text to stdout.
export const printHelp = lines => {
    console.log(lines.join('\n'));
};

// print an error to stderr and exit with the code (default 1).
export const fail = (msg, code = 1) => {
    console.error(`ERROR: ${msg}`);
    process.exit(code);
};
