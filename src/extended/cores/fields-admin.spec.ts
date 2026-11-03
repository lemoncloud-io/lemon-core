/**
 * `fields-admin.spec.ts`
 * - test of `checkFieldsAdmin()`: one tampering → exactly one issue line.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-28 v5 B4: the shared verifier of `fields/admin`.
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it } from 'vitest';
import { expect2 } from '../../common/test-helper';
import { checkFieldsAdmin, FieldsAdminReport } from './fields-admin';

//* the L2 core names (16) as `fieldsOf(CoreModel)` lists them.
const L1 = 'ns,type,stereo,sid,uid,gid,lock,next,meta,createdAt,updatedAt,deletedAt,error'.split(',');
const CORE = ['$', ...L1, 'id', '_id'];

//* a consistent report: counts and extra derived from the lists, then overrides.
const make = (over: Partial<FieldsAdminReport> & { core?: string[]; fields?: string[] } = {}): any => {
    const core = over.core ?? CORE;
    const fields = over.fields ?? [...L1, 'id', 'name', 'test', 'extra'];
    const extra = fields.filter(k => !core.includes(k));
    return {
        id: 'fields',
        type: 'tests',
        model: 'test',
        core,
        fields,
        extra,
        counts: { core: core.length, fields: fields.length, extra: extra.length },
        source: 'list',
        ok: true,
        issues: [],
        runtime: { local: true, external: true, lambda: null, node: 'v24.1.0', lemonCore: '5.0.0' },
        ...over,
    };
};

//* only the issues of a check.
const issuesOf = (report: any, expect?: any) => checkFieldsAdmin(report, expect).issues;

describe('checkFieldsAdmin (B4)', () => {
    //* a valid report, with and without expectations.
    it('should pass a valid report', () => {
        expect2(() => checkFieldsAdmin(make())).toEqual({ ok: true, issues: [] });
        expect2(() =>
            checkFieldsAdmin(make(), {
                type: 'tests',
                model: 'test',
                source: 'list',
                counts: { core: 16, fields: 17, extra: 3 },
                extra: ['name', 'test', 'extra'],
                core: CORE,
                lemonCore: '5.0.0',
                runtime: { local: true, external: true, lambda: false },
            }),
        ).toEqual({ ok: true, issues: [] });
        //* class source with all core names.
        expect2(() => checkFieldsAdmin(make({ source: 'class', fields: [...CORE, 'name'] }))).toEqual({
            ok: true,
            issues: [],
        });
    });

    //* not an object: one line, nothing else.
    it('should pass non-object input', () => {
        expect2(() => checkFieldsAdmin(null)).toEqual({ ok: false, issues: ['report is not an object'] });
        expect2(() => issuesOf(undefined)).toEqual(['report is not an object']);
        expect2(() => issuesOf('fields')).toEqual(['report is not an object']);
        expect2(() => issuesOf([])).toEqual(['report is not an object']);
    });

    //* (a) id and lists.
    it('should pass structure of id and lists', () => {
        expect2(() => issuesOf(make({ id: 'field' as any }))).toEqual(['id is not fields: field']);
        expect2(() => issuesOf({ ...make(), extra: 'name' })).toEqual(['extra is not a list of names']);
        //* an empty name, counts kept consistent.
        expect2(() => issuesOf({ ...make(), extra: ['name', 'test', ''] })).toEqual(['extra is not a list of names']);
        expect2(() => issuesOf({ ...make(), core: [...CORE.slice(1), 1] })).toEqual(['core is not a list of names']);
    });

    //* (a) counts and extra.
    it('should pass structure of counts and extra', () => {
        const R = make();
        expect2(() => issuesOf({ ...R, counts: { ...R.counts, fields: 18 } })).toEqual([
            'counts.fields=18 but fields has 17',
        ]);
        expect2(() => issuesOf({ ...R, counts: null })).toEqual(['counts is not an object']);
        expect2(() => issuesOf({ ...R, extra: ['test', 'name', 'extra'] })).toEqual([
            'extra=test,name,extra but fields minus core=name,test,extra',
        ]);
    });

    //* (a) source, issues/ok.
    it('should pass structure of source and ok', () => {
        expect2(() => issuesOf(make({ source: 'json' as any }))).toEqual(['source is not class|list: json']);
        expect2(() => issuesOf(make({ issues: 'none' as any }))).toEqual(['issues is not a list of strings']);
        expect2(() => issuesOf(make({ ok: false }))).toEqual(['ok=false but issues has 0']);
    });

    //* (a) runtime.
    it('should pass structure of runtime', () => {
        const T = make().runtime;
        expect2(() => issuesOf(make({ runtime: null }))).toEqual(['runtime is not an object']);
        expect2(() => issuesOf(make({ runtime: { ...T, local: 1 } }))).toEqual(['runtime.local is not boolean']);
        expect2(() => issuesOf(make({ runtime: { ...T, external: 'y' } }))).toEqual([
            'runtime.external is not boolean',
        ]);
        expect2(() => issuesOf(make({ runtime: { ...T, lambda: '' } }))).toEqual([
            'runtime.lambda is not null or a name: ',
        ]);
        expect2(() => issuesOf(make({ runtime: { ...T, node: '24.1.0' } }))).toEqual([
            'runtime.node is not a version: 24.1.0',
        ]);
        expect2(() => issuesOf(make({ runtime: { ...T, lemonCore: '^5.0.0' } }))).toEqual([
            'runtime.lemonCore is not a version: ^5.0.0',
        ]);
        expect2(() => issuesOf(make({ runtime: { ...T, lemonCore: null } }))).toEqual([
            'runtime.lemonCore is not a version: null',
        ]);
    });

    //* (b) content: a tampered report with `ok: true` and `issues: []` still fails.
    it('should pass content self-checks', () => {
        expect2(() => issuesOf(make({ core: CORE.slice(3) }))).toEqual(['core has 13 names (< 14)']);
        expect2(() => issuesOf(make({ core: CORE.filter(k => k !== '_id') }))).toEqual(['core misses _id']);
        expect2(() => issuesOf(make({ core: [...CORE, 'ns'] }))).toEqual(['core has duplicates: ns']);
        expect2(() => issuesOf(make({ fields: [] }))).toEqual(['fields is empty']);
        expect2(() => issuesOf(make({ fields: [...L1, 'id', 'name', 'name'] }))).toEqual([
            'fields has duplicates: name',
        ]);
        //* class source must keep every core name; a list may drop some.
        expect2(() => issuesOf(make({ source: 'class' }))).toEqual(['fields misses core: $,_id']);
        expect2(() => issuesOf(make({ source: 'list' }))).toEqual([]);
    });

    //* (b) the report's own issues: one line, no double report.
    it('should pass the report own issues', () => {
        const R = make({ fields: [], ok: false, issues: ['fields is empty'] });
        expect2(() => checkFieldsAdmin(R)).toEqual({
            ok: false,
            issues: ['fields is empty', 'report has 1 issues: fields is empty'],
        });
        expect2(() => issuesOf(make({ ok: false, issues: ['a', 'b'] }))).toEqual(['report has 2 issues: a; b']);
    });

    //* (c) expectations: type, model, source, counts, extra, core, lemonCore.
    it('should pass expectations', () => {
        const R = make();
        expect2(() => issuesOf(R, { type: 'pets' })).toEqual(['expected type=pets got tests']);
        expect2(() => issuesOf(R, { model: 'pet' })).toEqual(['expected model=pet got test']);
        expect2(() => issuesOf(R, { source: 'class' })).toEqual(['expected source=class got list']);
        expect2(() => issuesOf(R, { counts: { fields: 19 } })).toEqual(['expected counts.fields=19 got 17']);
        expect2(() => issuesOf(R, { counts: { core: 16, extra: 2 } })).toEqual(['expected counts.extra=2 got 3']);
        expect2(() => issuesOf(R, { extra: ['test', 'name', 'extra'] })).toEqual([
            'expected extra=test,name,extra got name,test,extra',
        ]);
        expect2(() => issuesOf(R, { core: CORE.slice(1) })).toEqual([
            `expected core=${CORE.slice(1).join(',')} got ${CORE.join(',')}`,
        ]);
        expect2(() => issuesOf(R, { lemonCore: '5.0.1' })).toEqual(['expected lemonCore=5.0.1 got 5.0.0']);
    });

    //* (c) runtime expectations: local, external, lambda (true/false/name).
    it('should pass runtime expectations', () => {
        const R = make();
        const L = make({ runtime: { ...R.runtime, local: false, external: false, lambda: 'my-api-dev' } });
        expect2(() => issuesOf(R, { runtime: { local: false } })).toEqual(['expected runtime.local=false got true']);
        expect2(() => issuesOf(R, { runtime: { external: false } })).toEqual([
            'expected runtime.external=false got true',
        ]);
        expect2(() => issuesOf(R, { runtime: { lambda: true } })).toEqual(['expected runtime.lambda=<name> got null']);
        expect2(() => issuesOf(L, { runtime: { lambda: true } })).toEqual([]);
        expect2(() => issuesOf(L, { runtime: { lambda: false } })).toEqual([
            'expected runtime.lambda=null got my-api-dev',
        ]);
        expect2(() => issuesOf(L, { runtime: { lambda: 'my-api-dev' } })).toEqual([]);
        expect2(() => issuesOf(L, { runtime: { lambda: 'other' } })).toEqual([
            'expected runtime.lambda=other got my-api-dev',
        ]);
    });
});
