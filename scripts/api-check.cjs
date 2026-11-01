#!/usr/bin/env node
/**
 * `scripts/api-check.cjs`
 * - public-name gate (v5): compare the current root public names of the build
 *   (`scripts/api-names.cjs --out -`) with the baseline file.
 * - prints added (`+`) and removed (`-`) lines.
 * - a line is `<name>\t<value|type|value+type>`, so a kind change shows as one `-` and one `+`.
 * - allow list (`etc/api-names.allow.txt`): one `-Name` or `+Name` per line, `#` starts a comment.
 *   exit 0 if every difference is in the allow list, else exit 1 and print the lines not allowed.
 *
 * usage:
 * ```sh
 * $ npm run build
 * $ node scripts/api-check.cjs                      # against etc/api-names.v4.txt + etc/api-names.allow.txt
 * $ node scripts/api-check.cjs --base etc/other.txt # against another baseline
 * $ node scripts/api-check.cjs --allow etc/x.txt    # with another allow list
 * ```
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// package root and CLI arguments.
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
// value of `--<flag> <value>`, or the default.
const argOf = (flag, def) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : def);
const base = argOf('--base', 'etc/api-names.v4.txt');
const allow = argOf('--allow', 'etc/api-names.allow.txt');
const baseFile = path.resolve(root, base);
// the baseline is required.
if (!fs.existsSync(baseFile)) {
    console.error(`! not found: ${base}`);
    process.exit(1);
}

// split into non-empty lines.
const toLines = text => text.split('\n').filter(l => l.length > 0);
// current public names of the build.
const current = toLines(
    execFileSync(process.execPath, [path.join(__dirname, 'api-names.cjs'), '--out', '-'], {
        cwd: root,
        encoding: 'utf8',
    }),
);
const baseline = toLines(fs.readFileSync(baseFile, 'utf8'));

// read the allow list as a set of `-Name` / `+Name` (missing file = empty list).
const readAllow = file => {
    const full = path.resolve(root, file);
    if (!fs.existsSync(full)) return new Set();
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    return new Set(lines.map(l => l.replace(/#.*$/, '').trim()).filter(l => /^[-+]\S+$/.test(l)));
};
const allowed = readAllow(allow);

// diff by line: removed from the baseline, added in the current build.
const cur = new Set(current);
const old = new Set(baseline);
const added = current.filter(l => !old.has(l));
const removed = baseline.filter(l => !cur.has(l));

// a diff line is allowed when `<sign><name>` is in the allow list (the kind is not compared).
const nameOf = line => line.split('\t')[0];
const diff = [...removed.map(l => `-${nameOf(l)}`), ...added.map(l => `+${nameOf(l)}`)];
const notAllowed = diff.filter(d => !allowed.has(d));

removed.forEach(l => console.log(`- ${l}`));
added.forEach(l => console.log(`+ ${l}`));
console.log(
    `api-check: ${base} base=${baseline.length} current=${current.length} added=${added.length} removed=${removed.length} allow=${allowed.size} not-allowed=${notAllowed.length}`,
);
// print the differences that the allow list does not cover.
notAllowed.forEach(d => console.log(`! not allowed: ${d}`));
process.exit(notAllowed.length ? 1 : 0);
