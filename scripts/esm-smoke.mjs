#!/usr/bin/env node
/**
 * `scripts/esm-smoke.mjs`
 * - v5 B1 smoke: the ESM entry and the CJS entry of `lemon-core` are the same instance.
 * - resolves the package by its own name (Node self-reference, needs `exports` in package.json),
 *   so it checks the published entry points, not the source.
 * - exit 1 on the first failed group; prints `names=<n>` on success.
 *
 * usage:
 * ```sh
 * $ npm run build
 * $ npm run esm:smoke
 * ```
 */
import { createRequire } from 'node:module';

// CJS `require` for this ESM file, to load the same package both ways.
const require = createRequire(import.meta.url);
// failed check names (with details).
const fails = [];
// record a failure when `ok` is false.
const check = (name, ok, info = '') => {
    if (!ok) fails.push(`${name}${info ? ` (${info})` : ''}`);
};
// true if both key lists hold the same names.
const sameSet = (a, b) => a.length === b.length && a.every(k => b.includes(k));

//* 1. root: ESM import vs CJS require
const esm = await import('lemon-core');
const cjs = require('lemon-core');

check('esm.$engine === cjs.$engine', esm.$engine !== undefined && esm.$engine === cjs.$engine);
check('esm.default === cjs.default', esm.default !== undefined && esm.default === cjs.default);

const esmKeys = Object.keys(esm).sort();
const cjsKeys = Object.keys(cjs).sort();
const missing = cjsKeys.filter(k => !esmKeys.includes(k));
const extra = esmKeys.filter(k => !cjsKeys.includes(k));
check('keys(esm) == keys(cjs)', sameSet(esmKeys, cjsKeys), `missing=${missing.join(',')} extra=${extra.join(',')}`);
const differ = cjsKeys.filter(k => k in esm && esm[k] !== cjs[k]);
check('esm[k] === cjs[k] for every key', differ.length === 0, `differ=${differ.join(',')}`);

//* 2. engine modules: one each on the shared $engine
for (const name of ['aws', 'config', 'protocol', 'lambda']) {
    const mod = cjs.$engine.module(name);
    check(`$engine.module('${name}')`, !!mod && mod.getModuleName() === name);
    const count = cjs.$engine.mods ? cjs.$engine.mods.filter(m => m.getModuleName() === name).length : 1;
    check(`$engine module '${name}' registered once`, count === 1, `count=${count}`);
}

//* 3. sub-paths: import() and require() resolve
// sub-path entries declared in the `exports` map.
const SUBPATHS = [
    'lemon-core/testing',
    'lemon-core/dist/environ',
    'lemon-core/dist/extended/cores',
    'lemon-core/dist/cores/lambda/lambda-web-handler',
];
for (const p of SUBPATHS) {
    let viaImport = null;
    let viaRequire = null;
    try {
        viaImport = await import(p);
    } catch (e) {
        check(`import('${p}')`, false, e.code || e.message);
    }
    try {
        viaRequire = require(p);
    } catch (e) {
        check(`require('${p}')`, false, e.code || e.message);
    }
    if (viaImport && viaRequire) {
        //* every named value of the import side is the same object as the require side.
        const keys = Object.keys(viaImport).filter(k => k !== 'default' && k !== 'module.exports');
        const notSame = keys.filter(k => viaImport[k] !== viaRequire[k]);
        check(
            `'${p}' import === require`,
            keys.length > 0 && notSame.length === 0,
            `keys=${keys.length} differ=${notSame.join(',')}`,
        );
    }
}

//* 4. ./testing: the ESM wrapper gives the same helpers as the root re-export.
const testing = await import('lemon-core/testing');
check('testing.expect2 === cjs.expect2', typeof testing.expect2 === 'function' && testing.expect2 === cjs.expect2);

//* 5. report: print each failure and exit 1, else print the name count.
if (fails.length) {
    fails.forEach(f => console.error(`! esm-smoke FAIL: ${f}`));
    process.exit(1);
}
console.log(`esm-smoke: ok names=${esmKeys.length} subpaths=${SUBPATHS.length}`);
process.exit(0); // do not wait for clients created at import time
