/** Private fork/IPC worker. Never import handler code in the parent process. */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { denyNetwork } from './local-network.mjs';

let handler,
    config,
    active = null,
    failed = false;
const send = message => {
    if (process.connected) process.send(message);
};
function serializeError(error) {
    const read = key => {
        try {
            return error?.[key] == null ? undefined : String(error[key]);
        } catch {
            return undefined;
        }
    };
    let message;
    try {
        message = read('message') ?? String(error);
    } catch {
        message = 'Unprintable thrown value';
    }
    return {
        name: read('name') ?? 'Error',
        message: message.slice(0, 65536),
        stack: (read('stack') ?? '').slice(0, 262144),
        ...(read('code') ? { code: read('code') } : {}),
    };
}
function fatal(error, kind) {
    if (failed) return;
    failed = true;
    send({ type: 'fatal', kind, requestId: active?.requestId, error: serializeError(error) });
    // The parent owns termination and reaping, including handlers with live timers.
}
process.on('uncaughtException', error => fatal(error, 'uncaughtException'));
process.on('unhandledRejection', error => fatal(error, 'unhandledRejection'));
process.on('disconnect', () => process.exit(0));
const flush = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all(
        [process.stdout, process.stderr].map(stream => new Promise(resolve => stream.write('', resolve))),
    );
};
process.on('message', async message => {
    if (failed) return;
    if (message.type === 'boot' && !config) {
        config = message.config;
        const started = performance.now();
        try {
            if (config.network === 'deny') denyNetwork();
            const mod = await import(pathToFileURL(path.join(config.root, config.handler.file)).href);
            handler = mod[config.handler.export] ?? mod.default?.[config.handler.export];
            if (config.handler.export === 'default' && typeof mod.default === 'function') handler = mod.default;
            if (typeof handler !== 'function') throw new TypeError('Handler export is not a function');
            await flush();
            if (!failed) send({ type: 'ready', initMs: performance.now() - started });
        } catch (error) {
            fatal(error, 'initError');
        }
        return;
    }
    if (message.type !== 'invoke' || !handler || active)
        return fatal(new Error('Invalid or concurrent runtime invocation'), 'protocolError');
    active = message;
    const started = performance.now();
    const context = {
        awsRequestId: message.requestId,
        functionName: config.functionName,
        functionVersion: config.functionVersion,
        invokedFunctionArn: config.functionArn,
        memoryLimitInMB: String(config.memorySize),
        logGroupName: config.logGroupName,
        logStreamName: config.logStreamName,
        getRemainingTimeInMillis: () => Math.max(0, Math.floor(message.deadline - Date.now())),
    };
    try {
        const unsupportedCallback = () => {
            throw Object.assign(new Error('Callback handlers are unsupported (Node 24 contract)'), {
                name: 'CallbackUnsupportedError',
            });
        };
        const value = await handler(message.event, context, unsupportedCallback);
        // Match JSON invocation payloads, including null for an undefined return.
        const json = JSON.stringify(value === undefined ? null : value);
        if (json === undefined) throw new TypeError('Handler result is not JSON serializable');
        if (Buffer.byteLength(json) > 6 * 1024 ** 2)
            throw new RangeError('Handler result exceeds local 6 MiB response limit');
        const result = JSON.parse(json);
        const invokeMs = performance.now() - started;
        await flush();
        if (!failed) send({ type: 'result', requestId: message.requestId, result, invokeMs });
    } catch (error) {
        const invokeMs = performance.now() - started;
        await flush();
        if (!failed) send({ type: 'result', requestId: message.requestId, error: serializeError(error), invokeMs });
        failed = true;
    } finally {
        active = null;
    }
});
