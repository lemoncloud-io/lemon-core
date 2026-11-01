/**
 * `bin/lib/guard-cli.mjs` (lemon-core)
 * - the `lemon-lambda-guard` commands over the B30 migration guard library (`migrate-guard.mjs`):
 *   `init` (install file + root), `register` (a reviewed target of a config), `status` (read-only), `resolve`
 *   (an owner decision on an unresolved operation).
 * - exit codes: 0 success, 1 blocked or failed, 2 input error. Errors are one stderr JSON line `{ status, code,
 *   message }` with a scrubbed fixed message (no path, no account).
 * - every effect is injectable for tests (`env`, `guardDeps`, `hostname`, `now`); no AWS call, no network but the
 *   guard's loopback listen.
 * - see `docs/v5/B31-guard-writers.md`.
 */
//* v5 B31: new module (the guard CLI).
import * as nodeFs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { MigrationError, validateMigrationConfig } from './migrate-core.mjs';
import { DeployError, validateConfig } from './deploy-plan.mjs';
import {
    RUN_STATES,
    CLASSES,
    BASELINE_KINDS,
    installPath,
    initializeRoot,
    loadInstall,
    registerTarget,
    classifyTarget,
    guardStatus,
    resolveOperation,
    runStateRefOf,
    scrub,
} from './migrate-guard.mjs';

// the doc of the commands.
export const GUARD_DOC = 'docs/v5/B31-guard-writers.md';

// the options of each command (flag → option key); every option takes one value and is required.
const COMMANDS = Object.freeze({
    init: { '--root': 'root', '--port': 'port', '--confirmed-by': 'confirmedBy' },
    register: {
        '--config': 'configFile',
        '--run-state': 'runState',
        '--class': 'class',
        '--baseline-kind': 'baselineKind',
        '--run-ref': 'runRef',
    },
    status: { '--config': 'configFile' },
    resolve: { '--operation': 'operationId', '--ref': 'ref', '--digest': 'digest' },
});

// the input-error codes (exit 2); every other known error is exit 1.
const INPUT_CODES = new Set(['INVALID_ARGS', 'INVALID_INPUT', 'TARGET_MISMATCH', 'REVISION_MISMATCH']);

// the help text.
export const GUARD_HELP = [
    'Usage: lemon-lambda-guard <init|register|status|resolve> [options]',
    '  init --root <absolute dir> --port <1024..65535> --confirmed-by <name>',
    `  register --config <migration or deploy config> --run-state <${RUN_STATES.join('|')}> --class <${CLASSES.join(
        '|',
    )}> --baseline-kind <${BASELINE_KINDS.join('|')}> --run-ref <absolute run-state path>`,
    '  status --config <migration or deploy config>',
    '  resolve --operation <uuid> --ref <decision ref> --digest <sha256 hex>',
    'Install file: LEMON_MIGRATION_GUARD_INSTALL (absolute path) or ~/.lemon-core/migration-guard.install.json.',
    `Exit: 0 success, 1 blocked or failed, 2 input error. See ${GUARD_DOC}.`,
].join('\n');

// throw a known input error.
const invalid = (code, message) => {
    throw new MigrationError(code, message);
};

/** parse `argv` into `{ help }` or `{ command, ...options }` (unknown, repeated or missing options are INVALID_ARGS). */
export function parseGuardArgs(argv) {
    if (argv.includes('--help') || argv.includes('-h')) return { help: true };
    const [command, ...rest] = argv;
    if (!Object.hasOwn(COMMANDS, command)) invalid('INVALID_ARGS', 'Unknown or missing command; use --help.');
    const flags = COMMANDS[command];
    const options = { command };
    // each flag once, each with a value that is not another flag.
    for (let i = 0; i < rest.length; i++) {
        const key = Object.hasOwn(flags, rest[i]) ? flags[rest[i]] : undefined;
        if (!key || options[key] !== undefined) invalid('INVALID_ARGS', 'Unknown or repeated option; use --help.');
        const value = rest[++i];
        if (value === undefined || value.startsWith('--'))
            invalid('INVALID_ARGS', 'A required option value is missing; use --help.');
        options[key] = value;
    }
    if (Object.values(flags).some(key => options[key] === undefined))
        invalid('INVALID_ARGS', 'A required option is missing; use --help.');
    return options;
}

// the validated values of a migration config (it names a stack) or a deploy config (not guard state: node fs).
async function readTargetConfig(file, fs = nodeFs) {
    let raw;
    // a missing or unparsable file is an input error (no path in the message).
    try {
        raw = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
    } catch {
        invalid('INVALID_INPUT', 'Could not read the config JSON.');
    }
    const migration = raw !== null && typeof raw === 'object' && Object.hasOwn(raw, 'stack');
    const c = migration ? validateMigrationConfig(raw, path.resolve(file)) : validateConfig(raw);
    return {
        input: { project: c.project, stage: c.stage, ...(migration ? { stack: c.stack } : {}) },
        expected: { account: c.account, region: c.region },
    };
}

// `init`: write the install file (0600, never overwritten), then set up its root once.
async function init(options, { env, guardDeps, hostname, now }) {
    const fs = guardDeps?.fs ?? nodeFs;
    const { root, confirmedBy } = options;
    if (!/^\d{1,5}$/.test(options.port)) invalid('INVALID_ARGS', 'The port must be an integer in 1024..65535.');
    const port = Number(options.port);
    if (port < 1024 || port > 65535) invalid('INVALID_ARGS', 'The port must be an integer in 1024..65535.');
    if (!path.isAbsolute(root)) invalid('INVALID_ARGS', 'The root must be an absolute path.');
    if (confirmedBy.length > 200 || !confirmedBy.trim())
        invalid('INVALID_ARGS', 'The confirmation name must have 1..200 characters.');
    const installFile = installPath({ env, deps: guardDeps });
    // the install file lives outside the root (the guard refuses it otherwise).
    if (installFile === root || installFile.startsWith(root + path.sep))
        invalid('INVALID_INPUT', 'The install file must live outside the guard root.');
    const install = {
        schemaVersion: 1,
        root,
        port,
        // a stable, non-identifying machine id: the first 16 hex of sha256(hostname).
        machineId: createHash('sha256').update(`${hostname()}`).digest('hex').slice(0, 16),
        localVolume: { confirmedBy: scrub(confirmedBy), at: now().toISOString() },
    };
    // `wx`: an existing install file is refused, never overwritten.
    try {
        await fs.mkdir(path.dirname(installFile), { recursive: true, mode: 0o700 });
        await fs.writeFile(installFile, JSON.stringify(install, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (e) {
        if (e?.code === 'EEXIST')
            invalid('INSTALL_EXISTS', 'A guard install file exists already; it is never overwritten.');
        invalid('STATE_WRITE_FAILED', 'Could not write the guard install file.');
    }
    // the root is created once; when that fails the new install file is removed again (nothing half-made stays).
    try {
        await fs.chmod(installFile, 0o600);
        await initializeRoot(install, guardDeps);
    } catch (e) {
        await fs.unlink(installFile).catch(() => {});
        throw e;
    }
    return { code: 0, out: { status: 'initialized', installFile, root, port } };
}

// `register`: a reviewed target of a config, with its run-state enums and the digest of its run-state path.
async function register(options, { env, guardDeps }) {
    for (const [key, values] of [
        ['runState', RUN_STATES],
        ['class', CLASSES],
        ['baselineKind', BASELINE_KINDS],
    ])
        if (!values.includes(options[key])) invalid('INVALID_INPUT', `Invalid ${key}; use --help for the values.`);
    if (!path.isAbsolute(options.runRef)) invalid('INVALID_INPUT', 'The run-state reference must be an absolute path.');
    const { input, expected } = await readTargetConfig(options.configFile);
    const classified = classifyTarget(input, guardDeps);
    if (classified.applicability !== 'applicable')
        invalid('TARGET_MISMATCH', 'Only reviewed migration targets are registered.');
    const entry = {
        identity: { ...classified.identity },
        account: expected.account,
        region: expected.region,
        runStateRef: runStateRefOf(options.runRef),
        class: options.class,
        runState: options.runState,
        baselineKind: options.baselineKind,
    };
    const install = await loadInstall({ env, deps: guardDeps });
    const { replaced, registeredAt } = await registerTarget(install, entry, guardDeps);
    return { code: 0, out: { status: 'registered', replaced, entry: { ...entry, registeredAt } } };
}

// `status`: the read-only guard status of a config's target (exit 1 when blocked).
async function status(options, { env, guardDeps }) {
    const { input, expected } = await readTargetConfig(options.configFile);
    const out = await guardStatus(input, expected, { env, deps: guardDeps });
    return { code: out.status === 'blocked' ? 1 : 0, out };
}

// `resolve`: record an owner decision `{ ref, digest }` on an inflight / unknown operation.
async function resolve(options, { env, guardDeps }) {
    const install = await loadInstall({ env, deps: guardDeps });
    const decision = { ref: options.ref, digest: options.digest };
    const out = await resolveOperation(install, options.operationId, { decision, deps: guardDeps });
    return { code: 0, out: { status: 'resolved', ...out } };
}

/** run one guard command; returns the exit code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
    const {
        stdout = console.log,
        stderr = console.error,
        env = process.env,
        guardDeps,
        hostname = os.hostname,
        now = () => new Date(),
    } = deps;
    try {
        const options = parseGuardArgs(argv);
        if (options.help) {
            stdout(GUARD_HELP);
            return 0;
        }
        const run = { init, register, status, resolve }[options.command];
        const { code, out } = await run(options, { env, guardDeps, hostname, now });
        stdout(JSON.stringify(out, null, 2));
        return code;
    } catch (error) {
        // a known error keeps its code and its (scrubbed) fixed message; anything else is one generic line.
        const known = error instanceof MigrationError || error instanceof DeployError;
        stderr(
            JSON.stringify({
                status: 'failed',
                code: known ? error.code : 'UNEXPECTED_ERROR',
                message: known ? scrub(error.message) : 'The guard command failed; raw errors are not logged.',
            }),
        );
        return known && INPUT_CODES.has(error.code) ? 2 : 1;
    }
}
