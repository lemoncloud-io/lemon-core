#!/usr/bin/env node
/**
 * `bin/lemon-lambda-env.mjs` (lemon-core)
 * - `build`: the Lambda environment of one stage from the service env file (Serverless rule), as a private JSON map.
 * - `diff`: compare a built map with the live environment of the deployed functions, by key name (read-only).
 * - usage: `lemon-lambda-env <build|diff> [options]` / `npx lemon-lambda-env --help`; run from the service root.
 * - never prints a value or a hash of a value. See `docs/v5/B26-lambda-env.md`.
 */
//* v5 B26: new tool (P0). It replaces the env merge that `sls deploy` did; it does not deploy anything.
import path from 'node:path';
import { EnvError, DOC_REF, buildEnvironment, diffEnvironment, isKnownError } from './lib/lambda-env.mjs';
import { isMain } from './lib/is-main.mjs';

// the usage text of `--help`.
export const USAGE = [
    'Usage: lemon-lambda-env build --env-file <env/<stage>.yml> --stage <stage> --output <file.json>',
    '       lemon-lambda-env diff --config <deploy-config.json> --env <built.json>',
    'build: offline; writes the <stage> section of the env file as a JSON string map (file 0600), prints key names only.',
    'diff: read-only (lambda:GetFunctionConfiguration of the lambda/backend functions); prints key names and counts only.',
    `Exit 0 done (differences are not failures), 1 failed, 2 invalid arguments/input. See ${DOC_REF}.`,
].join('\n');

// the options of each command (flag → option name).
const FLAGS = {
    build: { '--env-file': 'envFile', '--stage': 'stage', '--output': 'output' },
    diff: { '--config': 'configFile', '--env': 'envFile' },
};

// a bad argument (exit 2).
const badArgs = message => new EnvError('INVALID_ARGS', `${message}; use --help.`, 2);

//* v5 B26: `<command> --flag value ...`; `--help`/`-h` anywhere wins; unknown or repeated options are refused.
export function parseEnvArgs(argv) {
    if (argv.includes('--help') || argv.includes('-h')) return { help: true };
    const [command, ...rest] = argv;
    if (!Object.hasOwn(FLAGS, command ?? '')) throw badArgs('The first argument must be build or diff');
    const options = { command };
    for (let i = 0; i < rest.length; i++) {
        const key = FLAGS[command][rest[i]];
        if (!key || options[key] !== undefined) throw badArgs('Unknown or repeated option');
        const value = rest[++i];
        if (!value || value.startsWith('--')) throw badArgs('A required option value is missing');
        options[key] = value;
    }
    const missing = Object.entries(FLAGS[command]).filter(([, key]) => options[key] === undefined);
    if (missing.length) throw badArgs(`${missing.map(([flag]) => flag).join(', ')} required for ${command}`);
    return options;
}

/**
 * run one command; returns the exit code.
 * - `cwd` is the service root; `readerFactory` replaces the Lambda reader of `diff` (tests).
 */
export async function main(
    argv = process.argv.slice(2),
    { stdout = console.log, stderr = console.error, cwd = process.cwd(), readerFactory } = {},
) {
    try {
        const options = parseEnvArgs(argv);
        if (options.help) {
            stdout(USAGE);
            return 0;
        }
        const report =
            options.command === 'build'
                ? await buildEnvironment({ cwd, ...options })
                : await diffEnvironment({
                      cwd,
                      configFile: path.resolve(cwd, options.configFile),
                      envFile: path.resolve(cwd, options.envFile),
                      ...(readerFactory ? { readerFactory } : {}),
                  });
        stdout(JSON.stringify(report, null, 2));
        return 0;
    } catch (error) {
        const known = isKnownError(error);
        // a known error has a values-free message; anything else is reported without its raw text.
        stderr(
            JSON.stringify({
                status: 'failed',
                code: known ? error.code : 'UNEXPECTED_ERROR',
                message: known ? error.message : 'Could not complete the command; no raw error details are logged.',
            }),
        );
        if (error instanceof EnvError) return error.exitCode;
        return known && ['INVALID_INPUT', 'INVALID_ARGS'].includes(error.code) ? 2 : 1;
    }
}

//* v5 B26: run when started directly or through the npm `bin` symlink.
if (isMain(import.meta.url)) process.exitCode = await main();
