import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyMigrationError, diagnosticFromMessage, validateDiagnostic } from './migrate-diagnostic.mjs';
import { isMain } from './is-main.mjs';

/** Owned process group; stdout/stderr are deliberately never forwarded or persisted. */
export function runPrivateChild({ mode, command, args = [], cwd, environment, timeoutMs, signal, onProgress }) {
    if (process.platform === 'win32') throw new Error('POSIX_REQUIRED');
    return new Promise(resolve => {
        if (signal?.aborted) {
            resolve({ code: null, reason: 'interrupted' });
            return;
        }
        const child = fork(fileURLToPath(import.meta.url), ['--private-worker', mode, command, ...args], {
            cwd,
            env: environment,
            detached: true,
            execArgv: [],
            stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
        });
        let reason,
            account,
            diagnostic,
            done = false,
            code = null,
            pendingLine = '',
            progress = Promise.resolve(),
            cleanupTimer;
        const kill = () => {
            if (child.pid)
                try {
                    process.kill(-child.pid, 'SIGKILL');
                } catch {}
        };
        const stop = () => {
            reason = 'interrupted';
            kill();
        };
        const parentExit = () => kill();
        signal?.addEventListener('abort', stop, { once: true });
        process.once('exit', parentExit);
        const timer = setTimeout(() => {
            reason = 'timeout';
            kill();
        }, timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            const lines = (pendingLine + chunk).split('\n');
            pendingLine = lines.pop();
            if (pendingLine.length > 512) pendingLine = '';
            for (const line of lines) {
                const match = /^\d{2}:\d{2}:\d{2} deployId (dpl_[0-9a-z]{1,16}_[0-9a-f]{6})\r?$/.exec(line);
                if (mode === 'migration' && match && onProgress)
                    progress = progress
                        .then(() => onProgress({ deployId: match[1] }))
                        .catch(() => {
                            reason = 'receipt-failed';
                            kill();
                        });
            }
        });
        child.on('message', m => {
            if (mode === 'sts' && typeof m?.account === 'string' && /^\d{12}$/.test(m.account)) account = m.account;
            if (m && Object.hasOwn(m, 'diagnostic')) diagnostic = diagnosticFromMessage(m);
        });
        const finish = async () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearTimeout(cleanupTimer);
            kill();
            signal?.removeEventListener('abort', stop);
            process.removeListener('exit', parentExit);
            await progress;
            const outcome = reason ?? (code === 0 ? 'exited' : 'failed');
            resolve({
                code,
                reason: outcome,
                ...(account ? { account } : {}),
                ...(code !== 0 || outcome !== 'exited'
                    ? { diagnostic: validateDiagnostic(diagnostic ?? { kind: 'process' }) }
                    : {}),
            });
        };
        child.once('error', () => {
            reason = 'spawn-failed';
        });
        child.once('exit', exitCode => {
            code = exitCode;
            kill();
            cleanupTimer = setTimeout(() => {
                reason ??= 'cleanup-timeout';
                child.stdout.destroy();
                finish();
            }, 250);
        });
        child.once('close', exitCode => {
            code = exitCode;
            finish();
        });
    });
}

if (
    //* v5 B19: the worker check also holds when lemon-core is reached through a symlink.
    isMain(import.meta.url) &&
    process.argv[2] === '--private-worker'
) {
    if (!process.send) process.exitCode = 2;
    else {
        process.umask(0o077);
        const lostParent = () => {
            try {
                process.kill(-process.pid, 'SIGKILL');
            } catch {
                process.exit(1);
            }
        };
        process.once('disconnect', lostParent);
        const finish = code => {
            process.removeListener('disconnect', lostParent);
            process.exit(code);
        };
        const [, , , mode, command, ...args] = process.argv;
        try {
            if (mode === 'sts') {
                const { stdout } = await promisify(execFile)(command, args, { maxBuffer: 65536, encoding: 'utf8' });
                const value = JSON.parse(stdout);
                if (!/^\d{12}$/.test(value.Account)) throw Error('BAD_STS');
                process.send({ account: value.Account }, () => finish(0));
            } else if (mode === 'migration') {
                process.argv = [process.execPath, command, ...args];
                await import(pathToFileURL(command));
                // Canonical code may itself call process.exit; the parent also observes exitCode.
                finish(0);
            } else finish(2);
        } catch (error) {
            const diagnostic = classifyMigrationError(error, {
                migrationFile: mode === 'migration' ? command : undefined,
            });
            try {
                process.send({ diagnostic }, () => finish(1));
            } catch {
                finish(1);
            }
        }
    }
}
