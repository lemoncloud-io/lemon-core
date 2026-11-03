#!/usr/bin/env node
/**
 * `scripts/api-names.cjs`
 * - list the root public names of the built package (`dist/index.d.ts`).
 * - output: one line per name, `<name>\t<value|type|value+type>`, sorted by name.
 * - used as the v5 public-name baseline (B0-a) and the diff gate for later bundles.
 *
 * usage:
 * ```sh
 * $ npm run build
 * $ node scripts/api-names.cjs                 # writes etc/api-names.v4.txt
 * $ node scripts/api-names.cjs --out -         # print to stdout
 * $ node scripts/api-names.cjs --out etc/x.txt # write to another file
 * ```
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'etc/api-names.v4.txt';
const entry = path.join(root, 'dist', 'index.d.ts');
if (!fs.existsSync(entry)) {
    console.error(`! not found: dist/index.d.ts (run \`npm run build\` first)`);
    process.exit(1);
}

const program = ts.createProgram([entry], { declaration: true, noEmit: true, skipLibCheck: true });
const checker = program.getTypeChecker();
const source = program.getSourceFile(entry);
const moduleSymbol = checker.getSymbolAtLocation(source);
if (!moduleSymbol) {
    console.error(`! no module symbol for dist/index.d.ts`);
    process.exit(1);
}

const kindOf = sym => {
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const flags = target.flags;
    const isValue = (flags & ts.SymbolFlags.Value) !== 0;
    const isType = (flags & (ts.SymbolFlags.Type | ts.SymbolFlags.Namespace)) !== 0;
    if (isValue && isType) return 'value+type';
    if (isValue) return 'value';
    if (isType) return 'type';
    return 'unknown';
};

const lines = checker
    .getExportsOfModule(moduleSymbol)
    .map(sym => `${sym.getName()}\t${kindOf(sym)}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const text = lines.join('\n') + '\n';
if (out === '-') {
    process.stdout.write(text);
} else {
    const file = path.resolve(root, out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    const count = k => lines.filter(l => l.endsWith(`\t${k}`)).length;
    console.log(
        `api-names: ${lines.length} names (value ${count('value')}, value+type ${count('value+type')}, type ${count('type')}, unknown ${count('unknown')}) -> ${out}`,
    );
}
