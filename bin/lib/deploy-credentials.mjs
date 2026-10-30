import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DeployError } from './deploy-plan.mjs';
import { isMain } from './is-main.mjs';

const workerFile = fileURLToPath(import.meta.url);
const failure = () =>
    new DeployError('CREDENTIALS_FAILED', 'Could not resolve AWS credentials within the request deadline.');

/** Isolate SDK credential_process helpers in an owned POSIX process group. Never log credentials. */
export function boundedCredentialProvider({ profile, timeoutMs, environment = process.env, now = Date.now } = {}) {
    let cached;
    let validUntil = 0;
    let pending;
    let cancel;
    let closed = false;
    const resolve = () =>
        new Promise((accept, reject) => {
            if (process.platform === 'win32') {
                reject(
                    new DeployError(
                        'UNSUPPORTED_PLATFORM',
                        'Apply requires POSIX credential-helper process-group cleanup (macOS/Linux).',
                    ),
                );
                return;
            }
            let child;
            try {
                child = fork(workerFile, ['--credential-worker', profile ?? ''], {
                    detached: true,
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                    execArgv: [],
                    env: environment,
                });
            } catch {
                reject(failure());
                return;
            }
            let finished = false;
            const kill = () => {
                if (child.pid) {
                    try {
                        process.kill(-child.pid, 'SIGKILL');
                    } catch {
                        /* Already reaped. */
                    }
                }
            };
            const parentExit = () => kill();
            process.once('exit', parentExit);
            const finish = value => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                cancel = undefined;
                process.removeListener('exit', parentExit);
                kill();
                if (value) accept(value);
                else reject(failure());
            };
            const timer = setTimeout(() => finish(), timeoutMs);
            cancel = () => finish();
            child.once('error', () => finish());
            child.once('exit', () => finish());
            child.once('message', message => {
                if (!message?.ok || !message.credentials || closed) {
                    finish();
                    return;
                }
                const raw = message.credentials;
                if (
                    typeof raw.accessKeyId !== 'string' ||
                    !raw.accessKeyId ||
                    typeof raw.secretAccessKey !== 'string' ||
                    !raw.secretAccessKey ||
                    (raw.sessionToken !== undefined && typeof raw.sessionToken !== 'string')
                ) {
                    finish();
                    return;
                }
                const expiration = raw.expiration === undefined ? undefined : new Date(raw.expiration);
                if (expiration && (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= now() + 1000)) {
                    finish();
                    return;
                }
                const value = {
                    accessKeyId: raw.accessKeyId,
                    secretAccessKey: raw.secretAccessKey,
                    ...(raw.sessionToken === undefined ? {} : { sessionToken: raw.sessionToken }),
                    ...(expiration ? { expiration } : {}),
                };
                cached = value;
                validUntil = Math.min(now() + 5 * 60 * 1000, expiration ? expiration.getTime() - 30000 : Infinity);
                finish(value);
            });
        });
    const provider = async () => {
        if (closed) throw failure();
        if (cached && now() < validUntil) return cached;
        if (!pending)
            pending = resolve().finally(() => {
                pending = undefined;
            });
        return pending;
    };
    provider.cancel = () => cancel?.();
    provider.close = () => {
        closed = true;
        cached = undefined;
        cancel?.();
    };
    return provider;
}

// Private IPC worker; standalone invocation never prints credentials.
if (
    //* v5 B19: the worker check also holds when lemon-core is reached through a symlink.
    isMain(import.meta.url) &&
    process.argv[2] === '--credential-worker'
) {
    if (!process.send) process.exitCode = 2;
    else {
        // Also clean helpers if the coordinator is SIGKILLed and cannot run its exit hook.
        process.once('disconnect', () => {
            try {
                process.kill(-process.pid, 'SIGKILL');
            } catch {
                process.exit(1);
            }
        });
        try {
            const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers');
            const profile = process.argv[3] || undefined;
            const credentials = await fromNodeProviderChain(profile ? { profile } : {})();
            process.send(
                {
                    ok: true,
                    credentials: {
                        accessKeyId: credentials.accessKeyId,
                        secretAccessKey: credentials.secretAccessKey,
                        ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
                        ...(credentials.expiration ? { expiration: credentials.expiration.toISOString() } : {}),
                    },
                },
                () => process.disconnect(),
            );
        } catch {
            process.send({ ok: false }, () => process.disconnect());
            process.exitCode = 1;
        }
    }
}
