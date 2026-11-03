/**
 * `bin/lib/optional-peer.mjs` (lemon-core)
 * - load an optional peer dependency (ex: `@aws-sdk/client-lambda`) only when a tool needs it.
 * - a missing peer becomes an error that says `npm i -D <pkg>`.
 */
//* v5 B19: guarded loader of the optional peers of the deploy tools.
export const installHint = name => `Optional peer ${name} is missing; run: npm i -D ${name}`;

// true when `error` says that the package `name` itself cannot be found.
const isMissing = (error, name) =>
    ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error?.code) && String(error?.message).includes(name);

//* v5 B19: throw `makeError(hint)` when `name` does not resolve from lemon-core (no import, no side effect).
export function assertPeer(name, makeError = hint => new Error(hint)) {
    try {
        import.meta.resolve(name);
    } catch (error) {
        if (isMissing(error, name) || error?.code === 'ERR_MODULE_NOT_FOUND') throw makeError(installHint(name));
        throw error;
    }
}

//* v5 B19: `import(name)`, or throw `makeError(hint)` when the package is not installed.
export async function importPeer(name, makeError = hint => new Error(hint), loader = n => import(n)) {
    try {
        return await loader(name);
    } catch (error) {
        if (isMissing(error, name)) throw makeError(installHint(name));
        throw error;
    }
}
