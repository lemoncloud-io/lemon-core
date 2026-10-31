/**
 * `bin/lib/fields-types.spec.mjs` (lemon-core)
 * - offline tests for `fields-types.mjs` on the dummy models of `fixtures/fields-types/` (no AWS, no OpenSearch).
 * - run: `npm test` (vitest `bin/**\/*.spec.mjs`).
 */
//* v5 B10-5: ported from lemon-templates-api `bin/lib/fields-types.test.mjs` (node:test -> vitest), plus resolver cases.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, cpSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
    run,
    parseOptions,
    collectModels,
    normalizeType,
    flattenFields,
    findConflicts,
    mergeReports,
    formatSummary,
    severityOf,
    checkRepo,
    exitCode,
    resolveTypeScript,
    ArgError,
} from './fields-types.mjs';

// the CLI entry.
const SCRIPT = fileURLToPath(new URL('../lemon-fields-types.mjs', import.meta.url));

// the fixture repo (dummy models only).
const FIXTURE = fileURLToPath(new URL('fixtures/fields-types/', import.meta.url));

// the `typescript` package of lemon-core itself (what `self` resolves to).
const SELF_TS = createRequire(import.meta.url)('typescript/package.json');
const SELF_TS_DIR = dirname(createRequire(import.meta.url).resolve('typescript/package.json'));

// the known conflicts of the fixture at deep 2 (name -> severity).
const KNOWN = {
    error: 'hard',
    hidden: 'hard',
    owner$: 'hard',
    count: 'order',
    kind: 'order',
    'owner$.id': 'order',
    tags: 'order',
};

// one TS program takes about a second; the CLI cases spawn several.
const SLOW = 60000;

// run the CLI with `args`; returns `{ status, stdout, stderr }`.
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

// a one-model report as `--json` writes it.
const fakeReport = (repo, model, fields) => ({
    repo,
    deep: 2,
    rule: 'R',
    files: 1,
    fieldEntries: 1,
    modelsFound: 1,
    fields: fields.length,
    models: [{ name: model, file: 'src/model.ts', line: 1, rules: ['R'], fields }],
    conflicts: [],
    any: [],
    mixed: [],
    other: [],
    unresolved: [],
});

// a copy of the fixture in a temp dir (no `node_modules` above it), with optional `node_modules/typescript`.
const copyFixture = ({ withTs = false } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'fields-types-'));
    const root = join(dir, 'repo');
    cpSync(FIXTURE, root, { recursive: true });
    // link lemon-core's own `typescript` into the copy, so the copy resolves it as its own.
    if (withTs) {
        mkdirSync(join(root, 'node_modules'));
        symlinkSync(SELF_TS_DIR, join(root, 'node_modules', 'typescript'), 'dir');
    }
    return { dir, root };
};

describe('fields-types: collect and normalize', () => {
    let collected;
    let report;
    // one TS program for this block (building it takes about a second).
    beforeAll(() => {
        collected = collectModels({ root: FIXTURE });
        report = checkRepo({ root: FIXTURE, deep: 2 });
    }, SLOW);

    it('rule R takes the 5 `$FIELD` models; RH adds the CoreModel-shaped view', () => {
        expect(collected.models.map(m => m.name).sort()).toEqual(['AModel', 'BModel', 'CModel', 'DModel', 'EModel']);
        expect(collected.fieldEntries).toBe(5);
        expect(collected.unresolved).toEqual([]);
        const rh = collectModels({ root: FIXTURE, models: 'RH' });
        expect(rh.models.map(m => m.name).sort()).toEqual(['AModel', 'BModel', 'CModel', 'DModel', 'EModel', 'EView']);
    });

    it('finds all 7 known conflicts: hard 3, order 4', () => {
        const got = Object.fromEntries(report.conflicts.map(c => [c.name, c.severity]));
        expect(got).toEqual(KNOWN);
        expect(report.conflicts.filter(c => c.severity === 'hard').length).toBe(3);
        expect(report.conflicts.filter(c => c.severity === 'order').length).toBe(4);
        // hard first, then by name.
        expect(report.conflicts.map(c => c.name)).toEqual([
            'error',
            'hidden',
            'owner$',
            'count',
            'kind',
            'owner$.id',
            'tags',
        ]);
    });

    it('a field of CoreModel (`error?: string`) conflicts with a model field (`error: object`)', () => {
        const c = report.conflicts.find(x => x.name === 'error');
        const core = c.decls.filter(d => d.type === 'string');
        expect(core.length).toBeGreaterThanOrEqual(4);
        expect(core.every(d => d.file === 'lemon-model:core-storage.d.ts')).toBe(true);
        expect(c.decls.filter(d => d.type === 'object').map(d => [d.model, d.file])).toEqual([
            ['CModel', 'src/model.ts'],
        ]);
    });

    it('normalization: nullish dropped, literal unions, arrays, Date, index signature', () => {
        const fields = Object.fromEntries(
            collected.models.map(m => [m.name, Object.fromEntries(flattenFields(m, 2).map(f => [f.name, f.type]))]),
        );
        // `number | null` -> number.
        expect(fields.EModel.size).toBe('number');
        // `'x' | 'y' | null` -> string; `1 | 2` -> number; `0 | 1` (BoolFlag) -> number.
        expect(fields.CModel.kind).toBe('string');
        expect(fields.DModel.kind).toBe('number');
        expect(fields.AModel.hidden).toBe('number');
        // `string[]` -> string; `number[]` -> number.
        expect(fields.AModel.tags).toBe('string');
        expect(fields.BModel.tags).toBe('number');
        // `Date` -> date (not object, not flattened).
        expect(fields.AModel.at).toBe('date');
        expect(Object.keys(fields.AModel).some(k => k.startsWith('at.'))).toBe(false);
        // index signature -> `labels.*` dynamic, not in any list or count.
        expect(fields.EModel.labels).toBe('object');
        expect(fields.EModel['labels.*']).toBe('dynamic');
        expect(report.any.some(d => d.name.startsWith('labels'))).toBe(false);
        // `string | number` -> mixed; `any` -> any; `meta?: string | any` -> any.
        expect(fields.EModel.either).toBe('mixed');
        expect(fields.EModel.loose).toBe('any');
        expect(fields.AModel.meta).toBe('any');
        expect(report.mixed.map(d => [d.name, d.model])).toEqual([['either', 'EModel']]);
        // stored names only: no `_id`, no `$`.
        expect('_id' in fields.AModel || '$' in fields.AModel).toBe(false);
    });

    it('normalizeType reads a type through the checker', () => {
        const a = collected.models.find(m => m.name === 'AModel');
        // the kind of one property of `AModel`.
        const kind = name =>
            normalizeType(collected.checker, collected.checker.getTypeOfSymbol(a.type.getProperty(name)));
        expect(kind('count')).toBe('number');
        expect(kind('owner$')).toBe('object');
        expect(kind('at')).toBe('date');
    });

    it(
        '--deep 0 checks the top level only',
        () => {
            const top = checkRepo({ root: FIXTURE, deep: 0 });
            expect(top.conflicts.some(c => c.name.includes('.'))).toBe(false);
            expect(top.conflicts.length).toBe(6);
        },
        SLOW,
    );
});

describe('fields-types: severity, merge, format', () => {
    it('severityOf: object vs scalar and boolean vs number are hard; the rest is order', () => {
        expect(severityOf('object', 'string')).toBe('hard');
        expect(severityOf('number', 'object')).toBe('hard');
        expect(severityOf('boolean', 'number')).toBe('hard');
        expect(severityOf('date', 'boolean')).toBe('hard');
        expect(severityOf('string', 'number')).toBe('order');
        expect(severityOf('boolean', 'string')).toBe('order');
        expect(severityOf('date', 'string')).toBe('order');
        expect(severityOf('date', 'number')).toBe('order');
    });

    it('findConflicts ignores any, mixed, and dynamic', () => {
        const r = findConflicts([
            { name: 'X', fields: [{ name: 'a', type: 'any', file: 'x.ts', line: 1 }] },
            { name: 'Y', fields: [{ name: 'a', type: 'string', file: 'y.ts', line: 1 }] },
            { name: 'Z', fields: [{ name: 'a', type: 'mixed', file: 'z.ts', line: 1 }] },
            { name: 'W', fields: [{ name: 'b.*', type: 'dynamic', file: 'w.ts', line: 1 }] },
        ]);
        expect(r.conflicts).toEqual([]);
        expect(r.any.length).toBe(1);
        expect(r.mixed.length).toBe(1);
    });

    it('mergeReports: one name with two types in two repos is a conflict', () => {
        const a = fakeReport('one-api', 'AModel', [{ name: 'score', type: 'number', file: 'src/a.ts', line: 3 }]);
        const b = fakeReport('two-api', 'BModel', [{ name: 'score', type: 'string', file: 'src/b.ts', line: 7 }]);
        // each repo alone is clean.
        expect(findConflicts(a.models).conflicts.length).toBe(0);
        const m = mergeReports([a, b]);
        expect(m.repo).toBe('one-api+two-api');
        expect(m.conflicts.length).toBe(1);
        expect(m.conflicts[0].name).toBe('score');
        expect(m.conflicts[0].severity).toBe('order');
        expect(m.conflicts[0].decls.map(d => [d.repo, d.model, d.type])).toEqual([
            ['one-api', 'AModel', 'number'],
            ['two-api', 'BModel', 'string'],
        ]);
        // order only: passes --fail-on hard, fails --fail-on order.
        expect(exitCode(m, 'hard')).toBe(0);
        expect(exitCode(m, 'order')).toBe(1);
        expect(formatSummary(m)).toMatch(/- order score: number\[one-api:AModel\(src\/a\.ts:3\)\] vs string\[two-api:/);
    });

    it(
        'formatSummary: one summary line, then one line per conflict',
        () => {
            const report = checkRepo({ root: FIXTURE, deep: 2 });
            const lines = formatSummary(report).split('\n');
            expect(lines[0]).toMatch(
                /^fields-types repo=fields-types models=5 fields=\d+ conflicts=7 \(hard=3 order=4\) any=\d+ mixed=1 unresolved=0 ts=\S+$/,
            );
            expect(lines.length).toBe(8);
            expect(lines[2]).toMatch(
                /^ {2}- hard hidden: number\[AModel\(src\/model\.ts:\d+\)\] vs boolean\[BModel\(src\/model\.ts:\d+\)\]$/,
            );
            // more than 3 models of one type: `+<n>`.
            expect(lines[1]).toMatch(
                /^ {2}- hard error: string\[[^\]]*, \+\d+\] vs object\[CModel\(src\/model\.ts:\d+\)\]$/,
            );
            expect(exitCode(report, 'hard')).toBe(1);
            expect(exitCode(report, 'none')).toBe(0);
        },
        SLOW,
    );
});

describe('fields-types: arguments and CLI', () => {
    it('parseOptions: defaults, repeats, and bad values', () => {
        const o = parseOptions([]);
        expect(o.deep).toBe(2);
        expect(o.models).toBe('R');
        expect(o.failOn).toBe('hard');
        expect(o.with).toEqual([]);
        expect(parseOptions(['--with', 'a.json', '--with=b.json']).with.length).toBe(2);
        expect(() => parseOptions(['--deep', 'x'])).toThrow(ArgError);
        expect(() => parseOptions(['--deep', '11'])).toThrow(ArgError);
        expect(() => parseOptions(['--models', 'H'])).toThrow(ArgError);
        expect(() => parseOptions(['--fail-on', 'soft'])).toThrow(ArgError);
        expect(() => parseOptions(['--foo'])).toThrow(/unknown option --foo/);
        expect(() => parseOptions(['extra'])).toThrow(/unknown argument extra/);
        expect(() => parseOptions(['--root'])).toThrow(/--root needs a value/);
        expect(parseOptions(['--foo', '--help'])).toEqual({ help: true });
    });

    it('run: --help prints the usage and exits 0', () => {
        const out = [];
        expect(run(['--help'], { log: s => out.push(s) })).toBe(0);
        expect(out[0]).toMatch(/usage: lemon-fields-types \[options\]/);
        expect(out[0]).toMatch(/npx lemon-fields-types/);
        expect(out[0]).toMatch(/npm run fields:types -- \[options\]/);
    });

    it(
        'exit 1: hard conflicts with the default --fail-on hard',
        () => {
            const r = cli('--root', FIXTURE);
            expect(r.status, r.stderr).toBe(1);
            expect(r.stdout).toMatch(/^fields-types repo=fields-types models=5 .* conflicts=7 \(hard=3 order=4\)/);
        },
        SLOW,
    );

    it(
        'exit 0 with --fail-on none, exit 1 with --fail-on order; --models RH',
        () => {
            expect(cli('--root', FIXTURE, '--fail-on', 'none').status).toBe(0);
            expect(cli('--root', FIXTURE, '--fail-on', 'order').status).toBe(1);
            // `--models RH` adds one order conflict (`size`); still 3 hard.
            const rh = cli('--root', FIXTURE, '--models', 'RH', '--fail-on', 'none');
            expect(rh.status).toBe(0);
            expect(rh.stdout).toMatch(/models=6 .* conflicts=8 \(hard=3 order=5\)/);
            expect(rh.stdout).toMatch(/- order size: number\[EModel\(src\/model\.ts:\d+\)\] vs string\[EView/);
        },
        SLOW,
    );

    it(
        'exit 2: bad arguments, no src/, an unreadable --with report',
        () => {
            const bad = cli('--deep', 'x');
            expect(bad.status).toBe(2);
            expect(bad.stderr.trim()).toBe('ERROR: --deep must be 0-10 (got: x)');
            const dir = mkdtempSync(join(tmpdir(), 'fields-types-'));
            try {
                const nosrc = cli('--root', dir);
                expect(nosrc.status).toBe(2);
                expect(nosrc.stderr).toMatch(/^ERROR: no src\/ directory in /);
                const junk = join(dir, 'junk.json');
                writeFileSync(junk, '{"repo":"x"}');
                const r = cli('--root', FIXTURE, '--with', junk);
                expect(r.status).toBe(2);
                expect(r.stderr).toMatch(/is not a fields-types report/);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        SLOW,
    );

    it(
        '--json then --with: the other repo is merged as the same index',
        () => {
            const dir = mkdtempSync(join(tmpdir(), 'fields-types-'));
            try {
                // a full report round-trips through --json.
                const json = cli('--root', FIXTURE, '--json', '--fail-on', 'none');
                expect(json.status, json.stderr).toBe(0);
                const own = JSON.parse(json.stdout);
                expect(own.repo).toBe('fields-types');
                expect(own.conflicts.length).toBe(7);
                // another repo where `at` is a number: date vs number, order.
                const other = join(dir, 'other.json');
                const at = [{ name: 'at', type: 'number', file: 'src/x.ts', line: 9 }];
                writeFileSync(other, JSON.stringify(fakeReport('other-api', 'XModel', at)));
                const r = cli('--root', FIXTURE, '--with', other, '--fail-on', 'none');
                expect(r.status, r.stderr).toBe(0);
                expect(r.stdout).toMatch(
                    /^fields-types repo=fields-types\+other-api models=6 .* conflicts=8 \(hard=3 order=5\)/,
                );
                expect(r.stdout).toMatch(
                    /- order at: date\[fields-types:AModel\(src\/model\.ts:\d+\)\] vs number\[other-api:XModel\(src\/x\.ts:9\)\]/,
                );
                // the merged summary shows the `typescript` of the first report (this repo).
                expect(r.stdout.split('\n')[0]).toMatch(new RegExp(` ts=${SELF_TS.version.replace(/\./g, '\\.')}$`));
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        SLOW,
    );
});

//* v5 B10-5: `typescript` resolution (root -> --fallback -> self).
describe('fields-types: typescript resolution', () => {
    it(
        'a root with its own typescript: from root',
        () => {
            const { dir, root } = copyFixture({ withTs: true });
            try {
                const r = checkRepo({ root, deep: 2 });
                expect(r.typescript).toEqual({ version: SELF_TS.version, from: 'root' });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        SLOW,
    );

    it(
        'a root without typescript and no --fallback: from self',
        () => {
            const { dir, root } = copyFixture();
            try {
                const r = checkRepo({ root, deep: 2 });
                expect(r.typescript).toEqual({ version: SELF_TS.version, from: 'self' });
                // the copy has no lemon-model either: the package is reported, not a crash.
                expect(r.unresolved).toEqual(['lemon-model']);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        SLOW,
    );

    it('a root without typescript and a --fallback that has it: from fallback', () => {
        const { dir, root } = copyFixture();
        try {
            // a `node_modules` dir with only `typescript` in it.
            const nm = join(dir, 'fb', 'node_modules');
            mkdirSync(nm, { recursive: true });
            symlinkSync(SELF_TS_DIR, join(nm, 'typescript'), 'dir');
            const r = resolveTypeScript(root, [nm]);
            expect(r.from).toBe('fallback');
            expect(r.version).toBe(SELF_TS.version);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('no typescript anywhere: ArgError (exit 2) that names the three places', () => {
        const { dir, root } = copyFixture();
        try {
            // `self` moved to the temp dir, so nothing resolves.
            const self = pathToFileURL(join(dir, 'self.mjs')).href;
            expect(() => resolveTypeScript(root, [join(dir, 'none')], self)).toThrow(ArgError);
            expect(() => resolveTypeScript(root, [join(dir, 'none')], self)).toThrow(
                /^cannot resolve typescript from --root .+, --fallback \(1 dirs\), or lemon-core itself/,
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it(
        '--json carries typescript.version and typescript.from',
        () => {
            const json = cli('--root', FIXTURE, '--json', '--fail-on', 'none');
            expect(json.status, json.stderr).toBe(0);
            const r = JSON.parse(json.stdout);
            expect(r.typescript.version).toBe(SELF_TS.version);
            expect(['root', 'fallback', 'self']).toContain(r.typescript.from);
        },
        SLOW,
    );

    it(
        'the summary line ends with ts=<version>; the detail lines do not',
        () => {
            const r = cli('--root', FIXTURE, '--fail-on', 'none');
            expect(r.status, r.stderr).toBe(0);
            const lines = r.stdout.trim().split('\n');
            expect(lines[0].split(' ').pop()).toBe(`ts=${SELF_TS.version}`);
            expect(lines.slice(1).some(l => l.includes(' ts='))).toBe(false);
        },
        SLOW,
    );
});
