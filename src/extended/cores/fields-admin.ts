/**
 * `fields-admin.ts`
 * - v5 B4: the one verifier of the `GET /<type>/fields/admin` report.
 * - used by the server's own self-check (`doGetAdminFields()`) and by every test or harness
 *   (vitest, express, jest, local server, deployed Lambda), so all of them check the same rules.
 * - pure: no imports, so `lemon-core/dist/extended/cores/fields-admin` loads without the engine.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-28 v5 B4: `checkFieldsAdmin()` as the single verifier of `fields/admin`.
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */

/**
 * runtime of the report: tells the local harness from the deployed Lambda.
 */
export interface FieldsAdminRuntime {
    /** `$U.isLocalMode()` (`LOCAL_MODE=1` and not in Lambda) */
    local: boolean;
    /** the request has a `domain` (API-GW, ALB, URL, express) */
    external: boolean;
    /** `AWS_LAMBDA_FUNCTION_NAME`, or `null` outside Lambda */
    lambda: string | null;
    /** `process.version` */
    node: string;
    /** the `lemon-core` version of the service */
    lemonCore: string;
}

/**
 * the report of `GET /<type>/fields/admin`.
 */
export interface FieldsAdminReport {
    id: 'fields';
    /** api type (ex: `tests`) */
    type: string;
    /** model type of the manager (ex: `test`) */
    model: string;
    /** L2 core fields: `fieldsOf(CoreModel)` */
    core: string[];
    /** the manager's `FIELDS` */
    fields: string[];
    /** `fields` minus `core`, in `fields` order */
    extra: string[];
    /** lengths of the three lists */
    counts: { core: number; fields: number; extra: number };
    /** `class` if a model class was passed to the manager, else `list` */
    source: 'class' | 'list';
    /** `issues.length === 0` */
    ok: boolean;
    /** one short line per failed self-check */
    issues: string[];
    runtime: FieldsAdminRuntime;
}

/**
 * optional expectations: only the given keys are checked.
 * - `runtime.lambda`: `true` = any non-empty name, `false` = `null`, a string = exact name.
 */
export interface FieldsAdminExpect {
    type?: string;
    model?: string;
    source?: 'class' | 'list';
    counts?: Partial<FieldsAdminReport['counts']>;
    extra?: string[];
    core?: string[];
    lemonCore?: string;
    runtime?: { local?: boolean; external?: boolean; lambda?: boolean | string };
}

//* the three list names, in report order.
const LISTS = ['core', 'fields', 'extra'] as const;

//* true if the value is a plain (non-array) object.
const isObject = (v: any): boolean => !!v && typeof v === 'object' && !Array.isArray(v);

//* true if the value is an array of non-empty strings.
const isNames = (v: any): v is string[] => Array.isArray(v) && v.every(k => typeof k === 'string' && k.length > 0);

//* names that appear more than once (each extra occurrence).
const dupsOf = (list: string[]): string[] => list.filter((k, i) => list.indexOf(k) !== i);

//* short text of a value for a message.
const textOf = (v: any): string => (Array.isArray(v) ? v.join(',') : v === undefined ? 'undefined' : `${v}`);

/**
 * check a `fields/admin` report, and the optional expectations.
 * - each failed check is one short line in `issues`; `ok = issues.length === 0`.
 * - order: (a) structure, (b) content self-checks, (c) expectations.
 * - the report's own non-empty `issues` add one line; (b) runs on the lists, so a tampered
 *   report with `ok: true` and `issues: []` still fails.
 *
 * ```ts
 * const res = await request(app).get('/pets/fields/admin');
 * const { ok, issues } = checkFieldsAdmin(res.body, { type: 'pets', source: 'class', runtime: { lambda: false } });
 * if (!ok) console.error(issues.join('\n'));
 * ```
 */
export const checkFieldsAdmin = (report: any, expect?: FieldsAdminExpect): { ok: boolean; issues: string[] } => {
    const issues: string[] = [];
    const add = (line: string) => issues.push(line);
    if (!isObject(report)) {
        add('report is not an object');
        return { ok: false, issues };
    }
    const R = report;

    //* (a) structure: id, the three lists, counts, extra, source, issues/ok, runtime.
    if (R.id !== 'fields') add(`id is not fields: ${textOf(R.id)}`);
    LISTS.forEach(k => !isNames(R[k]) && add(`${k} is not a list of names`));
    const lists = isNames(R.core) && isNames(R.fields) && isNames(R.extra);
    if (!isObject(R.counts)) add('counts is not an object');
    else
        LISTS.forEach(k => {
            //* a broken list is already reported above.
            if (Array.isArray(R[k]) && R.counts[k] !== R[k].length)
                add(`counts.${k}=${textOf(R.counts[k])} but ${k} has ${R[k].length}`);
        });
    if (lists) {
        const expected = R.fields.filter((k: string) => !R.core.includes(k));
        if (expected.join(',') !== R.extra.join(','))
            add(`extra=${R.extra.join(',')} but fields minus core=${expected.join(',')}`);
    }
    if (R.source !== 'class' && R.source !== 'list') add(`source is not class|list: ${textOf(R.source)}`);
    const own = Array.isArray(R.issues) && R.issues.every((s: any) => typeof s === 'string');
    if (!own) add('issues is not a list of strings');
    else if (R.ok !== (R.issues.length === 0)) add(`ok=${textOf(R.ok)} but issues has ${R.issues.length}`);
    const T = R.runtime;
    if (!isObject(T)) add('runtime is not an object');
    else {
        ['local', 'external'].forEach(k => typeof T[k] !== 'boolean' && add(`runtime.${k} is not boolean`));
        if (!(T.lambda === null || (typeof T.lambda === 'string' && T.lambda.length > 0)))
            add(`runtime.lambda is not null or a name: ${textOf(T.lambda)}`);
        if (!(typeof T.node === 'string' && /^v\d+\.\d+\.\d+/.test(T.node)))
            add(`runtime.node is not a version: ${textOf(T.node)}`);
        if (!(typeof T.lemonCore === 'string' && /^\d+\.\d+\.\d+/.test(T.lemonCore)))
            add(`runtime.lemonCore is not a version: ${textOf(T.lemonCore)}`);
    }

    //* (b) content self-checks on the lists (the server's own `issues`).
    const core: string[] = isNames(R.core) ? R.core : [];
    const fields: string[] = isNames(R.fields) ? R.fields : [];
    if (isNames(R.core)) {
        if (core.length < 14) add(`core has ${core.length} names (< 14)`);
        ['id', '_id'].forEach(k => !core.includes(k) && add(`core misses ${k}`));
        if (dupsOf(core).length) add(`core has duplicates: ${dupsOf(core).join(',')}`);
    }
    if (isNames(R.fields)) {
        if (!fields.length) add('fields is empty');
        if (dupsOf(fields).length) add(`fields has duplicates: ${dupsOf(fields).join(',')}`);
    }
    //* a class-fed manager inherits all core fields; a list may filter some (ex: `$`, `_id`) by design.
    if (lists && R.source === 'class') {
        const missing = core.filter(k => !fields.includes(k));
        if (missing.length) add(`fields misses core: ${missing.join(',')}`);
    }
    //* the report's own issues, as one line.
    if (own && R.issues.length) add(`report has ${R.issues.length} issues: ${R.issues.join('; ')}`);

    //* (c) expectations: only the given keys.
    const E = expect ?? {};
    const same = (name: string, want: any, got: any) =>
        textOf(want) !== textOf(got) && add(`expected ${name}=${textOf(want)} got ${textOf(got)}`);
    if (E.type !== undefined) same('type', E.type, R.type);
    if (E.model !== undefined) same('model', E.model, R.model);
    if (E.source !== undefined) same('source', E.source, R.source);
    if (E.counts) LISTS.forEach(k => E.counts[k] !== undefined && same(`counts.${k}`, E.counts[k], R.counts?.[k]));
    if (E.extra) same('extra', E.extra, R.extra);
    if (E.core) same('core', E.core, R.core);
    if (E.lemonCore !== undefined) same('lemonCore', E.lemonCore, T?.lemonCore);
    if (E.runtime?.local !== undefined) same('runtime.local', E.runtime.local, T?.local);
    if (E.runtime?.external !== undefined) same('runtime.external', E.runtime.external, T?.external);
    //* lambda: `true` = any name, `false` = null, a string = exact.
    const lambda = E.runtime?.lambda;
    const gotLambda = T?.lambda;
    if (lambda === true && !(typeof gotLambda === 'string' && gotLambda.length > 0))
        add(`expected runtime.lambda=<name> got ${textOf(gotLambda)}`);
    if (lambda === false && gotLambda !== null) add(`expected runtime.lambda=null got ${textOf(gotLambda)}`);
    if (typeof lambda === 'string' && gotLambda !== lambda)
        add(`expected runtime.lambda=${lambda} got ${textOf(gotLambda)}`);

    return { ok: issues.length === 0, issues };
};
