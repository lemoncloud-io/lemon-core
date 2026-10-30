/**
 * `os2-query-service.b18.spec.ts`
 * - v5 B18: offline unit test of `OS2QueryService` over a fake `OS2CoreService` (no OpenSearch).
 * - table tests of `buildQueryBody()` (search params → query DSL), and of the result mapping.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B18-b)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, expect, it, vi } from 'vitest';
import { OS2QueryService } from './os2-query-service';
import { OS2CoreService } from './os2-service';
import $hangul from './hangul-service';
import { GETERR } from '../../common/test-helper';

//* v5 B18: a fake core service (only `options` and `searchRaw()` are used by the query service).
const fakeService = (searchRaw = vi.fn(), options: any = {}) =>
    ({
        options: { endpoint: 'http://localhost:9200', indexName: 'test-index', idName: '$id', ...options },
        searchRaw,
    } as any as OS2CoreService);

// a hit as OpenSearch returns it.
const hit = (id: string, source: any, sort?: any[]) => ({ _id: id, _score: 1.5, _source: { ...source }, sort });

describe('OS2QueryService (B18 offline)', () => {
    it('B18 constructor needs indexName', () => {
        expect(() => new OS2QueryService(fakeService(undefined, { indexName: '' }))).toThrow('.indexName is required');
        expect(new OS2QueryService(fakeService()).hello()).toBe('os2-query-service:test-index');
    });

    //* table: search param → query body.
    const Q = (query: string) => ({ query: { query_string: { query } } });
    const cases: Array<[string, any, any]> = [
        ['empty', {}, {}],
        ['internal key ignored', { _x: 1 }, {}],
        ['number', { n: 3 }, Q('n:3')],
        ['empty string', { name: '' }, Q('name:""')],
        ['space is quoted', { name: 'a b' }, Q('name:"a b"')],
        ['colon is quoted', { name: 'x:y' }, Q('name:"x:y"')],
        ['quote is escaped', { name: 'a"b c' }, Q('name:"a\\"b c"')],
        ['group kept', { name: '(a OR b)' }, Q('name:(a OR b)')],
        ['string block kept', { name: '"q r"' }, Q('name:"q r"')],
        ['comma list', { type: 'x, y' }, Q('type:(x OR y)')],
        ['array', { type: ['x', 'y z'] }, Q('type:(x OR "y z")')],
        ['not', { '!type': 'x' }, Q('type:(NOT x)')],
        ['not list', { '!type': 'x,y' }, Q('type:(NOT (x OR y))')],
        ['not empty', { '!type': null }, Q('_exists_:type')],
        ['undefined skipped', { a: undefined, b: 1 }, Q('b:1')],
        ['exists', { $exist: 'a,!b, ' }, Q('_exists_:a AND NOT _exists_:b')],
        ['exists array', { $exists: ['c', ''] }, Q('_exists_:c')],
        ['$Q string', { $Q: 'a:1 OR b:2', c: 3 }, Q('(a:1 OR b:2) AND c:3')],
        ['$Q json', { $Q: '{"match_all":{}}' }, { match_all: {} }],
        ['$Q object', { $Q: { query: { term: { a: 1 } } } }, { query: { term: { a: 1 } } }],
        ['$Q empty', { $Q: '' }, {}],
        ['$query json', { $query: '{"match":{"a":1}}' }, { query: { match: { a: 1 } } }],
        ['$query object', { $query: { term: { a: 1 } } }, { query: { term: { a: 1 } } }],
        ['$query other', { $query: 5 }, { query: '5' }],
        [
            'aggregation',
            { $A: 'brand, color:5,' },
            { aggs: { brand: { terms: { field: 'brand' } }, color: { terms: { field: 'color', size: 5 } } } },
        ],
        ['order', { $O: 'name,!age, ,!' }, { sort: [{ name: { order: 'asc' } }, { age: { order: 'desc' } }] }],
        ['order empty', { $O: '!' }, {}],
        [
            'highlight',
            { $H: 'title,,body' },
            { highlight: { fields: { title: { type: 'unified' }, body: { type: 'unified' } } } },
        ],
        ['paging', { $limit: 5, $page: 2 }, { size: 5, from: 10 }],
        ['limit only', { $limit: 3 }, { size: 3 }],
        ['page only', { $page: 3 }, {}],
        ['source all', { $source: '*' }, { _source: '*' }],
        ['source list', { $source: 'a,!b, ' }, { _source: { includes: ['a'], excludes: ['b'] } }],
        ['source raw', { $source: ['a'] }, { _source: ['a'] }],
        ['projection', { '#name': 1, '#age': 1 }, { _source: { includes: ['name', 'age'], excludes: [] } }],
        ['projection + source', { $source: { includes: ['a'] }, '#b': 1 }, { _source: { includes: ['a', 'b'] } }],
    ];
    it.each(cases)('B18 buildQueryBody(): %s', (_name, param, expected) => {
        const $q = new OS2QueryService(fakeService());
        expect($q.buildQueryBody(param)).toEqual(expected);
    });

    it('B18 asQueryResult() maps hits, total, last and aggregations', () => {
        const $q = new OS2QueryService<any>(fakeService());
        expect(() => $q.asQueryResult({}, {})).toThrow('.hits (object) is required');

        //* total as number (ES6), no `last` when hits < size.
        const r1 = $q.asQueryResult({}, { hits: { total: 1, hits: [hit('a', { name: 'A' })] } });
        expect(r1).toEqual({ list: [{ name: 'A', _id: 'a', _score: 1.5 }], total: 1, last: undefined });

        //* total as `{ value }` (since v7), `last` is the sort of the last hit; internal fields removed.
        const res = {
            hits: {
                total: { value: 9 },
                hits: [
                    hit('a', { _id: 'own', [OS2CoreService.DECOMPOSED_FIELD]: {}, [OS2CoreService.QWERTY_FIELD]: {} }),
                    hit('b', {}, [2, 'b']),
                ],
            },
            aggregations: {
                brand: {
                    doc_count_error_upper_bound: 1,
                    sum_other_doc_count: 2,
                    buckets: [{ key: 'x', doc_count: 3 }],
                },
                avg: { value: 1 },
            },
        };
        const r2 = $q.asQueryResult({ size: 2 }, res);
        expect(r2.total).toBe(9);
        expect(r2.last).toEqual([2, 'b']);
        expect(r2.list[0]).toEqual({ _id: 'own', _score: 1.5 });
        expect(r2.aggregations).toEqual({ brand: [{ key: 'x', count: 3 }] });
    });

    it('B18 searchSimple() and queryAll() send the built body', async () => {
        const searchRaw = vi.fn().mockResolvedValue({ hits: { total: 0, hits: [] } });
        const $q = new OS2QueryService(fakeService(searchRaw));
        expect(await $q.searchSimple(null).catch(GETERR)).toBe('@param (SimpleSearchParam) is required');
        expect(await $q.search(null).catch(GETERR)).toBe('@body (SearchBody) is required');

        expect(await $q.searchSimple({ name: 'a' } as any)).toEqual({ list: [], total: 0, last: undefined });
        expect(searchRaw).toHaveBeenLastCalledWith(Q('name:a'), undefined);

        await $q.search({ size: 1 }, 'dfs_query_then_fetch');
        expect(searchRaw).toHaveBeenLastCalledWith({ size: 1 }, 'dfs_query_then_fetch');

        //* queryAll(): id, limit and order.
        await $q.queryAll('A1', 5, true);
        expect(searchRaw).toHaveBeenLastCalledWith(
            { ...Q('$id:A1'), sort: [{ A1: { order: 'desc' } }], size: 5 },
            undefined,
        );
        await $q.queryAll('A2');
        expect(searchRaw).toHaveBeenLastCalledWith(Q('$id:A2'), undefined);
        await $q.queryAll('A3', undefined, false);
        expect(searchRaw).toHaveBeenLastCalledWith({ ...Q('$id:A3'), sort: [{ A3: { order: 'asc' } }] }, undefined);
    });

    it('B18 asSearchBody() validates and builds the autocomplete query', () => {
        const $q = new OS2QueryService(fakeService(undefined, { autocompleteFields: ['name'] }));
        const err = (p: any) => {
            try {
                $q.asSearchBody(p);
                return 'ok';
            } catch (e) {
                return GETERR(e);
            }
        };
        expect(err(null)).toBe('@param (AutocompleteSearchParam) is required');
        expect(err({})).toBe('.query is required');
        expect(err({ $query: {} })).toBe('.query is required');
        expect(err({ $query: { name: 'a', b: 'c' } })).toBe('.query accepts only one property');
        expect(err({ $query: { name: '' } })).toBe('.query is invalid');
        expect(err({ $query: { title: 'a' } })).toBe('.query has no autocomplete field');

        const { field, query, body } = $q.asSearchBody({
            $query: { name: '레몬' },
            $filter: { type: 'fruit' },
            $limit: 5,
            $page: 2,
        } as any);
        expect([field, query]).toEqual(['name', '레몬']);
        expect(body).toEqual({
            query: {
                bool: {
                    should: [
                        { match: { [`${OS2CoreService.DECOMPOSED_FIELD}.name`]: $hangul.asJamoSequence('레몬') } },
                        { match: { [`${OS2CoreService.QWERTY_FIELD}.name`]: '레몬' } },
                    ],
                    minimum_should_match: 1,
                    filter: [{ term: { type: 'fruit' } }],
                },
            },
            size: 5,
            from: 10,
        });
        //* default paging.
        const b2 = $q.asSearchBody({ $query: { name: 'a' } } as any).body;
        expect([b2.size, b2.from, b2.query.bool.filter]).toEqual([10, 0, undefined]);
    });

    it('B18 searchAutocomplete() highlights the matched text', async () => {
        const hits = () => ({
            hits: {
                total: 2,
                hits: [hit('1', { name: 'Hello COVID 19 news' }), hit('2', { name: 'other' }), hit('3', {})],
            },
        });
        const searchRaw = vi.fn().mockImplementation(async () => hits());
        const $q = new OS2QueryService<any>(fakeService(searchRaw, { autocompleteFields: ['name'] }));

        //* no highlight: list as is.
        const r0 = await $q.searchAutocomplete({ $query: { name: 'covid' } } as any);
        expect(r0.list.map((_: any) => _._highlight)).toEqual([undefined, undefined, undefined]);

        //* default tag `em`; spaces in the query are optional in the text.
        const r1 = await $q.searchAutocomplete({ $query: { name: 'covid19' }, $highlight: true } as any);
        expect(r1.list.map((_: any) => _._highlight)).toEqual(['Hello <em>COVID 19</em> news', 'other', '']);
        expect(r1.total).toBe(2);

        //* custom tag.
        const r2 = await $q.searchAutocomplete({ $query: { name: 'news' }, $highlight: 'b' } as any);
        expect(r2.list[0]._highlight).toBe('Hello COVID 19 <b>news</b>');
    });
});
