#!/usr/bin/env node
/**
 * `scripts/l1l2-probe.cjs`
 * - v5 B3 identity and deep-path gate (SPEC § 4.11 gate 7), run on the built `dist/`.
 * - identity: the root, the L1 file and the L2 file give the very same object for `$T`, `onlyDefined`,
 *   `sourceToItem`, `marshal`, `parseListParam`, `parsePaginateParam` (one definition each).
 * - `$T` has 32 members and the merged `S2`/`SS`/`US` behave as the L2 ones (SPEC § 4.10).
 * - the 11 deep paths of SPEC § 4.0 resolve through the package `exports` (self-reference by name).
 * - the 2 `cores/elastic` shims (old ES-era file names) export the same symbols as the renamed files.
 * - prints one line per check and a summary; exit 1 on any failure. No env values, hosts, or paths.
 *
 * usage:
 * ```sh
 * $ npm run build
 * $ node scripts/l1l2-probe.cjs
 * ```
 */
const path = require('path');

// silence the library logs (LOG SILENT), the same switch the tests use.
process.env.LS = process.env.LS || '1';

// package root, its name (for self-reference), and a loader for `dist/<rel>`.
const root = path.resolve(__dirname, '..');
const NAME = require(path.join(root, 'package.json')).name;
const dist = rel => require(path.join(root, 'dist', rel));

let fails = 0;
let checks = 0;
// record and print one check.
const check = (label, ok, extra = '') => {
    checks++;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` ${extra}` : ''}`);
};
// the same object across every module given.
const same = (name, mods) => mods.every(([, m]) => m[name] !== undefined && m[name] === mods[0][1][name]);

// the modules to compare (root, L1 files, L2 files).
const M = {
    root: dist('index'),
    helpers: dist('helpers/helpers'),
    testHelper: dist('common/test-helper'),
    commons: dist('extended/cores/commons'),
    abstractService: dist('extended/abstract-service'),
    abstractServices: dist('extended/cores/abstract-services'),
    configService: dist('cores/config/config-service'),
};

// 1) identity of each merged name across its homes.
const IDENTITY = [
    ['$T', ['root', 'helpers', 'commons']],
    ['onlyDefined', ['root', 'testHelper', 'commons']],
    ['sourceToItem', ['root', 'abstractService', 'abstractServices']],
    ['marshal', ['root', 'testHelper', 'configService']],
    ['parseListParam', ['root', 'helpers', 'commons']],
    ['parsePaginateParam', ['root', 'helpers', 'commons']],
];
for (const [name, homes] of IDENTITY) check(`identity ${name} (${homes.join(' === ')})`, same(name, homes.map(h => [h, M[h]])));

// 2) the single `$T`: 32 members, and the L2 bodies of `S2`/`SS`/`US` (SPEC § 4.9 probe values).
const $T = M.root.$T;
check('$T members === 32', Object.keys($T).length === 32, `(${Object.keys($T).length})`);
check(`$T.S2('a b  c','','-') === 'a b c'`, $T.S2('a b  c', '', '-') === 'a b c');
check(`$T.SS(null,['x']) => []`, JSON.stringify($T.SS(null, ['x'])) === '[]');
check(`$T.SS([' a  b ']) => ['a b']`, JSON.stringify($T.SS([' a  b '])) === '["a b"]');
check(`$T.US(['a','b','a']) => ['a','b']`, JSON.stringify($T.US(['a', 'b', 'a'])) === '["a","b"]');

// 3) the deep paths of SPEC § 4.0 (inventory § 2.4) resolve through `exports`.
const DEEP = [
    'dist/helpers/types',
    'dist/helpers/helpers',
    'dist/helpers/index',
    'dist/common/test-helper',
    'testing',
    'dist/extended/cores',
    'dist/extended/cores/commons',
    'dist/extended/cores/types',
    'dist/extended/cores/abstract-services',
    'dist/extended/abstract-service',
    'dist/cores/config/config-service',
];
for (const p of DEEP) {
    let ok = true;
    let keys = 0;
    try {
        keys = Object.keys(require(`${NAME}/${p}`)).length;
    } catch (e) {
        ok = false;
    }
    check(`require ${NAME}/${p}`, ok, `(keys=${keys})`);
}

// 4) the deep paths keep the B3 names (re-exports in the losing files).
const KEEP = [
    ['dist/extended/cores/commons', ['$T', 'onlyDefined', 'parseListParam', 'parsePaginateParam']],
    ['dist/helpers/helpers', ['$T', 'parseListParam', 'parsePaginateParam']],
    ['dist/extended/cores/abstract-services', ['sourceToItem']],
    ['dist/cores/config/config-service', ['marshal']],
];
for (const [p, names] of KEEP) {
    const m = require(`${NAME}/${p}`);
    const missing = names.filter(n => m[n] === undefined);
    check(`names on ${NAME}/${p}`, !missing.length, missing.length ? `(missing ${missing.join(',')})` : `(${names.length})`);
}

// 5) each shim exports exactly the symbols of the renamed file.
const SHIMS = [
    ['dist/cores/elastic/elastic6-service', 'dist/cores/elastic/os2-service'],
    ['dist/cores/elastic/elastic6-query-service', 'dist/cores/elastic/os2-query-service'],
];
for (const [oldPath, newPath] of SHIMS) {
    const a = require(`${NAME}/${oldPath}`);
    const b = require(`${NAME}/${newPath}`);
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    const ok = ka.length > 0 && ka.join() === kb.join() && ka.every(k => a[k] === b[k]);
    check(`shim ${oldPath} === ${newPath}`, ok, `(keys=${ka.length}/${kb.length})`);
}

// summary line and exit code.
console.log(`l1l2-probe: checks=${checks} fails=${fails} root-keys=${Object.keys(M.root).length}`);
process.exit(fails ? 1 : 0);
