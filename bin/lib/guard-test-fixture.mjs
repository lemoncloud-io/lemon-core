/**
 * `bin/lib/guard-test-fixture.mjs` (lemon-core)
 * - test-only fixture of the migration guard (not shipped): a temp installation (install file outside the root,
 *   root initialized, reviewed targets registered) on a free loopback port, and helpers of the writer specs.
 */
//* v5 B31: new test fixture (the writer specs and the B31 spec provision a guard installation with it).
import { onTestFinished } from 'vitest';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { TARGETS } from './migrate-core.mjs';
import { INSTALL_ENV, initializeRoot, loadInstall, registerTarget, runStateRefOf } from './migrate-guard.mjs';

// a fresh real-path temp dir (the guard root must be its own real path), removed after the test.
export async function guardTemp(prefix = 'lemon-guard-fixture-') {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

// a free loopback port: listen on 0, read the port, close.
export async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

/**
 * a guard installation for the expected `account` / `region`: install file, initialized root and the given reviewed
 * `targets` registered (settled run state by default). Returns `{ base, root, port, installFile, env, install }`;
 * `env` holds the install env only (pass it as `guardEnv`, or spread it into a child process env).
 */
export async function guardFixture({ account, region, targets = TARGETS, init = true, entry = {} } = {}) {
    const base = await guardTemp();
    const root = path.join(base, 'root');
    const port = await freePort();
    const installFile = path.join(base, 'guard-install.json');
    const env = { [INSTALL_ENV]: installFile };
    const machineId = 'spec-machine';
    // the install file of a synthetic installation (outside the root).
    await writeFile(
        installFile,
        JSON.stringify({
            schemaVersion: 1,
            root,
            port,
            machineId,
            localVolume: { confirmedBy: 'spec fixture (local temp dir)', at: '2026-11-01T00:00:00.000Z' },
        }),
        { mode: 0o600 },
    );
    if (!init) return { base, root, port, installFile, env, install: null };
    await initializeRoot({ root, port, machineId });
    const install = await loadInstall({ env });
    // each reviewed target under the expected account / region, with a settled run state unless overridden.
    for (const t of targets)
        await registerTarget(install, {
            identity: { project: t.project, stage: t.stage, stack: t.stack },
            account,
            region,
            runStateRef: runStateRefOf(path.join(base, 'runs', t.stack)),
            class: 'verified-no-op',
            runState: 'completed',
            baselineKind: 'run-receipt',
            ...entry,
        });
    return { base, root, port, installFile, env, install };
}

/** a guard env whose install file does not exist (an applicable target is `blocked: 'install-invalid'`). */
export async function missingGuardEnv() {
    return { [INSTALL_ENV]: path.join(await guardTemp(), 'no-install.json') };
}

/**
 * a CLI stdout line (JSON, 2 spaces) without its B31 `guard` field, as the CLI printed it before B31; the guard field
 * is appended last, so the rest of the bytes must be unchanged.
 */
export const withoutGuard = text => {
    let value;
    // a line that is not a JSON object is returned as is.
    try {
        value = JSON.parse(text);
    } catch {
        return text;
    }
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, 'guard')) return text;
    const { guard, ...rest } = value;
    return JSON.stringify(rest, null, 2);
};
