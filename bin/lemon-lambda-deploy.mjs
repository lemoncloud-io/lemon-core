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
    { stdout = console.log, stderr = console.error, clientFactory, signal } = {},
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
        if (!options.apply) {
            stdout(JSON.stringify(deploymentPlan(deployment), null, 2));
            return 0;
        }
        const create = clientFactory ?? (await import('./lib/deploy-client.mjs')).createDeployClient;
        const client = await create(deployment.config);
        const result = await runDeployment(deployment, { client, receiptDirectory: options.receiptDirectory, signal });
        stdout(JSON.stringify(result, null, 2));
        return 0;
    } catch (error) {
        const known = error instanceof DeployError;
        stderr(
            JSON.stringify({
                status: known && error.unknown ? 'unknown' : 'failed',
                code: known ? error.code : 'UNEXPECTED_ERROR',
                message: known
                    ? error.message
                    : 'Could not prepare or execute deployment; no raw error details are logged.',
                ...(error.receipt ? { receipt: error.receipt } : {}),
                ...(error.deployId ? { deployId: error.deployId } : {}),
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
