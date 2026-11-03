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

// listen on `port` of loopback (0 = any) and close again; resolves the port, or null when it is busy.
async function probePort(port) {
    const server = net.createServer();
    const ok = await new Promise(resolve => {
        server.once('error', () => resolve(false));
        server.listen({ host: '127.0.0.1', port }, () => resolve(true));
    });
    if (!ok) return null;
    const bound = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return bound;
}

// a free loopback port: listen on 0, read the port, close, then check it once more by its number.
//  v5 B31 r2 (N9): when another process took it in between (busy), one more candidate is tried.
export async function freePort() {
    for (let attempt = 0; attempt < 2; attempt++) {
        const port = await probePort(0);
        if (port !== null && (await probePort(port)) === port) return port;
    }
    throw new Error('no free loopback port after one retry');
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
 * v5 B31 r2 (N5): the tail block `,\n  "guard": {...}` is cut from the original text (no re-serialization), so every
 * other byte is compared as printed.
 */
export const withoutGuard = text => {
    const marker = ',\n  "guard": ';
    const at = typeof text === 'string' ? text.lastIndexOf(marker) : -1;
    // no top-level guard key at the end of an object: the line is returned as is.
    if (at < 0 || !text.endsWith('\n}')) return text;
    const block = text.slice(at + marker.length, -2);
    // the cut block must be one JSON object (the guard value), and what stays must still be one JSON object.
    try {
        const value = JSON.parse(block);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return text;
        const rest = text.slice(0, at) + '\n}';
        JSON.parse(rest);
        return rest;
    } catch {
        return text;
    }
};
