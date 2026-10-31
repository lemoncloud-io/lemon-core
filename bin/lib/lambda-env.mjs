/**
 * `bin/lib/lambda-env.mjs` (lemon-core)
 * - `lemon-lambda-env` core: build the Lambda environment string map of one stage from a service env file
 *   (`build`, offline), and compare it by key name with the live environment of the deployed functions (`diff`).
 * - Serverless rule, not `loadEnviron()`: values as they are (a leading `!` is kept), number/boolean → `String(v)`,
 *   null/object/array rejected. See `docs/v5/B26-lambda-env.md`.
 * - never prints, logs or hashes a value: reports, errors and messages carry key names, counts and relative paths only.
 */
//* v5 B26: new module (P0: offline build + read-only diff; no deploy-service call).
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import yaml from 'js-yaml';
import { DeployError, isObject, plannedFunctionNames, readJson, validateConfig } from './deploy-plan.mjs';
import { boundedCredentialProvider } from './deploy-credentials.mjs';
import { assertPeer, importPeer } from './optional-peer.mjs';

// the doc that error messages and `--help` point to.
export const DOC_REF = 'docs/v5/B26-lambda-env.md';

// a Lambda environment key (same rule as the bootstrap `environmentFile` check of `deploy-plan.mjs`).
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_]+$/;

// a stage name: a top-level section of the env file (ex: `local`, `dev`, `prod`).
export const STAGE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// the prefix of a KMS ciphertext value (same rule as the bootstrap `policy.kmsDecryptKeyArn` check).
export const ENCRYPTED_PREFIX = '*AQIC';

// the largest env file `build` reads (1 MiB).
export const MAX_ENV_FILE_BYTES = 1024 * 1024;

// the comparison categories of `diff`, in output order.
export const CATEGORIES = Object.freeze(['same', 'changed', 'new', 'liveOnly']);

/** an error of `lemon-lambda-env`: `code`, a message without values, and the process exit code. */
export class EnvError extends Error {
    // keep the code and the exit code next to the message.
    constructor(code, message, exitCode = 1) {
        super(message);
        this.name = 'EnvError';
        this.code = code;
        this.exitCode = exitCode;
    }
}

// a bad argument (exit 2).
const badArgs = message => new EnvError('INVALID_ARGS', `${message}; use --help.`, 2);

// a bad input file of `diff` (exit 2).
const badInput = message => new EnvError('INVALID_INPUT', `${message}; see ${DOC_REF}`, 2);

// sorted, comma-joined key names for a message (names only).
const names = keys => [...keys].sort().join(', ');

// true when `child` is `root` itself or below it (both absolute, already normalized).
const isInside = (root, child) => {
    const rel = path.relative(root, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * resolve a path argument against the service root (`cwd`): it must stay inside the root lexically.
 * - returns `{ abs, rel }` (`rel` is the root-relative form for reports).
 */
export function resolveInside(cwd, value, flag) {
    if (typeof value !== 'string' || !value) throw badArgs(`${flag} is required`);
    const abs = path.resolve(cwd, value);
    const rel = path.relative(cwd, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
        throw badArgs(`${flag} must be a file inside the service root`);
    return { abs, rel };
}

//* v5 B26: the env file must be a regular `.yml`/`.yaml` file whose real path stays inside the real service root.
export async function resolveEnvFile(cwd, value) {
    const { abs, rel } = resolveInside(cwd, value, '--env-file');
    if (!/\.ya?ml$/i.test(abs)) throw badArgs('--env-file must be a .yml or .yaml file');
    let real;
    try {
        real = await realpath(abs);
    } catch {
        throw new EnvError('ENV_FILE_NOT_FOUND', `Cannot read --env-file ${rel}.`);
    }
    // a symlinked file or directory that leads out of the root is refused.
    if (!isInside(await realpath(cwd), real)) throw badArgs('--env-file must not lead outside the service root');
    const info = await stat(real);
    if (!info.isFile()) throw badArgs('--env-file must be a regular file');
    if (info.size > MAX_ENV_FILE_BYTES) throw new EnvError('ENV_FILE_TOO_LARGE', `--env-file ${rel} is over 1 MiB.`);
    return { abs: real, rel };
}

//* v5 B26: safe YAML load (js-yaml 4 default schema: no JS types); the parser message (it quotes source text) is dropped.
export function parseEnvYaml(text, rel) {
    try {
        return yaml.load(text, { filename: rel });
    } catch (error) {
        const line = Number.isInteger(error?.mark?.line) ? ` (line ${error.mark.line + 1})` : '';
        throw new EnvError('ENV_FILE_INVALID', `Cannot parse ${rel} as YAML${line}.`);
    }
}

/**
 * the Lambda environment of one stage: the top-level `<stage>` mapping, converted the Serverless way.
 * - string → as is (a leading `!` is kept); number/boolean → `String(v)`; null/object/array → error (key names only).
 * - returns a plain object with sorted keys.
 */
export function stageEnvironment(doc, stage) {
    const section = isObject(doc) && Object.hasOwn(doc, stage) ? doc[stage] : undefined;
    // a Date / Buffer (YAML timestamp / binary) is an object, not a mapping of keys.
    if (!isObject(section) || Object.getPrototypeOf(section) !== Object.prototype)
        throw new EnvError('STAGE_NOT_FOUND', `Stage ${stage} is missing or is not a mapping.`);
    const keys = Object.keys(section);
    const badKeys = keys.filter(k => !KEY_RE.test(k));
    if (badKeys.length)
        throw new EnvError('INVALID_KEYS', `Invalid environment key names in stage ${stage}: ${names(badKeys)}.`);
    const unsupported = keys.filter(k => !['string', 'number', 'boolean'].includes(typeof section[k]));
    if (unsupported.length)
        throw new EnvError(
            'UNSUPPORTED_VALUES',
            `Null, object or array values are not allowed in a Lambda environment (stage ${stage}): ${names(
                unsupported,
            )}.`,
        );
    const out = {};
    for (const k of [...keys].sort()) out[k] = typeof section[k] === 'string' ? section[k] : String(section[k]);
    return out;
}

// the names of the keys whose value is a KMS ciphertext (`*AQIC...`).
export const encryptedKeys = environment =>
    Object.keys(environment)
        .filter(k => typeof environment[k] === 'string' && environment[k].startsWith(ENCRYPTED_PREFIX))
        .sort();

// the real path of `file`, or throw `makeError()` (a dangling symlink included).
const realOrThrow = async (file, makeError) => {
    try {
        return await realpath(file);
    } catch {
        throw makeError();
    }
};

//* v5 B26: write `text` to `abs` with mode 0600 through a temp file + atomic rename; parents created 0700, no symlinks.
export async function writePrivateFile(cwd, { abs, rel }, text, { protect } = {}) {
    const root = await realpath(cwd);
    const dir = path.dirname(abs);
    // the deepest existing ancestor of the output directory must really be inside the root (no symlink escape).
    let existing = dir;
    for (;;) {
        try {
            await lstat(existing);
            break;
        } catch {
            existing = path.dirname(existing);
        }
    }
    const escape = () => badArgs('--output must not lead outside the service root');
    if (!isInside(root, await realOrThrow(existing, escape))) throw escape();
    try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
    } catch {
        throw new EnvError('OUTPUT_WRITE_FAILED', `Cannot create the directory of --output ${rel}.`);
    }
    const realDir = await realOrThrow(dir, escape);
    if (!isInside(root, realDir)) throw escape();
    // the real target must not be the protected file (the env file), also through a symlinked directory.
    if (protect && path.join(realDir, path.basename(abs)) === protect)
        throw badArgs('--output must not be the env file');
    // an existing target must be a regular file, never a symlink.
    const target = await lstat(abs).catch(() => null);
    if (target?.isSymbolicLink()) throw badArgs('--output must not be a symlink');
    if (target && !target.isFile()) throw badArgs('--output must be a regular file');
    const temp = path.join(dir, `.${path.basename(abs)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    try {
        await writeFile(temp, text, { mode: 0o600, flag: 'wx' });
        await rename(temp, abs);
    } catch {
        await rm(temp, { force: true }).catch(() => {});
        throw new EnvError('OUTPUT_WRITE_FAILED', `Cannot write --output ${rel}.`);
    }
}

/**
 * `build`: env file `<stage>` section → private JSON string map at `output`; returns the names-only report.
 */
export async function buildEnvironment({ cwd = process.cwd(), envFile, stage, output }) {
    if (typeof stage !== 'string' || !STAGE_RE.test(stage)) throw badArgs('--stage must be a stage name');
    const source = await resolveEnvFile(cwd, envFile);
    const target = resolveInside(cwd, output, '--output');
    if (target.abs === source.abs) throw badArgs('--output must not be the env file');
    const doc = parseEnvYaml(await readFile(source.abs, 'utf8'), source.rel);
    const environment = stageEnvironment(doc, stage);
    await writePrivateFile(cwd, target, JSON.stringify(environment, null, 2) + '\n', { protect: source.abs });
    return {
        envFile: source.rel,
        stage,
        count: Object.keys(environment).length,
        keys: Object.keys(environment),
        encryptedKeys: encryptedKeys(environment),
        output: target.rel,
    };
}

//* v5 B26: a built map must be a JSON object of string values with valid key names (errors name keys only).
export async function readBuiltEnvironment(file) {
    let raw;
    try {
        raw = JSON.parse(await readFile(file, 'utf8'));
    } catch {
        throw badInput('Invalid --env JSON');
    }
    if (!isObject(raw)) throw badInput('Invalid --env: not a JSON object');
    const badKeys = Object.keys(raw).filter(k => !KEY_RE.test(k));
    if (badKeys.length) throw badInput(`Invalid --env key names: ${names(badKeys)}`);
    const notStrings = Object.keys(raw).filter(k => typeof raw[k] !== 'string');
    if (notStrings.length) throw badInput(`Invalid --env: values must be strings (${names(notStrings)})`);
    return raw;
}

//* v5 B26: a `lemon-lambda-deploy` config, validated by the deploy loader; `diff` reads code-mode targets only.
export async function readDiffConfig(file) {
    const config = validateConfig(await readJson(file, 'config JSON'));
    if (config.mode !== 'code') throw badInput('diff needs a code-mode deploy config');
    return config;
}

/**
 * compare the built map with one live environment, by key name: `same`, `changed`, `new`, `liveOnly`.
 * - `encryptedKeys` holds the same categories for keys whose file or live value is a KMS ciphertext.
 * - never returns a value or a hash of a value.
 */
export function compareEnvironment(file, live) {
    const result = Object.fromEntries(CATEGORIES.map(c => [c, []]));
    for (const k of Object.keys(file)) {
        if (!Object.hasOwn(live, k)) result.new.push(k);
        else if (live[k] === file[k]) result.same.push(k);
        else result.changed.push(k);
    }
    for (const k of Object.keys(live)) if (!Object.hasOwn(file, k)) result.liveOnly.push(k);
    const encrypted = new Set([...encryptedKeys(file), ...encryptedKeys(live)]);
    const counts = {};
    const enc = {};
    for (const c of CATEGORIES) {
        result[c].sort();
        counts[c] = result[c].length;
        enc[c] = result[c].filter(k => encrypted.has(k));
    }
    return { counts, ...result, encryptedKeys: enc };
}

// the names a live ARN must have: the configured account, region and function.
const arnOf = (config, name) => `arn:aws:lambda:${config.region}:${config.account}:function:${name}`;

/**
 * the read-only Lambda reader of `diff`: `GetFunctionConfiguration` only, credentials from the config `profile`
 * resolved in the forked worker of the deploy tools (`boundedCredentialProvider`).
 * - `lambdaClient` / `credentials` are injectable (tests); the SDK is an optional peer loaded here.
 */
export async function createEnvReader(config, { lambdaClient, credentials } = {}) {
    const missingPeer = hint => new EnvError('MISSING_PEER', hint);
    const lambda = await importPeer('@aws-sdk/client-lambda', missingPeer);
    if (credentials === undefined && lambdaClient === undefined)
        assertPeer('@aws-sdk/credential-providers', missingPeer);
    const owned =
        credentials === undefined && lambdaClient === undefined
            ? boundedCredentialProvider({ profile: config.profile, timeoutMs: config.requestTimeoutMs })
            : undefined;
    const sdk =
        lambdaClient ??
        new lambda.LambdaClient({ region: config.region, credentials: credentials ?? owned, maxAttempts: 1 });
    return {
        // the live environment of `name` (`{}` when it has none); errors name the function only.
        async readEnvironment(name) {
            const controller = new AbortController();
            let timer;
            let found;
            try {
                found = await Promise.race([
                    sdk.send(new lambda.GetFunctionConfigurationCommand({ FunctionName: name }), {
                        abortSignal: controller.signal,
                    }),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => {
                            controller.abort();
                            owned?.cancel();
                            reject(new Error('timeout'));
                        }, config.requestTimeoutMs);
                    }),
                ]);
            } catch (error) {
                if (error?.name === 'ResourceNotFoundException')
                    throw new EnvError('FUNCTION_NOT_FOUND', `Function ${name} does not exist.`);
                // only the SDK error name (ex: `AccessDeniedException`), never its message (it may hold ARNs).
                const kind = /^[A-Za-z]{1,64}$/.test(error?.name ?? '') ? ` (${error.name})` : '';
                throw new EnvError('READ_FAILED', `Could not read the configuration of ${name}${kind}.`);
            } finally {
                clearTimeout(timer);
            }
            if (found?.FunctionArn !== arnOf(config, name) && found?.FunctionArn !== `${arnOf(config, name)}:$LATEST`)
                throw new EnvError(
                    'TARGET_MISMATCH',
                    `Function ${name} is not in the configured account/region; check the config profile.`,
                );
            if (found.Environment?.Error)
                throw new EnvError('ENVIRONMENT_UNREADABLE', `The live environment of ${name} cannot be read.`);
            const variables = found.Environment?.Variables ?? {};
            if (!isObject(variables)) throw new EnvError('READ_FAILED', `Unexpected environment shape of ${name}.`);
            return variables;
        },
        // release the credential worker and the SDK client.
        close() {
            owned?.close();
            if (lambdaClient === undefined) sdk.destroy?.();
        },
    };
}

/**
 * `diff`: compare the built map with the live environment of both planned functions (lambda + backend).
 * - `readerFactory(config)` returns `{ readEnvironment(name), close() }` (default: `createEnvReader`).
 */
export async function diffEnvironment({ cwd = process.cwd(), configFile, envFile, readerFactory = createEnvReader }) {
    const config = await readDiffConfig(configFile);
    const file = await readBuiltEnvironment(envFile);
    const reader = await readerFactory(config);
    const functions = {};
    try {
        for (const [component, name] of Object.entries(plannedFunctionNames(config)))
            functions[component] = { name, ...compareEnvironment(file, await reader.readEnvironment(name)) };
    } finally {
        reader.close?.();
    }
    return {
        schemaVersion: 1,
        execution: 'read-only',
        target: { project: config.project, stage: config.stage, region: config.region },
        env: path.relative(cwd, envFile) || path.basename(envFile),
        count: Object.keys(file).length,
        encryptedKeys: encryptedKeys(file),
        functions,
    };
}

// `DeployError` (config loader) and `EnvError` are known errors with safe messages.
export const isKnownError = error => error instanceof EnvError || error instanceof DeployError;
