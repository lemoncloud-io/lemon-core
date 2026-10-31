#!/usr/bin/env node
/**
 * `bin/lemon-lambda-migrate.mjs` (lemon-core)
 * - run one guarded phase of the supported stack migration (offline plan by default, `--execute` to run).
 * - usage: `lemon-lambda-migrate [options]` (installed bin) / `npx lemon-lambda-migrate --help`; run from the service root (`process.cwd()`).
 */
//* v5 B19: ported from lemon-templates-api `bin/migrate.mjs` (behaviour, flags and output unchanged).
import path from 'node:path';
import { isMain } from './lib/is-main.mjs';
import { validateDiagnostic } from './lib/migrate-diagnostic.mjs';
import {
    PHASES,
    TARGETS,
    MigrationError,
    json,
    validateMigrationConfig,
    validateRepository,
    migrationPlan,
    executeMigration,
} from './lib/migrate-core.mjs';

export function parseMigrationArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (PHASES.includes(arg) && !result.phase) {
            result.phase = arg;
            continue;
        }
        const key = {
            '--config': 'configFile',
            '--execute': 'execute',
            '--allow-sensitive-backup': 'allowSensitiveBackup',
            '--confirm-stack': 'confirmStack',
            '--help': 'help',
            '-h': 'help',
        }[arg];
        if (!key || result[key] !== undefined)
            throw new MigrationError('INVALID_ARGS', 'Unknown or duplicate migration argument.');
        if (['execute', 'allowSensitiveBackup', 'help'].includes(key)) result[key] = true;
        else {
            const value = argv[++i];
            if (!value || value.startsWith('--'))
                throw new MigrationError('INVALID_ARGS', 'Missing migration argument value.');
            result[key] = key === 'configFile' ? path.resolve(value) : value;
        }
    }
    if (!result.help && (!result.phase || !result.configFile))
        throw new MigrationError('INVALID_ARGS', 'A phase and --config are required.');
    if (
        (result.allowSensitiveBackup && result.phase !== 'plan') ||
        (result.confirmStack !== undefined && result.phase !== 'remove')
    )
        throw new MigrationError('INVALID_ARGS', 'Confirmation flag is not applicable to this phase.');
    return result;
}
export async function main(argv = process.argv.slice(2), deps = {}) {
    const { stdout = console.log, stderr = console.error, signal } = deps;
    try {
        const options = parseMigrationArgs(argv);
        if (options.help) {
            stdout(
                `Usage: npm run lambda:migrate -- <plan|retain|remove|tag|apply|verify> --config <file> [--execute] [--allow-sensitive-backup] [--confirm-stack <stack>]\nDefault is offline planning, including plan/verify phases. apply --execute writes without upstream --go. No all-phases option.\nReviewed targets (config project/stage/stack): ${TARGETS.map(
                    t => t.stack,
                ).join(', ')}.`,
            );
            return 0;
        }
        const config = validateMigrationConfig(await json(options.configFile), options.configFile);
        const root = await (deps.validateRepository ?? validateRepository)(config);
        config.migrationRepo = root;
        if (!options.execute) {
            stdout(JSON.stringify(migrationPlan(config, options.phase), null, 2));
            return 0;
        }
        const result = await executeMigration(config, options.phase, { ...options, signal }, deps);
        stdout(JSON.stringify(result, null, 2));
        return 0;
    } catch (error) {
        const known = error instanceof MigrationError;
        stderr(
            JSON.stringify({
                status: known && error.unknown ? 'unknown' : 'failed',
                code: known ? error.code : 'PREPARATION_FAILED',
                message: known ? error.message : 'Could not prepare migration; raw errors are not logged.',
                ...(known && error.receipt ? { receipt: error.receipt } : {}),
                ...(known && error.diagnostic ? { diagnostic: validateDiagnostic(error.diagnostic) } : {}),
            }),
        );
        return (
            error.exitCode ??
            (known &&
            [
                'INVALID_ARGS',
                'INVALID_INPUT',
                'TARGET_MISMATCH',
                'REVISION_MISMATCH',
                'PLACEHOLDER_INPUT',
                'BACKUP_CONSENT_REQUIRED',
                'STACK_CONFIRMATION_REQUIRED',
            ].includes(error.code)
                ? 2
                : 1)
        );
    }
}
//* v5 B19: run when started directly or through the npm `bin` symlink (`isMain` resolves `argv[1]`).
if (isMain(import.meta.url)) {
    const controller = new AbortController(),
        stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        process.exitCode = await main(undefined, { signal: controller.signal });
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
