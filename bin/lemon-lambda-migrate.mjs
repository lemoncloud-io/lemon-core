#!/usr/bin/env node
/**
 * `bin/lemon-lambda-migrate.mjs` (lemon-core)
 * - run one guarded phase of the supported stack migration (offline plan by default, `--execute` to run).
 * - usage: `lemon-lambda-migrate [options]` (installed bin) / `npx lemon-lambda-migrate --help`; run from the service root (`process.cwd()`).
 * - v5 B27: `lemon-lambda-migrate <inspect|reconcile|resolve> --help` — read-only follow-up of an already migrated stack.
 */
//* v5 B19: ported from lemon-templates-api `bin/migrate.mjs` (behaviour, flags and output unchanged).
import path from 'node:path';
import { isMain } from './lib/is-main.mjs';
import { validateDiagnostic } from './lib/migrate-diagnostic.mjs';
import { INSPECTION_COMMANDS, inspectionMain } from './lib/migrate-inspect.mjs';
import {
    PHASES,
    TARGETS,
    MigrationError,
    json,
    validateMigrationConfig,
    validateRepository,
    migrationPlan,
    executeMigration,
    executionPrecheck,
} from './lib/migrate-core.mjs';
//* v5 B31: the six phases with `--execute` run under the migration guard (the LOCK / owner files stay as they are).
import {
    planGuard,
    runGuarded,
    blockedReport,
    guardErrorFields,
    unknownFailure,
    migrationJournalOf,
} from './lib/migrate-guard.mjs';

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
    //* v5 B27: a first argument `inspect` / `reconcile` / `resolve` has its own parser and output; any other argv
    //  takes the B19 path below unchanged (same help, plans, receipts, errors and exit codes).
    if (INSPECTION_COMMANDS.includes(argv[0])) return inspectionMain(argv, deps);
    //* v5 B31: `guardEnv` / `guardDeps` reach the guard only (tests); defaults are `process.env` and the node modules.
    const { stdout = console.log, stderr = console.error, signal, guardEnv = process.env, guardDeps } = deps;
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
        //* v5 B31: the guard sees the validated config only (D-1): project/stage/stack, expected account/region.
        const guardArgs = {
            input: { project: config.project, stage: config.stage, stack: config.stack },
            expected: { account: config.account, region: config.region },
            env: guardEnv,
            deps: guardDeps,
        };
        if (!options.execute) {
            //* v5 B31: the plan carries the read-only guard summary (no lock, no write).
            const guard = await planGuard(guardArgs.input, guardArgs.expected, guardArgs);
            const plan = migrationPlan(config, options.phase);
            stdout(JSON.stringify(guard ? { ...plan, guard } : plan, null, 2));
            return 0;
        }
        //* v5 B31: input-only refusals first, so a flag error never opens a journal record.
        executionPrecheck(config, options.phase, options);
        //* v5 B31: the guard runs first; receipt, LOCK file, STS and the child come only inside the write.
        const { result, guard } = await runGuarded({
            ...guardArgs,
            holder: `lemon-lambda-migrate:${options.phase}`,
            signal,
            run: () => executeMigration(config, options.phase, { ...options, signal }, deps),
            //* v5 B31 r2 (N6): the journal keeps the phase's deploy id and the run receipt digest (best effort).
            journalOf: result => migrationJournalOf(result),
        });
        stdout(JSON.stringify(guard ? { ...result, guard } : result, null, 2));
        return 0;
    } catch (error) {
        //* v5 B31: a blocked guarded write has its own one-line report (exit 1).
        if (error?.code === 'GUARD_BLOCKED' && error.guardReason) {
            stderr(JSON.stringify(blockedReport(error)));
            return 1;
        }
        const known = error instanceof MigrationError;
        stderr(
            JSON.stringify({
                //* v5 B31 r2 (N7): a journal failure (`stateWriteFailed`) is unknown whatever the error.
                status: unknownFailure(error, known) ? 'unknown' : 'failed',
                code: known ? error.code : 'PREPARATION_FAILED',
                message: known ? error.message : 'Could not prepare migration; raw errors are not logged.',
                ...(known && error.receipt ? { receipt: error.receipt } : {}),
                ...(known && error.diagnostic ? { diagnostic: validateDiagnostic(error.diagnostic) } : {}),
                //* v5 B31: the journal operation of a guarded write that did not complete.
                ...guardErrorFields(error),
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
