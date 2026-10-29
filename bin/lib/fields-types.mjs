/**
 * `bin/lib/fields-types.mjs` (lemon-core)
 * - check that one field name has one type across the stored models of one OpenSearch index.
 *   An index has one dynamic mapping, so the first model that writes `x` fixes the type of `x`;
 *   a later model that writes `x` with another type gets a 400 `mapper_parsing_exception`.
 * - reads the declared TypeScript types only (`typescript` compiler API); nothing is compiled or run.
 * - all logic of `bin/lemon-fields-types.mjs`: no `process.exit`; the printers are injectable, so the tests run offline.
 * - imports node built-ins only; `typescript` is resolved at run time (the checked repo, `--fallback`, then lemon-core).
 * - ported from lemon-templates-api `bin/lib/fields-types.mjs` (B10-5).
 */
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';

//* v5 B10-5: `typescript` is not imported statically; `useTypeScript()` sets these two from `resolveTypeScript()`.
// the loaded `typescript` module (the one that built the current program).
let ts = null;

// type flags of that module, short.
let F = null;

// the normalized kinds that map to one OpenSearch field type.
export const SCALARS = ['string', 'number', 'boolean', 'date'];

// the kinds that take part in the conflict check (`any`, `mixed`, `dynamic`, `other(..)` do not).
export const TYPED = [...SCALARS, 'object'];

// default nesting depth of object fields (`a.b.c` is depth 2).
export const DEFAULT_DEEP = 2;

// the CoreModel shape of rule H (a declaration with all of these is a model).
export const CORE_SHAPE = ['ns', 'sid', 'uid', 'lock', 'next', 'createdAt'];

// help text for `--help`.
export const HELP = [
    'Check that one field name has one type across the stored models of one OpenSearch index.',
    '',
    'usage: lemon-fields-types [options]',
    '       npx lemon-fields-types [options]',
    '       npm run fields:types -- [options]',
    '',
    '  --root <dir>            repo to check: reads <dir>/src/**/*.ts and <dir>/tsconfig.json (default: cwd)',
    `  --deep <n>              nesting depth of object fields, 0-10 (default: ${DEFAULT_DEEP})`,
    '  --models R|RH           R = models in a `$FIELD` object (default); RH = also every CoreModel-shaped type',
    '  --fail-on <level>       hard | order | none (default: hard)',
    '  --json                  print the full report as JSON only',
    '  --with <report.json>    merge another repo report (from --json) as the same index; repeatable',
    '  --fallback <dir>        extra node_modules dir for packages the repo cannot resolve; repeatable',
    '  --help                  show this help',
    '',
    'typescript: from the checked repo (its devDependency) first, then each --fallback dir, then lemon-core itself.',
    '',
    'exit codes: 0 = no conflict at or above --fail-on; 1 = conflicts; 2 = bad arguments, no typescript, no TS program.',
];

// a bad argument, an unreadable report, or no TypeScript program (exit 2).
export class ArgError extends Error {
    // always exit code 2.
    constructor(message) {
        super(message);
        this.name = 'ArgError';
        this.code = 2;
    }
}

//* v5 B10-5: `typescript` resolution.
// the place of the tool itself (the last place `resolveTypeScript` tries).
const SELF = import.meta.url;

// resolve and load `typescript`: `<root>`, then each `--fallback` node_modules dir, then the tool's own location.
// returns `{ ts, version, from: 'root' | 'fallback' | 'self' }`; throws `ArgError` (exit 2) when none resolves.
export const resolveTypeScript = (root, fallback = [], self = SELF) => {
    const places = [
        { from: 'root', base: path.join(root, 'package.json') },
        ...fallback.map(fb => ({ from: 'fallback', base: path.join(fb, '..', 'package.json') })),
        { from: 'self', base: self },
    ];
    for (const p of places) {
        // node's own lookup from that place (its node_modules, then the parent dirs).
        const req = createRequire(p.base);
        let file;
        try {
            file = req.resolve('typescript');
        } catch {
            continue;
        }
        const mod = req(file);
        return { ts: mod, version: String(mod.version), from: p.from };
    }
    throw new ArgError(
        `cannot resolve typescript from --root ${root}, --fallback (${fallback.length} dirs), or lemon-core itself` +
            ' (add typescript to the devDependencies of the repo, or pass --fallback <node_modules>)',
    );
};

// make `m` the module of the next program and of the type helpers below.
const useTypeScript = m => {
    ts = m;
    F = m.TypeFlags;
};

// options that take a value; `with` and `fallback` repeat.
const VALUES = ['root', 'deep', 'models', 'fail-on', 'with', 'fallback'];

// options that repeat (collected into an array).
const REPEAT = ['with', 'fallback'];

// options that never take a value.
const BOOLEANS = ['json', 'help'];

// parse argv strictly into `{ root, deep, models, failOn, json, help, with: [], fallback: [] }` (throws `ArgError`).
export const parseOptions = argv => {
    const raw = { with: [], fallback: [] };
    const errors = [];
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        // only `--key` and `--key=value`; no positionals.
        if (!tok.startsWith('--')) {
            errors.push(`unknown argument ${tok} (see --help)`);
            continue;
        }
        const eq = tok.indexOf('=');
        const key = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
        // a boolean flag takes no value.
        if (BOOLEANS.includes(key) && eq < 0) {
            raw[key] = true;
            continue;
        }
        if (!VALUES.includes(key)) {
            errors.push(`unknown option ${tok} (see --help)`);
            continue;
        }
        // the value is after `=`, or the next token (which must not be an option).
        let value = eq >= 0 ? tok.slice(eq + 1) : argv[i + 1];
        if (eq < 0) {
            if (value === undefined || value.startsWith('--')) value = '';
            else i++;
        }
        if (value === '') errors.push(`--${key} needs a value`);
        else if (REPEAT.includes(key)) raw[key].push(value);
        else raw[key] = value;
    }
    // `--help` wins over argument errors.
    if (raw.help) return { help: true };
    if (errors.length) throw new ArgError(errors[0]);
    // check each value.
    const deep = raw.deep === undefined ? DEFAULT_DEEP : Number(raw.deep);
    if (!Number.isInteger(deep) || deep < 0 || deep > 10) throw new ArgError(`--deep must be 0-10 (got: ${raw.deep})`);
    const models = raw.models ?? 'R';
    if (!['R', 'RH'].includes(models)) throw new ArgError(`--models must be R or RH (got: ${models})`);
    const failOn = raw['fail-on'] ?? 'hard';
    if (!['hard', 'order', 'none'].includes(failOn)) {
        throw new ArgError(`--fail-on must be hard, order, or none (got: ${failOn})`);
    }
    const root = path.resolve(raw.root ?? '.');
    return {
        root,
        deep,
        models,
        failOn,
        json: !!raw.json,
        with: raw.with,
        fallback: raw.fallback.map(f => path.resolve(f)),
    };
};

// `src/**/*.ts` of the repo, without `*.spec.ts` / `*.test.ts` and `node_modules` (sorted).
export const listSources = root => {
    const src = path.join(root, 'src');
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new ArgError(`no src/ directory in ${root}`);
    const files = [];
    // depth-first walk.
    const walk = dir => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name !== 'node_modules') walk(p);
            } else if (/\.ts$/.test(e.name) && !/\.(spec|test)\.ts$/.test(e.name)) files.push(p);
        }
    };
    walk(src);
    if (!files.length) throw new ArgError(`no TypeScript files in ${src}`);
    return files.sort();
};

// compiler options of `<root>/tsconfig.json` (or defaults), with null checks on so `null`/`undefined` stay visible.
export const compilerOptions = root => {
    const file = path.join(root, 'tsconfig.json');
    let base = {};
    if (fs.existsSync(file)) {
        const read = ts.readConfigFile(file, ts.sys.readFile);
        if (read.error) {
            const msg = ts.flattenDiagnosticMessageText(read.error.messageText, ' ');
            throw new ArgError(`cannot read ${file} (${msg})`);
        }
        // `include`/`files` errors (no inputs) do not matter: the file list is ours.
        base = ts.parseJsonConfigFileContent(read.config, ts.sys, root).options;
    }
    // no emit, no build info, no transformer plugins.
    return {
        ...base,
        noEmit: true,
        skipLibCheck: true,
        strictNullChecks: true,
        incremental: false,
        composite: false,
        tsBuildInfoFile: undefined,
        plugins: undefined,
    };
};

// `{ file, line }` of a declaration: path relative to `root`, or `<package>:<file name>` for a package file.
export const locate = (decl, root) => {
    if (!decl) return { file: '?', line: 0 };
    const sf = decl.getSourceFile();
    const line = sf.getLineAndCharacterOfPosition(decl.getStart()).line + 1;
    const rel = path.relative(root, sf.fileName);
    // a package file: name the package (`@scope/name` or `name`) after the last `node_modules/`.
    const nm = sf.fileName.lastIndexOf('/node_modules/');
    if (nm >= 0) {
        const parts = sf.fileName.slice(nm + 14).split('/');
        const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        return { file: `${pkg}:${path.basename(sf.fileName)}`, line };
    }
    // outside the repo (ex: a `--fallback` source tree): the file name only.
    return { file: rel.startsWith('..') ? path.basename(sf.fileName) : rel, line };
};

// the type of the `$FIELD` entry call: `keys<T>()`, `fieldKeys.x<T>()`, or `fieldsOf(Class)`; else null.
const typeOfFieldsCall = (checker, call) => {
    const callee = call.expression;
    const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
        ? callee.expression.getText()
        : '';
    // `keys<T>()` and `fieldKeys.x<T>()`: the type argument.
    if ((name === 'keys' || name === 'fieldKeys') && call.typeArguments?.length) {
        return checker.getTypeFromTypeNode(call.typeArguments[0]);
    }
    // `fieldsOf(Class)`: the instance type of the class.
    if (ts.isIdentifier(callee) && callee.text === 'fieldsOf' && call.arguments[0]) {
        const s = checker.getSymbolAtLocation(call.arguments[0]);
        const target = s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
        return target ? checker.getDeclaredTypeOfSymbol(target) : null;
    }
    return null;
};

// build the TS program of `root` and collect its models.
// opts: `{ root, models: 'R'|'RH', fallback: [node_modules dirs] }`.
// rule R: a model named in a `$FIELD = { k: ... }` object literal (what the service stores and syncs).
// rule H: an interface or class with the CoreModel shape (views and heads too).
// returns `{ root, files, checker, models, found, fieldEntries, unresolved, typescript }`; `models` is the checked set.
export const collectModels = ({ root, models: rule = 'R', fallback = [] } = {}) => {
    const files = listSources(root);
    // v5 B10-5: the `typescript` of the checked repo (or a fallback); `typescript` in the result says which.
    const resolved = resolveTypeScript(root, fallback);
    useTypeScript(resolved.ts);
    const typescript = { version: resolved.version, from: resolved.from };
    const options = compilerOptions(root);
    const unresolved = new Set();
    let program;
    try {
        // module resolution: the repo first, then each `--fallback` dir.
        const host = ts.createCompilerHost(options);
        host.resolveModuleNames = (names, containing) =>
            names.map(name => {
                const own = ts.resolveModuleName(name, containing, options, ts.sys).resolvedModule;
                if (own) return own;
                for (const fb of fallback) {
                    const r = ts.resolveModuleName(name, path.join(fb, '..', 'index.ts'), options, ts.sys);
                    if (r.resolvedModule) return r.resolvedModule;
                }
                // node built-ins are ambient (`@types/node`); relative misses are not packages.
                const bare = name.replace(/^node:/, '');
                if (!name.startsWith('.') && !name.startsWith('node:') && !builtinModules.includes(bare)) {
                    unresolved.add(name);
                }
                return undefined;
            });
        program = ts.createProgram(files, options, host);
    } catch (e) {
        throw new ArgError(`cannot create the TypeScript program of ${root} (${e?.message ?? e})`);
    }
    const checker = program.getTypeChecker();
    const byKey = new Map();
    // add (or tag) one model; the key is the declaration site, so one type found twice is one model.
    const add = (type, name, site, ruleName) => {
        const sym = type.aliasSymbol ?? type.symbol;
        const decl = sym?.declarations?.[0];
        const at = decl ? locate(decl, root) : site;
        const key = `${at.file}:${at.line}#${sym?.name ?? name}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                name: sym?.name ?? name,
                file: at.file,
                line: at.line,
                rules: [],
                type,
                checker,
                root,
                ts,
            });
        }
        const m = byKey.get(key);
        if (!m.rules.includes(ruleName)) m.rules.push(ruleName);
    };
    let fieldEntries = 0;
    const own = new Set(files.map(f => path.resolve(f)));
    for (const sf of program.getSourceFiles()) {
        if (!own.has(path.resolve(sf.fileName))) continue;
        // walk every node of the file.
        const visit = node => {
            // rule R: each property of `$FIELD = { k: <... fields call ...> }`.
            if (
                ts.isVariableDeclaration(node) &&
                node.name.getText() === '$FIELD' &&
                node.initializer &&
                ts.isObjectLiteralExpression(node.initializer)
            ) {
                for (const prop of node.initializer.properties) {
                    if (!ts.isPropertyAssignment(prop)) continue;
                    // the first fields call inside the entry (ex: inside `filterFields(...)`).
                    const find = n =>
                        (ts.isCallExpression(n) && typeOfFieldsCall(checker, n)) || ts.forEachChild(n, find);
                    const t = find(prop.initializer);
                    if (t) {
                        fieldEntries++;
                        add(t, prop.name.getText(), locate(prop, root), 'R');
                    }
                }
            }
            // rule H: an interface or class with the CoreModel shape.
            if ((ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
                const t = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(node.name));
                if (CORE_SHAPE.every(k => checker.getPropertyOfType(t, k)))
                    add(t, node.name.text, locate(node, root), 'H');
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    const found = [...byKey.values()];
    // R by default; a repo with no `$FIELD` entry falls back to H, so it is not an empty pass.
    const checked = found.filter(m => rule === 'RH' || m.rules.includes('R') || !fieldEntries);
    return {
        root,
        files,
        checker,
        models: checked,
        found,
        fieldEntries,
        unresolved: [...unresolved].sort(),
        typescript,
    };
};

// normalize one TS type to the kind OpenSearch maps it to:
// string | number | boolean | date | object | any | mixed | other(<type>).
export const normalizeType = (checker, type, depth = 0) => {
    if (depth > 8) return 'any';
    // no type information.
    if (type.flags & (F.Any | F.Unknown | F.Never)) return 'any';
    // a type parameter: its constraint.
    if (type.flags & F.TypeParameter) {
        const c = checker.getBaseConstraintOfType(type);
        return c && c !== type ? normalizeType(checker, c, depth + 1) : 'any';
    }
    // a union: drop null/undefined/void; one kind left is that kind, more is mixed.
    if (type.isUnion()) {
        const kinds = new Set(
            type.types
                .filter(x => !(x.flags & (F.Null | F.Undefined | F.Void)))
                .map(x => normalizeType(checker, x, depth + 1)),
        );
        const parts = [...kinds];
        return parts.includes('any') || !parts.length ? 'any' : parts.length === 1 ? parts[0] : 'mixed';
    }
    // scalars, literals and enums included.
    if (type.flags & F.StringLike) return 'string';
    if (type.flags & (F.NumberLike | F.BigIntLike)) return 'number';
    if (type.flags & F.BooleanLike) return 'boolean';
    // an array or tuple: the element kind (OpenSearch has no array type).
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
        const parts = [...new Set(checker.getTypeArguments(type).map(x => normalizeType(checker, x, depth + 1)))];
        return parts.length === 1 ? parts[0] : parts.includes('any') || !parts.length ? 'any' : 'mixed';
    }
    // `Date` is a date field, not an object.
    if (type.symbol?.name === 'Date') return 'date';
    // objects, intersections, and the `object` keyword.
    if (type.flags & (F.Object | F.NonPrimitive) || type.isIntersection()) return 'object';
    return `other(${checker.typeToString(type)})`;
};

// a stored top-level name: what `filterFields` keeps and `$U.cleanup` does not drop (`_*`, `$*`).
export const isStored = name => name !== '_id' && /^[a-z_][a-zA-Z_]+/.test(name) && !name.startsWith('_');

// the properties of an object field to flatten (`{ dyn: true }` for an index signature).
const objectProps = (checker, type) => {
    const members = type.isUnion() ? type.types.filter(x => !(x.flags & (F.Null | F.Undefined))) : [type];
    const out = [];
    for (const m0 of members) {
        // an array of objects: its element.
        const m = checker.isArrayType(m0) ? checker.getTypeArguments(m0)[0] : m0;
        if (!m || !(m.flags & F.Object) || m.symbol?.name === 'Date') continue;
        if (checker.getIndexInfosOfType(m).length) out.push({ dyn: true });
        for (const p of checker.getPropertiesOfType(m)) out.push({ p });
    }
    return out;
};

// the fields of one model, flattened to dotted paths up to `deep`: `[{ name, type, file, line }]`.
// an index signature gives `<path>.*` with type `dynamic` (dynamic keys are not checked).
// `model` comes from `collectModels` (it carries `type`, `checker`, and `root`).
export const flattenFields = (model, deep = DEFAULT_DEEP) => {
    const { checker, root } = model;
    // v5 B10-5: the type helpers use the `typescript` that built this model's checker.
    if (model.ts) useTypeScript(model.ts);
    const out = [];
    // one level: top-level properties, or the members of an object field.
    const walk = (type, prefix, depth, parent) => {
        const props = prefix ? objectProps(checker, type) : checker.getPropertiesOfType(type).map(p => ({ p }));
        for (const { p, dyn } of props) {
            if (dyn) {
                out.push({ name: `${prefix}.*`, type: 'dynamic', ...parent });
                continue;
            }
            if (!prefix && !isStored(p.name)) continue;
            const name = prefix ? `${prefix}.${p.name}` : p.name;
            const decl = p.valueDeclaration ?? p.declarations?.[0];
            const t = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
            let kind = normalizeType(checker, t);
            // a generic default `any` (ex: `S extends string = any`): the declared type node instead.
            if (kind === 'any' && decl?.type) kind = normalizeType(checker, checker.getTypeFromTypeNode(decl.type));
            const at = locate(decl, root);
            out.push({ name, type: kind, ...at });
            if (kind === 'object' && depth < deep) walk(t, name, depth + 1, at);
        }
    };
    walk(model.type, '', 0, null);
    return out;
};

// severity of two different kinds (from the local OpenSearch 2.17 probe):
// hard = the second write fails in both orders; order = it fails only when the stricter kind is mapped first.
export const severityOf = (a, b) => {
    // object vs a scalar fails both ways.
    if (a === 'object' || b === 'object') return 'hard';
    const pair = [a, b].sort().join('|');
    // boolean vs number (and boolean vs date) fails both ways.
    if (pair === 'boolean|number' || pair === 'boolean|date') return 'hard';
    // string|number, string|boolean, date|string, date|number: order-dependent.
    return 'order';
};

// `<Model>` or `<repo>:<Model>` of a declaration.
const label = d => (d.repo ? `${d.repo}:${d.model}` : d.model);

// find the conflicts in models with flattened fields: `models = [{ name, repo?, fields: [{ name, type, file, line }] }]`.
// returns `{ conflicts: [{ name, severity, decls: [{ model, type, file, line }] }], any, mixed, other, unresolved }`.
export const findConflicts = (models, unresolved = []) => {
    const byName = new Map();
    const any = [];
    const mixed = [];
    const other = [];
    // group declarations by field path; keep the untyped ones apart.
    for (const m of models) {
        for (const f of m.fields || []) {
            const d = { model: m.name, type: f.type, file: f.file, line: f.line, ...(m.repo ? { repo: m.repo } : {}) };
            if (f.type === 'dynamic') continue;
            if (f.type === 'any') any.push({ name: f.name, ...d });
            else if (f.type === 'mixed') mixed.push({ name: f.name, ...d });
            else if (!TYPED.includes(f.type)) other.push({ name: f.name, ...d });
            else {
                if (!byName.has(f.name)) byName.set(f.name, []);
                byName.get(f.name).push(d);
            }
        }
    }
    const conflicts = [];
    // a conflict: two or more kinds under one name; hard if any pair of kinds is hard.
    for (const [name, decls] of byName) {
        const kinds = [...new Set(decls.map(d => d.type))];
        if (kinds.length < 2) continue;
        let severity = 'order';
        for (let i = 0; i < kinds.length; i++) {
            for (let j = i + 1; j < kinds.length; j++) if (severityOf(kinds[i], kinds[j]) === 'hard') severity = 'hard';
        }
        conflicts.push({ name, severity, decls });
    }
    // hard first, then by name.
    conflicts.sort((a, b) =>
        a.severity === b.severity ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.severity === 'hard' ? -1 : 1,
    );
    return { conflicts, any, mixed, other, unresolved: [...unresolved] };
};

// distinct field paths of the models (without the `dynamic` `.*` paths).
const countFields = models => {
    const names = new Set();
    for (const m of models) for (const f of m.fields || []) if (f.type !== 'dynamic') names.add(f.name);
    return names.size;
};

// the report of one repo: collect, flatten, and check.
// opts: `{ root, deep, models, fallback }`; returns a JSON-safe object (the `--json` output).
export const checkRepo = ({ root, deep = DEFAULT_DEEP, models: rule = 'R', fallback = [] }) => {
    const c = collectModels({ root, models: rule, fallback });
    // flatten each checked model; drop the TS objects so the report is plain JSON.
    const models = c.models.map(m => ({
        name: m.name,
        file: m.file,
        line: m.line,
        rules: m.rules,
        fields: flattenFields(m, deep),
    }));
    const found = findConflicts(models, c.unresolved);
    return {
        repo: path.basename(root),
        deep,
        rule,
        typescript: c.typescript,
        files: c.files.length,
        fieldEntries: c.fieldEntries,
        modelsFound: c.found.length,
        fields: countFields(models),
        models,
        ...found,
    };
};

// merge repo reports (from `checkRepo` or `--json`) as one index: same name, other type is a conflict.
export const mergeReports = reports => {
    const repos = reports.map(r => r.repo);
    // tag each model with its repo so the lines show where it is.
    const models = reports.flatMap(r => (r.models || []).map(m => ({ ...m, repo: m.repo ?? r.repo })));
    const unresolved = [...new Set(reports.flatMap(r => r.unresolved || []))].sort();
    const found = findConflicts(models, unresolved);
    return {
        repo: repos.join('+'),
        repos,
        deep: reports[0]?.deep ?? DEFAULT_DEEP,
        rule: reports[0]?.rule ?? 'R',
        // v5 B10-5: the `typescript` of the first report (this repo).
        typescript: reports[0]?.typescript ?? null,
        files: reports.reduce((s, r) => s + (r.files || 0), 0),
        fieldEntries: reports.reduce((s, r) => s + (r.fieldEntries || 0), 0),
        modelsFound: reports.reduce((s, r) => s + (r.modelsFound || 0), 0),
        fields: countFields(models),
        models,
        ...found,
    };
};

// check the shape of a report read from `--with` (throws `ArgError`).
export const readReport = file => {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        throw new ArgError(`cannot read --with ${file} (${e.code || e.message})`);
    }
    // the fields `mergeReports` needs.
    const ok =
        value &&
        typeof value === 'object' &&
        typeof value.repo === 'string' &&
        Array.isArray(value.models) &&
        value.models.every(m => m && typeof m.name === 'string' && Array.isArray(m.fields));
    if (!ok) throw new ArgError(`--with ${file} is not a fields-types report (run with --json)`);
    return value;
};

// the most models listed per kind in one conflict line.
const MAX_LIST = 3;

// one conflict line: `  - <sev> <name>: <type>[<Model>(<file>:<line>), ...] vs <type>[...]`.
export const conflictLine = c => {
    const kinds = [...new Set(c.decls.map(d => d.type))];
    const parts = kinds.map(k => {
        const at = [...new Set(c.decls.filter(d => d.type === k).map(d => `${label(d)}(${d.file}:${d.line})`))];
        const more = at.length > MAX_LIST ? `, +${at.length - MAX_LIST}` : '';
        return `${k}[${at.slice(0, MAX_LIST).join(', ')}${more}]`;
    });
    return `  - ${c.severity} ${c.name}: ${parts.join(' vs ')}`;
};

// the text output: one summary line, then one line per conflict.
export const formatSummary = report => {
    const hard = report.conflicts.filter(c => c.severity === 'hard').length;
    const order = report.conflicts.length - hard;
    const head =
        `fields-types repo=${report.repo} models=${report.models.length} fields=${report.fields}` +
        ` conflicts=${report.conflicts.length} (hard=${hard} order=${order})` +
        ` any=${report.any.length} mixed=${report.mixed.length} unresolved=${report.unresolved.length}` +
        ` ts=${report.typescript?.version ?? '?'}`;
    return [head, ...report.conflicts.map(conflictLine)].join('\n');
};

// exit code for `--fail-on`: 1 when a conflict at or above the level exists.
export const exitCode = (report, failOn = 'hard') => {
    if (failOn === 'none') return 0;
    const hit = failOn === 'hard' ? report.conflicts.some(c => c.severity === 'hard') : report.conflicts.length > 0;
    return hit ? 1 : 0;
};

// run the check; returns the exit code. deps: `{ log, error }` (both optional).
export const run = (argv, deps = {}) => {
    const log = deps.log || (s => console.log(s));
    const error = deps.error || (s => console.error(s));
    try {
        const opts = parseOptions(argv);
        if (opts.help) {
            log(HELP.join('\n'));
            return 0;
        }
        // read the `--with` reports first, so a bad file stops before the TS program is built.
        const others = opts.with.map(readReport);
        const own = checkRepo(opts);
        const report = others.length ? mergeReports([own, ...others]) : own;
        log(opts.json ? JSON.stringify(report, null, 2) : formatSummary(report));
        return exitCode(report, opts.failOn);
    } catch (e) {
        // argument and program errors exit 2; anything else is a bug and exits 2 too (no result).
        error(`ERROR: ${e?.message ?? e}`);
        return 2;
    }
};
