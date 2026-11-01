#!/usr/bin/env node
/**
 * `bin/lemon-lambda-deploy-dev.mjs` (lemon-core)
 * - the guarded dev release: code-only deploy of the migrated dev target, gated by a verified migration receipt.
 * - usage: `lemon-lambda-deploy-dev [options]` (installed bin) / `npx lemon-lambda-deploy-dev --help`; run from the service root (`process.cwd()`).
 */
//* v5 B19: ported from lemon-templates-api `bin/deploy-dev.mjs` (behaviour, flags and output unchanged).
import path from 'node:path';
//* v5 B19: shares the argument parser of the `lemon-lambda-deploy` entry.
import { parseDeployArgs } from './lemon-lambda-deploy.mjs';
import { runDevRelease, DeployError } from './lib/dev-release.mjs';
import { MigrationError, TARGETS } from './lib/migrate-core.mjs';
import { isMain } from './lib/is-main.mjs';
//* v5 B31: the blocked report and the journal fields of a guarded write.
import { blockedReport, guardErrorFields } from './lib/migrate-guard.mjs';

export function parseDevArgs(argv) {
    const forwarded = [];
    let migrationReceipt;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--migration-receipt') {
            const value = argv[++i];
            if (migrationReceipt || !value || value.startsWith('--'))
                throw new MigrationError('INVALID_ARGS', 'Invalid or duplicate --migration-receipt.');
            migrationReceipt = path.resolve(value);
        } else forwarded.push(argv[i]);
    }
    return { ...parseDeployArgs(forwarded), ...(migrationReceipt ? { migrationReceipt } : {}) };
}
export async function main(argv = process.argv.slice(2), deps = {}) {
    const { stdout = console.log, stderr = console.error } = deps;
    try {
        const options = parseDevArgs(argv);
        if (options.help) {
            stdout(
                `Usage: npm run lambda:deploy:dev -- --config <dev-code-config> --artifact <pack-directory> [--migration-receipt <verified-receipt>] [--apply] [--receipt-dir <directory>]\nDefault is an offline plan; only reviewed dev targets are supported (${TARGETS.map(
                    t => `${t.project}/dev/code`,
                ).join(', ')}). Existing deploy ownership and artifact checks remain active.`,
            );
            return 0;
        }
        stdout(JSON.stringify(await runDevRelease(options, deps), null, 2));
        return 0;
    } catch (error) {
        //* v5 B31: a blocked guarded write has its own one-line report (exit 1).
        if (error?.code === 'GUARD_BLOCKED' && error.guardReason) {
            stderr(JSON.stringify(blockedReport(error)));
            return 1;
        }
        const known = error instanceof DeployError || error instanceof MigrationError;
        stderr(
            JSON.stringify({
                status: known && error.unknown ? 'unknown' : 'failed',
                code: known ? error.code : 'PREPARATION_FAILED',
                message: known ? error.message : 'Could not prepare dev deployment; raw errors are not logged.',
                ...(known && error.receipt ? { receipt: error.receipt } : {}),
                ...(known && error.deployId ? { deployId: error.deployId } : {}),
                //* v5 B31: the journal operation of a guarded write that did not complete.
                ...guardErrorFields(error),
            }),
        );
        return (
            error.exitCode ??
            (known && ['INVALID_INPUT', 'INVALID_ARGS', 'TARGET_MISMATCH', 'PLACEHOLDER_INPUT'].includes(error.code)
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
