import { mkdir, mkdtemp, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { DeployError } from './deploy-plan.mjs';

/**
 * No raw request/response, environment, credentials, upload URL, or raw remote error text belongs here.
 * v5 B34 (D-2): a failed step may carry the tool's error as `errorMessage` (scrubbed, 300 characters) / `toolErrorCode`.
 */
export async function createReceipt(directory, plan) {
    try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const run = await mkdtemp(path.join(path.resolve(directory), 'run-'));
        const file = path.join(run, 'receipt.json');
        const state = {
            schemaVersion: 1,
            startedAt: new Date().toISOString(),
            status: 'prepared',
            plan,
            steps: [],
            verification: 'server aggregate only',
        };
        const save = async () => {
            try {
                await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
                await rename(`${file}.tmp`, file);
            } catch {
                throw new DeployError(
                    'RECEIPT_WRITE_FAILED',
                    'Could not persist deployment receipt; stop and inspect the existing record.',
                    { unknown: true },
                );
            }
        };
        await save();
        return { file, state, save };
    } catch (error) {
        if (error instanceof DeployError) throw error;
        throw new DeployError('RECEIPT_WRITE_FAILED', 'Could not prepare deployment receipt.');
    }
}
