#!/usr/bin/env node
/**
 * `scripts/os2-lazy-probe.cjs`
 * - v5 B2-b load probe (SPEC § 3.4.7-2): `$OS2` builds nothing at import.
 * - counts OpenSearch `Client` constructions by swapping the module's `Client` for a counting subclass
 *   BEFORE `require('../dist/index')` (the build reads `.Client` from the cached module at call time).
 * - the module counts come from a separate clean child process (`require('../dist/index')` only),
 *   because the swap above loads the client package in this process (lemon-core loads it on first client use).
 * - prints counts only: no env values, no hosts.
 *
 * usage (clean env; the endpoint is a fake host and is never contacted):
 * ```sh
 * $ npm run build
 * $ env -i PATH=$PATH HOME=$HOME OS2_ENDPOINT=https://example.invalid node scripts/os2-lazy-probe.cjs
 * ```
 */
const path = require('path');
const { execFileSync } = require('child_process');

// module counts of a plain `require('../dist/index')` in a child process (same env, no pre-load).
const plain = JSON.parse(
    execFileSync(
        process.execPath,
        [
            '-e',
            `require(${JSON.stringify(path.resolve(__dirname, '../dist/index'))});` +
                `const c=Object.keys(require.cache);` +
                `process.stdout.write('\\n'+JSON.stringify({total:c.length,os:c.filter(p=>p.includes('@opensearch-project')).length,es:c.filter(p=>p.includes('@elastic')).length}))`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
        .trim()
        .split('\n')
        .pop(),
);

// count every client built from now on.
const os = require('@opensearch-project/opensearch');
let clients = 0;
const Base = os.Client;
os.Client = class CountingClient extends Base {
    // count, then build as usual.
    constructor(opts) {
        super(opts);
        clients++;
    }
};

// load the build (the same entry as `require('lemon-core')`).
const lc = require(path.resolve(__dirname, '../dist/index'));
// the dynamo-stream registry that every synchronizer adds a listener to.
const dynamos = lc.default.cores.lambda.dynamos;
// listener count of the registry (protected field, read for the probe only).
const listeners = () => (dynamos.listeners || []).length;
// loaded modules whose path has `@elastic/`.
const elasticModules = () =>
    Object.keys(require.cache).filter(p => p.includes(`${path.sep}@elastic${path.sep}`)).length;

const out = [];
// 1. right after import: nothing built.
out.push(['clients.import', clients]);
out.push(['elastic.modules', elasticModules()]);
// plain import (child process): total modules, client package files (0 = not loaded), `@elastic` files.
out.push(['import.modules', plain.total]);
out.push(['import.opensearch', plain.os]);
out.push(['import.elastic', plain.es]);
out.push(['listeners.import', listeners()]);
out.push(['same.object', lc.$OS2 === lc.$ES6Routed]);

// 2. first touch builds the instance (one synchronizer = one listener), still no client.
const hello = lc.$OS2.hello();
out.push(['hello', hello]);
out.push(['listeners.hello', listeners()]);
out.push(['clients.hello', clients]);

// 3. first client access builds exactly one client.
const client = lc.$OS2.elastic && lc.$OS2.elastic.client;
out.push(['client.defined', !!client]);
out.push(['clients.client', clients]);
// 4. a second access reuses it.
void (lc.$OS2.elastic && lc.$OS2.elastic.client);
out.push(['clients.again', clients]);

console.log(out.map(([k, v]) => `${k}=${v}`).join(' '));
