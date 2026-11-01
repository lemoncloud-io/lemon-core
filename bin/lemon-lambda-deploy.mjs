#!/usr/bin/env node
/**
 * `bin/lemon-lambda-deploy.mjs` (lemon-core)
 * - plan (default, offline) or `--apply` a Lambda deployment through the deploy-service tools.
 * - usage: `lemon-lambda-deploy [options]` (installed bin) / `npx lemon-lambda-deploy --help`; run from the service root (`process.cwd()`).
 */
//* v5 B19: ported from lemon-templates-api `bin/deploy.mjs` (behaviour, flags and output unchanged).
import path from 'node:path';
import { DeployError, loadDeployment, deploymentPlan } from './lib/deploy-plan.mjs';
import { runDeployment } from './lib/deploy-runner.mjs';
import { ORG_DEFAULTS } from './lib/org-defaults.mjs';
import { isMain } from './lib/is-main.mjs';
//* v5 B31: the migration guard of the reviewed targets (a target outside the registry keeps this path unchanged).
import { MigrationError } from './lib/migrate-core.mjs';
import { planGuard, runGuarded, blockedReport, guardErrorFields, unknownFailure } from './lib/migrate-guard.mjs';

export function parseDeployArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        const key = {
            '--config': 'configFile',
            '--artifact': 'artifact',
            '--receipt-dir': 'receiptDirectory',
            '--apply': 'apply',
            '--help': 'help',
            '-h': 'help',
        }[name];
        if (!key || options[key] !== undefined)
            throw new DeployError('INVALID_ARGS', 'Unknown or repeated option; use --help.');
        if (key === 'apply' || key === 'help') options[key] = true;
        else {
            const value = argv[++i];
            if (!value || value.startsWith('--'))
                throw new DeployError('INVALID_ARGS', 'A required option value is missing; use --help.');
            options[key] = path.resolve(value);
        }
    }
    if (!options.help && (!options.configFile || !options.artifact))
        throw new DeployError('INVALID_ARGS', '--config and --artifact are required; use --help.');
    return options;
}
export async function main(
    argv = process.argv.slice(2),
    //* v5 B31: `guardEnv` / `guardDeps` reach the guard only, `run` replaces the deployment runner (tests); defaults
    //  are `process.env`, the node modules and `runDeployment` (as in `lemon-lambda-deploy-dev`).
    {
        stdout = console.log,
        stderr = console.error,
        clientFactory,
        signal,
        guardEnv = process.env,
        guardDeps,
        run = runDeployment,
    } = {},
) {
    let options;
    try {
        options = parseDeployArgs(argv);
        if (options.help) {
            stdout(
                `Usage: npm run lambda:deploy -- --config <config.json> --artifact <pack-directory> [--apply] [--receipt-dir <directory>]\nDefault: verified offline plan, no network or credential lookup. --apply mutates AWS resources via ${ORG_DEFAULTS.deploy.serviceName} tools. See ${ORG_DEFAULTS.deploy.docRef}.`,
            );
            return 0;
        }
        const deployment = await loadDeployment(options);
        //* v5 B31: the guard sees the validated config only (D-1): target project/stage, expected account/region.
        const c = deployment.config;
        const guardArgs = {
            input: { project: c.project, stage: c.stage },
            expected: { account: c.account, region: c.region },
            env: guardEnv,
            deps: guardDeps,
        };
        if (!options.apply) {
            //* v5 B31: a reviewed target's plan carries the read-only guard summary; any other plan is unchanged.
            const guard = await planGuard(guardArgs.input, guardArgs.expected, guardArgs);
            const plan = deploymentPlan(deployment);
            stdout(JSON.stringify(guard ? { ...plan, guard } : plan, null, 2));
            return 0;
        }
        //* v5 B31: the guard runs first; the client (credentials) and the receipt come only inside the write.
        const { result, guard } = await runGuarded({
            ...guardArgs,
            holder: 'lemon-lambda-deploy',
            signal,
            run: async () => {
                const create = clientFactory ?? (await import('./lib/deploy-client.mjs')).createDeployClient;
                const client = await create(c);
                return run(deployment, { client, receiptDirectory: options.receiptDirectory, signal });
            },
        });
        stdout(JSON.stringify(guard ? { ...result, guard } : result, null, 2));
        return 0;
    } catch (error) {
        //* v5 B31: a blocked guarded write has its own one-line report (exit 1).
        if (error?.code === 'GUARD_BLOCKED' && error.guardReason) {
            stderr(JSON.stringify(blockedReport(error)));
            return 1;
        }
        //* v5 B31: guard errors are known errors too (fixed messages without values).
        const known = error instanceof DeployError || error instanceof MigrationError;
        stderr(
            JSON.stringify({
                //* v5 B31 r2 (N7): a journal failure (`stateWriteFailed`) is unknown whatever the error.
                status: unknownFailure(error, known) ? 'unknown' : 'failed',
                code: known ? error.code : 'UNEXPECTED_ERROR',
                message: known
                    ? error.message
                    : 'Could not prepare or execute deployment; no raw error details are logged.',
                ...(error.receipt ? { receipt: error.receipt } : {}),
                ...(error.deployId ? { deployId: error.deployId } : {}),
                //* v5 B31: the journal operation of a guarded write that did not complete.
                ...guardErrorFields(error),
            }),
        );
        return error.exitCode ?? (known && ['INVALID_INPUT', 'INVALID_ARGS'].includes(error.code) ? 2 : 1);
    }
}
//* v5 B19: run when started directly or through the npm `bin` symlink (`isMain` resolves `argv[1]`).
if (isMain(import.meta.url)) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
        process.exitCode = await main(undefined, { signal: controller.signal });
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}
