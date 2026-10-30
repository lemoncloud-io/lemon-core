import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { prepareSource } from './local-artifact.mjs';

// Detached workers get an owned POSIX process group. Scoped hooks preserve cleanup on CLI signals.
const activeSessions = new Set();
const signalHandlers = new Map();
const onExit = () => {
    for (const session of activeSessions) session.terminate();
};
function registerSession(session) {
    if (!activeSessions.size) {
        process.on('exit', onExit);
        for (const signal of ['SIGINT', 'SIGTERM']) {
            const handler = () => {
                for (const active of activeSessions) active.terminate();
                // If the caller has its own signal policy, leave termination to that listener.
                if (process.listenerCount(signal) === 1) {
                    process.removeListener(signal, handler);
                    process.kill(process.pid, signal);
                }
            };
            signalHandlers.set(signal, handler);
            process.on(signal, handler);
        }
    }
    activeSessions.add(session);
}
function unregisterSession(session) {
    activeSessions.delete(session);
    if (!activeSessions.size) {
        process.removeListener('exit', onExit);
        for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
        signalHandlers.clear();
    }
}
const runtime = fileURLToPath(new URL('./local-runtime.mjs', import.meta.url));
const limits = [
    'Trusted-code development runner; network deny is a best-effort Node guard, not a security sandbox.',
    'No IAM, VPC, AWS service, Lambda orchestration, memory/CPU allocation, freeze/thaw or deployment cold-start emulation.',
    'Host OS, architecture and Node version apply; Linux/native-addon compatibility is not verified.',
    'Callbacks and response streaming are unsupported; warm background work continues between invocations.',
    'Log capture tracks arrival windows, not background task origins; earlier warm requests can log during later attempts.',
    'POSIX disposal signals the owned process group; deliberately detached descendants and abrupt parent SIGKILL are outside supervision. Windows disposal targets the runtime only.',
];
function positive(value, name, fallback, max) {
    const number = value ?? fallback;
    if (!Number.isSafeInteger(number) || number < 1 || number > max)
        throw new Error(`${name} must be an integer from 1 to ${max}`);
    return number;
}
function configuration(options) {
    const mode = options.mode ?? 'cold';
    if (!['cold', 'warm'].includes(mode)) throw new Error('mode must be cold or warm');
    const network = options.network ?? 'deny';
    if (!['deny', 'allow'].includes(network)) throw new Error('network must be deny or allow');
    const events = options.events ?? [options.event === undefined ? {} : options.event];
    if (!Array.isArray(events) || !events.length) throw new Error('events must be a nonempty JSON array');
    const runs = positive(options.runs, 'runs', events.length, 1000);
    if (events.length !== 1 && events.length !== runs)
        throw new Error('events must contain one event or exactly runs events');
    const timeoutMs = positive(options.timeoutMs, 'timeoutMs', 3000, 900000);
    const maxLogBytes = positive(options.maxLogBytes, 'maxLogBytes', 65536, 16 * 1024 ** 2);
    const memorySize = positive(options.memorySize, 'memorySize', 128, 10240);
    const env = options.env ?? {};
    if (!env || typeof env !== 'object' || Array.isArray(env))
        throw new Error('env must be a JSON object of string values');
    for (const [name, value] of Object.entries(env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== 'string' || value.includes('\0'))
            throw new Error('env must contain valid names and string values');
        if (['HOME', 'NODE_OPTIONS', 'NODE_PATH'].includes(name)) throw new Error(`env cannot set ${name}`);
    }
    const functionName = options.functionName ?? 'lambda-local';
    const functionVersion = options.functionVersion ?? '$LATEST';
    const functionArn =
        options.functionArn ?? `arn:aws:lambda:${env.AWS_REGION ?? 'us-east-1'}:000000000000:function:${functionName}`;
    for (const [name, value] of Object.entries({ functionName, functionVersion, functionArn })) {
        if (typeof value !== 'string' || !value || /[\x00-\x1f]/.test(value))
            throw new Error(`${name} must be a nonempty string without control characters`);
    }
    // Validate the wire format once, before any process starts.
    const jsonEvents = JSON.parse(JSON.stringify(events));
    return {
        mode,
        network,
        events: jsonEvents,
        runs,
        timeoutMs,
        maxLogBytes,
        memorySize,
        env,
        functionName,
        functionVersion,
        functionArn,
    };
}
function capture(limit) {
    const chunks = [];
    let bytes = 0,
        saved = 0;
    return {
        add(chunk) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            const keep = buffer.subarray(0, Math.max(0, limit - saved));
            if (keep.length) {
                chunks.push(keep);
                saved += keep.length;
            }
        },
        value() {
            // Normalize invalid UTF-8, then cut only at a complete code point within the byte cap.
            const normalized = Buffer.from(Buffer.concat(chunks).toString('utf8'));
            const text = new TextDecoder().decode(normalized.subarray(0, limit), { stream: true });
            return { text, bytes, truncated: bytes > saved || normalized.length > limit };
        },
    };
}
function childEnvironment(config) {
    // Deliberately do not spread process.env: credentials, HOME, PATH and Node hooks stay out.
    return {
        LANG: 'C.UTF-8',
        TZ: 'UTC',
        AWS_EC2_METADATA_DISABLED: 'true',
        ...config.env,
        AWS_LAMBDA_FUNCTION_NAME: config.functionName,
        AWS_LAMBDA_FUNCTION_VERSION: config.functionVersion,
        AWS_LAMBDA_FUNCTION_MEMORY_SIZE: String(config.memorySize),
        AWS_LAMBDA_LOG_GROUP_NAME: config.logGroupName,
        AWS_LAMBDA_LOG_STREAM_NAME: config.logStreamName,
        LAMBDA_TASK_ROOT: config.root,
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs24.x',
        _HANDLER: `${config.handler.file.replace(/\.(?:c?js|mjs)$/, '')}.${config.handler.export}`,
    };
}
class Session {
    constructor(config) {
        this.config = config;
        this.sessionId = randomUUID();
        config = {
            ...config,
            logGroupName: `/aws/lambda/${config.functionName}`,
            logStreamName: `local/${this.sessionId}`,
        };
        this.config = config;
        this.ready = false;
        this.usable = true;
        this.closed = false;
        this.exited = false;
        this.ownsProcessGroup = process.platform !== 'win32';
        this.exit = { code: null, signal: null };
        this.child = fork(runtime, [], {
            cwd: config.root,
            env: childEnvironment(config),
            execArgv: ['--enable-source-maps'],
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            serialization: 'json',
            detached: this.ownsProcessGroup,
        });
        registerSession(this);
        this.closedPromise = new Promise(resolve => {
            this.resolveClosed = resolve;
        });
        this.child.stdout.on('data', chunk => this.output?.stdout.add(chunk));
        this.child.stderr.on('data', chunk => this.output?.stderr.add(chunk));
        this.child.on('message', message => {
            if (!this.pending) {
                if (message.type === 'fatal') {
                    this.usable = false;
                    this.terminate();
                }
                return;
            }
            if (message.type === 'ready' && !this.ready) {
                this.ready = true;
                this.pending.initMs = message.initMs;
                this.invokeChild();
            } else if (message.type === 'result' && message.requestId === this.pending.requestId) {
                void this.finish(message.error ? 'error' : 'success', message);
            } else if (message.type === 'fatal') {
                void this.finish('error', { error: { ...message.error, kind: message.kind } });
            }
        });
        this.child.on('error', error => {
            void this.finish('crash', { error: { name: error.name, message: error.message, stack: error.stack } });
        });
        this.child.on('exit', (code, signal) => {
            this.exited = true;
            this.exit = { code, signal };
            void this.finish('crash', {
                error: {
                    name: 'RuntimeExitError',
                    message: `Child exited before completing request (code=${code}, signal=${signal})`,
                    stack: '',
                },
            });
        });
        this.child.on('close', (code, signal) => {
            this.closed = true;
            this.usable = false;
            this.exit = { code, signal };
            this.resolveClosed();
            void this.finish('crash', {
                error: {
                    name: 'RuntimeExitError',
                    message: `Child exited before completing request (code=${code}, signal=${signal})`,
                    stack: '',
                },
            });
        });
    }
    invoke(event, cold, started) {
        this.output = { stdout: capture(this.config.maxLogBytes), stderr: capture(this.config.maxLogBytes) };
        return new Promise(resolve => {
            const requestId = randomUUID();
            const remainingMs = Math.max(1, this.config.timeoutMs - (performance.now() - started));
            this.pending = {
                requestId,
                event,
                cold,
                started,
                resolve,
                initMs: cold ? null : 0,
                phase: 'init',
                deadline: Date.now() + remainingMs,
            };
            this.timer = setTimeout(() => {
                void this.finish('timeout', {
                    error: {
                        name: 'TimeoutError',
                        message: `Parent deadline exceeded ${this.config.timeoutMs} ms`,
                        stack: '',
                    },
                });
            }, remainingMs);
            if (this.ready) this.invokeChild();
            else
                this.child.send({ type: 'boot', config: this.config }, error => {
                    if (error)
                        void this.finish('crash', {
                            error: { name: error.name, message: error.message, stack: error.stack },
                        });
                });
        });
    }
    invokeChild() {
        const pending = this.pending;
        if (!pending) return;
        pending.phase = 'invoke';
        pending.invokeStarted = performance.now();
        this.child.send(
            { type: 'invoke', requestId: pending.requestId, event: pending.event, deadline: pending.deadline },
            error => {
                if (error)
                    void this.finish('crash', {
                        error: { name: error.name, message: error.message, stack: error.stack },
                    });
            },
        );
    }
    async finish(status, message) {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        clearTimeout(this.timer);
        const settled = performance.now();
        const cleanup = status !== 'success' ? await this.stop() : null;
        pending.resolve({
            requestId: pending.requestId,
            sessionId: this.sessionId,
            processId: this.child.pid ?? null,
            cold: pending.cold,
            status,
            phase: pending.phase,
            timedOut: status === 'timeout',
            timings: {
                initMs: pending.initMs,
                invokeMs: message.invokeMs ?? (pending.invokeStarted ? settled - pending.invokeStarted : null),
                totalMs: settled - pending.started,
            },
            ...(status === 'success' ? { result: message.result } : { error: message.error }),
            stdout: this.output.stdout.value(),
            stderr: this.output.stderr.value(),
            exit: { ...this.exit },
            cleanup,
        });
    }
    terminate() {
        if (this.terminationSent) return;
        this.terminationSent = true;
        this.usable = false;
        try {
            if (this.ownsProcessGroup && this.child.pid) process.kill(-this.child.pid, 'SIGKILL');
            else this.child.kill('SIGKILL');
        } catch (error) {
            if (error.code !== 'ESRCH') this.terminationError = error.message;
            if (!this.exited) this.child.kill('SIGKILL');
        }
    }
    stop() {
        if (this.stopPromise) return this.stopPromise;
        this.stopPromise = (async () => {
            const started = performance.now();
            this.terminate();
            let timer;
            const drained = await Promise.race([
                this.closedPromise.then(() => true),
                new Promise(resolve => {
                    timer = setTimeout(() => resolve(false), 250);
                }),
            ]);
            clearTimeout(timer);
            if (!drained) {
                // Escaped descendants and Windows inherited pipes must never make cleanup unbounded.
                this.child.stdout.destroy();
                this.child.stderr.destroy();
                if (this.child.connected) this.child.disconnect();
            }
            unregisterSession(this);
            return {
                durationMs: performance.now() - started,
                forcedPipeClose: !drained,
                scope: this.ownsProcessGroup ? 'owned-posix-process-group' : 'runtime-process-only',
                exitObserved: this.exited,
                ...(this.terminationError ? { error: this.terminationError } : {}),
            };
        })();
        return this.stopPromise;
    }
}

/** Stable schema v1 adapter entry point; runs are sequential and JSON events are copied over IPC. */
export async function runLocal(options = {}) {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('lambda-local requires Node 24 or newer');
    const config = configuration(options);
    const setupStarted = performance.now();
    const source = await prepareSource(options);
    const host = { platform: process.platform, architecture: process.arch, node: process.version };
    const targetArch = { x86_64: 'x64', arm64: 'arm64' }[source.source.architecture];
    const platformMismatch =
        source.source.type === 'artifact' &&
        (process.platform !== 'linux' || (targetArch && targetArch !== process.arch));
    const report = {
        schemaVersion: 1,
        runner: 'node',
        runId: randomUUID(),
        mode: config.mode,
        network: config.network,
        handler: source.handler,
        source: source.source,
        host,
        platformMismatch: Boolean(platformMismatch),
        timeoutMs: config.timeoutMs,
        maxLogBytes: config.maxLogBytes,
        measurements: {
            setupMs: performance.now() - setupStarted,
            logs: 'stdout/stderr observed during this attempt; background origins are not tracked and may belong to earlier warm requests.',
            init: 'Child boot/import through ready, including one event-loop turn and log flush; 0 for warm reuse; null if init never completed.',
            invoke: 'Handler call through await and JSON result conversion; failed termination uses parent elapsed invocation time.',
            cleanup:
                'Session disposal duration is reported separately in cleanup.durationMs; pipe closure is bounded to 250 ms after termination. Null while a warm session remains reusable.',
            total: 'Parent attempt start through outcome, including process creation/init/IPC but excluding artifact setup and final process reaping.',
        },
        limitations: limits,
        runs: [],
    };
    let session;
    try {
        for (let index = 0; index < config.runs; index++) {
            const started = performance.now();
            const cold = config.mode === 'cold' || !session?.usable;
            if (cold) {
                if (session) await session.stop();
                session = new Session({ ...config, root: source.root, handler: source.handler });
            }
            const result = await session.invoke(config.events[index % config.events.length], cold, started);
            report.runs.push(result);
            if (config.mode === 'cold') result.cleanup = await session.stop();
        }
        return report;
    } finally {
        if (session) {
            const cleanup = await session.stop();
            const last = report.runs.at(-1);
            if (last?.sessionId === session.sessionId && last.cleanup === null) last.cleanup = cleanup;
        }
        await source.cleanup();
    }
}
