import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeployError, loadDeployment, deploymentPlan, validateConfig, readJson } from './deploy-plan.mjs';
import { runDeployment } from './deploy-runner.mjs';
import { TARGETS, MigrationError, rejectPlaceholders, verifyMigrationReceipt } from './migrate-core.mjs';

//* v5 B24: the dev targets of the reviewed registry (`<project>/dev/code`), for the mismatch message.
const TARGET_LABELS = TARGETS.filter(t => t.stage === 'dev')
    .map(t => `${t.project}/dev/code`)
    .join(', ');
//* v5 B24: the registry entry of a dev code config (matched by project; the stack is `<project>-dev`).
function devTarget(c) {
    const target =
        c.stage === 'dev' && c.mode === 'code'
            ? TARGETS.find(t => t.stage === 'dev' && t.project === c.project)
            : undefined;
    if (!target)
        throw new MigrationError(
            'TARGET_MISMATCH',
            `Dev deployment requires a reviewed target config: ${TARGET_LABELS}.`,
        );
    return target;
}

export async function runDevRelease(
    options,
    { clientFactory, run = runDeployment, load = loadDeployment, signal } = {},
) {
    const candidate = validateConfig(await readJson(options.configFile, 'config JSON'));
    const target = devTarget(candidate);
    // Preserve the reviewed code-only config while reusing the existing artifact loader.
    // Code mode has no config-relative environment file; this snapshot cannot read one.
    const temporary = await mkdtemp(path.join(os.tmpdir(), target.devConfigPrefix));
    let deployment;
    try {
        const configFile = path.join(temporary, 'config.json');
        await writeFile(configFile, JSON.stringify(candidate), { mode: 0o600, flag: 'wx' });
        deployment = await load({ ...options, configFile });
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
    const c = deployment.config;
    //* v5 B24: the loaded config must name the same registry entry as the reviewed copy.
    if (devTarget(c) !== target)
        throw new MigrationError(
            'TARGET_MISMATCH',
            `Dev deployment requires a reviewed target config: ${TARGET_LABELS}.`,
        );
    const migration = options.migrationReceipt ? await verifyMigrationReceipt(options.migrationReceipt, c) : undefined;
    if (!options.apply) return { ...deploymentPlan(deployment), ...(migration ? { migration } : {}) };
    rejectPlaceholders(c);
    const create = clientFactory ?? (await import('./deploy-client.mjs')).createDeployClient;
    return run(deployment, { client: await create(c), receiptDirectory: options.receiptDirectory, signal });
}
export { DeployError };
