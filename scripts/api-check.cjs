#!/usr/bin/env node
/**
 * `scripts/api-check.cjs`
 * - public-name gate (v5): compare the current root public names of the build
 *   (`scripts/api-names.cjs --out -`) with the baseline file.
 * - prints added (`+`) and removed (`-`) lines; exit 1 if there is any difference.
 * - a line is `<name>\t<value|type|value+type>`, so a kind change shows as one `-` and one `+`.
 *
 * usage:
 * ```sh
 * $ npm run build
 * $ node scripts/api-check.cjs                      # against etc/api-names.v4.txt
 * $ node scripts/api-check.cjs --base etc/other.txt # against another baseline
 * ```
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1] : 'etc/api-names.v4.txt';
const baseFile = path.resolve(root, base);
if (!fs.existsSync(baseFile)) {
    console.error(`! not found: ${base}`);
    process.exit(1);
}

const toLines = text => text.split('\n').filter(l => l.length > 0);
const current = toLines(
    execFileSync(process.execPath, [path.join(__dirname, 'api-names.cjs'), '--out', '-'], {
        cwd: root,
        encoding: 'utf8',
    }),
);
const baseline = toLines(fs.readFileSync(baseFile, 'utf8'));

const cur = new Set(current);
const old = new Set(baseline);
const added = current.filter(l => !old.has(l));
const removed = baseline.filter(l => !cur.has(l));

removed.forEach(l => console.log(`- ${l}`));
added.forEach(l => console.log(`+ ${l}`));
console.log(
    `api-check: ${base} base=${baseline.length} current=${current.length} added=${added.length} removed=${removed.length}`,
);
process.exit(added.length || removed.length ? 1 : 0);
