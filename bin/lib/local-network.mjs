/** Best-effort guard for trusted development code; not a security sandbox. */
import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
export function denyNetwork() {
    const blocked = () => {
        throw Object.assign(new Error('Network disabled by lambda-local development guard'), {
            code: 'LOCAL_NETWORK_DENIED',
        });
    };
    for (const [module, names] of Object.entries({
        net: ['connect', 'createConnection'],
        tls: ['connect'],
        http: ['request', 'get'],
        https: ['request', 'get'],
        dgram: ['createSocket'],
    }))
        for (const name of names) require(`node:${module}`)[name] = blocked;
    require('node:net').Socket.prototype.connect = blocked;
    require('node:net').Server.prototype.listen = blocked;
    const dns = require('node:dns');
    for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
        for (const key of Object.getOwnPropertyNames(target)) {
            if (/^(lookup|resolve|reverse)/.test(key) && typeof target[key] === 'function') target[key] = blocked;
        }
    }
    globalThis.fetch = async () => blocked();
    if (globalThis.WebSocket)
        globalThis.WebSocket = class {
            constructor() {
                blocked();
            }
        };
    syncBuiltinESMExports();
}
