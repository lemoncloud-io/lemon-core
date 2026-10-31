import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { get } from 'node:http';
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { lookup as promiseLookup, Resolver } from 'node:dns/promises';
export async function lambda() {
    const operations = {
        net: () => connect({ host: '127.0.0.1', port: 1 }), tls: () => tlsConnect({ host: '127.0.0.1', port: 1 }),
        http: () => get('http://127.0.0.1:1'), https: () => request('https://127.0.0.1:1'),
        dns: () => lookup('localhost', () => {}), dnsPromise: () => promiseLookup('localhost'),
        resolver: () => new Resolver().resolve4('localhost'), fetch: () => fetch('http://127.0.0.1:1'),
    };
    const result = {};
    for (const [name, operation] of Object.entries(operations)) {
        try { await operation(); result[name] = 'NOT_BLOCKED'; } catch (error) { result[name] = error.code; }
    }
    return result;
}
