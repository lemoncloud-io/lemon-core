#!/usr/bin/env node
/**
 * `scripts/dup-decls.cjs`
 * - v5 B3 definition-count gate (SPEC § 4.11 gate 5): one definition per exported name.
 * - scans every top-level `export` declaration (const/let/var, function, class, interface, type, enum)
 *   in the non-spec `src/**\/*.ts` files with the TypeScript parser. Re-export lines (`export { … } from`,
 *   `export *`) and `export default` are not declarations, so they are not counted.
 * - prints every name declared in 2 or more files.
 * - exit 1 if (a) a duplicated name is not in `L1_ONLY` (L1-vs-L1 pairs kept out of B3, SPEC § 4.1), or
 *   (b) one of the B3 names (`B3_NAMES`: the 20 pair names + `AggrResult`) is not declared in exactly 1 file.
 *
 * usage:
 * ```sh
 * $ node scripts/dup-decls.cjs
 * ```
 */
const fs = require('fs');
const path = require('path');

// package root; the parser comes from the repo's own devDependency.
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules', 'typescript'));

// L1-vs-L1 duplicates that SPEC § 4.1 keeps out of B3 (different bodies, or an alias).
const L1_ONLY = ['ConfigService', 'buildResponse', 'success', 'failure', 'notfound'];

// the 20 pair names B3 reduces to one definition (13 types, `$T`, parse ×2, `onlyDefined`, `sourceToItem`, `Filter`/`marshal`) + `AggrResult`.
const B3_NAMES = [
    ...['IdentityToken', 'IdentityTokenSite', 'IdentityTokenUser', 'IdentityTokenGroup', 'ListResult'],
    ...['PaginatedListResult', 'AggrKeyCount', 'ListParam', 'PaginateParam', 'BulkUpdateBody'],
    ...['BulkBody', 'BodyList', 'BulkItemsResult', 'AggrResult'],
    ...['$T', 'parseListParam', 'parsePaginateParam', 'onlyDefined', 'sourceToItem', 'Filter', 'marshal'],
];

// all non-spec `.ts` files under `src/` (sorted for a stable output).
const walk = d =>
    fs
        .readdirSync(d, { withFileTypes: true })
        .flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(path.join(root, 'src'))
    .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts'))
    .sort();

// name -> [{ file, line, kind }]
const byName = {};
let total = 0;
// record one exported declaration.
const add = (name, file, line, kind) => {
    (byName[name] = byName[name] || []).push({ file: path.relative(root, file), line, kind });
    total++;
};

// collect the top-level exported declarations of each file.
for (const f of files) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    const lineOf = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    for (const st of sf.statements) {
        const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) || [] : [];
        if (!mods.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (mods.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, f, lineOf(d), 'const');
        } else if (st.name && ts.isIdentifier(st.name)) {
            add(st.name.text, f, lineOf(st), ts.SyntaxKind[st.kind].replace('Declaration', ''));
        }
    }
}

// names declared in 2 or more distinct files.
const fileCount = name => new Set((byName[name] || []).map(x => x.file)).size;
const dups = Object.keys(byName)
    .filter(n => fileCount(n) > 1)
    .sort();
for (const n of dups) console.log(`${n}\t${byName[n].map(x => `${x.file}:${x.line}(${x.kind})`).join('  ')}`);

// check (a): only the L1-only pairs may stay duplicated.
const notAllowed = dups.filter(n => !L1_ONLY.includes(n));
// check (b): each B3 name has exactly one declaring file.
const notSingle = B3_NAMES.filter(n => fileCount(n) !== 1);

console.log(
    `dup-decls: files=${files.length} decls=${total} dup-names=${dups.length} not-allowed=${notAllowed.length} b3-names=${B3_NAMES.length} b3-not-single=${notSingle.length}`,
);
if (notAllowed.length) console.log(`! not allowed: ${notAllowed.join(', ')}`);
if (notSingle.length) console.log(`! not single: ${notSingle.map(n => `${n}(${fileCount(n)})`).join(', ')}`);
process.exit(notAllowed.length || notSingle.length ? 1 : 0);
